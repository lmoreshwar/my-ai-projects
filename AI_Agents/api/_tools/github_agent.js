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
const { setAppCredentialSecrets } = require('./github_secrets');

const API = 'https://api.github.com';
const GRAPHQL = 'https://api.github.com/graphql';

function parseRepoUrl(url) {
  const m = String(url || '').match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  return m ? { owner: m[1], repo: m[2] } : { owner: '', repo: '' };
}

// `git` (optional) is a per-request override resolved from the caller's GitHub connection:
// { token, owner, repo, branch }. When absent, fall back to the server env — so a job with no
// connection configured behaves exactly as before (single-tenant default). This is what lets a
// customer's PR open in THEIR selected repo using THEIR token, without a secret ever touching the
// persisted job (the token is passed in per call, never stored on job.git).
function repoConfig(git) {
  const fromUrl = parseRepoUrl(process.env.GITHUB_REPO_URL);
  const g = git || {};
  return {
    token: g.token || process.env.GITHUB_TOKEN || '',
    owner: g.owner || process.env.GITHUB_OWNER || fromUrl.owner || '',
    repo: g.repo || process.env.GITHUB_REPO || fromUrl.repo || '',
    branch: g.branch || process.env.GITHUB_DEFAULT_BRANCH || 'main',
    copilotLogin: process.env.COPILOT_ASSIGNEE_LOGIN || '',
  };
}

function isConfigured() {
  const { token, owner, repo } = repoConfig();
  return Boolean(token && owner && repo);
}

function headers(git) {
  const { token } = repoConfig(git);
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
async function dispatchWorkflow(job, git) {
  const { owner, repo, branch, token } = repoConfig(git);
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
    journey: Array.isArray(job.journey) ? job.journey : [],
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
    // SECURITY: app login credentials must NEVER travel as workflow_dispatch inputs (inputs are
    // plain text in the Actions UI/logs). If the caller passed fresh form creds on the transient
    // job.appCredentials, push them as encrypted repo secrets FIRST — the job reads
    // secrets.AGENT_USERNAME / secrets.AGENT_PASSWORD. Uses the SAME user token as the dispatch.
    // No creds present → no-op (the env-based single-tenant path is unchanged).
    const appCreds = job.appCredentials;
    if (appCreds && appCreds.username && appCreds.password) {
      await setAppCredentialSecrets({ token, owner, repo }, appCreds);
    }

    const inputs = { job_id: String(job.jobId), job_payload: JSON.stringify(payload), browser: job.browser || 'Chrome' };
    // Level 3 (agentic live-drive codegen) is ON by default — it mirrors the local agent's
    // evidence-based, verify-before-write flow. Only an explicit false opts out.
    if (job.level3 === false || String(job.level3).toLowerCase() === 'false') inputs.level3 = 'false';
    else inputs.level3 = 'true';
    await axios.post(
      `${API}/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      { ref, inputs },
      { headers: headers(git) },
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
 * PHASE 1 dispatch — trigger the EXPLORE workflow (blast-explore.yml). One headless run drives
 * the live app with the agent-loop, VERIFIES the flow, authors the proposed test cases, and
 * uploads them (plus the verified trace) as the `blast-plan-<jobId>` artifact. NO codegen, NO PR.
 * The website then polls, downloads the plan, shows it, and waits for Approve (phase 2).
 *
 * SECURITY: app login credentials NEVER travel as workflow_dispatch inputs (inputs are plaintext
 * in the Actions UI/logs). Fresh form creds are pushed as encrypted repo secrets FIRST
 * (APP_USERNAME/APP_PASSWORD) using the SAME user token as the dispatch; the workflow reads them
 * from secrets. No creds present → the run uses whatever secrets already exist on the repo.
 *
 * @param {object} job   the explore job (jobId, url, feature, testTypes, maxCases)
 * @param {object} git   resolved GitHub connection { token, owner, repo, branch }
 * @param {object} creds { username, password } transient form creds (never persisted/logged)
 */
async function dispatchExplore(job, git, creds) {
  const { owner, repo, branch, token } = repoConfig(git);
  const workflow = process.env.BLAST_EXPLORE_WORKFLOW || 'blast-explore.yml';
  const ref = process.env.BLAST_WORKFLOW_REF || branch || 'main';

  try {
    if (creds && creds.username && creds.password) {
      await setAppCredentialSecrets({ token, owner, repo }, creds);
    }
    const testTypes = Array.isArray(job.testTypes) ? job.testTypes.join(',') : String(job.testTypes || '');
    const inputs = {
      job_id: String(job.jobId),
      app_url: job.url || '',
      feature_name: job.feature || '',
      summary: job.summary || '',
      test_types: testTypes || 'positive',
      max_cases: String(job.maxCases > 0 ? job.maxCases : 3),
    };
    await axios.post(
      `${API}/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      { ref, inputs },
      { headers: headers(git) },
    );
    return {
      dispatched: true,
      ref,
      workflow,
      runsUrl: `https://github.com/${owner}/${repo}/actions/workflows/${workflow}`,
    };
  } catch (err) {
    throw friendlyError(err, 'explore workflow dispatch');
  }
}

