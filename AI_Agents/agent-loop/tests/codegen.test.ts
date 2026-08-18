/**
 * codegen.test.ts — unit tests for the DISCOVERY ↔ AUTOMATION TRACE ↔ CODEGEN boundary.
 *
 * The core invariant proven here: the discovery inventory may contain any number of irrelevant
 * controls (navigation, page infrastructure, orphan links), but the AUTOMATION TRACE — the scope
 * codegen implements and the coverage gate measures — is derived from the VERIFIED trace's real
 * feature actions only. Discovered navigation can NEVER cause a codegen coverage failure.
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInventory } from '../discovery';
import type { DiscoveryResult, FieldInventoryItem } from '../discovery';
import { authorScenariosFromDiscovery, scenariosToCases, selectTraceForScenarios, assertNavigationUrlContract, assertSingleNavigationPath } from '../codegen';
import type { AgentStep } from '../agent-loop';

/* ── Fixtures ─────────────────────────────────────────────────────────────────── */

// Admin → Job → Job Titles: a create form surrounded by the full OrangeHRM navigation rail plus a
// couple of orphan/footer links. Discovery inventories ALL of it; only 3 controls are feature inputs.
const JOB_TITLES_SNAPSHOT = `
- link "Dashboard" [ref=e1]
- link "PIM" [ref=e2]
- link "Leave" [ref=e3]
- link "Time" [ref=e4]
- link "Recruitment" [ref=e5]
- link "My Info" [ref=e6]
- link "Performance" [ref=e7]
- link "Directory" [ref=e8]
- link "Maintenance" [ref=e9]
- link "Claim" [ref=e10]
- link "Buzz" [ref=e11]
- link "Admin" [ref=e12]
- heading "Add Job Title" [level=6]
- text: Job Title*
- textbox [ref=e20]
- text: Job Description
- textbox [ref=e21]
- text: Note
- textbox [ref=e22]
- button "Save" [ref=e30]
- button "Cancel" [ref=e31]
- link "Upgrade" [ref=e40]
- text: OrangeHRM, Inc
`.trim();

// Recruitment → Add Candidate: a rich form (10 executable fields) plus a Resume upload with no fixture
// (BLOCKED) and navigation links.
const ADD_CANDIDATE_SNAPSHOT = `
- link "Dashboard" [ref=e1]
- link "PIM" [ref=e2]
- link "Recruitment" [ref=e3]
- heading "Add Candidate" [level=6]
- text: First Name*
- textbox "First Name" [ref=e12]
- text: Middle Name
- textbox "Middle Name" [ref=e13]
- text: Last Name*
- textbox "Last Name" [ref=e14]
- text: Vacancy
- combobox "Vacancy" [ref=e18]
- text: Email
- textbox [ref=e25]
- text: Contact Number
- textbox "Contact Number" [ref=e26]
- text: Keywords
- textbox "Keywords" [ref=e27]
- text: Date of Application
- textbox "Date of Application" [ref=e28]
- text: Notes
- textbox "Notes" [ref=e29]
- checkbox "Consent" [ref=e31]
- text: Resume
- button "Browse" [ref=e30]
- button "Save" [ref=e48]
`.trim();

function discoveryFrom(snapshot: string, feature: string): DiscoveryResult {
  const inventory = parseInventory(snapshot);
  return {
    applicationSummary: { application: 'OrangeHRM', feature, entryUrl: '', finalUrl: '', pageTitle: '', headings: [], authenticated: true },
    inventory, states: [], scrolls: 1, snapshots: 1,
    stoppedReason: 'stable',
    completeness: { passed: true, checks: [], missing: [] },
  };
}

/** Build a trace step (defaults keep tests terse). */
function step(tool: string, label: string | undefined, value?: string, extra: Partial<AgentStep> = {}): AgentStep {
  const s: AgentStep = { tool, args: value !== undefined ? { value } : {}, result: '', ...extra };
  if (label) s.scopeHint = { role: 'textbox', name: label, matches: 1, label, locator: `getByLabel('${label}')` } as AgentStep['scopeHint'];
  return s;
}

