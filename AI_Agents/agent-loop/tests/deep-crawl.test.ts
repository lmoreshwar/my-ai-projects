/**
 * deep-crawl.test.ts — unit tests for the bounded, SAFE, REVERSIBLE state-transition layer
 * (`runDiscovery` deep-crawl) and the discovery→codegen evidence hand-off.
 *
 * Everything runs against a scripted in-memory CLI session — a tiny state machine that returns
 * canned accessibility snapshots keyed by the ref that was clicked. No real browser, no network,
 * no sleeps. The deep crawl only ever OPENS reversible controls (dropdown/date/tab), never submits.
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runDiscovery, parseInventory, normalizeStateSignature,
  type DiscoveryResult, type StateTransition, type ApplicationSummary,
} from '../discovery';
import { authorScenariosFromDiscovery } from '../codegen';
import type { CliSession } from '../playwright-cli-tools';
import type { AgentStep } from '../agent-loop';

/* ── Scripted CLI session (no real browser) ─────────────────────────────────────
 * `current` is the snapshot the next `snapshot` call returns. Clicking a ref that appears in
 * `onClick` swaps `current` to that ref's snapshot; Escape/goto restore the baseline; PageDown and
 * everything else leave the state unchanged (so the read-only scroll pass stabilises immediately). */
interface ScriptedScreen {
  featureUrl: string;
  baseline: string;
  onClick?: Record<string, string>;
}

function asCli(yaml: string, url: string): string {
  return `Page URL: ${url}\n\n\`\`\`yaml\n${yaml}\n\`\`\``;
}

function scriptedSession(screen: ScriptedScreen): CliSession & { calls: string[] } {
  let current = screen.baseline;
  const onClick = screen.onClick || {};
  const session = {
    id: 'deep-crawl-test',
    calls: [] as string[],
    run(args: string[]): Promise<string> {
      session.calls.push(args.join(' '));
      const [cmd, arg] = args;
      if (cmd === 'snapshot') return Promise.resolve(asCli(current, screen.featureUrl));
      if (cmd === 'click' && onClick[arg] !== undefined) current = onClick[arg];
      if (cmd === 'goto' || (cmd === 'press' && arg === 'Escape')) current = screen.baseline;
      return Promise.resolve('');
    },
  };
  return session as unknown as CliSession & { calls: string[] };
}

const URL = 'https://app.example/web/feature';

/* ── Fixtures ────────────────────────────────────────────────────────────────── */

// A custom dropdown that opens to real options and reflects the chosen value.
const DROPDOWN = {
  baseline: [
    '- heading "Add Employee" [level=6]',
    '- text: Job Title*',
    '- combobox "Job Title" [ref=e10]: "-- Select --"',
    '- button "Save" [ref=e20]',
  ].join('\n'),
  opened: [
    '- heading "Add Employee" [level=6]',
    '- text: Job Title*',
    '- combobox "Job Title" [ref=e10]: "-- Select --"',
    '- option "-- Select --" [ref=e11]',
    '- option "Manager" [ref=e12]',
    '- option "Engineer" [ref=e13]',
    '- button "Save" [ref=e20]',
  ].join('\n'),
  selected: [
    '- heading "Add Employee" [level=6]',
    '- text: Job Title*',
    '- combobox "Job Title" [ref=e10]: "Manager"',
    '- button "Save" [ref=e20]',
  ].join('\n'),
};

// A date field that opens a calendar dialog (no options; a picker, not a select).
const DATE = {
  baseline: [
    '- heading "Apply Leave" [level=6]',
    '- text: From Date*',
    '- textbox "From Date" [ref=e10]',
    '- button "Assign" [ref=e30]',
  ].join('\n'),
  opened: [
    '- heading "Apply Leave" [level=6]',
    '- text: From Date*',
    '- textbox "From Date" [ref=e10]',
    '- dialog "Calendar":',
    '  - button "Previous Month" [ref=e11]',
    '  - gridcell "1" [ref=e12]',
    '  - gridcell "15" [ref=e13]',
    '- button "Assign" [ref=e30]',
  ].join('\n'),
};