/**
 * PHASE 2 dispatch — trigger the APPROVE workflow (blast-approve.yml). One headless run downloads
 * the `blast-plan-<jobId>` artifact produced by the EXPLORE run, turns the SAME verified trace into
 * Page/Module/Spec, verifies the spec is green, then commits + opens a Pull Request. No exploration.
 * Requires `job.exploreRunId` (the run id of the phase-1 run that holds the plan artifact).
 *
 * @param {object} job   the job (jobId, feature, exploreRunId)
 * @param {object} git   resolved GitHub connection { token, owner, repo, branch }
 */
/**
 * Dispatch a SCOPED smoke run of the framework's own CI workflow (playwright.yml) via
 * workflow_dispatch, filtered to @Smoke-tagged tests only. Used after a BLAST PR is merged so the
 * user can validate the merged suite without triggering the full regression run. Generic: the
 * workflow file + tag are configurable; nothing app-specific here.
 */
async function dispatchSmoke(job, git) {
  const { owner, repo, branch } = repoConfig(git);
  const workflow = process.env.BLAST_SMOKE_WORKFLOW || 'playwright.yml';
  const ref = process.env.BLAST_WORKFLOW_REF || branch || 'main';
  const inputs = {
    environment: process.env.BLAST_SMOKE_ENV || 'qa',
    test_grep: process.env.BLAST_SMOKE_GREP || '@Smoke',
    browser: 'desktop-chrome',
    generate_allure: 'true',
  };
  try {
    await axios.post(
      `${API}/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      { ref, inputs },
      { headers: headers(git) },
    );
    return {
      dispatched: true,
      workflow,
      ref,
      runsUrl: `https://github.com/${owner}/${repo}/actions/workflows/${workflow}`,
    };
  } catch (err) {
    throw friendlyError(err, 'smoke workflow dispatch');
  }
}

async function dispatchApprove(job, git) {
  const { owner, repo, branch } = repoConfig(git);
  const workflow = process.env.BLAST_APPROVE_WORKFLOW || 'blast-approve.yml';
  const ref = process.env.BLAST_WORKFLOW_REF || branch || 'main';
  const exploreRunId = job.exploreRunId || job.runId;
  if (!exploreRunId) throw new Error('Cannot approve: no explore run id on the job (run the plan phase first).');

  try {
    const inputs = {
      job_id: String(job.jobId),
      explore_run_id: String(exploreRunId),
      feature_name: job.feature || '',
      // The scenarios the user selected in the approval UI. approve.ts filters the verified trace to
      // these and enforces an Automation-Trace-step coverage gate (never the discovery inventory).
      // Empty for legacy (non-discovery) plans.
      scenario_ids: Array.isArray(job.selectedScenarioIds) ? job.selectedScenarioIds.join(',') : '',
    };
    await axios.post(
      `${API}/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      { ref, inputs },
      { headers: headers(git) },
    );
    return {
      dispatched: true,
      ref,
      workflow,
      runsUrl: `https://github.com/${owner}/${repo}/actions/workflows/${workflow}`,
    };
  } catch (err) {
    throw friendlyError(err, 'approve workflow dispatch');
  }
}

/**
 * Live progress for the cloud (GitHub Actions) path: resolve the dispatched run,
 * read its jobs/steps, and return a FULL log snapshot the caller replaces each poll
 * (so steps never duplicate). Returns { status, checksStatus, executionStatus,
 * prUrl, runId, runHtmlUrl, snapshotLogs }.
 */
