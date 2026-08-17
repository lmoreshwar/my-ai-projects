/**
 * automation_orchestrator.js — Service layer between B.L.A.S.T. and the
 * AI Native Playwright Service.
 *
 * B.L.A.S.T. NEVER generates Playwright code itself. It delegates planning,
 * generation, execution and reporting to the AI Service over REST.
 *
 * If AI_SERVICE_URL is not configured, a local SIMULATION is used so the UI
 * flow is fully demonstrable end-to-end. Swap in the real service by setting
 * AI_SERVICE_URL in .env — no route/UI changes required.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const githubAgent = require('./github_agent');
const localAgent = require('./local_agent');

const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || '').replace(/\/$/, '');
const AI_TIMEOUT = Number(process.env.AI_SERVICE_TIMEOUT_MS || 120000);

/**
 * Resolve the active provider.
 *
 * PRODUCTION IS ALWAYS 'github-actions': one headless GitHub Actions job runs the whole
 * flow (explore → codegen → verify → commit → PR). There is NO laptop worker, NO
 * cloudflared tunnel, and NO external always-on service — the same agent-loop code runs
 * identically on a laptop, a VM, or an Actions runner.
 *
 * The other providers ('runner', 'local', 'service', 'simulation') are LOCAL DEV/DEBUG
 * conveniences ONLY. They are reachable exclusively when DEV_MODE=true (or the explicit
 * BLAST_ALLOW_DEV_PROVIDERS=1 escape hatch), so Render/production can never fall into the
 * laptop-worker path. Setting AUTOMATION_PROVIDER on Render therefore only ever means
 * 'github-actions'.
 */
function provider() {
  const forced = (process.env.AUTOMATION_PROVIDER || '').toLowerCase();
  const allowDevProviders = process.env.DEV_MODE === 'true' || process.env.BLAST_ALLOW_DEV_PROVIDERS === '1';
  if (allowDevProviders) {
    if (forced === 'runner') return 'runner';
    if (forced === 'github' && githubAgent.isConfigured()) return 'github';
    if (forced === 'local' && localAgent.isConfigured()) return 'local';
    if (forced === 'service' && AI_SERVICE_URL) return 'service';
    if (forced === 'simulation') return 'simulation';
  }
  return 'github-actions';
}

// Map a skill label to the AI Service REST endpoint.
const SKILL_ENDPOINT = {
  'New Automation': '/api/automation/generate',
  'Modify Automation': '/api/automation/modify',
  Debug: '/api/automation/debug',
  'Self Healing': '/api/automation/self-heal',
  'Visual Testing': '/api/automation/visual-test',
};

function toFeatureName(label) {
  const base = (label || 'App').replace(/[^A-Za-z0-9]+/g, ' ').trim() || 'App';
  return base
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

// Group selected test cases by their primary tag (feature).
function groupFeatures(testCases) {
  const groups = {};
  (testCases || []).forEach((tc) => {
    const primary = (tc.tags || 'General').split(',')[0].trim() || 'General';
    (groups[primary] = groups[primary] || []).push(tc);
  });
  return groups;
}

/**
 * Give buildPlan a REAL framework to read for the cloud/runner path. Prefer a local
 * FRAMEWORK_PATH; otherwise mirror the essential framework files from the GitHub repo
 * (the same source the cloud runner checks out) into a temp dir so the plan reflects
 * what will actually run. Returns a framework path, or '' if neither is available.
 */
async function ensureFrameworkMirror() {
  const localFw = (localAgent.config().frameworkPath || '').trim();
  if (localFw && fs.existsSync(localFw)) return localFw;
  if (!githubAgent.isConfigured()) return '';

  const dir = path.join(os.tmpdir(), 'blast-fw-mirror');
  const write = (rel, content) => {
    if (content == null) return;
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  };
  try {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* stale mirror */ }
    fs.mkdirSync(dir, { recursive: true });
    write('.ai-memory/capabilities.json', await githubAgent.getFileContent('.ai-memory/capabilities.json'));
    for (const sub of ['src/tests', 'src/pages', 'src/modules']) {
      const entries = await githubAgent.listDir(sub);
      for (const e of entries) {
        if (e.type === 'file' && e.name.endsWith('.ts')) {
          write(`${sub}/${e.name}`, await githubAgent.getFileContent(e.path));
        }
      }
    }
    for (const shared of ['src/config/index.ts', 'src/utils/constants.ts']) {
      write(shared, await githubAgent.getFileContent(shared));
    }
    return dir;
  } catch {
    return ''; // any fetch error → caller falls back to the simulated plan
  }
}

