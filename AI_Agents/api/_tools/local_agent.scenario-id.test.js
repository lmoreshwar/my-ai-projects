'use strict';

/**
 * BLAST Runner — scenario-ID preservation + append-only generation.
 *
 * Locks the FINAL fix for: the LLM regenerating each new spec with a RESET id (e.g. TC_001) instead of
 * the approved scenario id, which made the append-only / integrity gates reject TC_003…TC_005.
 *
 *   forceRequestedScenarioId(emitted, prior, wantId, wantTitle) deterministically rewrites ONLY the
 *   genuinely-new test block's id to the approved id, never touching a block that reproduces an
 *   existing prior test. Combined with the existing mergeNewTestsIntoSpec (append-only recovery) and
 *   generationIntegrity gate, all five requested ids end up present.
 *
 * Pure — no LLM, no network, no Playwright.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  forceRequestedScenarioId,
  mergeNewTestsIntoSpec,
  renumberedTests,
  specTestIds,
  generationIntegrity,
} = require('./local_agent');

const HEADER = "import { test, expect } from '@playwright/test';\n\n";

/** One realistic test() block. */
function block(id, title, body = 'await inventorySortModule.sort();') {
  return `test('${id} ${title} @Regression', async ({ page, inventorySortModule }) => {\n  ${body}\n});`;
}
function spec(...blocks) {
  return HEADER + blocks.join('\n\n') + '\n';
}

/** Simulate the runner's per-case handling: force the approved id, then append-only recover if terse. */
function applyCase(prior, emitted, wantId, wantTitle) {
  const forced = forceRequestedScenarioId(emitted, prior, wantId, wantTitle).content;
  if (prior.trim() && renumberedTests(prior, forced).length) {
    const merged = mergeNewTestsIntoSpec(prior, forced, wantId);
    if (merged) return merged;
  }
  return forced;
}

const T = {
  az: 'Sort products by name A to Z',
  za: 'Sort products by name Z to A',
  lohi: 'Sort products by price low to high',
  hilo: 'Sort products by price high to low',
  bad: 'Unsupported sort value shows no change',
};

// ── #1 — TC_002 never becomes TC_001 ─────────────────────────────────────────
test('#1 a new case labeled TC_001 by the LLM is normalized to the approved TC_002', () => {
  const prior = spec(block('TC_001', T.az, 'await inventorySortModule.sortBy("az");'));
  // LLM (terse) emits ONLY the new test but mislabels it TC_001.
  const emitted = spec(block('TC_001', T.za, 'await inventorySortModule.sortBy("za");'));
  const r = forceRequestedScenarioId(emitted, prior, 'TC_002', T.za);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.from, 'TC_001');
  assert.deepStrictEqual(specTestIds(r.content), ['TC_002']);
});

// ── #2 — TC_003 never becomes TC_001 ─────────────────────────────────────────
test('#2 a new case labeled TC_001 is normalized to the approved TC_003 (2 prior tests)', () => {
  const prior = spec(
    block('TC_001', T.az, 'await inventorySortModule.sortBy("az");'),
    block('TC_002', T.za, 'await inventorySortModule.sortBy("za");'),
  );
  const emitted = spec(block('TC_001', T.lohi, 'await inventorySortModule.sortBy("lohi");'));
  const r = forceRequestedScenarioId(emitted, prior, 'TC_003', T.lohi);
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(specTestIds(r.content), ['TC_003']);
});

// ── #3 — multiple scenarios can be appended to the same spec ──────────────────
test('#3 five scenarios append into ONE spec as TC_001..TC_005 in order', () => {
  let s = '';
  const cases = [
    ['TC_001', T.az, 'az'], ['TC_002', T.za, 'za'], ['TC_003', T.lohi, 'lohi'],
    ['TC_004', T.hilo, 'hilo'], ['TC_005', T.bad, 'zzz'],
  ];
  for (const [id, title, val] of cases) {
    // Each LLM reply mislabels the new test TC_001 (the reported bug) and is terse.
    const emitted = spec(block('TC_001', title, `await inventorySortModule.sortBy("${val}");`));
    s = applyCase(s || spec(), emitted, id, title);
  }
  assert.deepStrictEqual(specTestIds(s), ['TC_001', 'TC_002', 'TC_003', 'TC_004', 'TC_005']);
});