async function getWorkflowRunProgress(job, git) {
  const { owner, repo, branch } = repoConfig(git);
  // Poll whichever workflow this job was dispatched to (the one-job agent-loop workflow, or the
  // legacy runner). job.workflow is set at dispatch time; env/legacy default is the fallback.
  const workflow = job.workflow || process.env.BLAST_WORKFLOW_FILE || 'blast-runner.yml';
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
        { headers: headers(git) },
      );
      const floor = job.dispatchedAt ? new Date(job.dispatchedAt).getTime() - 60000 : 0;
      const run = matchRunForJob(data.workflow_runs, job, floor);
      if (!run) {
        return { status: 'Generating', snapshotLogs: snap(['⟳ Waiting for the workflow run to start…']) };
      }
      runId = run.id;
      runHtmlUrl = run.html_url;
    }

    // 2) Read the run + its jobs/steps.
    const [runRes, jobsRes] = await Promise.all([
      axios.get(`${API}/repos/${owner}/${repo}/actions/runs/${runId}`, { headers: headers(git) }),
      axios.get(`${API}/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, { headers: headers(git) }),
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
    let done = st === 'completed' || substantiveDone;
    const effConc = st === 'completed' ? conc : (substantiveFailed ? 'failure' : 'success');

    // The BLAST gate is the Pull Request. As soon as it exists, the job is functionally
    // done from the app's perspective — surface it and the Merge action without waiting
    // for GitHub's teardown steps (which is what made the UI look "stuck").
    const pr = await findBlastPr(job, git);
    if (pr) done = true;

    // A green GitHub run is NOT proof of success: the runner exits 0 even when the
    // completion gate FAILS (requested cases not automated → PR suppressed). Read the
    // BLAST result artifact to learn the true outcome.
    let result = null;
    if (done && !pr) result = await getRunResult(job, runId, git);
    const verified = !result || result.verified !== false;
    const missingCases = (result && result.missingCases) || [];
    const changedPaths = (result && result.changedPaths) || [];

    // If the run has functionally finished with NO PR, the true pass/fail lives in the
    // blast-ci-result.json artifact. If we can't read it yet AND GitHub hasn't fully
    // finalized the run (and it didn't hard-fail), stay non-terminal so the next poll can
    // classify correctly — this prevents a FALSE "Passed" from a not-yet-uploaded/indexed
    // artifact, which would otherwise stop polling and freeze the run on the wrong status.
    const awaitingResult = done && !pr && !result && st !== 'completed' && effConc !== 'failure';
    if (awaitingResult) done = false;

    const gateFailed = done && !pr && (!verified || effConc === 'failure');

    let status = !done ? 'Executing' : (effConc === 'success' && !gateFailed) ? 'Passed' : 'Failed';
    if (pr && !pr.merged) status = 'PushedToGate';
    if (done) {
      if (gateFailed) {
        lines.push('', '✗ Generation did not pass the completion gate — no Pull Request was opened.');
        if (missingCases.length) lines.push(`   Requested case(s) not automated: ${missingCases.join(', ')}.`);
        lines.push('   Review the run logs and re-run; the existing tests were left unchanged.');
      } else {
        lines.push('', effConc === 'success' ? '✓ Run completed successfully.' : `✗ Run ${effConc || 'failed'}.`);
        if (pr) lines.push(pr.merged ? `✓ Pull Request #${pr.number} merged.` : `⏸ Pull Request #${pr.number} opened — waiting for you to merge.`);
        else if (verified && changedPaths.length === 0) lines.push('ℹ All requested case(s) already automated — nothing new to add (reuse). No Pull Request needed.');
      }
    } else if (awaitingResult) {
      lines.push('', '⟳ Run finished — finalizing results…');
    }

    // Pull the parsed report summary once the run is functionally done (only if not cached).
    let reportSummary;
    if (done && !job.reportSummary) {
      reportSummary = result ? (result.reportSummary || null) : await getRunReportSummary(job, runId, git);
    }

    return {
      status,
      prUrl: (pr && pr.url) || job.prUrl || '',
      prNumber: pr ? pr.number : (job.prNumber || null),
      branch: pr ? pr.branch : (job.branch || ''),
      prMerged: pr ? pr.merged : false,
      prMergeable: pr ? pr.mergeable : null,
      prMergeableState: pr ? pr.mergeableState : '',
      checksStatus: gateFailed ? 'failed' : (effConc || (done ? '' : 'pending')),
      executionStatus: gateFailed ? 'FAILED' : effConc === 'success' ? 'PASSED' : effConc === 'failure' ? 'FAILED' : '',
      gateFailed,
      verified,
      missingCases,
      runId,
      runHtmlUrl,
      reportSummary,
      snapshotLogs: snap(lines),
    };
  } catch (err) {
    return { status: job.status, snapshotLogs: snap([`⚠ Could not read run status: ${friendlyError(err, 'run progress').message}`]) };
  }
}

