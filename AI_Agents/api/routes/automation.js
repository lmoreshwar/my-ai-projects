const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const auth = require('../middleware/auth');
const AutomationJob = require('../models/AutomationJob');
const orchestrator = require('../_tools/automation_orchestrator');
const localAgent = require('../_tools/local_agent');
const githubAgent = require('../_tools/github_agent');
const runnerAuth = require('../middleware/runnerAuth');
// Dev-mode local store (used when MongoDB is unreachable / DEV_MODE=true).
const DEV_JOBS_FILE = path.join(__dirname, '..', '..', 'dev-automation-jobs.json');
const isDev = () => process.env.DEV_MODE === 'true';

function loadDevJobs() {
  try {
    if (fs.existsSync(DEV_JOBS_FILE)) return JSON.parse(fs.readFileSync(DEV_JOBS_FILE, 'utf8'));
  } catch (err) {
    console.error('Error loading dev automation jobs:', err.message);
  }
  return [];
}

function saveDevJobs(jobs) {
  try {
    fs.writeFileSync(DEV_JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving dev automation jobs:', err.message);
    return false;
  }
}

function nextJobId(existing) {
  const nums = existing
    .map((j) => Number(String(j.jobId || '').replace(/[^0-9]/g, '')))
    .filter((n) => !Number.isNaN(n));
  const max = nums.length ? Math.max(...nums) : 1000;
  return `AUTO-${max + 1}`;
}

// Persist a job to whichever store is active. Returns the saved plain object.
async function persist(job) {
  if (isDev()) {
    const jobs = loadDevJobs();
    const idx = jobs.findIndex((j) => j.jobId === job.jobId);
    job.updatedAt = new Date().toISOString();
    if (idx >= 0) jobs[idx] = job;
    else jobs.push(job);
    saveDevJobs(jobs);
    return job;
  }
  const doc = await AutomationJob.findOneAndUpdate({ jobId: job.jobId }, { $set: job }, { new: true, upsert: true });
  return doc.toObject();
}

async function findJob(jobId) {
  if (isDev()) return loadDevJobs().find((j) => j.jobId === jobId) || null;
  const doc = await AutomationJob.findOne({ jobId });
  return doc ? doc.toObject() : null;
}

// @route   GET /api/automation/jobs
// @desc    List automation jobs for the current user
router.get('/jobs', auth, async (req, res) => {
  try {
    if (isDev()) {
      const jobs = loadDevJobs().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.json(jobs);
    }
    const jobs = await AutomationJob.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
    res.json(jobs);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// @route   GET /api/automation/jobs/:jobId
// @desc    Get one automation job (poll for status)
router.get('/jobs/:jobId', auth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    res.json(job);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// @route   POST /api/automation/generate
// @desc    Create a job and request a plan from the AI Service
router.post('/generate', auth, async (req, res) => {
  try {
    const { project, environment, url, agent, skill, executionMode, comments, testCases } = req.body;
    if (!Array.isArray(testCases) || testCases.length === 0) {
      return res.status(400).json({ msg: 'Select at least one automation-feasible test case.' });
    }

    const existing = isDev() ? loadDevJobs() : [];
    const jobId = isDev() ? nextJobId(existing) : `AUTO-${Date.now()}`;
    const now = new Date().toISOString();

    let job = {
      jobId,
      userId: req.user.id,
      project: project || '',
      environment: environment || 'QA',
      url: url || '',
      agent: agent || 'AI Native Playwright Engineer',
      skill: skill || 'New Automation',
      executionMode: executionMode || 'GenerateAndExecute',
      comments: comments || '',
      testCases: testCases.map((tc) => ({
        id: tc.id,
        title: tc.title || '',
        tags: tc.tags || '',
        executionTags: tc.executionTags || '',
        complexity: tc.complexity || 'Medium',
        description: tc.description || '',
        preconditions: tc.preconditions || '',
        testData: tc.testData || '',
        steps: tc.steps || '',
        expectedResults: tc.expectedResults || '',
        comments: tc.comments || '',
      })),
      status: 'Planning',
      plan: '',
      missingInfo: [],
      approved: false,
      provider: orchestrator.provider(),
      issueNumber: null,
      issueUrl: '',
      checksStatus: '',
      generatedFiles: [],
      reusedFiles: [],
      executionStatus: '',
      reportUrl: '',
      prUrl: '',
      logs: [],
      error: '',
      createdAt: now,
      updatedAt: now,
    };
    job = await persist(job);

    // Request the plan (reuse-first). Blocks generation if info is missing.
    const { plan, missingInfo, reusedFiles, logs } = await orchestrator.requestPlan(job);
    job.plan = plan;
    job.missingInfo = missingInfo;
    job.reusedFiles = reusedFiles;
    if (Array.isArray(logs) && logs.length) job.logs = [...(job.logs || []), ...logs];
    job.status = missingInfo.length ? 'Pending' : 'WaitingForApproval';
    job = await persist(job);

    res.json(job);
  } catch (err) {
    console.error('generate error:', err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// @route   POST /api/automation/jobs/:jobId/answer
// @desc    Provide missing information, then re-plan
router.post('/jobs/:jobId/answer', auth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });

    const { url, comments } = req.body;
    if (url) job.url = url;
    if (comments) job.comments = comments;

    const { plan, missingInfo, reusedFiles } = await orchestrator.requestPlan(job);
    job.plan = plan;
    job.missingInfo = missingInfo;
    job.reusedFiles = reusedFiles;
    job.status = missingInfo.length ? 'Pending' : 'WaitingForApproval';
    const saved = await persist(job);
    res.json(saved);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// @route   POST /api/automation/jobs/:jobId/approve
// @desc    Approve the plan → generate (+ execute per executionMode)
router.post('/jobs/:jobId/approve', auth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    if (job.missingInfo && job.missingInfo.length) {
      return res.status(400).json({ msg: 'Cannot proceed — missing information must be provided first.', missingInfo: job.missingInfo });
    }

    job.approved = true;
    job.status = 'Generating';
    job.logs = [...(job.logs || []), '[local] Approved — starting generation…'];
    await persist(job);

    // Runner (pull-based worker) path: the API does NOT execute. It just enqueues the job;
    // a separate runner process claims it via /runner/claim and reports results back.
    if (job.provider === 'runner') {
      job.status = 'Queued';
      job.logs = [...(job.logs || []), '[runner] Queued — waiting for a runner to claim this job…'];
      const savedQueued = await persist(job);
      return res.json(savedQueued);
    }

    // Cloud runner path: trigger a GitHub Actions workflow that generates + runs the
    // tests and opens a PR. Nothing runs on this server or a laptop worker.
    if (job.provider === 'github-actions') {
      try {
        const dispatch = await githubAgent.dispatchWorkflow(job);
        job.status = 'Generating';
        job.provider = 'github-actions';
        job.reportUrl = dispatch.runsUrl || '';
        job.logs = [
          ...(job.logs || []),
          `[cloud] Dispatched GitHub Actions workflow ${dispatch.workflow} on ${dispatch.ref}.`,
          `[cloud] Track the run + Pull Request here: ${dispatch.runsUrl}`,
        ];
        const savedCloud = await persist(job);
        return res.json(savedCloud);
      } catch (dispatchErr) {
        job.status = 'Failed';
        job.error = dispatchErr.message || 'Cloud dispatch failed';
        job.logs = [...(job.logs || []), `[error] ${job.error}`];
        await persist(job);
        return res.status(502).json({ msg: job.error, job });
      }
    }

    // GitHub coding-agent path stays synchronous (it just creates an issue and returns).
    if (job.provider === 'github') {
      let result;
      try {
        result = await orchestrator.requestGenerate(job);
      } catch (genErr) {
        job.status = 'Failed';
        job.error = genErr.message || 'Generation failed';
        job.logs = [...(job.logs || []), `[error] ${job.error}`];
        await persist(job);
        return res.status(502).json({ msg: job.error, job });
      }
      job.logs = [...(job.logs || []), ...(result.logs || [])];
      job.provider = result.provider || 'github';
      job.issueNumber = result.issueNumber || null;
      job.issueUrl = result.issueUrl || '';
      job.generatedFiles = [];
      job.reusedFiles = [];
      job.status = 'Generating';
      const savedAsync = await persist(job);
      return res.json(savedAsync);
    }

    // Local / service / simulation: respond now, run in the background with live logs.
    res.json(job);
    runGenerationInBackground(job).catch((err) => {
      console.error('background generation error:', err.message);
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// Background worker: streams logs into the job store (debounced) as generation runs.
async function runGenerationInBackground(job) {
  let persistTimer = null;
  const schedulePersist = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => { persistTimer = null; persist(job).catch(() => {}); }, 500);
  };
  const onLog = (line) => { job.logs = [...(job.logs || []), line]; schedulePersist(); };

  try {
    const result = await orchestrator.requestGenerate(job, onLog);
    if ((!job.logs || job.logs.length === 0) && result.logs) job.logs = result.logs;
    job.generatedFiles = result.generatedFiles || [];
    job.reusedFiles = result.reusedFiles || [];

    if (job.executionMode === 'GenerateOnly') {
      job.status = 'Completed';
    } else {
      job.executionStatus = result.executionStatus || '';
      // Map the framework-relative report to the URL the API serves it at.
      job.reportUrl = result.reportUrl ? '/automation-report/index.html' : '';
      job.status = result.executionStatus === 'PASSED' ? 'Passed' : 'Failed';
    }
  } catch (genErr) {
    job.status = 'Failed';
    job.error = genErr.message || 'Generation failed';
    job.logs = [...(job.logs || []), `[error] ${job.error}`];
  } finally {
    if (persistTimer) clearTimeout(persistTimer);
    await persist(job);
  }
}

// @route   GET /api/automation/jobs/:jobId/progress
// @desc    Poll the active provider (GitHub coding agent) and advance job status
router.get('/jobs/:jobId/progress', auth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });

    if (job.provider !== 'github') {
      return res.json(job); // background worker owns the state — don't clobber it
    }

    const progress = await orchestrator.requestProgress(job);
    if (progress.status) job.status = progress.status;
    if (progress.prUrl) job.prUrl = progress.prUrl;
    if (progress.checksStatus !== undefined) job.checksStatus = progress.checksStatus;
    if (progress.executionStatus !== undefined) job.executionStatus = progress.executionStatus;
    if (progress.logs && progress.logs.length) job.logs = [...(job.logs || []), ...progress.logs];

    const saved = await persist(job);
    res.json(saved);
  } catch (err) {
    console.error('progress error:', err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// @route   POST /api/automation/jobs/:jobId/push-gate
// @desc    Push the generated tests on a new branch and return the PR-compare URL
router.post('/jobs/:jobId/push-gate', auth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    if (job.status !== 'Passed') {
      return res.status(400).json({ msg: 'Push to Gate is only allowed after a passing run.' });
    }

    const onLog = (line) => { job.logs = [...(job.logs || []), line]; };
    const { prUrl, branch, logs } = await orchestrator.requestPushToGate(job, onLog);
    if (logs && logs.length) job.logs = [...(job.logs || []), ...logs.filter((l) => !(job.logs || []).includes(l))];
    if (branch) job.branch = branch;
    job.prUrl = prUrl;
    job.status = 'PushedToGate';
    const saved = await persist(job);
    res.json(saved);
  } catch (err) {
    console.error('push-gate error:', err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// @route   POST /api/automation/jobs/:jobId/run-copilot
// @desc    Hand the job to the LOCAL VS Code Copilot agent via a generated .bat
router.post('/jobs/:jobId/run-copilot', auth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });

    const fw = localAgent.config().frameworkPath;
    if (!fw || !fs.existsSync(fw)) {
      return res.status(400).json({ msg: 'FRAMEWORK_PATH is not configured or does not exist.' });
    }

    const handoff = localAgent.launchCopilotHandoff(fw, job, { spawnBat: req.body?.spawn !== false });
    job.copilotHandoff = {
      batRel: handoff.batRel,
      logRel: handoff.logRel,
      launched: handoff.launched,
      at: new Date().toISOString(),
    };
    job.status = 'HandedToCopilot';
    job.logs = [
      ...(job.logs || []),
      `[copilot] Handoff created — ${handoff.batRel}`,
      handoff.launched
        ? '[copilot] Launched VS Code Copilot agent. Watch the chat panel; execution logs stream below.'
        : `[copilot] Could not auto-launch. Run the .bat manually: ${handoff.batRel}`,
    ];
    const saved = await persist(job);
    res.json(saved);
  } catch (err) {
    console.error('run-copilot error:', err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// @route   GET /api/automation/jobs/:jobId/copilot-log
// @desc    Tail the Copilot handoff log so the UI can stream the live console
router.get('/jobs/:jobId/copilot-log', auth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    const fw = localAgent.config().frameworkPath;
    const log = fw ? localAgent.readCopilotLog(fw, job.jobId) : '';
    res.json({ jobId: job.jobId, log });
  } catch (err) {
    console.error('copilot-log error:', err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// @route   GET /api/automation/jobs/:jobId/copilot-stream
// @desc    Server-Sent Events stream of the Copilot handoff log for a truly live console.
//          Pushes the full sanitized log whenever the file changes (no client polling gap).
router.get('/jobs/:jobId/copilot-stream', auth, async (req, res) => {
  const job = await findJob(req.params.jobId);
  if (!job) return res.status(404).json({ msg: 'Job not found' });
  const fw = localAgent.config().frameworkPath;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering so events flush immediately
  });
  res.write('retry: 2000\n\n');

  let closed = false;
  let lastLog = null;
  const send = () => {
    if (closed) return;
    try {
      const log = fw ? localAgent.readCopilotLog(fw, job.jobId) : '';
      if (log !== lastLog) {
        lastLog = log;
        res.write(`data: ${JSON.stringify({ jobId: job.jobId, log })}\n\n`);
      }
    } catch { /* keep the stream alive on transient read errors */ }
  };
  send();
  const poll = setInterval(send, 500);
  const heartbeat = setInterval(() => { if (!closed) res.write(': hb\n\n'); }, 15000);
  req.on('close', () => { closed = true; clearInterval(poll); clearInterval(heartbeat); });
});

// @route   POST /api/automation/jobs/:jobId/copilot-stop
// @desc    Cooperatively stop a running Copilot handoff (stop sentinel + inbox instruction).
router.post('/jobs/:jobId/copilot-stop', auth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    const fw = localAgent.config().frameworkPath;
    if (!fw) return res.status(400).json({ msg: 'FRAMEWORK_PATH is not configured.' });
    localAgent.requestCopilotStop(fw, job.jobId);
    const log = localAgent.readCopilotLog(fw, job.jobId);
    res.json({ jobId: job.jobId, log });
  } catch (err) {
    console.error('copilot-stop error:', err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// @route   PATCH /api/automation/jobs/:jobId/plan
// @desc    Save an edited implementation plan (used by BOTH the LLM and Copilot paths)
router.patch('/jobs/:jobId/plan', auth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    const { plan } = req.body || {};
    if (typeof plan !== 'string') return res.status(400).json({ msg: 'plan (string) is required.' });
    job.plan = plan;
    job.logs = [...(job.logs || []), '[local] Implementation plan edited by user.'];
    const saved = await persist(job);
    res.json(saved);
  } catch (err) {
    console.error('plan-edit error:', err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// @route   POST /api/automation/jobs/:jobId/copilot-input
// @desc    Send additional info to the running Copilot agent (file-based inbox loop)
router.post('/jobs/:jobId/copilot-input', auth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    const { message } = req.body || {};
    if (!message || !String(message).trim()) return res.status(400).json({ msg: 'message is required.' });
    const fw = localAgent.config().frameworkPath;
    if (!fw) return res.status(400).json({ msg: 'FRAMEWORK_PATH is not configured.' });
    localAgent.appendCopilotInput(fw, job.jobId, message);
    const log = localAgent.readCopilotLog(fw, job.jobId);
    res.json({ jobId: job.jobId, log });
  } catch (err) {
    console.error('copilot-input error:', err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// @route   DELETE /api/automation/jobs/:jobId
router.delete('/jobs/:jobId', auth, async (req, res) => {
  try {
    if (isDev()) {
      const jobs = loadDevJobs().filter((j) => j.jobId !== req.params.jobId);
      saveDevJobs(jobs);
      return res.json({ msg: 'Job removed' });
    }
    await AutomationJob.findOneAndDelete({ jobId: req.params.jobId });
    res.json({ msg: 'Job removed' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// ===================================================================
// Runner API (pull-based worker) — authenticated with a shared RUNNER_TOKEN,
// NOT a user JWT. A separate runner process polls these to claim & report jobs.
// ===================================================================

// Atomically claim the oldest Queued job for a runner. Returns { job } or { job: null }.
async function claimNextQueued(claimedBy) {
  const now = new Date().toISOString();
  if (isDev()) {
    const jobs = loadDevJobs();
    const queued = jobs
      .filter((j) => j.status === 'Queued')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const job = queued[0];
    if (!job) return null;
    job.status = 'Generating';
    job.claimedBy = claimedBy;
    job.claimedAt = now;
    job.logs = [...(job.logs || []), `[runner] Claimed by ${claimedBy}.`];
    job.updatedAt = now;
    saveDevJobs(jobs);
    return job;
  }
  const doc = await AutomationJob.findOneAndUpdate(
    { status: 'Queued' },
    { $set: { status: 'Generating', claimedBy, claimedAt: new Date() } },
    { sort: { createdAt: 1 }, new: true }
  );
  return doc ? doc.toObject() : null;
}

// @route   POST /api/automation/runner/claim
// @desc    Runner pulls the next queued job (no user auth — shared runner token)
router.post('/runner/claim', runnerAuth, async (req, res) => {
  try {
    const claimedBy = (req.body && req.body.runnerId) || 'runner';
    const job = await claimNextQueued(claimedBy);
    res.json({ job: job || null });
  } catch (err) {
    console.error('runner-claim error:', err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// @route   POST /api/automation/runner/jobs/:jobId/logs
// @desc    Runner streams log lines back for the live console
router.post('/runner/jobs/:jobId/logs', runnerAuth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (lines.length) job.logs = [...(job.logs || []), ...lines.map(String)];
    const saved = await persist(job);
    res.json({ jobId: saved.jobId, count: (saved.logs || []).length });
  } catch (err) {
    console.error('runner-logs error:', err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

// @route   POST /api/automation/runner/jobs/:jobId/result
// @desc    Runner reports the final outcome (status, execution, report, files)
router.post('/runner/jobs/:jobId/result', runnerAuth, async (req, res) => {
  try {
    const job = await findJob(req.params.jobId);
    if (!job) return res.status(404).json({ msg: 'Job not found' });
    const { executionStatus, reportUrl, generatedFiles, reusedFiles, error, logs } = req.body || {};

    if (Array.isArray(logs) && logs.length) job.logs = [...(job.logs || []), ...logs.map(String)];
    if (Array.isArray(generatedFiles)) job.generatedFiles = generatedFiles;
    if (Array.isArray(reusedFiles)) job.reusedFiles = reusedFiles;

    if (error) {
      job.status = 'Failed';
      job.error = String(error);
    } else if (job.executionMode === 'GenerateOnly') {
      job.status = 'Completed';
    } else {
      job.executionStatus = executionStatus || '';
      // The report is served from FRAMEWORK_PATH/playwright-report by this API.
      job.reportUrl = reportUrl ? '/automation-report/index.html' : '';
      job.status = executionStatus === 'PASSED' ? 'Passed' : 'Failed';
    }
    const saved = await persist(job);
    res.json(saved);
  } catch (err) {
    console.error('runner-result error:', err.message);
    res.status(500).json({ msg: err.message || 'Server Error' });
  }
});

module.exports = router;
