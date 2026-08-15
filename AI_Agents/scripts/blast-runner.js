/**
 * blast-runner.js — B.L.A.S.T. pull-based Runner (Phase-1, local).
 *
 * The production execution model, running locally: instead of the web API executing
 * Playwright in-process, this standalone worker POLLS the API for Queued jobs, runs the
 * generation + Playwright locally via the existing local_agent, and streams logs + the
 * final result back over REST. Move this process to any machine that has the framework
 * (a VM, container, or spare PC) and nothing about the API/UI changes.
 *
 * Enable the queue path on the API side:  AUTOMATION_PROVIDER=runner
 * Run this worker:                          npm run runner
 *
 * Config (from .env / environment):
 *   BLAST_API_URL   base URL of the B.L.A.S.T. API      (default http://localhost:8000)
 *   RUNNER_TOKEN    shared secret matching the API       (default dev-runner-token in DEV_MODE)
 *   RUNNER_ID       friendly id for this worker          (default host-<pid>)
 *   RUNNER_POLL_MS  poll interval when idle              (default 3000)
 *   FRAMEWORK_PATH + LLM_* keys are read by local_agent, same as the API.
 */
require('dotenv').config();
const os = require('os');
const axios = require('axios');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const localAgent = require('../api/_tools/local_agent');

const API = (process.env.BLAST_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const TOKEN = process.env.RUNNER_TOKEN || (process.env.DEV_MODE === 'true' ? 'dev-runner-token' : '');
const RUNNER_ID = process.env.RUNNER_ID || `${os.hostname()}-${process.pid}`;
const POLL_MS = Number(process.env.RUNNER_POLL_MS || 3000);
// Execution engine: 'codegen' = in-process LLM codegen (default, legacy); 'copilot' = hand the job to the
// local VS Code Copilot agent (real browser, evidence-based locators) and stream its log back.
const RUNNER_MODE = String(process.env.RUNNER_MODE || 'codegen').toLowerCase();
const COPILOT_TIMEOUT_MS = Number(process.env.RUNNER_COPILOT_TIMEOUT_MS || 20 * 60 * 1000);
const COPILOT_POLL_MS = Number(process.env.RUNNER_COPILOT_POLL_MS || 1500);
const BASE = `${API}/api/automation`;
const headers = { 'x-runner-token': TOKEN, 'Content-Type': 'application/json' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run a command, resolving with stdout; rejects with a trimmed error (never leaks a token in args).
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} failed: ${String(stderr || err.message).slice(0, 400)}`));
      resolve(String(stdout || ''));
    });
  });
}

/**
 * Prepare an ISOLATED per-job workspace. When the job carries the user's own repo (repoUrl), clone it
 * fresh into a temp dir (multi-tenant); otherwise use the worker's local FRAMEWORK_PATH (single-tenant
 * POC — unchanged behaviour). Returns { fw, cleanup }. The token is resolved from the worker env
 * (GitHub App installation token or a PAT) and is injected only into the remote, never logged.
 */
async function prepareWorkspace(job, onLog) {
  const repoUrl = String(job.repoUrl || '').trim();
  if (!repoUrl) {
    return { fw: (localAgent.config().frameworkPath) || '', cleanup: async () => {} };
  }
  const token = process.env.WORKER_GIT_TOKEN || process.env.GITHUB_TOKEN || '';
  const authUrl = token && repoUrl.startsWith('https://')
    ? repoUrl.replace('https://', `https://x-access-token:${token}@`)
    : repoUrl;
  const safe = String(job.jobId).replace(/[^A-Za-z0-9_-]/g, '_');
  const dir = path.join(os.tmpdir(), 'blast-ws', safe);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(dir), { recursive: true });
  onLog(`[runner] Cloning ${repoUrl} into an isolated workspace…`);
  const cloneArgs = ['clone', '--depth', '1'];
  if (job.repoBranch) cloneArgs.push('--branch', String(job.repoBranch));
  await run('git', [...cloneArgs, authUrl, dir]);
  onLog('[runner] Installing framework dependencies (npm)…');
  await run('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, shell: true });
  const cleanup = async () => { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); };
  return { fw: dir, cleanup };
}

async function claim() {
  const { data } = await axios.post(`${BASE}/runner/claim`, { runnerId: RUNNER_ID }, { headers });
  return data.job || null;
}

async function postLogs(jobId, lines) {
  if (!lines.length) return;
  try {
    await axios.post(`${BASE}/runner/jobs/${jobId}/logs`, { lines }, { headers });
  } catch (err) {
    console.error(`[runner] log post failed for ${jobId}: ${err.message}`);
  }
}

async function postResult(jobId, payload) {
  await axios.post(`${BASE}/runner/jobs/${jobId}/result`, payload, { headers });
}

// Batch log lines and flush at most every 500ms so the live console stays smooth.
function makeLogSink(jobId) {
  let buffer = [];
  let timer = null;
  const flush = async () => {
    timer = null;
    const lines = buffer;
    buffer = [];
    await postLogs(jobId, lines);
  };
  const onLog = (line) => {
    process.stdout.write(`${line}\n`);
    buffer.push(String(line));
    if (!timer) timer = setTimeout(flush, 500);
  };
  const drain = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    await flush();
  };
  return { onLog, drain };
}