/**
 * Ask the AI Service for an implementation plan (reuse-first, evidence-based).
 * Returns { plan, missingInfo, reusedFiles }.
 */
async function requestPlan(job) {
  if (provider() === 'local') {
    return localAgent.buildPlan(job, undefined, 'local');
  }
  if (AI_SERVICE_URL) {
    const { data } = await axios.post(
      `${AI_SERVICE_URL}${SKILL_ENDPOINT[job.skill] || '/api/automation/generate'}`,
      { ...serializeRequest(job), stage: 'plan' },
      { timeout: AI_TIMEOUT }
    );
    return {
      plan: data.plan || '',
      missingInfo: data.missingInfo || [],
      reusedFiles: data.reusedFiles || [],
    };
  }
  // Cloud/runner: build a REAL reuse-first plan against the framework (local path or a
  // GitHub mirror of the repo the cloud runner checks out) instead of a generic template.
  if (provider() === 'github-actions' || provider() === 'runner') {
    try {
      const fw = await ensureFrameworkMirror();
      if (fw) return localAgent.buildPlan(job, fw, provider());
    } catch { /* fall back to the simulated plan below */ }
  }
  return simulatePlan(job);
}

/**
 * Ask the AI Service to generate + (optionally) execute.
 * Returns { generatedFiles, reusedFiles, executionStatus, reportUrl, logs }.
 */
async function requestGenerate(job, onLog) {
  if (provider() === 'github') {
    const issue = await githubAgent.createAutomationIssue(job);
    return {
      provider: 'github',
      async: true,
      issueNumber: issue.issueNumber,
      issueUrl: issue.issueUrl,
      generatedFiles: [],
      reusedFiles: [],
      executionStatus: '',
      reportUrl: '',
      logs: [
        `[github] Created issue #${issue.issueNumber} and assigned it to the Copilot coding agent (${issue.copilotLogin}).`,
        `[github] Track progress: ${issue.issueUrl}`,
      ],
    };
  }
  if (provider() === 'local') {
    return localAgent.generateAndRun(job, onLog);
  }
  if (AI_SERVICE_URL) {
    const { data } = await axios.post(
      `${AI_SERVICE_URL}${SKILL_ENDPOINT[job.skill] || '/api/automation/generate'}`,
      { ...serializeRequest(job), stage: 'generate' },
      { timeout: AI_TIMEOUT }
    );
    return {
      generatedFiles: data.generatedFiles || [],
      reusedFiles: data.reusedFiles || [],
      executionStatus: data.executionStatus || '',
      reportUrl: data.reportUrl || '',
      logs: data.logs || [],
    };
  }
  return simulateGenerate(job);
}

/**
 * Poll the active provider for job progress. Only meaningful for async
 * providers (github, github-actions); sync providers return the job state unchanged.
 * Keys off the JOB's provider (set at dispatch time) rather than the global
 * AUTOMATION_PROVIDER — a job dispatched to the cloud runner must keep being polled as
 * github-actions even when the server's default provider is local, otherwise progress
 * returns an empty no-op and the run console freezes on the dispatch header.
 * Returns { status, prUrl, checksStatus, executionStatus, logs }.
 */
async function requestProgress(job, git) {
  const prov = (job && job.provider) || provider();
  if (prov === 'github') {
    return githubAgent.getProgress(job);
  }
  if (prov === 'github-actions') {
    // Two-dispatch flow: while in the explore (plan) phase, poll the explore run and surface
    // the proposed cases → WaitingForApproval. Once approved, poll the approve run → PR/pass/fail.
    if (job && job.phase === 'explore') {
      return githubAgent.getExploreRunProgress(job, git);
    }
    return githubAgent.getWorkflowRunProgress(job, git);
  }
  return { status: job.status, prUrl: job.prUrl || '', checksStatus: job.checksStatus || '', executionStatus: job.executionStatus || '', logs: [] };
}

/**
 * Ask the AI Service (or GitHub) to open a PR into the framework repo.
 * Returns { prUrl }.
 */