/** A realistic Job Titles create trace: login + nav + 3 form fills + Save, then the post-submit snapshot. */
function jobTitlesTrace(): AgentStep[] {
  return [
    step('fill', 'Username', '{{USERNAME}}'),
    step('fill', 'Password', '{{PASSWORD}}'),
    step('click', undefined, undefined, { locator: "getByRole('button', { name: 'Login' })" }),
    step('click', undefined, undefined, { locator: "getByRole('link', { name: 'Admin' })" }), // nav — NOT a step
    step('click', undefined, undefined, { locator: "getByRole('link', { name: 'Job Titles' })" }), // nav — NOT a step
    step('click', undefined, undefined, { locator: "getByRole('button', { name: 'Add' })" }), // open form — NOT a step
    step('fill', 'Job Title', 'QA Engineer'),
    step('fill', 'Job Description', 'Runs the tests'),
    step('fill', 'Note', 'internal'),
    step('click', undefined, undefined, { locator: "getByRole('button', { name: 'Save' })" }), // the submit
    { tool: 'snapshot', args: { after: 'submit' }, url: 'https://x/viewJobTitleList', result: '' },
  ];
}

/** A realistic Add Candidate create trace: login + nav + 10 form actions + Save (Resume never touched). */
function addCandidateTrace(): AgentStep[] {
  return [
    step('fill', 'Username', '{{USERNAME}}'),
    step('fill', 'Password', '{{PASSWORD}}'),
    step('click', undefined, undefined, { locator: "getByRole('button', { name: 'Login' })" }),
    step('click', undefined, undefined, { locator: "getByRole('link', { name: 'Recruitment' })" }), // nav
    step('click', undefined, undefined, { locator: "getByRole('button', { name: 'Add' })" }), // open form
    step('fill', 'First Name', 'John'),
    step('fill', 'Middle Name', 'Q'),
    step('fill', 'Last Name', 'Doe'),
    step('select', 'Vacancy', 'Senior QA'),
    step('fill', 'Email', 'john@example.com'),
    step('fill', 'Contact Number', '5551234'),
    step('fill', 'Keywords', 'automation'),
    step('fill', 'Date of Application', '2025-01-01'),
    step('fill', 'Notes', 'strong candidate'),
    step('check', 'Consent'),
    step('click', undefined, undefined, { locator: "getByRole('button', { name: 'Save' })" }), // submit
    { tool: 'snapshot', args: { after: 'submit' }, url: 'https://x/addCandidate', result: '' },
  ];
}

const NAV_LABELS = ['PIM', 'Leave', 'Time', 'Recruitment', 'My Info', 'Performance', 'Directory', 'Maintenance', 'Claim', 'Buzz', 'Admin', 'Dashboard', 'Upgrade'];
const hasNav = (labels: string[]): boolean => labels.some((l) => NAV_LABELS.some((n) => n.toLowerCase() === l.toLowerCase()));

/* ── 1. Discovery can contain irrelevant controls ─────────────────────────────── */

test('discovery inventory contains navigation + infrastructure controls (exhaustive, unchanged)', () => {
  const disc = discoveryFrom(JOB_TITLES_SNAPSHOT, 'Job Titles');
  const labels = disc.inventory.map((i) => i.label);
  // The full nav rail and orphan links are all inventoried — discovery stays exhaustive.
  for (const nav of ['PIM', 'Leave', 'Recruitment', 'Buzz', 'Admin']) {
    assert.ok(labels.some((l) => l === nav), `discovery must still inventory the "${nav}" navigation control`);
  }
  assert.ok(disc.inventory.length >= 14, 'discovery inventory keeps every discovered control');
});

/* ── 2. Automation Trace excludes irrelevant controls ─────────────────────────── */

