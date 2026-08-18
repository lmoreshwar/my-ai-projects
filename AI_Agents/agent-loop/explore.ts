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
import { authorPlanFromTrace, type CodegenJob } from './codegen';

const log = (l: string): void => console.log(l);

async function main(): Promise<void> {
  const url = process.env.APP_URL || '';
  const feature = process.env.FEATURE_NAME || '';
  const fw = process.env.FRAMEWORK_PATH || '';
  if (!url || !feature) throw new Error('APP_URL and FEATURE_NAME are required.');

  const testTypes = (process.env.TEST_TYPES || 'positive').split(',').map((s) => s.trim()).filter(Boolean);
  const maxCases = Number(process.env.MAX_CASES) > 0 ? Number(process.env.MAX_CASES) : 3;
  const outDir = process.env.OUTPUT_DIR || fw || '.';

  const goal = `Explore and verify the "${feature}" feature. Log in if a login form is present, reach the feature, and exercise its primary flow (${testTypes.join(', ')}), confirming the expected outcome.`;
  log(`[explore] Exploring "${feature}" at ${url}…`);
  const walk = await runAgentLoop({ url, goal, maxSteps: Math.max(15, maxCases * 8), onLog: log });

  const plan: {
    feature: string; url: string; testTypes: string[]; maxCases: number;
    status: string; summary: string; trace: unknown[]; cases: unknown[];
  } = {
    feature, url, testTypes, maxCases,
    status: walk.status, summary: walk.summary,
    trace: walk.steps, cases: [],
  };

  if (walk.status === 'passed' && walk.steps.length) {
    const job: CodegenJob = { feature, url, testTypes, maxCases };
    plan.cases = await authorPlanFromTrace(fw, job, walk.steps, log);
  } else {
    log(`[explore] The flow could not be verified: ${walk.summary}`);
  }

  const outFile = join(outDir, 'blast-plan.json');
  writeFileSync(outFile, JSON.stringify(plan, null, 2));
  const evidenceFile = join(outDir, 'blast-explore-evidence.json');
  writeFileSync(evidenceFile, JSON.stringify({ status: plan.status, summary: plan.summary, trace: plan.trace }, null, 2));
  log(`[explore] Wrote plan (${plan.cases.length} case(s), ${plan.trace.length} verified step(s)) → ${outFile}`);

  // Always exit 0 so the plan artifact uploads; the website reads plan.status to
  // decide WaitingForApproval (cases present) vs Blocked (no verified flow).
  process.exit(0);
}

main().catch((e) => { console.error('[explore] failed:', (e as Error).message); process.exit(1); });