// A dropdown whose selection reveals a dependent field (Card Number appears only after "Credit Card").
const CASCADING = {
  baseline: [
    '- heading "Payment" [level=6]',
    '- text: Method*',
    '- combobox "Method" [ref=e10]: "-- Select --"',
    '- button "Submit" [ref=e40]',
  ].join('\n'),
  opened: [
    '- heading "Payment" [level=6]',
    '- text: Method*',
    '- combobox "Method" [ref=e10]: "-- Select --"',
    '- option "-- Select --" [ref=e11]',
    '- option "Credit Card" [ref=e12]',
    '- option "PayPal" [ref=e13]',
    '- button "Submit" [ref=e40]',
  ].join('\n'),
  selected: [
    '- heading "Payment" [level=6]',
    '- text: Method*',
    '- combobox "Method" [ref=e10]: "Credit Card"',
    '- text: Card Number*',
    '- textbox "Card Number" [ref=e20]',
    '- button "Submit" [ref=e40]',
  ].join('\n'),
};

// Three independent dropdowns, each opening to distinct options (for the crawl-budget test).
const MULTI = {
  baseline: [
    '- heading "Multi" [level=6]',
    '- combobox "Alpha" [ref=e10]: "-- Select --"',
    '- combobox "Beta" [ref=e20]: "-- Select --"',
    '- combobox "Gamma" [ref=e30]: "-- Select --"',
    '- button "Save" [ref=e90]',
  ].join('\n'),
  openedAlpha: [
    '- heading "Multi" [level=6]',
    '- combobox "Alpha" [ref=e10]: "-- Select --"',
    '- option "A-One" [ref=e11]',
    '- option "A-Two" [ref=e12]',
    '- combobox "Beta" [ref=e20]: "-- Select --"',
    '- combobox "Gamma" [ref=e30]: "-- Select --"',
    '- button "Save" [ref=e90]',
  ].join('\n'),
};

const summary = (feature: string): ApplicationSummary => ({
  application: 'DemoApp', feature, entryUrl: URL, finalUrl: URL, pageTitle: '', headings: [], authenticated: true,
});

const noopLog = (): void => {};

/* ── 1. Dropdown option capture + transition evidence shape ─────────────────────── */

test('deep-crawl captures a dropdown open→options→select→value transition (verified live)', async () => {
  const session = scriptedSession({ featureUrl: URL, baseline: DROPDOWN.baseline, onClick: { e10: DROPDOWN.opened, e12: DROPDOWN.selected } });
  const res = await runDiscovery(session, { featureUrl: URL, feature: 'Add Employee', deepCrawl: true, log: noopLog });

  assert.equal(res.discoveryVersion, 2, 'v2 discovery carries transitions');
  assert.equal(res.transitions.length, 1, 'exactly one dropdown transition');
  const t = res.transitions[0];
  assert.equal(t.kind, 'dropdown');
  assert.equal(t.trigger, 'Job Title');
  assert.equal(t.verified, true, 'transitions are driven LIVE, so verified');
  assert.equal(t.source, 'deep-crawl');
  assert.deepEqual(t.options, ['Manager', 'Engineer'], 'placeholder "-- Select --" is filtered out');
  assert.equal(t.selectedOption, 'Manager');
  assert.equal(t.resultingValue, 'Manager', 'the chosen value is read back from the control');
  assert.notEqual(t.beforeState, t.afterState, 'opening the control is a real state change');
});

test('deep-crawl enriches the inventory item with its captured options', async () => {
  const session = scriptedSession({ featureUrl: URL, baseline: DROPDOWN.baseline, onClick: { e10: DROPDOWN.opened, e12: DROPDOWN.selected } });
  const res = await runDiscovery(session, { featureUrl: URL, feature: 'Add Employee', deepCrawl: true, log: noopLog });
  const jobTitle = res.inventory.find((i) => /job title/i.test(i.label));
  assert.ok(jobTitle, 'Job Title combobox is inventoried');
  assert.deepEqual(jobTitle!.options, ['Manager', 'Engineer'], 'options are mirrored onto the inventory item');
});

/* ── 2. Date-picker capture ─────────────────────────────────────────────────────── */

test('deep-crawl captures a date-picker transition (calendar visible, no invented options)', async () => {
  const session = scriptedSession({ featureUrl: URL, baseline: DATE.baseline, onClick: { e10: DATE.opened } });
  const res = await runDiscovery(session, { featureUrl: URL, feature: 'Apply Leave', deepCrawl: true, log: noopLog });

  const t = res.transitions.find((x) => x.kind === 'date-picker');
  assert.ok(t, 'a date-picker transition is captured');
  assert.equal(t!.trigger, 'From Date');
  assert.equal(t!.verified, true);
  assert.ok(!t!.options || t!.options.length === 0, 'a date picker has no select options');
  assert.notEqual(t!.beforeState, t!.afterState, 'the calendar opening is a real state change');
});

/* ── 3. Dependent / dynamic control discovery ───────────────────────────────────── */

