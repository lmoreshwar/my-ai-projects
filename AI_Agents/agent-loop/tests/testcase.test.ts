/**
 * testcase.test.ts — AI-Native (test-case-driven) adapter layer.
 *
 * Proves the DETERMINISTIC contract that moves the test-case flow onto the shared codegen core:
 *  - supplied TC IDs are authoritative and preserved (TC_003 never becomes TC_001),
 *  - each supplied case becomes its own distinct Scenario (no false semantic dedup: A-Z ≠ Z-A, Low-High ≠ High-Low),
 *  - the exploration goal is built verbatim from the cases (no LLM rewrite),
 *  - a generated spec's IDs are enforced to the requested set with no duplicates,
 *  - generation integrity reports any missing requested case (no silent dropping).
 *
 * The live pieces (runAgentLoop, generateVerifyHeal) are exercised only in CI (browser + LLM); this suite
 * covers every deterministic unit. Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scenariosFromTestCases, buildTestCaseGoal, enforceTestCaseIds, testCaseIntegrity, extractSpecTestIds, normalizeTcId,
  type TestCaseInput,
} from '../codegen';

const SORT_CASES: TestCaseInput[] = [
  { id: 'TC_001', title: 'Verify Name A-Z sorting option and ordering', steps: ['Login', 'Open sort dropdown', 'Select Name (A to Z)', 'Verify products ordered A→Z'], expectedResults: 'Products are ordered by name ascending' },
  { id: 'TC_002', title: 'Verify Name Z-A sorting option and ordering', steps: ['Login', 'Open sort dropdown', 'Select Name (Z to A)', 'Verify products ordered Z→A'], expectedResults: 'Products are ordered by name descending' },
  { id: 'TC_003', title: 'Verify Price Low-High sorting option and ordering', steps: ['Login', 'Open sort dropdown', 'Select Price (low to high)', 'Verify prices ascending'], expectedResults: 'Products are ordered by price ascending' },
  { id: 'TC_004', title: 'Verify Price High-Low sorting option and ordering', steps: ['Login', 'Open sort dropdown', 'Select Price (high to low)', 'Verify prices descending'], expectedResults: 'Products are ordered by price descending' },
  { id: 'TC_005', title: 'Verify handling of an unsupported sort value', steps: ['Login', 'Attempt an unsupported sort value'], expectedResults: 'The app safely ignores/does not offer an unsupported sort' },
];

/* ── normalizeTcId ─────────────────────────────────────────────────────────────── */

test('normalizeTcId canonicalises id variants to TC_00x', () => {
  assert.equal(normalizeTcId('TC_3'), 'TC_003');
  assert.equal(normalizeTcId('tc-3'), 'TC_003');
  assert.equal(normalizeTcId('TC_003 Verify something'), 'TC_003');
  assert.equal(normalizeTcId('3'), 'TC_003');
});

/* ── scenariosFromTestCases: IDs preserved, distinct scenarios, no false dedup ───── */

test('scenariosFromTestCases preserves every supplied TC id in order', () => {
  const scen = scenariosFromTestCases(SORT_CASES);
  assert.deepEqual(scen.map((s) => s.id), ['TC_001', 'TC_002', 'TC_003', 'TC_004', 'TC_005']);
});

test('TC_002 stays TC_002 and TC_003 stays TC_003 (never reset to TC_001)', () => {
  const scen = scenariosFromTestCases([SORT_CASES[1], SORT_CASES[2]]);
  assert.equal(scen[0].id, 'TC_002');
  assert.equal(scen[1].id, 'TC_003');
  assert.ok(!scen.some((s) => s.id === 'TC_001'));
});

test('five requested cases remain five distinct scenarios (no collapse)', () => {
  const scen = scenariosFromTestCases(SORT_CASES);
  assert.equal(scen.length, 5);
  assert.equal(new Set(scen.map((s) => s.id)).size, 5);
  assert.equal(new Set(scen.map((s) => s.title)).size, 5);
});

test('A-Z and Z-A are distinct scenarios; Low-High and High-Low are distinct scenarios', () => {
  const scen = scenariosFromTestCases(SORT_CASES);
  const az = scen.find((s) => /a-z/i.test(s.title))!;
  const za = scen.find((s) => /z-a/i.test(s.title))!;
  const lohi = scen.find((s) => /low-high/i.test(s.title))!;
  const hilo = scen.find((s) => /high-low/i.test(s.title))!;
  assert.notEqual(az.id, za.id);
  assert.notEqual(az.title, za.title);
  assert.notEqual(lohi.id, hilo.id);
  assert.notEqual(lohi.title, hilo.title);
});

test('scenariosFromTestCases marks an unsupported/invalid case as negative and keeps steps', () => {
  const scen = scenariosFromTestCases([SORT_CASES[4]]);
  assert.equal(scen[0].type, 'negative');
  assert.equal(scen[0].steps.length, 2);
  assert.equal(scen[0].ready, true);
  assert.equal(scen[0].blocked, false);
});

/* ── buildTestCaseGoal: deterministic, verbatim ──────────────────────────────────── */

