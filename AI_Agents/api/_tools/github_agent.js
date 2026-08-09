/**
 * github_agent.js — GitHub Copilot coding-agent provider for B.L.A.S.T.
 *
 * B.L.A.S.T. delegates real automation work to the GitHub Copilot coding agent:
 * it creates an issue in the framework repo (with instructions to follow AGENT.md +
 * the pw-new-automation skill), assigns it to Copilot, and then polls the linked PR
 * and its CI checks. The agent does the plan → locator capture → 3-layer generation →
 * execution → PR entirely on GitHub.
 *
 * Configuration (all via env — NEVER commit the token):
 *   GITHUB_TOKEN            fine-grained PAT (Issues RW, Pull requests RW, Actions R, Contents R)
 *   GITHUB_OWNER            e.g. lmoreshwar         (or set GITHUB_REPO_URL)
 *   GITHUB_REPO             e.g. PLAYWRIGHT_BLAST_FRAMEWORK
 *   GITHUB_REPO_URL         optional full URL; parsed into owner/repo if the two above are unset
 *   GITHUB_DEFAULT_BRANCH   default 'main'
 *   COPILOT_ASSIGNEE_LOGIN  optional override; auto-detected otherwise
 */
const axios = require('axios');
const PizZip = require('pizzip');

const API = 'https://api.github.com';
const GRAPHQL = 'https://api.github.com/graphql';

function parseRepoUrl(url) {
  const m = String(url || '').match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  return m ? { owner: m[1], repo: m[2] } : { owner: '', repo: '' };
}

function repoConfig() {
  const fromUrl = parseRepoUrl(process.env.GITHUB_REPO_URL);
  return {
    token: process.env.GITHUB_TOKEN || '',
    owner: process.env.GITHUB_OWNER || fromUrl.owner || '',
    repo: process.env.GITHUB_REPO || fromUrl.repo || '',
    branch: process.env.GITHUB_DEFAULT_BRANCH || 'main',
    copilotLogin: process.env.COPILOT_ASSIGNEE_LOGIN || '',
  };
}

function isConfigured() {
  const { token, owner, repo } = repoConfig();
  return Boolean(token && owner && repo);
}

function headers() {
  const { token } = repoConfig();
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'blast-automation-orchestrator',
  };
}

function friendlyError(err, context) {
  const status = err.response?.status;
  const msg = err.response?.data?.message || err.message;
  return new Error(`GitHub ${context} failed${status ? ` (${status})` : ''}: ${msg}`);
}

/**
 * Find the Copilot coding-agent actor that can be assigned to issues in this repo.
 * Doubles as the "is the coding agent enabled?" check.
 * Returns { available, id, login }.
 */