test('Automation Trace for "Create Job Title" excludes all navigation/infrastructure controls', () => {
  const disc = discoveryFrom(JOB_TITLES_SNAPSHOT, 'Job Title');
  const scenarios = authorScenariosFromDiscovery({ feature: 'Job Title', url: 'x', maxCases: 6 }, disc, jobTitlesTrace());
  const positive = scenarios.find((s) => s.type === 'positive' && /all fields/i.test(s.title))!;
  assert.ok(positive, 'a positive scenario must exist');
  // The trace covers ONLY the three real form controls — never PIM/Leave/Admin/Upgrade/orphan links.
  assert.deepEqual([...positive.coverage.fieldLabels].sort(), ['Job Description', 'Job Title', 'Note']);
  assert.ok(!hasNav(positive.coverage.fieldLabels), 'no navigation control may appear in the Automation Trace');
});

/* ── 3. Codegen coverage uses trace steps (not discovery inventory) ───────────── */

test('coverage counts executable Automation Trace steps, not discovered controls', () => {
  const disc = discoveryFrom(JOB_TITLES_SNAPSHOT, 'Job Title');
  const trace = jobTitlesTrace();
  const scenarios = authorScenariosFromDiscovery({ feature: 'Job Title', url: 'x', maxCases: 6 }, disc, trace);
  const positive = scenarios.find((s) => /all fields/i.test(s.title))!;
  const traceFieldFills = trace.filter((s) => s.tool === 'fill' && !String((s.args as { value?: string }).value).includes('{{')).length;
  // ~25 discovered controls, but coverage == the 3 executable trace fills.
  assert.equal(positive.coverage.fieldLabels.length, traceFieldFills);
  assert.ok(disc.inventory.length > positive.coverage.fieldLabels.length, 'inventory is far larger than the trace');
});

/* ── 4. Discovery count does not affect codegen coverage ──────────────────────── */

test('adding more discovered navigation controls does NOT change codegen coverage', () => {
  const trace = jobTitlesTrace();
  const lean = discoveryFrom(JOB_TITLES_SNAPSHOT, 'Job Title');
  // Same feature form, but far more navigation/orphan links discovered.
  const bloatedSnapshot = JOB_TITLES_SNAPSHOT
    + '\n- link "Extra Nav 1" [ref=e90]\n- link "Extra Nav 2" [ref=e91]\n- link "Extra Nav 3" [ref=e92]\n- link "Extra Nav 4" [ref=e93]';
  const bloated = discoveryFrom(bloatedSnapshot, 'Job Title');
  assert.ok(bloated.inventory.length > lean.inventory.length, 'the bloated discovery really has more controls');

  const leanCov = authorScenariosFromDiscovery({ feature: 'Job Title', url: 'x', maxCases: 6 }, lean, trace)
    .find((s) => /all fields/i.test(s.title))!.coverage.fieldLabels;
  const bloatedCov = authorScenariosFromDiscovery({ feature: 'Job Title', url: 'x', maxCases: 6 }, bloated, trace)
    .find((s) => /all fields/i.test(s.title))!.coverage.fieldLabels;
  assert.deepEqual([...bloatedCov].sort(), [...leanCov].sort(), 'coverage is invariant to discovery inventory size');
});

/* ── 5. Blocked upload steps are excluded from executable coverage ────────────── */

test('a blocked upload (Resume) is listed in the trace but excluded from executable coverage', () => {
  const disc = discoveryFrom(ADD_CANDIDATE_SNAPSHOT, 'Candidate');
  const fileItem = disc.inventory.find((i: FieldInventoryItem) => i.type === 'file');
  assert.ok(fileItem && fileItem.blocked, 'the Resume upload is inventoried as blocked');

  const scenarios = authorScenariosFromDiscovery({ feature: 'Candidate', url: 'x', maxCases: 8 }, disc, addCandidateTrace());
  const positive = scenarios.find((s) => /all fields/i.test(s.title))!;
  const blockedStep = positive.steps.find((st) => st.blocked === true);
  assert.ok(blockedStep, 'the blocked upload appears as a NON-executable trace step');
  assert.equal(blockedStep!.type, 'upload');
  assert.equal(blockedStep!.classification, 'upload');
  assert.ok(!positive.coverage.fieldLabels.some((l) => /resume|browse/i.test(l)), 'the blocked upload is never in executable coverage');
});