test('deep-crawl records dependent fields revealed by a selection', async () => {
  const session = scriptedSession({ featureUrl: URL, baseline: CASCADING.baseline, onClick: { e10: CASCADING.opened, e12: CASCADING.selected } });
  const res = await runDiscovery(session, { featureUrl: URL, feature: 'Payment', deepCrawl: true, log: noopLog });

  const t = res.transitions.find((x) => x.trigger === 'Method');
  assert.ok(t, 'the Method dropdown transition exists');
  assert.equal(t!.selectedOption, 'Credit Card');
  assert.ok(t!.revealedFields.some((f) => /card number/i.test(f)), 'the dependent Card Number field is discovered');
});

/* ── 4. Crawl bounds — maxTransitions ───────────────────────────────────────────── */

test('deep-crawl respects maxTransitions and does not crawl every control', async () => {
  const session = scriptedSession({ featureUrl: URL, baseline: MULTI.baseline, onClick: { e10: MULTI.openedAlpha, e11: MULTI.baseline } });
  const res = await runDiscovery(session, { featureUrl: URL, feature: 'Multi', deepCrawl: true, limits: { maxTransitions: 1 }, log: noopLog });

  assert.equal(res.transitions.length, 1, 'stops after the transition budget is spent');
  assert.equal(res.transitions[0].trigger, 'Alpha');
  assert.ok(!session.calls.includes('click e20'), 'Beta is never opened once the budget is reached');
  assert.ok(!session.calls.includes('click e30'), 'Gamma is never opened once the budget is reached');
});

/* ── 5. Crawl bounds — maxSnapshots ─────────────────────────────────────────────── */

test('a tight snapshot budget stops before the deep crawl runs (no transitions)', async () => {
  const session = scriptedSession({ featureUrl: URL, baseline: DROPDOWN.baseline, onClick: { e10: DROPDOWN.opened, e12: DROPDOWN.selected } });
  const res = await runDiscovery(session, { featureUrl: URL, feature: 'Add Employee', deepCrawl: true, limits: { maxSnapshots: 2 }, log: noopLog });

  assert.equal(res.stoppedReason, 'max-snapshots');
  assert.ok(res.snapshots <= 2, 'never exceeds the snapshot cap');
  assert.equal(res.transitions.length, 0, 'no budget left for transition capture');
});

/* ── 6. Timeout budget ──────────────────────────────────────────────────────────── */

test('an exhausted time budget stops the crawl with no transitions', async () => {
  const session = scriptedSession({ featureUrl: URL, baseline: DROPDOWN.baseline, onClick: { e10: DROPDOWN.opened, e12: DROPDOWN.selected } });
  const res = await runDiscovery(session, { featureUrl: URL, feature: 'Add Employee', deepCrawl: true, limits: { maxDurationMs: -1 }, log: noopLog });

  assert.equal(res.stoppedReason, 'timeout');
  assert.equal(res.transitions.length, 0, 'the deep crawl respects the time budget');
});

/* ── 7. Dedup + no-infinite-loop ────────────────────────────────────────────────── */

test('normalizeStateSignature dedups by url+heading+controls and ignores the query string', () => {
  const closed = '- heading "X"\n- combobox "C" [ref=e1]: "-- Select --"';
  const open = `${closed}\n- option "A" [ref=e2]\n- option "B" [ref=e3]`;
  assert.notEqual(normalizeStateSignature('u', closed), normalizeStateSignature('u', open), 'open vs closed differ');
  assert.equal(normalizeStateSignature('u', closed), normalizeStateSignature('u?tab=1', closed), 'query string is ignored');
  assert.equal(normalizeStateSignature('u', open), normalizeStateSignature('u', open), 'identical states share a signature');
});

test('a control whose click does not change state produces no transition (no infinite loop)', async () => {
  // onClick is empty → clicking never mutates `current`, so afterSig === beforeSig every time.
  const twoStatic = {
    baseline: [
      '- heading "Static" [level=6]',
      '- combobox "Choice A" [ref=e10]: "-- Select --"',
      '- combobox "Choice B" [ref=e20]: "-- Select --"',
      '- button "Go" [ref=e90]',
    ].join('\n'),
  };
  const session = scriptedSession({ featureUrl: URL, baseline: twoStatic.baseline, onClick: {} });
  const res = await runDiscovery(session, { featureUrl: URL, feature: 'Static', deepCrawl: true, limits: { maxRepeatedState: 1 }, log: noopLog });

  assert.equal(res.transitions.length, 0, 'unchanged states are never recorded as transitions');
  assert.ok(!session.calls.includes('click e20'), 'the repeated-state cap stops the crawl before the second control');
});

