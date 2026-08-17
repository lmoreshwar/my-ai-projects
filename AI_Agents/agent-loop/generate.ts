/**
 * generate.ts — the runner "Generate" entrypoint.
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the single step a GitHub Actions workflow_dispatch job (or a cloud VM)
 * runs. It takes the Autopilot form inputs and produces a merged PR:
 *
 *   explore (agent-loop, live) → codegen (Page/Module/Spec + capability reuse)
 *     → verify the new spec is green → commit to a branch → open a PR → print URL
 *
 * INPUTS (env — GitHub Actions maps workflow inputs + secrets to these):
 *   APP_URL         feature URL to automate            (required)
 *   FEATURE_NAME    human feature name                 (required)
 *   AGENT_USERNAME  login username                     (secret; optional)
 *   AGENT_PASSWORD  login password                     (secret; optional)
 *   TEST_TYPES      comma list e.g. "positive,negative"(optional)
 *   MAX_CASES       max cases to author                (optional, default 3)
 *   FRAMEWORK_PATH  path to the target framework repo  (required)
 *   OPENAI_API_KEY  LLM key                            (required)
 *   GITHUB_TOKEN    the CONNECTED USER's own OAuth / App-installation token with
 *                   `contents:write` + `pull_requests:write` on their repo — NOT the
 *                   default github-actions[bot] token, so the push + PR are attributed
 *                   to their account and respect their permissions   (required for PR)
 *   BASE_BRANCH     PR base branch                     (optional, default main)
 *   PLAYWRIGHT_PROJECT  project name                   (optional, default desktop-chrome)
 *   SKIP_VERIFY=1   skip the green-before-PR spec run  (optional)
 *
 * The PR is opened ONLY when exploration verified the flow AND the generated spec
 * passes — matching the product contract (green → PR, red → no PR).
 */

import { spawn } from 'node:child_process';
import { request } from 'node:https';
import { runAgentLoop } from './agent-loop';
import { generateFromTrace, type CodegenJob } from './codegen';

const log = (l: string) => console.log(l);

interface RepoRef { owner: string; repo: string; }

/** Run a command in a cwd; resolve { code, out }. Uses shell:false so args with spaces are safe. */
function run(cmd: string, args: string[], cwd: string, useShell = false): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: useShell });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
    child.on('error', (e) => resolve({ code: 1, out: e.message }));
  });
}