/* ── Automation Trace steps carry an auditable, evidence-based classification ──── */

test('every Automation Trace step is classified (feature-input / feature-action / upload)', () => {
  const disc = discoveryFrom(ADD_CANDIDATE_SNAPSHOT, 'Candidate');
  const scenarios = authorScenariosFromDiscovery({ feature: 'Candidate', url: 'x', maxCases: 8 }, disc, addCandidateTrace());
  const positive = scenarios.find((s) => /all fields/i.test(s.title))!;
  for (const st of positive.steps) {
    assert.ok(['feature-input', 'feature-action', 'upload'].includes(st.classification), `step "${st.action}" must be classified`);
  }
  // The form fills are feature-input, the Save click is feature-action, Resume is upload.
  assert.ok(positive.steps.some((st) => st.classification === 'feature-input'));
  assert.equal(positive.steps.filter((st) => st.classification === 'feature-action').length, 1, 'exactly one controlled submit');
  assert.ok(positive.steps.some((st) => st.classification === 'upload'));
});

/* ── 6. Job Titles scenario can generate successfully ─────────────────────────── */

test('Job Titles: positive scenario is automation-ready and codegen only sees feature fields', () => {
  const disc = discoveryFrom(JOB_TITLES_SNAPSHOT, 'Job Title');
  const scenarios = authorScenariosFromDiscovery({ feature: 'Job Title', url: 'x', maxCases: 6 }, disc, jobTitlesTrace());
  const positive = scenarios.find((s) => /all fields/i.test(s.title))!;
  assert.equal(positive.ready, true);
  assert.equal(positive.blocked, false);
  // The exact set codegen must implement — Save is a step but not a coverage "field".
  assert.deepEqual([...positive.coverage.fieldLabels].sort(), ['Job Description', 'Job Title', 'Note']);
  assert.ok(positive.steps.some((st) => /save/i.test(st.action) && st.type === 'click'), 'the controlled submit is the final step');

  // The approval → codegen hand-off passes ONLY these feature labels (no navigation) to the gate.
  const { coverageLabels } = selectTraceForScenarios(jobTitlesTrace(), scenarios, [positive.id]);
  assert.ok(!hasNav(coverageLabels), 'navigation must never reach the codegen coverage gate');
  assert.equal(coverageLabels.length, 3);
});

/* ── 7. Recruitment Add Candidate scenario can generate successfully ──────────── */

test('Recruitment Add Candidate: trace has each feature field individually; Resume stays BLOCKED', () => {
  const disc = discoveryFrom(ADD_CANDIDATE_SNAPSHOT, 'Candidate');
  const scenarios = authorScenariosFromDiscovery({ feature: 'Candidate', url: 'x', maxCases: 8 }, disc, addCandidateTrace());
  const positive = scenarios.find((s) => /all fields/i.test(s.title))!;
  assert.equal(positive.ready, true);
  const expectedFields = ['First Name', 'Middle Name', 'Last Name', 'Vacancy', 'Email', 'Contact Number', 'Keywords', 'Date of Application', 'Notes', 'Consent'];
  for (const f of expectedFields) {
    assert.ok(positive.coverage.fieldLabels.includes(f), `Automation Trace must cover "${f}" as an individual step`);
  }
  assert.equal(positive.coverage.fieldLabels.length, expectedFields.length, 'exactly the executable feature fields — no more');
  assert.ok(!hasNav(positive.coverage.fieldLabels), 'no navigation control in the Add Candidate trace');
  // Resume is present as a blocked step but NOT counted as executable.
  assert.ok(positive.steps.some((st) => st.blocked && st.type === 'upload'), 'Resume remains in the trace as BLOCKED');
});

/* ── Regression: legacy projection + trace filtering still behave ─────────────── */