async function findCopilotActor() {
  const { owner, repo, copilotLogin } = repoConfig();
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        suggestedActors(capabilities: [CAN_BE_ASSIGNED], first: 100) {
          nodes { login __typename ... on Bot { id } ... on User { id } }
        }
      }
    }`;
  try {
    const { data } = await axios.post(
      GRAPHQL,
      { query, variables: { owner, repo } },
      { headers: headers() }
    );
    if (data.errors?.length) throw new Error(data.errors.map((e) => e.message).join('; '));
    const nodes = data.data?.repository?.suggestedActors?.nodes || [];
    const match = nodes.find((n) => {
      const login = (n.login || '').toLowerCase();
      if (copilotLogin) return login === copilotLogin.toLowerCase();
      return login === 'copilot' || login === 'copilot-swe-agent' || login.includes('copilot');
    });
    return match
      ? { available: true, id: match.id, login: match.login }
      : { available: false, id: '', login: '' };
  } catch (err) {
    throw friendlyError(err, 'actor lookup');
  }
}

function buildIssueBody(job) {
  const cases = job.testCases || [];
  const rows = cases
    .map((tc) => `| ${tc.id} | ${tc.title || ''} | ${tc.tags || ''} | ${tc.complexity || ''} |`)
    .join('\n');

  return [
    `Automate the selected test case(s) in this framework. **Follow \`AGENT.md\` and the \`pw-new-automation\` skill exactly** — this is binding policy.`,
    '',
    '## Target',
    `- **Application URL:** ${job.url || '(not provided)'}`,
    `- **Environment:** ${job.environment || 'QA'}`,
    `- **Agent persona:** ${job.agent || 'AI Native Playwright Engineer'}`,
    `- **Skill:** ${job.skill || 'New Automation'}`,
    `- **Execution mode:** ${job.executionMode || 'GenerateAndExecute'}`,
    job.comments ? `- **Notes:** ${job.comments}` : '',
    '',
    '## Test cases to automate',
    '| ID | Title | Tags | Complexity |',
    '| --- | --- | --- | --- |',
    rows || '| — | — | — | — |',
    '',
    '## Required workflow (non-negotiable)',
    '1. **Reuse-first:** check `.ai-memory/capabilities.json` and existing `src/pages`/`src/modules`/`src/tests` before creating anything new.',
    '2. **Evidence-based locators:** capture real refs with `@playwright/cli` (`playwright-cli open <url>` → `snapshot`). Never guess a locator.',
    '3. **3-layer architecture:** locators in `src/pages/*Page.ts`, workflows in `src/modules/*Module.ts`, assertions in `src/tests/*.spec.ts`. Group all cases of one domain into one `[domain].spec.ts`.',
    '4. **Wrappers only:** use `Actions` / `WaitHelper` / `WorkflowActions`; centralized `TIMEOUTS`; secrets from `.env` via `credentials()`/`env()`.',
    '5. **Validate before opening the PR:** `npx playwright test <spec> --project=desktop-chrome` green · `npm run lint` 0 · `npx tsc --noEmit` 0 · `npm run index` to refresh capabilities.',
    '6. Keep `saucectl.yml` in sync for any new/renamed spec.',
    '',
    '## Definition of done',
    '- [ ] New/updated Page, Module, and Spec following the 3-layer rules',
    '- [ ] All targeted test cases pass locally on `desktop-chrome`',
    '- [ ] Lint + type-check clean',
    '- [ ] PR opened into `main` with a summary of changed files and the test result',
    '',
    `_Requested via B.L.A.S.T. job ${job.jobId}._`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Create the automation issue and assign it to the Copilot coding agent.
 * Returns { issueNumber, issueUrl, issueNodeId, assigned, copilotLogin }.
 */
async function createAutomationIssue(job) {
  const { owner, repo } = repoConfig();
  const title = `[Automation] ${job.project || 'App'} — ${(job.testCases || []).length} test case(s) (${job.jobId})`;

  // Verify Copilot is assignable BEFORE creating the issue, for a clear error.
  const actor = await findCopilotActor();
  if (!actor.available) {
    throw new Error(
      'GitHub Copilot coding agent is not assignable on this repository. Enable it (Copilot Pro/Pro+/Business/Enterprise with coding agent) and confirm "Copilot" appears in the issue Assignees list.'
    );
  }

  let issue;
  try {
    const { data } = await axios.post(
      `${API}/repos/${owner}/${repo}/issues`,
      { title, body: buildIssueBody(job) },
      { headers: headers() }
    );
    issue = data;
  } catch (err) {
    throw friendlyError(err, 'create issue');
  }

  // Assign Copilot via GraphQL (REST assignees does not accept the bot actor).
  const mutation = `
    mutation($assignableId: ID!, $actorIds: [ID!]!) {
      replaceActorsForAssignable(input: { assignableId: $assignableId, actorIds: $actorIds }) {
        assignable { ... on Issue { number } }
      }
    }`;
  try {
    const { data } = await axios.post(
      GRAPHQL,
      { query: mutation, variables: { assignableId: issue.node_id, actorIds: [actor.id] } },
      { headers: headers() }
    );
    if (data.errors?.length) throw new Error(data.errors.map((e) => e.message).join('; '));
  } catch (err) {
    throw friendlyError(err, 'assign Copilot');
  }

  return {
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    issueNodeId: issue.node_id,
    assigned: true,
    copilotLogin: actor.login,
  };
}

/**
 * Find the PR the coding agent opened for this issue (via cross-reference timeline).
 * Returns the most recent linked PR or null.
 */