/**
 * Generic GitHub Actions run-state mapper. Normalizes a workflow run's status + conclusion into
 * ONE lifecycle state, independent of which BLAST phase dispatched it. GitHub run status is
 * queued | in_progress | completed; conclusion is success | failure | cancelled | skipped |
 * timed_out | startup_failure | action_required | neutral | stale | null.
 * @returns {'running'|'success'|'failed'|'cancelled'|'skipped'}
 */
function mapGithubRunState(status, conclusion) {
  if (status !== 'completed') return 'running'; // queued | in_progress | waiting | requested | pending
  switch (conclusion) {
    case 'success': return 'success';
    case 'cancelled': return 'cancelled';
    case 'skipped': return 'skipped';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
    case 'action_required':
    case 'neutral':
    case 'stale':
    default: return 'failed';
  }
}

/**
 * Decide the BLAST explore-phase job status from the normalized GitHub run state and the downloaded
 * plan artifact. A green GitHub run NEVER stays 'Blocked' when the plan contains automatable content:
 * 'Blocked' is reserved for a REAL BLAST state (the exploration verified nothing to automate), never a
 * stale workflow status. This is the pure, testable core of the job-status synchronization layer.
 *
 * @param {'running'|'success'|'failed'|'cancelled'|'skipped'} runState
 * @param {object|null} plan  parsed blast-plan.json ({ status, cases, scenarios, summary }) or null
 * @returns {{ status: string, ready: boolean, reason: string }}
 */
function deriveExploreStatus(runState, plan) {
  if (runState === 'running') return { status: 'Exploring', ready: false, reason: '' };
  if (runState === 'cancelled') return { status: 'Cancelled', ready: false, reason: 'The explore run was cancelled.' };
  if (runState === 'skipped') return { status: 'Skipped', ready: false, reason: 'The explore run was skipped.' };
  if (runState === 'failed') return { status: 'Failed', ready: false, reason: 'The explore run failed — no plan was produced.' };

  // runState === 'success' — the GitHub workflow is green. Classify by REAL plan content.
  if (!plan) return { status: 'Exploring', ready: false, reason: 'Run finished — waiting for the plan artifact…' };

  const cases = Array.isArray(plan.cases) ? plan.cases : [];
  const scenarios = Array.isArray(plan.scenarios) ? plan.scenarios : [];
  const readyScenarios = scenarios.filter((s) => s && s.ready && !s.blocked);
  const automatable = cases.length > 0 || readyScenarios.length > 0;

  // A green run with automatable content is ALWAYS ready to approve — never Blocked (the bug this fixes).
  if (automatable) return { status: 'WaitingForApproval', ready: true, reason: '' };

  // Genuinely nothing to automate — a legitimate BLAST 'Blocked' (no automation-ready scenarios /
  // exploration could not verify a flow), NOT a stale GitHub status.
  const reason = (plan.status && plan.status !== 'passed')
    ? (plan.summary || 'Exploration could not verify a flow to automate.')
    : 'Exploration found no automation-ready scenarios.';
  return { status: 'Blocked', ready: false, reason };
}

/** Project a plan case OR a discovery scenario into the flat testCase shape the UI/table renders. */
function projectPlanStepsToText(steps) {
  if (!Array.isArray(steps)) return steps || '';
  return steps
    .map((st) => (typeof st === 'string' ? st : `${st.order}. ${st.action}${st.input ? ` — ${st.input}` : ''}`))
    .join('\n');
}