/** Parse owner/repo from the framework's `origin` remote (github.com only). */
async function deriveRepo(fw: string): Promise<RepoRef | null> {
  const env = process.env.FRAMEWORK_REPO || '';
  const fromEnv = env.match(/([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (fromEnv) return { owner: fromEnv[1], repo: fromEnv[2] };
  const { out } = await run('git', ['remote', 'get-url', 'origin'], fw);
  const m = out.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\s*$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** POST to the GitHub REST API; resolves the parsed JSON body. */
function githubPost(path: string, body: unknown, token: string): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request({
      hostname: 'api.github.com', path, method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'blast-agent-loop',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json: Record<string, unknown> = {};
        try { json = JSON.parse(data || '{}'); } catch { /* keep {} */ }
        resolve({ status: res.statusCode || 0, json });
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function slug(feature: string): string {
  return (feature || 'feature').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'feature';
}

/** Commit the generated files to a new branch and open a PR. Returns the PR URL (or throws). */
export async function commitAndOpenPr(fw: string, feature: string, files: string[]): Promise<string> {
  // GITHUB_TOKEN MUST be the CONNECTED USER's own OAuth token / GitHub App installation token
  // (the workflow maps their token here — NOT the default github-actions[bot] GITHUB_TOKEN), so
  // the push + PR are attributed to their account and respect their repo permissions.
  const token = process.env.GITHUB_TOKEN || '';
  if (!token) throw new Error('GITHUB_TOKEN is not set — cannot open a PR.');
  const repo = await deriveRepo(fw);
  if (!repo) throw new Error('Could not determine owner/repo from the framework git remote.');
  const base = process.env.BASE_BRANCH || 'main';
  // Use the deterministic job-scoped branch when the job id is available so the API's findBlastPr
  // (which reconstructs `blast/auto-<jobId>`) can locate this PR to merge it. Fall back to the
  // feature slug for ad-hoc/local runs that have no job id.
  const jobId = process.env.JOB_ID || '';
  const branch = jobId ? `blast/auto-${jobId}` : `blast/${slug(feature)}`;

  // Stage only the generated files + the regenerated capability index — nothing else.
  await run('git', ['checkout', '-B', branch], fw);
  await run('git', ['add', ...files, '.ai-memory'], fw);
  // Inline identity so a bare CI runner has an author; --no-verify bypasses a broken pre-push hook.
  const commit = await run('git', ['-c', 'user.name=BLAST Automation', '-c', 'user.email=blast-automation@users.noreply.github.com', 'commit', '-m', `test: automate "${feature}" via BLAST agent loop`], fw);
  if (commit.code !== 0 && /nothing to commit/i.test(commit.out)) throw new Error('No generated changes to commit.');
  // Push over an explicitly token-authenticated URL so the push uses the connected user's token
  // (never a stray ambient/service token). Redact the token from any surfaced error output.
  const authRemote = `https://x-access-token:${token}@github.com/${repo.owner}/${repo.repo}.git`;
  const push = await run('git', ['push', '--no-verify', '--force-with-lease', authRemote, `HEAD:refs/heads/${branch}`], fw);
  if (push.code !== 0) throw new Error(`git push failed: ${push.out.replaceAll(token, '«redacted»').slice(0, 300)}`);

  const { status, json } = await githubPost(`/repos/${repo.owner}/${repo.repo}/pulls`, {
    title: `BLAST: automate "${feature}"`,
    head: branch,
    base,
    body: `Automated by the BLAST agent loop.\n\nFeature: ${feature}\nFiles:\n${files.map((f) => `- \`${f}\``).join('\n')}`,
  }, token);

  if (status === 201 && json.html_url) return String(json.html_url);
  // A PR may already exist for this head — surface it instead of failing.
  if (status === 422) return `https://github.com/${repo.owner}/${repo.repo}/compare/${base}...${branch}?expand=1`;
  throw new Error(`GitHub PR create failed (HTTP ${status}): ${JSON.stringify(json).slice(0, 300)}`);
}

/** Run the generated spec headless; resolve true when it passes (gates the PR). */
export async function verifySpec(fw: string, specRel: string): Promise<boolean> {
  if (process.env.SKIP_VERIFY === '1') return true;
  const project = process.env.PLAYWRIGHT_PROJECT || 'desktop-chrome';
  log(`[generate] Verifying ${specRel} on project ${project}…`);
  const { code, out } = await run('npx', ['playwright', 'test', specRel, `--project=${project}`], fw, true);
  if (code === 0) {
    log(out.split('\n').slice(-12).join('\n'));
  } else {
    // Print the FULL Playwright output so the real error (locator/assertion) reaches the CI log,
    // not just the trace-attachment footer that a short tail would capture.
    log('[generate] Verification FAILED — full Playwright output below:');
    log(out);
  }
  return code === 0;
}

export async function generate(): Promise<{ status: string; prUrl?: string; files: string[]; summary: string }> {
  const url = process.env.APP_URL || '';
  const feature = process.env.FEATURE_NAME || '';
  const fw = process.env.FRAMEWORK_PATH || '';
  if (!url || !feature || !fw) throw new Error('APP_URL, FEATURE_NAME and FRAMEWORK_PATH are required.');
  const testTypes = (process.env.TEST_TYPES || 'positive').split(',').map((s) => s.trim()).filter(Boolean);
  const maxCases = Number(process.env.MAX_CASES) > 0 ? Number(process.env.MAX_CASES) : 3;

  // 1) EXPLORE — verify the real flow live (credentials come from env inside runAgentLoop).
  const goal = `Explore and verify the "${feature}" feature. Log in if a login form is present, reach the feature, and exercise its primary flow (${testTypes.join(', ')}), confirming the expected outcome.`;
  log(`[generate] Exploring "${feature}" at ${url}…`);
  const walk = await runAgentLoop({ url, goal, maxSteps: Math.max(15, maxCases * 8), onLog: log });
  if (walk.status === 'failed' || !walk.steps.length) {
    return { status: 'failed', files: [], summary: `Exploration did not verify the flow: ${walk.summary}` };
  }

  // 2) CODEGEN — turn the proven trace into Page/Module/Spec (+ capability reuse & write-back).
  const job: CodegenJob = { feature, url, testTypes, maxCases };
  const art = await generateFromTrace(fw, job, walk.steps, log);
  const specRel = art.files.find((f) => f.includes('/tests/')) || '';

  // 3) VERIFY green before PR.
  if (specRel && !(await verifySpec(fw, specRel))) {
    return { status: 'failed', files: art.files, summary: 'Generated spec did not pass — no PR opened.' };
  }

  // 4) COMMIT + PR.
  const prUrl = await commitAndOpenPr(fw, feature, art.files);
  return { status: 'passed', prUrl, files: art.files, summary: `PR opened: ${prUrl}` };
}

const invokedDirectly =
  (process.argv[1] || '').replace(/\\/g, '/').endsWith('generate.ts') ||
  (process.argv[1] || '').replace(/\\/g, '/').endsWith('generate.js') ||
  process.env.GENERATE_MAIN === '1';

if (invokedDirectly) {
  generate()
    .then((res) => {
      console.log(`\n=== GENERATE: ${res.status.toUpperCase()} ===\n${res.summary}`);
      if (res.prUrl) console.log(`PR_URL=${res.prUrl}`);
      process.exit(res.status === 'passed' ? 0 : 1);
    })
    .catch((e) => { console.error('Generate failed:', e.message); process.exit(1); });
}