async function findLinkedPullRequest(issueNumber) {
  const { owner, repo } = repoConfig();
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        issue(number: $number) {
          timelineItems(itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT], first: 50) {
            nodes {
              __typename
              ... on CrossReferencedEvent {
                source { ... on PullRequest { number url state isDraft headRefOid merged } }
              }
              ... on ConnectedEvent {
                subject { ... on PullRequest { number url state isDraft headRefOid merged } }
              }
            }
          }
        }
      }
    }`;
  try {
    const { data } = await axios.post(
      GRAPHQL,
      { query, variables: { owner, repo, number: issueNumber } },
      { headers: headers() }
    );
    if (data.errors?.length) throw new Error(data.errors.map((e) => e.message).join('; '));
    const nodes = data.data?.repository?.issue?.timelineItems?.nodes || [];
    const prs = nodes
      .map((n) => n.source || n.subject)
      .filter((p) => p && p.number);
    return prs.length ? prs[prs.length - 1] : null;
  } catch (err) {
    throw friendlyError(err, 'linked PR lookup');
  }
}

/**
 * Aggregate check-run conclusions for a commit SHA.
 * Returns 'pending' | 'passed' | 'failed' | 'none'.
 */
async function checksForSha(sha) {
  const { owner, repo } = repoConfig();
  if (!sha) return 'none';
  try {
    const { data } = await axios.get(
      `${API}/repos/${owner}/${repo}/commits/${sha}/check-runs`,
      { headers: headers() }
    );
    const runs = data.check_runs || [];
    if (runs.length === 0) return 'none';
    const incomplete = runs.some((r) => r.status !== 'completed');
    if (incomplete) return 'pending';
    const failed = runs.some((r) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(r.conclusion));
    return failed ? 'failed' : 'passed';
  } catch (err) {
    throw friendlyError(err, 'check-runs lookup');
  }
}

/**
 * Poll the agent's progress for a job. Maps GitHub state → B.L.A.S.T. job status.
 * Returns { status, prUrl, checksStatus, executionStatus, logs }.
 */
async function getProgress(job) {
  if (!job.issueNumber) {
    return { status: job.status, prUrl: job.prUrl || '', checksStatus: '', executionStatus: '', logs: [] };
  }

  const pr = await findLinkedPullRequest(job.issueNumber);
  if (!pr) {
    return {
      status: 'Generating',
      prUrl: '',
      checksStatus: '',
      executionStatus: '',
      logs: ['[github] Coding agent is working — no pull request opened yet.'],
    };
  }

  if (pr.merged) {
    return {
      status: 'PushedToGate',
      prUrl: pr.url,
      checksStatus: 'passed',
      executionStatus: 'PASSED',
      logs: [`[github] PR #${pr.number} merged.`],
    };
  }

  const checks = await checksForSha(pr.headRefOid);
  const statusByChecks = {
    pending: 'Executing',
    passed: 'Passed',
    failed: 'Failed',
    none: 'Executing',
  };
  const executionByChecks = { passed: 'PASSED', failed: 'FAILED', pending: '', none: '' };

  return {
    status: statusByChecks[checks],
    prUrl: pr.url,
    checksStatus: checks,
    executionStatus: executionByChecks[checks],
    logs: [`[github] PR #${pr.number} (${pr.state.toLowerCase()}${pr.isDraft ? ', draft' : ''}) — checks: ${checks}.`],
  };
}

/**
 * Trigger the BLAST Runner GitHub Actions workflow (cloud runner). The workflow
 * checks out the framework, generates + runs the tests, and opens a PR — all in
 * the cloud, no laptop terminals. Uses the REST workflow_dispatch endpoint.
 *
 * Requires: GITHUB_TOKEN with Actions:write on the framework repo, GITHUB_OWNER,
 * GITHUB_REPO. Returns { dispatched, ref, workflow, runsUrl }.
 */
