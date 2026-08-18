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
import { generateFromTrace, selectTraceForScenarios, type CodegenJob, type Scenario } from './codegen';
import { verifySpec, commitAndOpenPr } from './generate';
import type { AgentStep } from './agent-loop';

const log = (l: string): void => console.log(l);

interface Plan {
  feature: string; url: string; testTypes?: string[]; maxCases?: number;
  trace?: AgentStep[];
  scenarios?: Scenario[];
  completeness?: { passed?: boolean; missing?: string[] } | null;
}

async function main(): Promise<void> {
  const fw = process.env.FRAMEWORK_PATH || '';
  if (!fw) throw new Error('FRAMEWORK_PATH is required.');
  const planFile = process.env.PLAN_FILE || join(process.env.PLAN_DIR || fw, 'blast-plan.json');

  let plan: Plan;
  try { plan = JSON.parse(readFileSync(planFile, 'utf8')); }
  catch (e) { throw new Error(`Could not read the plan from ${planFile}: ${(e as Error).message}`); }

  const fullTrace: AgentStep[] = Array.isArray(plan.trace) ? plan.trace : [];
  if (!fullTrace.length) throw new Error('The plan has no verified trace — nothing to generate.');

  const scenarios: Scenario[] = Array.isArray(plan.scenarios) ? plan.scenarios : [];
  const selectedIds = (process.env.SELECTED_SCENARIO_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

  // Scenario-driven path: validate the user's selection, then filter the trace to only those fields.
  let trace = fullTrace;
  let coverageFields: string[] | undefined;
  if (scenarios.length) {
    if (!selectedIds.length) throw new Error('No scenarios were selected — pick at least one ready scenario before approving.');
    const chosen = scenarios.filter((s) => selectedIds.includes(s.id));
    const unknown = selectedIds.filter((id) => !scenarios.some((s) => s.id === id));
    if (unknown.length) throw new Error(`Unknown scenario id(s): ${unknown.join(', ')}.`);
    const blocked = chosen.filter((s) => s.blocked || !s.ready);
    if (blocked.length) throw new Error(`These scenarios are not automation-ready and cannot be generated: ${blocked.map((s) => `${s.id} (${s.blockedReason || 'not ready'})`).join('; ')}.`);
    if (plan.completeness && plan.completeness.passed === false) {
      throw new Error(`Discovery is incomplete (${(plan.completeness.missing || []).join('; ')}). Re-run exploration before generating.`);
    }
    const sel = selectTraceForScenarios(fullTrace, scenarios, selectedIds);
    trace = sel.trace;
    coverageFields = sel.coverageLabels;
    log(`[approve] ${chosen.length} scenario(s) selected → ${coverageFields.length} executable Automation Trace step(s) to cover from ${trace.length} verified trace step(s).`);
  }

  const job: CodegenJob = { feature: plan.feature, url: plan.url, testTypes: plan.testTypes, maxCases: plan.maxCases, coverageFields };
  log(`[approve] Generating from ${trace.length} verified step(s) for "${job.feature}"…`);
  const art = await generateFromTrace(fw, job, trace, log);

  const specRel = art.files.find((f) => f.includes('/tests/')) || '';
  if (specRel && !(await verifySpec(fw, specRel))) {
    // Dump the generated files so the written locators can be compared against the verified trace.
    for (const rel of art.files) {
      try { log(`\n───── generated ${rel} ─────\n${readFileSync(join(fw, rel), 'utf8')}`); }
      catch { /* unreadable file — skip */ }
    }
    console.error('[approve] Generated spec did not pass — no PR opened.');
    process.exit(1);
  }

  const prUrl = await commitAndOpenPr(fw, job.feature || 'feature', art.files);
  console.log(`\n=== APPROVE: PASSED ===\nPR opened: ${prUrl}`);
  console.log(`PR_URL=${prUrl}`);
  process.exit(0);
}

main().catch((e) => { console.error('[approve] failed:', (e as Error).message); process.exit(1); });