/* ── 8. Stale-ref protection ────────────────────────────────────────────────────── */

test('deep-crawl re-snapshots to derive a FRESH ref immediately before each click', async () => {
  const session = scriptedSession({ featureUrl: URL, baseline: DROPDOWN.baseline, onClick: { e10: DROPDOWN.opened, e12: DROPDOWN.selected } });
  await runDiscovery(session, { featureUrl: URL, feature: 'Add Employee', deepCrawl: true, log: noopLog });

  const firstClick = session.calls.findIndex((c) => c.startsWith('click '));
  assert.ok(firstClick > 0, 'a click happened during the crawl');
  assert.equal(session.calls[firstClick - 1], 'snapshot', 'the ref is re-derived from a fresh snapshot, never reused stale');
});

/* ── 9. Deep-crawl is opt-in and never destructive ──────────────────────────────── */

test('deep-crawl is OFF by default and only clicks reversible openers (never Save/Submit)', async () => {
  const off = scriptedSession({ featureUrl: URL, baseline: DROPDOWN.baseline, onClick: { e10: DROPDOWN.opened, e12: DROPDOWN.selected } });
  const resOff = await runDiscovery(off, { featureUrl: URL, feature: 'Add Employee', log: noopLog });
  assert.equal(resOff.transitions.length, 0, 'without deepCrawl the crawl does not run');

  const on = scriptedSession({ featureUrl: URL, baseline: DROPDOWN.baseline, onClick: { e10: DROPDOWN.opened, e12: DROPDOWN.selected } });
  await runDiscovery(on, { featureUrl: URL, feature: 'Add Employee', deepCrawl: true, log: noopLog });
  assert.ok(!on.calls.includes('click e20'), 'the Save button (e20) is never clicked by the deep crawl');
});

/* ── 10. Discovery → codegen evidence hand-off ──────────────────────────────────── */

const EVIDENCE_SNAPSHOT = [
  '- heading "Add Employee" [level=6]',
  '- text: Job Title*',
  '- combobox "Job Title" [ref=e10]: "-- Select --"',
  '- button "Save" [ref=e20]',
].join('\n');

function step(tool: string, label?: string, value?: string, extra: Partial<AgentStep> = {}): AgentStep {
  const s: AgentStep = { tool, args: value !== undefined ? { value } : {}, result: '', ...extra };
  if (label) s.scopeHint = { role: 'combobox', name: label, matches: 1, label, locator: `getByLabel('${label}')` } as AgentStep['scopeHint'];
  return s;
}

function discoveryWithTransition(): DiscoveryResult {
  const inventory = parseInventory(EVIDENCE_SNAPSHOT);
  const jobTitle = inventory.find((i) => /job title/i.test(i.label))!;
  const transitions: StateTransition[] = [{
    id: 'transition-1', kind: 'dropdown', trigger: 'Job Title', fieldId: jobTitle.id,
    beforeState: 'closed', afterState: 'open', options: ['Manager', 'Engineer'],
    selectedOption: 'Manager', resultingValue: 'Manager', revealedFields: [],
    afterExcerpt: '', source: 'deep-crawl', verified: true,
  }];
  return {
    discoveryVersion: 2, applicationSummary: summary('Add Employee'), inventory,
    states: [], transitions, scrolls: 1, snapshots: 1, stoppedReason: 'stable',
    completeness: { passed: true, checks: [], missing: [] },
  };
}

test('authorScenariosFromDiscovery attaches the captured option evidence to the select step', () => {
  const disc = discoveryWithTransition();
  const trace: AgentStep[] = [
    step('fill', 'Username', '{{USERNAME}}'),
    step('fill', 'Password', '{{PASSWORD}}'),
    step('click', undefined, undefined, { locator: "getByRole('button', { name: 'Login' })" }),
    step('select', 'Job Title', 'Manager'),
    step('click', undefined, undefined, { locator: "getByRole('button', { name: 'Save' })" }),
    { tool: 'snapshot', args: { after: 'submit' }, url: 'https://x/list', result: '' },
  ];
  const scenarios = authorScenariosFromDiscovery({ feature: 'Add Employee', url: 'x', maxCases: 6 }, disc, trace);
  const positive = scenarios.find((s) => s.type === 'positive' && /all fields/i.test(s.title));
  assert.ok(positive, 'a positive scenario is authored');
  const jobStep = positive!.steps.find((s) => /job title/i.test(s.target));
  assert.ok(jobStep, 'the Job Title select step is present');
  assert.deepEqual(jobStep!.optionEvidence, ['Manager', 'Engineer'], 'the live-captured options ride along as step evidence');
});
