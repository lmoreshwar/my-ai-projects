/**
 * gap-coverage.test.ts — regression tests for gap-aware planning (markCoveredScenarios / coveringTest).
 *
 * Goal: when a feature is ALREADY partly automated, explore must flag the proposed scenarios that an
 * existing test in the repo's reuse index (.ai-memory/capabilities.json → testIndex) already covers, so
 * the website pre-selects only the NEW ones and we author just the gap — never a duplicate block.
 *
 * These tests lock the matcher: it MARKS a proposed scenario covered when an existing test automates the
 * same intent (title substring or distinctive-token overlap), it leaves genuinely-new scenarios uncovered
 * (never silently dropped), and it degrades safely to "all new" when the repo has no index yet. Matching
 * is TITLE-first and GENERIC — no app-specific rules, because ids are not globally unique.
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markCoveredScenarios, coveringTest, existingTestTitles, type Scenario } from '../codegen';

/* ── Temp-framework helper: a reuse index whose testIndex already automates a couple of Checkout cases. */
function makeFramework(testIndex: Record<string, unknown> | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'blast-gap-'));
  mkdirSync(join(dir, '.ai-memory'), { recursive: true });
  const root: Record<string, unknown> = { shardDir: '.ai-memory/domains' };
  if (testIndex) root.testIndex = testIndex;
  writeFileSync(join(dir, '.ai-memory', 'capabilities.json'), JSON.stringify(root, null, 2));
  return dir;
}
const cleanup = (fw: string) => rmSync(fw, { recursive: true, force: true });

/* A minimal ready scenario factory (only the fields the matcher reads matter). */
function scn(id: string, title: string, type = 'positive'): Scenario {
  return { id, title, type, ready: true, blocked: false, steps: [], expectedResults: '', coverage: { fieldIds: [], fieldLabels: [] } };
}

const CHECKOUT_INDEX = {
  TC_001: [{ domain: 'Checkout', spec: 'src/tests/checkout.spec.ts', title: 'Complete checkout with valid customer information' }],
  TC_002: [{ domain: 'Checkout', spec: 'src/tests/checkout.spec.ts', title: 'Checkout shows order summary and total' }],
};

/* ── #1 — a proposed scenario matching an existing test title is flagged covered (+ coveredBy). */
test('#1 marks a proposed scenario covered when an existing test already automates it', () => {
  const fw = makeFramework(CHECKOUT_INDEX);
  try {
    const scenarios = [scn('S1', 'Complete checkout with valid customer information')];
    const covered = markCoveredScenarios(fw, 'Checkout', scenarios);
    assert.equal(covered, 1);
    assert.equal(scenarios[0].covered, true);
    assert.equal(scenarios[0].coveredBy?.testId, 'TC_001');
    assert.equal(scenarios[0].coveredBy?.spec, 'src/tests/checkout.spec.ts');
  } finally { cleanup(fw); }
});

/* ── #2 — a genuinely NEW scenario (negative case) stays uncovered so it is offered for automation. */
test('#2 leaves a genuinely new scenario uncovered (not silently dropped)', () => {
  const fw = makeFramework(CHECKOUT_INDEX);
  try {
    const scenarios = [scn('S1', 'Checkout blocked when postal code is missing', 'negative')];
    const covered = markCoveredScenarios(fw, 'Checkout', scenarios);
    assert.equal(covered, 0);
    assert.equal(scenarios[0].covered, false);
    assert.equal(scenarios[0].coveredBy, undefined);
  } finally { cleanup(fw); }
});

/* ── #3 — mixed plan: only the already-automated one is flagged, the new one stays selectable. */
test('#3 flags only the covered scenario in a mixed plan', () => {
  const fw = makeFramework(CHECKOUT_INDEX);
  try {
    const scenarios = [
      scn('S1', 'Checkout shows order summary and total'),        // covered by TC_002
      scn('S2', 'Checkout rejects an empty first name', 'negative'), // new
    ];
    const covered = markCoveredScenarios(fw, 'Checkout', scenarios);
    assert.equal(covered, 1);
    assert.equal(scenarios[0].covered, true);
    assert.equal(scenarios[1].covered, false);
  } finally { cleanup(fw); }
});

/* ── #4 — distinctive-token overlap catches a re-worded title even without an exact substring. */
test('#4 matches a re-worded title via distinctive-token overlap', () => {
  const existing = existingTestTitles(makeFrameworkOnce(CHECKOUT_INDEX));
  const hit = coveringTest('Complete the checkout using valid customer information', existing);
  assert.ok(hit, 'a re-worded but same-intent title resolves to the existing test');
  assert.equal(hit?.testId, 'TC_001');
});

/* ── #5 — no index (fresh repo) → every scenario is treated as new. */
test('#5 treats all scenarios as new when the repo has no reuse index', () => {
  const fw = makeFramework(null);
  try {
    const scenarios = [scn('S1', 'Complete checkout with valid customer information')];
    const covered = markCoveredScenarios(fw, 'Checkout', scenarios);
    assert.equal(covered, 0);
    assert.equal(scenarios[0].covered, false);
    assert.deepEqual(existingTestTitles(fw), []);
  } finally { cleanup(fw); }
});

/* ── #6 — an id collision with an UNRELATED title must NOT count as covered (title-first, not id-first). */
test('#6 does not mark covered on an id collision with an unrelated title', () => {
  const fw = makeFramework(CHECKOUT_INDEX);
  try {
    // Same TC id family, totally different intent — the negative case is genuinely new.
    const scenarios = [scn('TC_001', 'Remove an item from the shopping cart')];
    const covered = markCoveredScenarios(fw, 'Cart', scenarios);
    assert.equal(covered, 0);
    assert.equal(scenarios[0].covered, false);
  } finally { cleanup(fw); }
});

/* Small helper so #4 can build the index inline without a try/finally (self-cleaning temp dir). */
function makeFrameworkOnce(testIndex: Record<string, unknown>): string {
  const fw = makeFramework(testIndex);
  process.on('exit', () => { try { cleanup(fw); } catch { /* noop */ } });
  return fw;
}