/**
 * Copilot-handoff execution: hand the claimed job to the local VS Code Copilot agent, tail its run
 * log, stream new lines back to B.L.A.S.T., and resolve when the agent writes a terminal marker.
 * The agent drives a REAL browser (evidence-based locators) instead of guessing — the reliable path
 * for interaction-gated features (menus/dropdowns/logout).
 */
async function runJobViaCopilot(job, onLog) {
  const { fw, cleanup } = await prepareWorkspace(job, onLog);
  if (!fw) throw new Error('No workspace — set job.repoUrl or FRAMEWORK_PATH.');
  onLog(`[runner] Launching local Copilot agent for ${job.jobId} in ${fw}…`);
  try {
    const handoff = localAgent.launchCopilotHandoff(fw, job);
    if (!handoff.launched) {
      onLog('[runner] WARN: VS Code launch may have failed — ensure "code" is on PATH and you are signed into Copilot.');
    }

    const deadline = Date.now() + COPILOT_TIMEOUT_MS;
    const markerRe = /\[copilot\]\s+(DONE PASSED|DONE FAILED|ERROR)\b([^\n]*)/i;
    let seen = 0;          // chars of the log already streamed back
    let terminal = null;   // { status, reason }

    while (Date.now() < deadline && !terminal) {
      await sleep(COPILOT_POLL_MS);
      const full = localAgent.readCopilotLog(fw, job.jobId) || '';
      if (full.length > seen) {
        for (const line of full.slice(seen).split('\n')) {
          if (line.trim()) onLog(line);
        }
        seen = full.length;
      }
      const m = full.match(markerRe);
      if (m) {
        const kind = m[1].toUpperCase();
        terminal = kind === 'DONE PASSED'
          ? { status: 'PASSED', reason: '' }
          : { status: 'FAILED', reason: (m[2] || '').trim() || 'Copilot reported failure' };
      }
    }

    if (!terminal) {
      const mins = Math.round(COPILOT_TIMEOUT_MS / 60000);
      return { executionStatus: 'FAILED', error: `Copilot handoff timed out after ${mins}m with no DONE marker.` };
    }
    return { executionStatus: terminal.status, error: terminal.status === 'PASSED' ? '' : terminal.reason };
  } finally {
    await cleanup();
  }
}

async function runJob(job) {
  const engine = RUNNER_MODE === 'copilot' ? 'local Copilot agent' : 'codegen';
  console.log(`\n[runner] Claimed ${job.jobId} — ${(job.testCases || []).length} case(s). Running via ${engine}…`);
  const { onLog, drain } = makeLogSink(job.jobId);
  onLog(`[runner] ${RUNNER_ID} picked up ${job.jobId} (${engine}).`);
  try {
    const result = RUNNER_MODE === 'copilot'
      ? await runJobViaCopilot(job, onLog)
      : await localAgent.generateAndRun(job, onLog);
    await drain();
    await postResult(job.jobId, {
      executionStatus: result.executionStatus || '',
      reportUrl: result.reportUrl || '',
      generatedFiles: result.generatedFiles || [],
      reusedFiles: result.reusedFiles || [],
      error: result.error || '',
      logs: [`[runner] ${job.jobId} finished: ${result.executionStatus || 'DONE'}.`],
    });
    console.log(`[runner] ${job.jobId} reported: ${result.executionStatus || 'DONE'}.`);
  } catch (err) {
    await drain();
    await postResult(job.jobId, { error: err.message || 'Runner execution failed' });
    console.error(`[runner] ${job.jobId} FAILED: ${err.message}`);
  }
}

async function main() {
  if (!TOKEN) {
    console.error('[runner] RUNNER_TOKEN is not set (and DEV_MODE is off). Aborting.');
    process.exit(1);
  }
  if (RUNNER_MODE === 'copilot') {
    // Copilot drives generation, so no LLM key is needed — only a valid framework path.
    const fw = (localAgent.config().frameworkPath) || '';
    if (!fw || !fs.existsSync(fw)) {
      console.error('[runner] FRAMEWORK_PATH is not set or does not exist — required for Copilot mode. Aborting.');
      process.exit(1);
    }
  } else if (!localAgent.isConfigured()) {
    console.error('[runner] local_agent not configured — set FRAMEWORK_PATH and an LLM key in .env. Aborting.');
    process.exit(1);
  }
  console.log(`[runner] ${RUNNER_ID} online (${RUNNER_MODE} mode). Polling ${BASE}/runner/claim every ${POLL_MS}ms…`);
  for (;;) {
    let job = null;
    try {
      job = await claim();
    } catch (err) {
      const detail = err.response ? `${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
      console.error(`[runner] claim failed: ${detail}`);
    }
    if (job) await runJob(job);
    else await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error('[runner] fatal:', err.message);
  process.exit(1);
});
