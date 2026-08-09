#!/usr/bin/env node
/**
 * B.L.A.S.T. cloud CI entry point.
 *
 * Runs the SAME local_agent generation the laptop worker uses, but inside a
 * GitHub Actions runner. The workflow checks out the framework repo (tests +
 * code land there) and this engine repo, then invokes this script with a job
 * JSON file. We reuse generateAndRun() verbatim — no logic is duplicated.
 *
 * Contract:
 *   Usage:   node scripts/blast-ci-generate.js <path-to-job.json>
 *   Env:     FRAMEWORK_PATH  = checkout of the framework repo (where src/ lives)
 *            LLM_PLATFORM / GROQ_API_KEY|GEMINI_API_KEY / LLM_MODEL|GEMINI_MODEL
 *            APP_USERNAME / APP_PASSWORD  (framework credentials, read by tests)
 *   Output:  writes blast-ci-result.json into CWD (the framework checkout) and,
 *            when running under Actions, appends status/changed to $GITHUB_OUTPUT.
 *   Exit:    0 even when tests fail — the Pull Request is the human gate. Exits
 *            non-zero ONLY on a hard error (misconfig, no job, nothing generated).
 */
const fs = require('fs');
const path = require('path');
const localAgent = require('../api/_tools/local_agent');

function fail(msg) {
  console.error(`[blast-ci] ERROR: ${msg}`);
  process.exit(1);
}

function setActionOutput(key, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  try {
    fs.appendFileSync(out, `${key}=${String(value).replace(/\r?\n/g, ' ')}\n`);
  } catch {
    /* best-effort — outputs are non-fatal */
  }
}

async function main() {
  const jobPath = process.argv[2];
  if (!jobPath) fail('no job file provided. Usage: node scripts/blast-ci-generate.js <job.json>');
  if (!fs.existsSync(jobPath)) fail(`job file not found: ${jobPath}`);

  let job;
  try {
    job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  } catch (e) {
    return fail(`job file is not valid JSON: ${e.message}`);
  }
  if (!job || !job.jobId) fail('job payload is missing a jobId.');

  const cfg = localAgent.config();
  if (!cfg.frameworkPath || !fs.existsSync(cfg.frameworkPath)) {
    fail('FRAMEWORK_PATH is not set or does not exist in the runner.');
  }
  if (!localAgent.isConfigured()) {
    fail('LLM is not configured — set LLM_PLATFORM and the matching API key secret.');
  }

  console.log(`[blast-ci] Job ${job.jobId} — skill "${job.skill || 'New Automation'}" — framework at ${cfg.frameworkPath}`);

  let result;
  try {
    result = await localAgent.generateAndRun(job, (line) => process.stdout.write(`${line}\n`));
  } catch (e) {
    // A hard generation failure still writes a result so the workflow can report it.
    const errResult = { executionStatus: 'FAILED', error: e.message || String(e), generatedFiles: [], reusedFiles: [] };
    fs.writeFileSync(path.join(process.cwd(), 'blast-ci-result.json'), JSON.stringify(errResult, null, 2));
    return fail(`generation threw: ${e.message}`);
  }

  const changed = (result.generatedFiles || [])
    .filter((f) => f && f.path && f.path.startsWith('src/') && f.action !== 'reused')
    .map((f) => f.path);

  // Completion gate: if any requested case was NOT automated, do NOT open a PR —
  // an incomplete/no-op PR is worse than none. Verified defaults true for pure-reuse.
  const missingCases = result.missingCases || [];
  const verified = result.verified !== false;
  if (!verified) {
    console.error(`[blast-ci] VERIFICATION FAILED — requested case(s) not automated: ${missingCases.join(', ')}. Suppressing PR (has_changes=false).`);
  }
  const openPr = verified && changed.length > 0;

  const summary = {
    jobId: job.jobId,
    skill: job.skill || 'New Automation',
    executionStatus: result.executionStatus || 'UNKNOWN',
    reportUrl: result.reportUrl || 'playwright-report/index.html',
    reportSummary: result.reportSummary || null,
    generatedFiles: result.generatedFiles || [],
    reusedFiles: result.reusedFiles || [],
    changedPaths: changed,
    requestedCases: result.requestedCases || [],
    missingCases,
    verified,
  };
  fs.writeFileSync(path.join(process.cwd(), 'blast-ci-result.json'), JSON.stringify(summary, null, 2));

  setActionOutput('status', summary.executionStatus);
  setActionOutput('changed_count', changed.length);
  setActionOutput('has_changes', openPr ? 'true' : 'false');
  setActionOutput('verified', verified ? 'true' : 'false');
  setActionOutput('missing_cases', missingCases.join(' '));

  console.log(`[blast-ci] Done — status=${summary.executionStatus}, changed ${changed.length} file(s), verified=${verified}, PR=${openPr}.`);
  // Exit 0 regardless of test pass/fail: the PR review is the gate.
  process.exit(0);
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
