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
import { authorPlanFromTrace, authorScenariosFromDiscovery, authorFeatureVerificationScenarios, scenariosToCases, type CodegenJob, type BlastPlanV2 } from './codegen';
import { dependencyResolutionContext, resolveCapabilityDependencies } from './capability-dependencies';
import { detectFeatureBoundary, splitTrace, resolveFeatureStatus } from './feature-boundary';

const log = (l: string): void => console.log(l);

async function main(): Promise<void> {
  const url = process.env.APP_URL || '';
  const feature = process.env.FEATURE_NAME || '';
  const fw = process.env.FRAMEWORK_PATH || '';
  // Optional free-text summary: when the website sends a full task description it becomes the PRIMARY
  // exploration goal (feature stays a short label for naming). Empty → the feature-name goal (unchanged).
  const summary = (process.env.SUMMARY || '').trim();
  if (!url || !feature) throw new Error('APP_URL and FEATURE_NAME are required.');

  const testTypes = (process.env.TEST_TYPES || 'positive').split(',').map((s) => s.trim()).filter(Boolean);
  // Default cap raised to 6 so exhaustive discovery can surface several selectable scenarios.
  const maxCases = Number(process.env.MAX_CASES) > 0 ? Number(process.env.MAX_CASES) : 6;
  const outDir = process.env.OUTPUT_DIR || fw || '.';

  const initialDependencies = resolveCapabilityDependencies(fw, feature, url);
  // The summary (when provided) is the user's own description of the task and drives the walk verbatim;
  // otherwise fall back to the feature-name template. The prerequisite context is appended either way.
  const primary = summary
    ? `${summary}

Log in if a login form is present, reach the described feature, and COMPLETE the task end-to-end (${testTypes.join(', ')}): once on each form, fill EVERY discovered field (including optional ones) with realistic valid data before saving/submitting, then confirm the expected FINAL outcome.`
    : `Explore and verify the "${feature}" feature. Log in if a login form is present, reach the feature, and EXHAUSTIVELY exercise its primary flow (${testTypes.join(', ')}): once on the feature form, fill EVERY discovered field (including optional ones) with realistic valid data before saving, and confirm the expected outcome.`;
  const goal = `${primary}

INTERNAL PREREQUISITE CONTEXT (already verified capabilities; do not treat these as new feature scope):
${dependencyResolutionContext(initialDependencies)}
When the feature needs one of these states, establish it as setup before verifying the missing capability. Do not re-automate the prerequisite as a new feature.`;
  log(`[explore] Exploring "${feature}" at ${url}…`);
  // Floor of 32: a real feature walk spends ~24-28 steps on fixed overhead (login, prerequisite setup,
  // navigation, discovery, per-field fills + inter-step snapshots) before its own submit — a 20-step cap
  // lands multi-step flows (e.g. Checkout) exactly on the finish line. maxCases still scales larger runs.
  const walk = await runAgentLoop({ url, goal, feature, discover: true, maxSteps: Math.max(32, maxCases * 8), onLog: log });

  const discovery = walk.discovery;
  const dependencies = resolveCapabilityDependencies(fw, feature, url, discovery);
  const job: CodegenJob = {
    feature, url, testTypes, maxCases,
    discoveryEvidence: discovery ? { inventory: discovery.inventory, transitions: discovery.transitions } : undefined,
    dependencyResolution: dependencies,
  };

  // FEATURE BOUNDARY / TARGET COMPLETION (generic): a VERIFIED feature target is a SUCCESS even when
  // the walk later wandered into a downstream capability. The PRIMARY trace (prerequisite + feature,
  // no downstream) is what we author from, and the effective status is never a failure after success.
  // Prefer the boundary the agent already accepted at finish (computed WITH the resolved on-screen
  // state — a non-navigating action's resulting snapshot is not re-derivable from steps alone).
  const boundary = walk.featureBoundary ?? detectFeatureBoundary(feature, url, walk.steps);
  const effStatus = resolveFeatureStatus(walk.status, boundary);
  const primaryTrace = boundary.acceptanceVerified ? splitTrace(walk.steps, boundary).primaryTrace : walk.steps;
  if (boundary.acceptanceVerified && walk.status !== 'passed') {
    log(`[explore] feature boundary: ${boundary.reason} — treating exploration as PASSED (downstream steps ignored).`);
  }

  // Build the richer V2 plan. When discovery captured a fillable form, author create/fill scenarios.
  // Otherwise, for a verified READ/VIEW feature (e.g. View Cart), author a view-verification scenario
  // from the primary trace so the plan always has a ready, automation-ready scenario.
  let scenarios = (effStatus === 'passed' && discovery && discovery.inventory.some((it) => !it.isAction))
    ? authorScenariosFromDiscovery(job, discovery, primaryTrace)
    : [];
  if (!scenarios.length && effStatus === 'passed' && boundary.acceptanceVerified) {
    scenarios = authorFeatureVerificationScenarios(job, primaryTrace, discovery?.applicationSummary ?? null);
  }

  // Legacy PlanCase list: prefer the scenario projection; fall back to the LLM author for non-discovery walks.
  let cases = scenariosToCases(scenarios);
  if (!cases.length && effStatus === 'passed' && primaryTrace.length) {
    cases = await authorPlanFromTrace(fw, job, primaryTrace, log);
  } else if (effStatus !== 'passed') {
    log(`[explore] The flow could not be verified: ${walk.summary}`);
    for (const d of walk.diagnostics ?? []) {
      log(`[explore] ROOT CAUSE (${d.category}): ${d.headline}`);
      for (const line of d.evidence) log(`[explore]   • ${line}`);
    }
  }

  const plan: BlastPlanV2 = {
    version: 2, feature, url, testTypes, maxCases,
    status: effStatus, summary: walk.summary,
    applicationSummary: discovery?.applicationSummary ?? null,
    inventory: discovery?.inventory ?? [],
    states: discovery?.states ?? [],
    // LIVE state-transition evidence (dropdown options, date-picker, dependent fields) for codegen.
    transitions: discovery?.transitions ?? [],
    discoveryVersion: discovery?.discoveryVersion,
    completeness: discovery?.completeness ?? null,
    scenarios,
    trace: primaryTrace,
    cases,
  };

  const outFile = join(outDir, 'blast-plan.json');
  writeFileSync(outFile, JSON.stringify(plan, null, 2));
  const evidenceFile = join(outDir, 'blast-explore-evidence.json');
  writeFileSync(evidenceFile, JSON.stringify({ status: plan.status, summary: plan.summary, trace: plan.trace, completeness: plan.completeness, diagnostics: walk.diagnostics ?? [] }, null, 2));
  log(`[explore] Wrote plan v2 (${scenarios.length} scenario(s), ${plan.inventory.length} control(s), ${(plan.transitions ?? []).length} transition(s), ${plan.trace.length} verified step(s)) → ${outFile}`);

  // Always exit 0 so the plan artifact uploads; the website reads plan.status to
  // decide WaitingForApproval (cases present) vs Blocked (no verified flow).
  process.exit(0);
}

main().catch((e) => { console.error('[explore] failed:', (e as Error).message); process.exit(1); });