// ── #4 — existing tests remain byte-for-byte unchanged ───────────────────────
test('#4 forcing the new id never mutates an existing (reproduced) test block', () => {
  const existing = block('TC_001', T.az, 'await inventorySortModule.sortBy("az");');
  const prior = spec(existing);
  // LLM emits the whole spec: the existing TC_001 VERBATIM + a new block ALSO mislabeled TC_001.
  const emitted = spec(existing, block('TC_001', T.za, 'await inventorySortModule.sortBy("za");'));
  const r = forceRequestedScenarioId(emitted, prior, 'TC_002', T.za);
  assert.strictEqual(r.changed, true);
  assert.ok(r.content.includes(existing), 'the reproduced TC_001 block must be preserved verbatim');
  assert.deepStrictEqual(specTestIds(r.content), ['TC_001', 'TC_002']);
  assert.deepStrictEqual(renumberedTests(prior, r.content), [], 'append-only: no existing test altered');
});

// ── #5 — 5 requested scenarios remain 5 generated scenarios (integrity) ──────
test('#5 the acceptance flow: 5 requested ids are all present → integrity complete', () => {
  let s = spec();
  const req = [
    ['TC_001', T.az, 'az'], ['TC_002', T.za, 'za'], ['TC_003', T.lohi, 'lohi'],
    ['TC_004', T.hilo, 'hilo'], ['TC_005', T.bad, 'zzz'],
  ];
  const written = new Set();
  for (const [id, title, val] of req) {
    const emitted = spec(block('TC_001', title, `await inventorySortModule.sortBy("${val}");`));
    s = applyCase(s, emitted, id, title);
    if (specTestIds(s).includes(id)) written.add(id);
  }
  const selected = req.map((r) => r[0]);
  assert.deepStrictEqual(specTestIds(s), selected);
  const integ = generationIntegrity(selected, written, new Set());
  assert.strictEqual(integ.complete, true);
  assert.deepStrictEqual(integ.missing, []);
});

// ── #5b — if a requested id genuinely disappears, integrity reports it by ID ──
test('#5b a missing requested id is reported (gate not weakened)', () => {
  const integ = generationIntegrity(
    ['TC_001', 'TC_002', 'TC_003', 'TC_004', 'TC_005'],
    new Set(['TC_001', 'TC_002', 'TC_005']),
    new Set(),
  );
  assert.strictEqual(integ.complete, false);
  assert.deepStrictEqual(integ.missing, ['TC_003', 'TC_004']);
});

// ── #6 — genuine existing duplicates can still be reused (no false rename) ────
test('#6 a pure reproduction of an existing test is left unchanged (reuse still detectable)', () => {
  const existing = block('TC_001', T.az, 'await inventorySortModule.sortBy("az");');
  const prior = spec(existing);
  // LLM reproduces the existing test EXACTLY (no genuinely-new behavior for this request).
  const emitted = spec(existing);
  const r = forceRequestedScenarioId(emitted, prior, 'TC_002', T.az);
  assert.strictEqual(r.changed, false, 'a verbatim reproduction must NOT be renamed to a new id');
  // Reuse is then accounted via reusedNewIds → integrity stays complete.
  const integ = generationIntegrity(['TC_001', 'TC_002'], new Set(['TC_001']), new Set(['TC_002']));
  assert.strictEqual(integ.complete, true);
});

// ── #7 — an already-correct id is a no-op ────────────────────────────────────
test('#7 when the LLM already used the approved id, nothing is rewritten', () => {
  const prior = spec(block('TC_001', T.az, 'await inventorySortModule.sortBy("az");'));
  const emitted = spec(block('TC_002', T.za, 'await inventorySortModule.sortBy("za");'));
  const r = forceRequestedScenarioId(emitted, prior, 'TC_002', T.za);
  assert.strictEqual(r.changed, false);
  assert.deepStrictEqual(specTestIds(r.content), ['TC_002']);
});