test('scenariosToCases projects a legacy PlanCase list with numbered steps', () => {
  const disc = discoveryFrom(JOB_TITLES_SNAPSHOT, 'Job Title');
  const scenarios = authorScenariosFromDiscovery({ feature: 'Job Title', url: 'x', maxCases: 6 }, disc, jobTitlesTrace());
  const cases = scenariosToCases(scenarios);
  assert.equal(cases.length, scenarios.length);
  assert.ok(cases[0].steps.every((s) => /^\d+\./.test(s)), 'steps are numbered');
});

test('a required-only positive scenario is offered when required is a strict subset', () => {
  const disc = discoveryFrom(ADD_CANDIDATE_SNAPSHOT, 'Candidate');
  const scenarios = authorScenariosFromDiscovery({ feature: 'Candidate', url: 'x', maxCases: 8 }, disc, addCandidateTrace());
  const reqOnly = scenarios.find((s) => s.type === 'positive' && /required/i.test(s.title));
  assert.ok(reqOnly, 'a required-only scenario must be offered');
  // Only First Name* and Last Name* are marked required in the snapshot.
  assert.deepEqual([...reqOnly!.coverage.fieldLabels].sort(), ['First Name', 'Last Name']);
});

test('negative scenarios are surfaced but marked blocked (no live validation evidence)', () => {
  const disc = discoveryFrom(ADD_CANDIDATE_SNAPSHOT, 'Candidate');
  const scenarios = authorScenariosFromDiscovery({ feature: 'Candidate', url: 'x', maxCases: 8 }, disc, addCandidateTrace());
  const negatives = scenarios.filter((s) => s.type === 'negative');
  assert.ok(negatives.length >= 1);
  for (const n of negatives) {
    assert.equal(n.ready, false);
    assert.equal(n.blocked, true);
    assert.ok(n.blockedReason && n.blockedReason.length > 0);
  }
});

test('selectTraceForScenarios keeps login + selected fields, drops unselected fields', () => {
  const disc = discoveryFrom(ADD_CANDIDATE_SNAPSHOT, 'Candidate');
  const trace = addCandidateTrace();
  const scenarios = authorScenariosFromDiscovery({ feature: 'Candidate', url: 'x', maxCases: 8 }, disc, trace);
  const reqOnly = scenarios.find((s) => /required/i.test(s.title))!;

  const { trace: filtered, coverageLabels } = selectTraceForScenarios(trace, scenarios, [reqOnly.id]);
  const fillLabels = filtered.filter((s) => s.tool === 'fill').map((s) => (s.scopeHint as { label?: string } | undefined)?.label);
  assert.ok(fillLabels.includes('Username') && fillLabels.includes('Password'), 'credential fills are always kept');
  assert.ok(fillLabels.includes('First Name') && fillLabels.includes('Last Name'), 'selected required fields kept');
  assert.ok(!fillLabels.includes('Middle Name'), 'the unselected optional field is dropped');
  assert.ok(filtered.some((s) => s.tool === 'click'), 'clicks (incl. the Save submit) are kept');
  assert.equal(coverageLabels.length, 2);
});

test('no selection (legacy) returns the full trace unchanged', () => {
  const disc = discoveryFrom(JOB_TITLES_SNAPSHOT, 'Job Title');
  const scenarios = authorScenariosFromDiscovery({ feature: 'Job Title', url: 'x', maxCases: 6 }, disc, jobTitlesTrace());
  const trace: AgentStep[] = [{ tool: 'fill', args: { value: 'John' }, scopeHint: { label: 'Job Title' } as AgentStep['scopeHint'], result: '' }];
  const { trace: out, coverageLabels } = selectTraceForScenarios(trace, scenarios, []);
  assert.equal(out.length, 1);
  assert.equal(coverageLabels.length, 0);
});

/* ── 8. A list control (Search) touched during exploration never enters a create scenario ─ */