async function dispatchWorkflow(job) {
  const { owner, repo, branch } = repoConfig();
  const workflow = process.env.BLAST_WORKFLOW_FILE || 'blast-runner.yml';
  const ref = process.env.BLAST_WORKFLOW_REF || branch || 'main';

  const payload = {
    jobId: job.jobId,
    project: job.project || '',
    environment: job.environment || 'QA',
    url: job.url || '',
    agent: job.agent || 'AI Native Playwright Engineer',
    skill: job.skill || 'New Automation',
    executionMode: job.executionMode || 'GenerateAndExecute',
    comments: job.comments || '',
    browser: job.browser || 'Chrome',
    testScope: job.testScope || 'Generated only',
    parallel: job.parallel || 'Auto',
    testCases: (job.testCases || []).map((tc) => ({
      id: tc.id,
      title: tc.title || '',
      tags: tc.tags || '',
      complexity: tc.complexity || 'Medium',
      description: tc.description || '',
      preconditions: tc.preconditions || '',
      testData: tc.testData || '',
      steps: tc.steps || '',
      expectedResults: tc.expectedResults || '',
      comments: tc.comments || '',
    })),
  };

  try {
    await axios.post(
      `${API}/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      { ref, inputs: { job_id: String(job.jobId), job_payload: JSON.stringify(payload), browser: job.browser || 'Chrome' } },
      { headers: headers() },
    );
    return {
      dispatched: true,
      ref,
      workflow,
      runsUrl: `https://github.com/${owner}/${repo}/actions/workflows/${workflow}`,
    };
  } catch (err) {
    throw friendlyError(err, 'workflow dispatch');
  }
}

/**
 * Live progress for the cloud (GitHub Actions) path: resolve the dispatched run,
 * read its jobs/steps, and return a FULL log snapshot the caller replaces each poll
 * (so steps never duplicate). Returns { status, checksStatus, executionStatus,
 * prUrl, runId, runHtmlUrl, snapshotLogs }.
 */