test('buildTestCaseGoal embeds every id, title, step and expected result without rewriting', () => {
  const goal = buildTestCaseGoal(SORT_CASES);
  for (const c of SORT_CASES) {
    assert.ok(goal.includes(c.id), `goal should mention ${c.id}`);
    assert.ok(goal.includes(c.title), `goal should mention title of ${c.id}`);
    assert.ok(goal.includes(c.expectedResults!), `goal should mention expected result of ${c.id}`);
  }
  assert.ok(/do NOT invent additional scenarios/i.test(goal));
  assert.ok(/1\. Login/.test(goal));
});

/* ── extractSpecTestIds + testCaseIntegrity: no silent dropping ───────────────────── */

const FULL_SPEC = `
import { test, expect } from '../fixtures';
test.describe('Product Sorting', () => {
  test('[TC_001] Verify Name A-Z sorting option and ordering @Regression', async ({ page }) => {});
  test('[TC_002] Verify Name Z-A sorting option and ordering @Regression', async ({ page }) => {});
  test('[TC_003] Verify Price Low-High sorting option and ordering @Regression', async ({ page }) => {});
  test('[TC_004] Verify Price High-Low sorting option and ordering @Regression', async ({ page }) => {});
  test('[TC_005] Verify handling of an unsupported sort value @Regression', async ({ page }) => {});
});`;

test('extractSpecTestIds returns every TC id present in a spec', () => {
  assert.deepEqual(extractSpecTestIds(FULL_SPEC), ['TC_001', 'TC_002', 'TC_003', 'TC_004', 'TC_005']);
});

test('integrity: 5 requested / 5 present => complete', () => {
  const r = testCaseIntegrity(SORT_CASES.map((c) => c.id), FULL_SPEC);
  assert.equal(r.complete, true);
  assert.deepEqual(r.missing, []);
  assert.equal(r.present.length, 5);
});

test('integrity: 5 requested / 4 present => FAIL and reports the missing id', () => {
  const missingOne = FULL_SPEC.replace(/.*TC_003.*\n/, '');
  const r = testCaseIntegrity(SORT_CASES.map((c) => c.id), missingOne);
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, ['TC_003']);
});

/* ── enforceTestCaseIds: deterministic ID correction, no duplicates ───────────────── */

test('enforceTestCaseIds rewrites an LLM-reset id back to the requested one (TC_001 dup → TC_003)', () => {
  // The model reset the Price Low-High test to TC_001 (a duplicate) instead of TC_003.
  const spec = `
test('[TC_001] Verify Name A-Z sorting option and ordering', async ({ page }) => {});
test('[TC_002] Verify Name Z-A sorting option and ordering', async ({ page }) => {});
test('[TC_001] Verify Price Low-High sorting option and ordering', async ({ page }) => {});`;
  const requested = [
    { id: 'TC_001', title: 'Verify Name A-Z sorting option and ordering' },
    { id: 'TC_002', title: 'Verify Name Z-A sorting option and ordering' },
    { id: 'TC_003', title: 'Verify Price Low-High sorting option and ordering' },
  ];
  const res = enforceTestCaseIds(spec, requested);
  assert.equal(res.changed, true);
  assert.deepEqual(res.missing, []);
  const ids = extractSpecTestIds(res.content);
  assert.deepEqual(ids, ['TC_001', 'TC_002', 'TC_003']);
  assert.equal(new Set(ids).size, 3, 'no duplicate ids');
  // The Price test now carries TC_003.
  assert.match(res.content, /\[TC_003\] Verify Price Low-High/);
});

test('enforceTestCaseIds leaves an already-correct spec untouched', () => {
  const requested = SORT_CASES.map((c) => ({ id: c.id, title: c.title }));
  const res = enforceTestCaseIds(FULL_SPEC, requested);
  assert.equal(res.changed, false);
  assert.equal(res.content, FULL_SPEC);
  assert.deepEqual(res.missing, []);
});

test('enforceTestCaseIds injects a bracketed id when the matched test has none', () => {
  const spec = `test('Verify Price High-Low sorting option and ordering', async ({ page }) => {});`;
  const res = enforceTestCaseIds(spec, [{ id: 'TC_004', title: 'Verify Price High-Low sorting option and ordering' }]);
  assert.equal(res.changed, true);
  assert.match(res.content, /\[TC_004\] Verify Price High-Low/);
});

test('enforceTestCaseIds reports a requested case that has no matching generated test', () => {
  const spec = `test('[TC_001] Verify Name A-Z sorting option and ordering', async ({ page }) => {});`;
  const res = enforceTestCaseIds(spec, [
    { id: 'TC_001', title: 'Verify Name A-Z sorting option and ordering' },
    { id: 'TC_009', title: 'A wholly unrelated behaviour that was never generated here at all' },
  ]);
  assert.deepEqual(res.missing, ['TC_009']);
});

test('enforceTestCaseIds keeps A-Z and Z-A as two distinct correctly-labelled tests', () => {
  // Identical distinctive tokens between the two titles — pass-1 exact-id match must preserve both.
  const spec = `
test('[TC_001] Verify Name A-Z sorting option and ordering', async ({ page }) => {});
test('[TC_002] Verify Name Z-A sorting option and ordering', async ({ page }) => {});`;
  const res = enforceTestCaseIds(spec, [
    { id: 'TC_001', title: 'Verify Name A-Z sorting option and ordering' },
    { id: 'TC_002', title: 'Verify Name Z-A sorting option and ordering' },
  ]);
  assert.equal(res.changed, false);
  assert.deepEqual(extractSpecTestIds(res.content), ['TC_001', 'TC_002']);
});
