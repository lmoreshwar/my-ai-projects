/**
 * explore.ts — PHASE 1 of the two-dispatch flow (the APPROVAL GATE).
 * ─────────────────────────────────────────────────────────────────────────────
 * Drives the live app with the agent-loop to VERIFY the feature flow, then authors
 * the PROPOSED test cases from that verified trace. It writes a `blast-plan.json`
 * (feature + url + proposed cases + the verified trace) which the workflow uploads
 * as an artifact. NO code is written, NO commit, NO PR here — the website shows the
 * plan and waits for the user to Approve, which triggers phase 2 (approve.ts).
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgentLoop } from './agent-loop';
import { authorPlanFromTrace, authorScenariosFromDiscovery, scenariosToCases, type CodegenJob, type BlastPlanV2 } from './codegen';

const log = (l: string): void => console.log(l);

async function main(): Promise<void> {
  const url = process.env.APP_URL || '';
  const feature = process.env.FEATURE_NAME || '';
  const fw = process.env.FRAMEWORK_PATH || '';
  if (!url || !feature) throw new Error('APP_URL and FEATURE_NAME are required.');

  const testTypes = (process.env.TEST_TYPES || 'positive').split(',').map((s) => s.trim()).filter(Boolean);
  // Default cap raised to 6 so exhaustive discovery can surface several selectable scenarios.
  const maxCases = Number(process.env.MAX_CASES) > 0 ? Number(process.env.MAX_CASES) : 6;
  const outDir = process.env.OUTPUT_DIR || fw || '.';

  const goal = `Explore and verify the "${feature}" feature. Log in if a login form is present, reach the feature, and EXHAUSTIVELY exercise its primary flow (${testTypes.join(', ')}): once on the feature form, fill EVERY discovered field (including optional ones) with realistic valid data before saving, and confirm the expected outcome.`;
  log(`[explore] Exploring "${feature}" at ${url}…`);
  const walk = await runAgentLoop({ url, goal, feature, discover: true, maxSteps: Math.max(20, maxCases * 8), onLog: log });

  const job: CodegenJob = { feature, url, testTypes, maxCases };
  const discovery = walk.discovery;

  // Build the richer V2 plan when discovery ran; scenarios are the selectable, evidence-linked units.
  const scenarios = (walk.status === 'passed' && discovery)
    ? authorScenariosFromDiscovery(job, discovery, walk.steps)
    : [];

  // Legacy PlanCase list: prefer the scenario projection; fall back to the LLM author for non-discovery walks.
  let cases = scenariosToCases(scenarios);
  if (!cases.length && walk.status === 'passed' && walk.steps.length) {
    cases = await authorPlanFromTrace(fw, job, walk.steps, log);
  } else if (walk.status !== 'passed') {
    log(`[explore] The flow could not be verified: ${walk.summary}`);
  }

  const plan: BlastPlanV2 = {
    version: 2, feature, url, testTypes, maxCases,
    status: walk.status, summary: walk.summary,
    applicationSummary: discovery?.applicationSummary ?? null,
    inventory: discovery?.inventory ?? [],
    states: discovery?.states ?? [],
    completeness: discovery?.completeness ?? null,
    scenarios,
    trace: walk.steps,
    cases,
  };

  const outFile = join(outDir, 'blast-plan.json');
  writeFileSync(outFile, JSON.stringify(plan, null, 2));
  const evidenceFile = join(outDir, 'blast-explore-evidence.json');
  writeFileSync(evidenceFile, JSON.stringify({ status: plan.status, summary: plan.summary, trace: plan.trace, completeness: plan.completeness }, null, 2));
  log(`[explore] Wrote plan v2 (${scenarios.length} scenario(s), ${plan.inventory.length} control(s), ${plan.trace.length} verified step(s)) → ${outFile}`);

  // Always exit 0 so the plan artifact uploads; the website reads plan.status to
  // decide WaitingForApproval (cases present) vs Blocked (no verified flow).
  process.exit(0);
}

main().catch((e) => { console.error('[explore] failed:', (e as Error).message); process.exit(1); });
