/**
 * testcase.ts — AI-NATIVE (test-case-driven) entrypoint.
 * ─────────────────────────────────────────────────────────────────────────────
 * The AI-Native counterpart to the Autopilot Explore→Approve flow, run as ONE job
 * (the supplied test cases are already-approved requirements, so there is NO manual
 * approval gate). It reuses the SAME evidence engine and generation core as Autopilot:
 *
 *   directed exploration (runAgentLoop, live @playwright/cli evidence)
 *     → scenariosFromTestCases (IDs preserved, no LLM re-authoring)
 *     → generateVerifyHeal (shared codegen: reuse index, evidence gates, typecheck,
 *        single-nav repair, self-heal, verify)
 *     → deterministic TC-id enforcement + generation integrity
 *     → open a PR ONLY when every requested case is present AND green
 *
 * It does NOT introduce a second generator: local_agent.js is untouched (kept as
 * fallback) and this path never routes through it. Autopilot's explore.ts/approve.ts
 * are not imported or modified.
 *
 * INPUTS (env):
 *   APP_URL         application URL to drive                 (required)
 *   FRAMEWORK_PATH  path to the target framework repo        (required)
 *   FEATURE_NAME    human feature name (spec/file naming)    (required)
 *   TESTCASES_FILE  path to a JSON file: TestCaseInput[]     (required unless TESTCASES set)
 *   TESTCASES       inline JSON: TestCaseInput[]             (alternative to TESTCASES_FILE)
 *   AGENT_USERNAME / AGENT_PASSWORD  login (secret; optional — consumed inside runAgentLoop)
 *   GITHUB_TOKEN    connected user's token for push + PR     (required for PR)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgentLoop } from './agent-loop';
import {
  generateVerifyHeal, commitAndOpenPr,
} from './generate';
import {
  scenariosFromTestCases, buildTestCaseGoal, enforceTestCaseIds, testCaseIntegrity,
  normalizeTcId, scenariosToCases,
  type CodegenJob, type TestCaseInput, type BlastPlanV2,
} from './codegen';
import { dependencyResolutionContext, resolveCapabilityDependencies } from './capability-dependencies';

const log = (l: string): void => console.log(l);

/** Read the authoritative test cases from TESTCASES_FILE or the inline TESTCASES env (JSON array). */
function readTestCases(): TestCaseInput[] {
  const inline = (process.env.TESTCASES || '').trim();
  const file = (process.env.TESTCASES_FILE || '').trim();
  let raw = '';
  if (file) raw = readFileSync(file, 'utf8');
  else if (inline) raw = inline;
  else throw new Error('Provide the test cases via TESTCASES_FILE (path) or TESTCASES (inline JSON).');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`Test cases are not valid JSON: ${(e as Error).message}`); }
  const arr = Array.isArray(parsed) ? parsed : (parsed as { cases?: unknown[] })?.cases;
  if (!Array.isArray(arr) || !arr.length) throw new Error('Test cases must be a non-empty JSON array of { id, title, steps, expectedResults }.');
  return arr.map((c) => {
    const t = c as Partial<TestCaseInput>;
    if (!t.id || !t.title) throw new Error('Every test case needs an id and a title.');
    return {
      id: normalizeTcId(String(t.id)),
      title: String(t.title),
      steps: Array.isArray(t.steps) ? t.steps.map(String) : [],
      expectedResults: t.expectedResults ? String(t.expectedResults) : '',
      type: t.type ? String(t.type) : undefined,
      tags: Array.isArray(t.tags) ? t.tags.map(String) : undefined,
      testData: (t.testData && typeof t.testData === 'object') ? t.testData as Record<string, unknown> : undefined,
    };
  });
}