test('a Search fill done while exploring the list page is EXCLUDED from the "Create Job Title" trace', () => {
  const disc = discoveryFrom(JOB_TITLES_SNAPSHOT, 'Job Title');
  const trace = jobTitlesTrace();
  // The agent searched the list page before opening the Add form — a list control, NOT a create field.
  trace.splice(5, 0, step('fill', 'Search', 'Engineer'));
  const scenarios = authorScenariosFromDiscovery({ feature: 'Job Title', url: 'x', maxCases: 6 }, disc, trace);
  const positive = scenarios.find((s) => /all fields/i.test(s.title))!;
  // Coverage is still exactly the three real form controls — Search is filtered out.
  assert.deepEqual([...positive.coverage.fieldLabels].sort(), ['Job Description', 'Job Title', 'Note']);
  assert.ok(!positive.coverage.fieldLabels.some((l) => /search/i.test(l)), 'Search is never part of the Create trace');
  assert.ok(!positive.steps.some((st) => /search/i.test(st.action)), 'no "Fill Search" step in the create scenario');
  // And the codegen hand-off coverage must not carry it either.
  const { coverageLabels } = selectTraceForScenarios(trace, scenarios, [positive.id]);
  assert.ok(!coverageLabels.some((l) => /search/i.test(l)), 'Search must never reach the codegen coverage gate');
});

/* ── 9. Navigation URL contract: goto() needs a STRING (urlFor), not a RegExp (urlRegex) ─ */

test('assertNavigationUrlContract rejects page.goto fed a RegExp/urlRegex/bare route, accepts urlFor + string', () => {
  // The exact live failure: goto() handed a urlRegex(...) RegExp → "expected string, got object".
  assert.throws(() => assertNavigationUrlContract([{ file: 'spec', content: 'await page.goto(urlRegex(routes.adminJobTitles));' }]), /URL STRING|urlFor/i);
  assert.throws(() => assertNavigationUrlContract([{ file: 's', content: 'await page.goto(new RegExp("/x"));' }]), /urlFor/i);
  assert.throws(() => assertNavigationUrlContract([{ file: 's', content: 'await page.goto(routes.adminJobTitles);' }]), /urlFor/i);
  assert.throws(() => assertNavigationUrlContract([{ file: 's', content: 'await page.goto(/viewJobTitleList/);' }]), /urlFor/i);
  // Valid: goto() gets a STRING (urlFor or a literal); urlRegex(...) is only used for assertions/waits.
  const good = [
    'await this.page.goto(urlFor(routes.adminJobTitles));',
    'await expect(page).toHaveURL(urlRegex(routes.adminJobTitles));',
    'await this.page.waitForURL(urlRegex(routes.adminJobTitles));',
    "await page.goto('/web/index.php/admin/viewJobTitleList');",
  ].join('\n');
  assert.doesNotThrow(() => assertNavigationUrlContract([{ file: 'ok', content: good }]));
});

/* ── 10. Single navigation path: beforeEach logs in only; the Module.goto() navigates ─── */

test('assertSingleNavigationPath rejects duplicate feature nav, accepts login-only beforeEach + Module.goto()', () => {
  // beforeEach navigates to the feature AND the test navigates again → the double-nav bug.
  const dup = `
test.describe('X', () => {
  test.beforeEach(async ({ loginModule, page }) => {
    await loginModule.goto();
    await loginModule.login(u, p);
    await page.goto(urlFor(routes.adminJobTitles));
  });
  test('[TC_001] add', async ({ page }) => {
    const adminJobTitlesModule = new AdminJobTitlesModule(page);
    await adminJobTitlesModule.goto();
  });
});`;
  assert.throws(() => assertSingleNavigationPath({ file: 'spec', content: dup }), /duplicate feature navigation/i);

  // Preferred: beforeEach logs in ONLY; the feature Module.goto() navigates inside the test.
  const clean = `
test.describe('X', () => {
  test.beforeEach(async ({ loginModule }) => {
    await loginModule.goto();
    await loginModule.login(u, p);
  });
  test('[TC_001] add', async ({ page }) => {
    const adminJobTitlesModule = new AdminJobTitlesModule(page);
    await adminJobTitlesModule.goto();
  });
});`;
  assert.doesNotThrow(() => assertSingleNavigationPath({ file: 'spec', content: clean }));
});