async function getWorkflowRunProgress(job) {
  const { owner, repo, branch } = repoConfig();
  const workflow = process.env.BLAST_WORKFLOW_FILE || 'blast-runner.yml';
  const header = Array.isArray(job.dispatchLogs) && job.dispatchLogs.length
    ? job.dispatchLogs
    : (job.logs || []);
  const snap = (lines) => [...header, ...(lines.length ? ['', '── GitHub Actions run ──', ...lines] : [])];

  try {
    // 1) Resolve the run id (cache it on the job after the first poll).
    let runId = job.runId;
    let runHtmlUrl = job.reportUrl || '';
    if (!runId) {
      const { data } = await axios.get(
        `${API}/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch || 'main')}&per_page=10`,
        { headers: headers() },
      );
      const floor = job.dispatchedAt ? new Date(job.dispatchedAt).getTime() - 60000 : 0;
      const run = (data.workflow_runs || [])
        .filter((r) => new Date(r.created_at).getTime() >= floor)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (!run) {
        return { status: 'Generating', snapshotLogs: snap(['⟳ Waiting for the workflow run to start…']) };
      }
      runId = run.id;
      runHtmlUrl = run.html_url;
    }

    // 2) Read the run + its jobs/steps.
    const [runRes, jobsRes] = await Promise.all([
      axios.get(`${API}/repos/${owner}/${repo}/actions/runs/${runId}`, { headers: headers() }),
      axios.get(`${API}/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, { headers: headers() }),
    ]);
    const runData = runRes.data;
    runHtmlUrl = runData.html_url || runHtmlUrl;

    const lines = [];
    const allSteps = [];
    for (const j of runData_jobs(jobsRes.data)) {
      lines.push(`▸ ${j.name} — ${j.status}${j.conclusion ? ` (${j.conclusion})` : ''}`);
      for (const s of (j.steps || [])) {
        allSteps.push(s);
        const icon = s.conclusion === 'success' ? '✓'
          : s.conclusion === 'failure' ? '✗'
          : s.conclusion === 'skipped' ? '⊘'
          : s.status === 'in_progress' ? '⟳' : '•';
        lines.push(`   ${icon} ${s.name}`);
      }
    }

    const st = runData.status;         // queued | in_progress | completed
    const conc = runData.conclusion;   // success | failure | cancelled | null

    // Effective completion: don't hang on GitHub's teardown. Once every substantive step
    // (everything except the auto "Post *" / "Complete job" steps) has finished, the run is
    // functionally done — surface Passed/Failed and the report immediately.
    const isTeardown = (name) => /^Post\b/i.test(name || '') || /^Complete job$/i.test(name || '');
    const substantive = allSteps.filter((s) => !isTeardown(s.name));
    const substantiveDone = substantive.length > 0 && substantive.every((s) => s.status === 'completed');
    const substantiveFailed = substantive.some((s) => ['failure', 'timed_out', 'cancelled'].includes(s.conclusion));
    const done = st === 'completed' || substantiveDone;
    const effConc = st === 'completed' ? conc : (substantiveFailed ? 'failure' : 'success');

    const status = !done ? 'Executing' : effConc === 'success' ? 'Passed' : 'Failed';
    if (done) {
      lines.push('', effConc === 'success' ? '✓ Run completed successfully.' : `✗ Run ${effConc || 'failed'}.`);
    }

    // Pull the parsed report summary once the run is functionally done (only if not cached).
    let reportSummary;
    if (done && !job.reportSummary) {
      reportSummary = await getRunReportSummary(job, runId);
    }

    return {
      status,
      prUrl: job.prUrl || '',
      checksStatus: effConc || (done ? '' : 'pending'),
      executionStatus: effConc === 'success' ? 'PASSED' : effConc === 'failure' ? 'FAILED' : '',
      runId,
      runHtmlUrl,
      reportSummary,
      snapshotLogs: snap(lines),
    };
  } catch (err) {
    return { status: job.status, snapshotLogs: snap([`⚠ Could not read run status: ${friendlyError(err, 'run progress').message}`]) };
  }
}

function runData_jobs(data) {
  return Array.isArray(data && data.jobs) ? data.jobs : [];
}

/** Read a single file's UTF-8 content from the framework repo. Returns null if missing. */
async function getFileContent(filePath, ref) {
  const { owner, repo, branch } = repoConfig();
  const r = ref || branch || 'main';
  try {
    const { data } = await axios.get(
      `${API}/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(r)}`,
      { headers: headers() },
    );
    if (data && data.content && data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf8');
    }
    return null;
  } catch (err) {
    if (err.response && err.response.status === 404) return null;
    throw friendlyError(err, `read ${filePath}`);
  }
}

/** List a directory in the framework repo. Returns [{ name, path, type }]; [] if missing. */
async function listDir(dirPath, ref) {  const { owner, repo, branch } = repoConfig();
  const r = ref || branch || 'main';
  try {
    const { data } = await axios.get(
      `${API}/repos/${owner}/${repo}/contents/${dirPath}?ref=${encodeURIComponent(r)}`,
      { headers: headers() },
    );
    return Array.isArray(data) ? data.map((e) => ({ name: e.name, path: e.path, type: e.type })) : [];
  } catch (err) {
    if (err.response && err.response.status === 404) return [];
    throw friendlyError(err, `list ${dirPath}`);
  }
}

/**
 * Download the run's `blast-result-<jobId>` artifact and extract the parsed Playwright
 * report summary (pass/fail counts + per-test steps). Returns null when unavailable.
 */
async function getRunReportSummary(job, runId) {
  const { owner, repo } = repoConfig();
  const id = runId || job.runId;
  if (!id) return null;
  try {
    const { data } = await axios.get(
      `${API}/repos/${owner}/${repo}/actions/runs/${id}/artifacts?per_page=100`,
      { headers: headers(), timeout: 12000 },
    );
    const arts = data.artifacts || [];
    const art = arts.find((a) => a.name === `blast-result-${job.jobId}`)
      || arts.find((a) => a.name.startsWith('blast-result-'));
    if (!art || art.expired) return null;
    const zipRes = await axios.get(art.archive_download_url, {
      headers: headers(),
      responseType: 'arraybuffer',
      maxRedirects: 5,
      timeout: 20000,
    });
    const zip = new PizZip(Buffer.from(zipRes.data));
    const entry = zip.file('blast-ci-result.json');
    if (!entry) return null;
    const parsed = JSON.parse(entry.asText());
    return parsed.reportSummary || null;
  } catch {
    return null;
  }
}

module.exports = {
  isConfigured,
  findCopilotActor,
  createAutomationIssue,
  getProgress,
  repoConfig,
  dispatchWorkflow,
  getWorkflowRunProgress,
  getRunReportSummary,
  getFileContent,
  listDir,
};