async function requestPushToGate(job, onLog) {
  if (provider() === 'github') {
    // With the coding agent, the PR IS the gate — it already exists once checks pass.
    const progress = await githubAgent.getProgress(job);
    return { prUrl: progress.prUrl || job.prUrl || '' };
  }
  if (provider() === 'local') {
    const { compareUrl, branch, logs } = await localAgent.pushBranch(job, onLog);
    return { prUrl: compareUrl, branch, logs: logs || [] };
  }
  if (provider() === 'runner') {
    // The Copilot/runner path writes files without committing — capture them onto a
    // feature-named branch, commit, and push, then hand back the PR-compare URL.
    const { compareUrl, branch, logs } = await localAgent.commitAndPushBranch(job, onLog);
    return { prUrl: compareUrl, branch, logs: logs || [] };
  }
  if (AI_SERVICE_URL) {
    const { data } = await axios.post(
      `${AI_SERVICE_URL}/api/automation/push-to-gate`,
      serializeRequest(job),
      { timeout: AI_TIMEOUT }
    );
    return { prUrl: data.prUrl || '' };
  }
  return { prUrl: `https://github.com/example/ai-native-playwright/pull/${Math.floor(Math.random() * 900 + 100)}` };
}

/**
 * Discard a generation attempt (Phase 2) — delete the orphan job branch after a failed/closed
 * PR so a fresh generation starts from scratch. Local provider only.
 */
async function requestDiscard(job, opts, onLog) {
  if (provider() === 'local') {
    return localAgent.discardBranch(job, opts || {}, onLog);
  }
  return { branch: job.branch || '', localDeleted: false, remoteDeleted: false, logs: ['[discard] Discard is only supported for the local provider.'] };
}

function serializeRequest(job) {
  return {
    jobId: job.jobId,
    project: job.project,
    environment: job.environment,
    url: job.url,
    agent: job.agent,
    skill: job.skill,
    executionMode: job.executionMode,
    comments: job.comments,
    testCases: (job.testCases || []).map((tc) => ({ id: tc.id, title: tc.title, tags: tc.tags })),
  };
}

/* ─────────────────────────── SIMULATION ─────────────────────────── */

function simulatePlan(job) {
  const missingInfo = [];
  if (!job.url) missingInfo.push('Application URL is required to capture locators via @playwright/cli.');
  if (!job.testCases || job.testCases.length === 0) missingInfo.push('No test cases selected for automation.');

  const groups = groupFeatures(job.testCases);
  const lines = [
    `# Implementation Plan — ${job.skill} (${job.environment})`,
    '',
    `Agent: ${job.agent}`,
    `Target URL: ${job.url || '(missing)'}`,
    `Total test cases: ${(job.testCases || []).length}`,
    '',
    '## Reuse-first analysis (from capabilities.json)',
    '- Existing assets are reused where available; no duplicate pages/locators are created.',
    '',
    '## Files to create / reuse',
  ];
  Object.entries(groups).forEach(([feature, cases]) => {
    const F = toFeatureName(feature);
    lines.push(`- **${feature}** (${cases.length} case${cases.length > 1 ? 's' : ''}) → src/pages/${F}Page.ts, src/modules/${F}Module.ts, src/tests/${F.toLowerCase()}.spec.ts`);
  });
  lines.push('', '## Evidence-based locators', '- Locators captured live via @playwright/cli snapshot before any code is written.');

  return {
    plan: lines.join('\n'),
    missingInfo,
    reusedFiles: ['src/utils/constants.ts', 'src/config/index.ts'],
  };
}

function simulateGenerate(job) {
  const groups = groupFeatures(job.testCases);
  const generatedFiles = [];
  Object.keys(groups).forEach((feature) => {
    const F = toFeatureName(feature);
    generatedFiles.push({ path: `src/pages/${F}Page.ts`, layer: 'page', reused: false });
    generatedFiles.push({ path: `src/modules/${F}Module.ts`, layer: 'module', reused: false });
    generatedFiles.push({ path: `src/tests/${F.toLowerCase()}.spec.ts`, layer: 'spec', reused: false });
  });
  const runs = job.executionMode !== 'GenerateOnly';
  return {
    generatedFiles,
    reusedFiles: ['src/utils/constants.ts', 'src/config/index.ts'],
    executionStatus: runs ? 'PASSED' : '',
    reportUrl: runs ? 'playwright-report/index.html' : '',
    logs: [
      '[SIMULATION] AI_SERVICE_URL not configured — using local simulation.',
      `Planned ${generatedFiles.length} files across ${Object.keys(groups).length} feature(s).`,
      runs ? 'Simulated Playwright run: PASSED.' : 'Generate-only mode: execution skipped.',
    ],
  };
}

module.exports = {
  provider,
  requestPlan,
  requestGenerate,
  requestProgress,
  requestPushToGate,
  requestDiscard,
  isSimulated: () => provider() === 'simulation',
};
