/**
 * approve.ts — PHASE 2 of the two-dispatch flow (runs ONLY after the user Approves).
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads the `blast-plan.json` produced by phase 1 (explore.ts) — which the workflow
 * downloaded from the explore run's artifact — and turns the SAME verified trace into
 * real framework files, verifies the spec is green, then commits + opens a PR.
 * No exploration happens here; the trace is authoritative evidence from phase 1.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateFromTrace, type CodegenJob } from './codegen';
import { verifySpec, commitAndOpenPr } from './generate';
import type { AgentStep } from './agent-loop';

const log = (l: string): void => console.log(l);

interface Plan {
  feature: string; url: string; testTypes?: string[]; maxCases?: number;
  trace?: AgentStep[];
}

async function main(): Promise<void> {
  const fw = process.env.FRAMEWORK_PATH || '';
  if (!fw) throw new Error('FRAMEWORK_PATH is required.');
  const planFile = process.env.PLAN_FILE || join(process.env.PLAN_DIR || fw, 'blast-plan.json');

  let plan: Plan;
  try { plan = JSON.parse(readFileSync(planFile, 'utf8')); }
  catch (e) { throw new Error(`Could not read the plan from ${planFile}: ${(e as Error).message}`); }

  const trace: AgentStep[] = Array.isArray(plan.trace) ? plan.trace : [];
  if (!trace.length) throw new Error('The plan has no verified trace — nothing to generate.');

  const job: CodegenJob = { feature: plan.feature, url: plan.url, testTypes: plan.testTypes, maxCases: plan.maxCases };
  log(`[approve] Generating from ${trace.length} verified step(s) for "${job.feature}"…`);
  const art = await generateFromTrace(fw, job, trace, log);

  const specRel = art.files.find((f) => f.includes('/tests/')) || '';
  if (specRel && !(await verifySpec(fw, specRel))) {
    console.error('[approve] Generated spec did not pass — no PR opened.');
    process.exit(1);
  }

  const prUrl = await commitAndOpenPr(fw, job.feature || 'feature', art.files);
  console.log(`\n=== APPROVE: PASSED ===\nPR opened: ${prUrl}`);
  console.log(`PR_URL=${prUrl}`);
  process.exit(0);
}

main().catch((e) => { console.error('[approve] failed:', (e as Error).message); process.exit(1); });