export async function runTestCases(): Promise<{ status: string; prUrl?: string; files: string[]; summary: string }> {
  const url = process.env.APP_URL || '';
  const feature = process.env.FEATURE_NAME || '';
  const fw = process.env.FRAMEWORK_PATH || '';
  if (!url || !feature || !fw) throw new Error('APP_URL, FEATURE_NAME and FRAMEWORK_PATH are required.');

  const cases = readTestCases();
  const requestedIds = cases.map((c) => c.id);
  const requested = cases.map((c) => ({ id: c.id, title: c.title }));
  log(`[testcase] ${cases.length} requested: ${requestedIds.join(', ')}`);

  // 1) DIRECTED EXPLORATION — drive the SUPPLIED steps live and collect verified evidence (same engine
  //    as Autopilot Explore). The goal is built deterministically from the test cases; nothing is invented.
  const dependencies = resolveCapabilityDependencies(fw, feature, url);
  const goal = `${buildTestCaseGoal(cases)}

INTERNAL PREREQUISITE CONTEXT (already verified capabilities; use only as setup, do not re-automate):
${dependencyResolutionContext(dependencies)}`;
  log(`[testcase] Directed exploration of "${feature}" at ${url}…`);
  const walk = await runAgentLoop({ url, goal, feature, discover: true, maxSteps: Math.max(32, cases.length * 8), onLog: log });
  if (walk.status === 'failed' || !walk.steps.length) {
    return { status: 'failed', files: [], summary: `Directed exploration did not verify the flow: ${walk.summary}` };
  }

  // Persist a plan artifact in the EXISTING v2 shape (parity with Autopilot; no second plan format).
  const scenarios = scenariosFromTestCases(cases);
  const plan: BlastPlanV2 = {
    version: 2, feature, url, testTypes: ['positive'], maxCases: cases.length,
    status: walk.status, summary: walk.summary,
    applicationSummary: walk.discovery?.applicationSummary ?? null,
    inventory: walk.discovery?.inventory ?? [],
    states: walk.discovery?.states ?? [],
    transitions: walk.discovery?.transitions ?? [],
    discoveryVersion: walk.discovery?.discoveryVersion,
    completeness: walk.discovery?.completeness ?? null,
    scenarios,
    trace: walk.steps,
    cases: scenariosToCases(scenarios),
  };
  try { writeFileSync(join(fw, 'blast-plan.json'), JSON.stringify(plan, null, 2)); } catch { /* best-effort artifact */ }

  // 2) GENERATE → VERIFY → SELF-HEAL via the SHARED core. caseContract makes the model author the exact
  //    supplied IDs+titles; the shared gates (reuse, evidence, single-nav repair, typecheck) still apply.
  const job: CodegenJob = {
    feature, url, testTypes: ['positive'], maxCases: cases.length,
    caseContract: requested,
    discoveryEvidence: walk.discovery ? { inventory: walk.discovery.inventory, transitions: walk.discovery.transitions } : undefined,
    dependencyResolution: resolveCapabilityDependencies(fw, feature, url, walk.discovery),
  };
  const { passed, art } = await generateVerifyHeal(fw, job, walk.steps, log);
  if (!passed) {
    return { status: 'failed', files: art.files, summary: 'Generated spec did not pass after self-heal — no PR opened.' };
  }

  // 3) DETERMINISTIC TC-ID ENFORCEMENT + GENERATION INTEGRITY. Preserve the supplied IDs exactly; open a PR
  //    ONLY when every requested case is present. No silent dropping.
  const specRel = art.files.find((f) => f.includes('/tests/')) || '';
  if (!specRel) return { status: 'failed', files: art.files, summary: 'No spec file was generated.' };
  const specAbs = join(fw, specRel);
  const before = readFileSync(specAbs, 'utf8');
  const enforced = enforceTestCaseIds(before, requested);
  if (enforced.changed) { writeFileSync(specAbs, enforced.content); log('[testcase] deterministic ID enforcement: aligned generated tests to the requested TC ids.'); }
  const integrity = testCaseIntegrity(requestedIds, enforced.content);
  log(`[testcase] integrity — requested ${requestedIds.length}, present ${integrity.present.length}: ${integrity.present.join(', ')}`);
  if (!integrity.complete) {
    return { status: 'failed', files: art.files, summary: `Generation integrity FAILED — missing: ${integrity.missing.join(', ')}. No PR opened.` };
  }

  // 4) COMMIT + PR (green + complete only).
  const prUrl = await commitAndOpenPr(fw, feature, art.files);
  return { status: 'passed', prUrl, files: art.files, summary: `PR opened: ${prUrl}` };
}

const invokedDirectly =
  (process.argv[1] || '').replace(/\\/g, '/').endsWith('testcase.ts') ||
  (process.argv[1] || '').replace(/\\/g, '/').endsWith('testcase.js') ||
  process.env.TESTCASE_MAIN === '1';

if (invokedDirectly) {
  runTestCases()
    .then((res) => {
      console.log(`\n=== TESTCASE: ${res.status.toUpperCase()} ===\n${res.summary}`);
      if (res.prUrl) console.log(`PR_URL=${res.prUrl}`);
      process.exit(res.status === 'passed' ? 0 : 1);
    })
    .catch((e) => { console.error('[testcase] failed:', (e as Error).message); process.exit(1); });
}
