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
const localAgent = require('../api/_tools/local_agent');

const API = (process.env.BLAST_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const TOKEN = process.env.RUNNER_TOKEN || (process.env.DEV_MODE === 'true' ? 'dev-runner-token' : '');
const RUNNER_ID = process.env.RUNNER_ID || `${os.hostname()}-${process.pid}`;
const POLL_MS = Number(process.env.RUNNER_POLL_MS || 3000);
const BASE = `${API}/api/automation`;
const headers = { 'x-runner-token': TOKEN, 'Content-Type': 'application/json' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function runJob(job) {
  console.log(`\n[runner] Claimed ${job.jobId} — ${(job.testCases || []).length} case(s). Generating…`);
  const { onLog, drain } = makeLogSink(job.jobId);
  onLog(`[runner] ${RUNNER_ID} picked up ${job.jobId}.`);
  try {
    const result = await localAgent.generateAndRun(job, onLog);
    await drain();
    await postResult(job.jobId, {
      executionStatus: result.executionStatus || '',
      reportUrl: result.reportUrl || '',
      generatedFiles: result.generatedFiles || [],
      reusedFiles: result.reusedFiles || [],
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
  if (!localAgent.isConfigured()) {
    console.error('[runner] local_agent not configured — set FRAMEWORK_PATH and an LLM key in .env. Aborting.');
    process.exit(1);
  }
  console.log(`[runner] ${RUNNER_ID} online. Polling ${BASE}/runner/claim every ${POLL_MS}ms…`);
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