/**
 * PHASE 1 progress — poll the EXPLORE run and, once it finishes, download the plan artifact and
 * surface the proposed test cases so the website can show them and wait for Approve.
 *   • run still going            → { status: 'Exploring', … }
 *   • run done + plan automatable → { status: 'WaitingForApproval', testCases, plan, exploreRunId, … }
 *   • run done + nothing to automate → { status: 'Blocked', plan, … }  (real BLAST state)
 *   • run failed / cancelled / skipped → { status: 'Failed' | 'Cancelled' | 'Skipped', … }
 * Returns a FULL log snapshot the caller replaces each poll (steps never duplicate).
 */
async function getExploreRunProgress(job, git) {
  const { owner, repo, branch } = repoConfig(git);
  const workflow = job.workflow || process.env.BLAST_EXPLORE_WORKFLOW || 'blast-explore.yml';
  const header = Array.isArray(job.dispatchLogs) && job.dispatchLogs.length ? job.dispatchLogs : (job.logs || []);
  const snap = (lines) => [...header, ...(lines.length ? ['', '── Explore run ──', ...lines] : [])];

  try {
    // 1) Resolve the run id (cache it on the job after the first poll).
    let runId = job.runId;
    let runHtmlUrl = job.reportUrl || '';
    if (!runId) {
      const { data } = await axios.get(
        `${API}/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch || 'main')}&per_page=10`,
        { headers: headers(git) },
      );
      const floor = job.dispatchedAt ? new Date(job.dispatchedAt).getTime() - 60000 : 0;
      const run = matchRunForJob(data.workflow_runs, job, floor);
      if (!run) return { status: 'Exploring', snapshotLogs: snap(['⟳ Waiting for the explore run to start…']) };
      runId = run.id;
      runHtmlUrl = run.html_url;
    }

    // 2) Read the run + its jobs/steps.
    const [runRes, jobsRes] = await Promise.all([
      axios.get(`${API}/repos/${owner}/${repo}/actions/runs/${runId}`, { headers: headers(git) }),
      axios.get(`${API}/repos/${owner}/${repo}/actions/runs/${runId}/jobs`, { headers: headers(git) }),
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

    const isTeardown = (name) => /^Post\b/i.test(name || '') || /^Complete job$/i.test(name || '');
    const substantive = allSteps.filter((s) => !isTeardown(s.name));
    const substantiveDone = substantive.length > 0 && substantive.every((s) => s.status === 'completed');
    const substantiveFailed = substantive.some((s) => ['failure', 'timed_out', 'cancelled'].includes(s.conclusion));
    const substantiveCancelled = substantive.some((s) => s.conclusion === 'cancelled');

    // The GitHub run id/job id are persisted so Approve/Proceed target the right artifact and so the
    // UI can deep-link the run even after teardown (requirement: persist run_id + job_id on success).
    const githubJobId = (runData_jobs(jobsRes.data)[0] || {}).id || job.githubJobId || null;

    // Normalize the GitHub run into a generic lifecycle state, but don't hang on GitHub's teardown:
    // once every substantive step has finished we treat the run as effectively done.
    let runState = mapGithubRunState(runData.status, runData.conclusion);
    if (runState === 'running' && substantiveDone) {
      runState = substantiveCancelled ? 'cancelled' : substantiveFailed ? 'failed' : 'success';
    }

    if (runState === 'running') {
      return { status: 'Exploring', runId, runHtmlUrl, githubJobId, snapshotLogs: snap(lines) };
    }

    if (runState === 'cancelled') {
      lines.push('', '⊘ Exploration run was cancelled — no plan was produced.');
      return { status: 'Cancelled', runId, runHtmlUrl, githubJobId, snapshotLogs: snap(lines) };
    }
    if (runState === 'skipped') {
      lines.push('', '⊘ Exploration run was skipped — no plan was produced.');
      return { status: 'Skipped', runId, runHtmlUrl, githubJobId, snapshotLogs: snap(lines) };
    }
    if (runState === 'failed') {
      lines.push('', '✗ Exploration run failed — no plan was produced. Review the run logs and retry.');
      return { status: 'Failed', runId, runHtmlUrl, githubJobId, snapshotLogs: snap(lines) };
    }

    // 3) Run is GREEN — pull the plan artifact and classify by its REAL content (never a stale status).
    const plan = await getPlanArtifact(job, runId, git);
    const decision = deriveExploreStatus('success', plan);

    if (decision.status === 'Exploring') {
      // Artifact not indexed yet — keep polling (a green run must not freeze on the wrong status).
      lines.push('', '⟳ Run finished — waiting for the plan artifact…');
      return { status: 'Exploring', runId, runHtmlUrl, githubJobId, snapshotLogs: snap(lines) };
    }

    if (decision.status === 'Blocked') {
      lines.push('', `ℹ ${decision.reason}`);
      return {
        status: 'Blocked',
        runId,
        runHtmlUrl,
        githubJobId,
        exploreRunId: runId,
        plan: plan ? renderPlan(plan) : undefined,
        snapshotLogs: snap(lines),
      };
    }

    // WaitingForApproval — project the proposed cases. Prefer the legacy `cases` array; when a V2 plan
    // ships only ready scenarios, project THOSE so the run is never wrongly Blocked for missing cases.
    const sourceCases = (Array.isArray(plan.cases) && plan.cases.length)
      ? plan.cases
      : (Array.isArray(plan.scenarios) ? plan.scenarios.filter((s) => s && s.ready && !s.blocked) : []);
    const testCases = sourceCases.map((c, i) => ({
      id: c.id || `TC_${String(i + 1).padStart(3, '0')}`,
      title: c.title || `Case ${i + 1}`,
      tags: Array.isArray(c.type) ? c.type.join(', ') : (c.type || ''),
      complexity: 'Medium',
      description: c.expectedResults || '',
      preconditions: '',
      testData: '',
      steps: projectPlanStepsToText(c.steps),
      expectedResults: c.expectedResults || '',
      comments: '',
    }));
    lines.push('', `✓ Exploration verified the flow — ${testCases.length} test case(s) proposed. Review and Approve to generate.`);
    return {
      status: 'WaitingForApproval',
      runId,
      runHtmlUrl,
      githubJobId,
      exploreRunId: runId,
      testCases,
      plan: renderPlan(plan),
      // Full V2 discovery plan (application summary, field inventory, scenarios, completeness) so the
      // API can persist it and the website can render the dossier + scenario picker. Undefined for
      // legacy (non-discovery) plans.
      discoveryPlan: (plan.version === 2 || Array.isArray(plan.scenarios)) ? plan : undefined,
      snapshotLogs: snap(lines),
    };
  } catch (err) {
    return { status: job.status, snapshotLogs: snap([`⚠ Could not read explore status: ${friendlyError(err, 'explore progress').message}`]) };
  }
}

/** Render a plan (feature + proposed cases with steps) as a readable text block for the console. */
function renderPlan(plan) {
  const out = [`Feature: ${plan.feature || ''}`, `URL: ${plan.url || ''}`, ''];
  const cases = Array.isArray(plan.cases) ? plan.cases : [];
  cases.forEach((c, i) => {
    out.push(`${i + 1}. [${c.type || 'positive'}] ${c.title || `Case ${i + 1}`}`);
    (Array.isArray(c.steps) ? c.steps : []).forEach((s) => out.push(`     ${s}`));
    if (c.expectedResults) out.push(`     Expected: ${c.expectedResults}`);
    out.push('');
  });
  return out.join('\n').trimEnd();
}

function runData_jobs(data) {
  return Array.isArray(data && data.jobs) ? data.jobs : [];
}

// Resolve WHICH dispatched run belongs to THIS job. Multiple concurrent explore/approve dispatches
// share the same workflow file + branch, so recency alone can latch onto the wrong run (e.g. an
// earlier feature). Prefer a run whose run-name/title carries this job id (set via `run-name:` in
// the workflow); fall back to the most-recent run after the dispatch floor for older runs.
function matchRunForJob(runs, job, floor) {
  const list = (runs || [])
    .filter((r) => new Date(r.created_at).getTime() >= floor)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const jid = String((job && job.jobId) || '');
  if (jid) {
    const exact = list.find((r) => `${r.name || ''} ${r.display_title || ''}`.includes(jid));
    if (exact) return exact;
  }
  return list[0] || null;
}

/**
 * Find the open BLAST pull request for a job's auto branch.
 * Returns { url, number, branch, state, merged, mergeable, mergeableState } | null.
 * `mergeable`/`mergeableState` come from a follow-up single-PR GET (GitHub computes them
 * asynchronously, so they may be null on the first read and settle on a later poll).
 */
async function findBlastPr(job, git) {
  const { owner, repo } = repoConfig(git);
  const branch = `blast/auto-${job.jobId}`;
  try {
    const { data } = await axios.get(
      `${API}/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=5`,
      { headers: headers(git), timeout: 12000 },
    );
    const pr = (data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    if (!pr) return null;
    const base = { url: pr.html_url, number: pr.number, branch, state: pr.state, merged: !!pr.merged_at };
    if (base.merged) return { ...base, mergeable: true, mergeableState: 'merged' };
    try {
      const { data: full } = await axios.get(
        `${API}/repos/${owner}/${repo}/pulls/${pr.number}`,
        { headers: headers(git), timeout: 12000 },
      );
      return { ...base, mergeable: full.mergeable, mergeableState: full.mergeable_state || 'unknown' };
    } catch {
      return { ...base, mergeable: null, mergeableState: 'unknown' };
    }
  } catch {
    return null;
  }
}

/** Merge the BLAST pull request for a job. Returns { merged, message, prUrl }. */
async function mergePr(job, git) {
  const { owner, repo } = repoConfig(git);
  const pr = await findBlastPr(job, git);
  if (!pr) return { merged: false, message: 'No pull request found for this job yet.' };
  if (pr.merged) return { merged: true, message: 'Pull request already merged.', prUrl: pr.url };
  // Block early on a known-dirty PR so the user gets a clear conflict message + resolve link.
  if (pr.mergeable === false || pr.mergeableState === 'dirty') {
    return {
      merged: false,
      hasConflicts: true,
      mergeableState: pr.mergeableState,
      message: `Pull request #${pr.number} has merge conflicts. Resolve them on GitHub, then merge.`,
      prUrl: pr.url,
    };
  }
  try {
    await axios.put(
      `${API}/repos/${owner}/${repo}/pulls/${pr.number}/merge`,
      { merge_method: 'squash', commit_title: `[BLAST] merge ${job.jobId} automated tests (#${pr.number})` },
      { headers: headers(git), timeout: 15000 },
    );
    return { merged: true, message: 'Pull request merged.', prUrl: pr.url };
  } catch (err) {
    // 405 = not mergeable (conflicts / required checks). Surface it as a conflict hint.
    const status = err.response && err.response.status;
    if (status === 405 || status === 409) {
      return {
        merged: false,
        hasConflicts: true,
        mergeableState: pr.mergeableState || 'dirty',
        message: `Pull request #${pr.number} could not be merged automatically (conflicts or required checks). Resolve on GitHub, then merge.`,
        prUrl: pr.url,
      };
    }
    return { merged: false, message: friendlyError(err, 'merge PR').message, prUrl: pr.url };
  }
}

/** Read a single file's UTF-8 content from the framework repo. Returns null if missing. */
async function getFileContent(filePath, ref, git) {
  const { owner, repo, branch } = repoConfig(git);
  const r = ref || branch || 'main';
  try {
    const { data } = await axios.get(
      `${API}/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(r)}`,
      { headers: headers(git) },
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

/**
 * ISO date of the most recent commit that touched `filePath` on `ref`. Best-effort: returns null on
 * any error (used only to show "merged <date>" in the already-automated feature prompt).
 */
async function getFileLastCommitDate(filePath, ref, git) {
  const { owner, repo, branch } = repoConfig(git);
  const r = ref || branch || 'main';
  try {
    const { data } = await axios.get(
      `${API}/repos/${owner}/${repo}/commits?path=${encodeURIComponent(filePath)}&sha=${encodeURIComponent(r)}&per_page=1`,
      { headers: headers(git) },
    );
    const c = Array.isArray(data) && data[0];
    const commit = c && c.commit;
    const when = commit && ((commit.committer && commit.committer.date) || (commit.author && commit.author.date));
    return when || null;
  } catch {
    return null;
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
 * Download a run artifact zip as a Buffer. GitHub's `archive_download_url` 302-redirects to a
 * short-lived SIGNED storage URL; that host rejects the GitHub `Authorization` header, so we
 * resolve the redirect WITH auth (maxRedirects: 0) and then fetch the signed URL WITHOUT auth.
 * Throws on real failures so the caller can log the reason.
 */
async function fetchArtifactBuffer(archiveUrl, git) {
  let signedUrl = null;
  try {
    const first = await axios.get(archiveUrl, {
      headers: headers(git),
      responseType: 'arraybuffer',
      maxRedirects: 0,
      timeout: 20000,
      validateStatus: (s) => (s >= 200 && s < 300) || s === 301 || s === 302 || s === 307 || s === 308,
    });
    if (first.status >= 200 && first.status < 300) return Buffer.from(first.data); // some hosts return the zip directly
    signedUrl = first.headers && first.headers.location;
  } catch (err) {
    const r = err.response;
    if (r && [301, 302, 307, 308].includes(r.status) && r.headers && r.headers.location) {
      signedUrl = r.headers.location;
    } else {
      throw err;
    }
  }
  if (!signedUrl) throw new Error('artifact redirect returned no Location');
  const res = await axios.get(signedUrl, { responseType: 'arraybuffer', maxRedirects: 5, timeout: 20000 });
  return Buffer.from(res.data);
}

/**
 * Download the EXPLORE run's `blast-plan-<jobId>` artifact and return the parsed blast-plan.json
 * (feature, url, testTypes, maxCases, status, summary, cases, trace). Returns null when unavailable.
 * Same artifact-download+unzip pattern as getRunResult (PizZip — no extra dependency).
 */
async function getPlanArtifact(job, runId, git) {
  const { owner, repo } = repoConfig(git);
  const id = runId || job.exploreRunId || job.runId;
  if (!id) return null;
  try {
    const { data } = await axios.get(
      `${API}/repos/${owner}/${repo}/actions/runs/${id}/artifacts?per_page=100`,
      { headers: headers(git), timeout: 12000 },
    );
    const arts = data.artifacts || [];
    const art = arts.find((a) => a.name === `blast-plan-${job.jobId}`)
      || arts.find((a) => a.name.startsWith('blast-plan-'));
    if (!art || art.expired) return null;
    const buf = await fetchArtifactBuffer(art.archive_download_url, git);
    const zip = new PizZip(buf);
    const entry = zip.file('blast-plan.json');
    if (!entry) return null;
    return JSON.parse(entry.asText());
  } catch (err) {
    console.error(`getPlanArtifact failed for ${job.jobId}: ${err.message}`);
    return null;
  }
}

/**
 * Download the run's `blast-result-<jobId>` artifact and return the FULL parsed
 * blast-ci-result.json (verified, missingCases, changedPaths, executionStatus,
 * reportSummary, …). Returns null when unavailable.
 */
async function getRunResult(job, runId, git) {
  const { owner, repo } = repoConfig(git);
  const id = runId || job.runId;
  if (!id) return null;
  try {
    const { data } = await axios.get(
      `${API}/repos/${owner}/${repo}/actions/runs/${id}/artifacts?per_page=100`,
      { headers: headers(git), timeout: 12000 },
    );
    const arts = data.artifacts || [];
    const art = arts.find((a) => a.name === `blast-result-${job.jobId}`)
      || arts.find((a) => a.name.startsWith('blast-result-'));
    if (!art || art.expired) return null;
    const buf = await fetchArtifactBuffer(art.archive_download_url, git);
    const zip = new PizZip(buf);
    const entry = zip.file('blast-ci-result.json');
    if (!entry) return null;
    return JSON.parse(entry.asText());
  } catch (err) {
    console.error(`getRunResult failed for ${job.jobId}: ${err.message}`);
    return null;
  }
}

/**
 * Download the run's `blast-result-<jobId>` artifact and extract the parsed Playwright
 * report summary (pass/fail counts + per-test steps). Returns null when unavailable.
 */
async function getRunReportSummary(job, runId, git) {
  const result = await getRunResult(job, runId, git);
  return (result && result.reportSummary) || null;
}

module.exports = {
  isConfigured,
  findCopilotActor,
  createAutomationIssue,
  getProgress,
  repoConfig,
  dispatchWorkflow,
  dispatchExplore,
  dispatchApprove,
  dispatchSmoke,
  getWorkflowRunProgress,
  getExploreRunProgress,
  getPlanArtifact,
  getRunReportSummary,
  getRunResult,
  findBlastPr,
  mergePr,
  getFileContent,
  getFileLastCommitDate,
  listDir,
  mapGithubRunState,
  deriveExploreStatus,
};
