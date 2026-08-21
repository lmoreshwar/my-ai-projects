'use strict';

/**
 * BLAST Runner — semantic-dedup correctness + generation-integrity gate.
 *
 * Locks the FINAL fix for the confirmed bug where distinct sorting scenarios
 * (Name A-Z, Name Z-A, Price Low-High, Price High-Low, unsupported) collapsed into one
 * because testSignature() only looked at *Module.method() calls and ignored the meaningful
 * differences (dropdown value, expected order). Two guarantees are tested here:
 *
 *   FIX 1 — testSignature distinguishes meaningful behavior (values, assertions, page actions)
 *           and still collapses genuinely-identical behavior (variable rename / formatting).
 *   FIX 3 — generationIntegrity() fails when a requested NEW scenario is neither written nor
 *           legitimately reused, and names the missing ids.
 *
 * Pure — no LLM, no network, no Playwright.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  testSignature,
  signatureVarMap,
  localLiteralMap,
  generationIntegrity,
  isDestructiveOverwrite,
  droppedConstructorWiring,
  writeFiles,
} = require('./local_agent');

// Signature of a standalone test body, resolving its own local literals/data vars.
function sig(body, testData) {
  return testSignature(body, signatureVarMap(body, testData || {}));
}

// ── Sorting scenario bodies (the exact demo cases) ───────────────────────────
const TC_001_NAME_AZ = `
  await inventorySortModule.goto();
  await inventorySortModule.sortBy('az');
  const names = await inventorySortModule.productNames();
  expect(names).toEqual([...names].sort());
`;
const TC_002_NAME_ZA = `
  await inventorySortModule.goto();
  await inventorySortModule.sortBy('za');
  const names = await inventorySortModule.productNames();
  expect(names).toEqual([...names].sort().reverse());
`;
const TC_003_PRICE_LOHI = `
  await inventorySortModule.goto();
  await inventorySortModule.sortBy('lohi');
  const prices = await inventorySortModule.productPrices();
  expect(prices).toEqual([...prices].sort((a, b) => a - b));
`;
const TC_004_PRICE_HILO = `
  await inventorySortModule.goto();
  await inventorySortModule.sortBy('hilo');
  const prices = await inventorySortModule.productPrices();
  expect(prices).toEqual([...prices].sort((a, b) => b - a));
`;
const TC_005_UNSUPPORTED = `
  await inventorySortModule.goto();
  await inventorySortModule.sortBy('zzz');
  await expect(inventorySortPage.errorBanner()).toBeVisible();
`;

// ── FIX 1: distinct scenarios must NOT collapse ──────────────────────────────
test('#1 Name A-Z != Name Z-A (dropdown value + expected order differ)', () => {
  assert.notStrictEqual(sig(TC_001_NAME_AZ), sig(TC_002_NAME_ZA));
});

test('#2 Price Low-High != Price High-Low', () => {
  assert.notStrictEqual(sig(TC_003_PRICE_LOHI), sig(TC_004_PRICE_HILO));
});

test('#3 different dropdown/select values are not duplicates', () => {
  const az = `await sortPage.dropdown().selectOption('az');`;
  const za = `await sortPage.dropdown().selectOption('za');`;
  assert.notStrictEqual(sig(az), sig(za));
});

test('#4 different expected assertions are not duplicates', () => {
  const a = `const r = await m.results(); expect(r).toEqual(['a', 'b', 'c']);`;
  const b = `const r = await m.results(); expect(r).toEqual(['c', 'b', 'a']);`;
  assert.notStrictEqual(sig(a), sig(b));
});

test('#5 meaningful Page-level interaction differences are not duplicates', () => {
  const clicks = `await inventoryPage.addToCart('backpack'); await inventoryPage.openCart();`;
  const reload = `await inventoryPage.addToCart('backpack'); await this.page.reload();`;
  assert.notStrictEqual(sig(clicks), sig(reload));
});

test('#3b valid vs invalid value (unsupported sort) is distinct from every valid sort', () => {
  const sigs = [TC_001_NAME_AZ, TC_002_NAME_ZA, TC_003_PRICE_LOHI, TC_004_PRICE_HILO, TC_005_UNSUPPORTED].map((b) => sig(b));
  assert.strictEqual(new Set(sigs).size, 5, 'all five sorting scenarios must have distinct signatures');
});

test('#5b variable name held value still differentiates (const sortValue = ...)', () => {
  const az = `const sortValue = 'az'; await m.sortBy(sortValue);`;
  const za = `const sortValue = 'za'; await m.sortBy(sortValue);`;
  assert.deepStrictEqual([...localLiteralMap(az)], [['sortValue', '"az"']]);
  assert.notStrictEqual(sig(az), sig(za));
});

// ── FIX 1: genuinely identical behavior STILL deduplicates ───────────────────
test('#6 identical behavior with different variable names + formatting still deduplicates', () => {
  const a = `
    const u = 'standard_user';
    await loginModule.login(u, 'secret_sauce');
    expect(page).toHaveURL(/inventory/);
  `;
  const b = `
    const account   =    'standard_user';
    await loginModule.login( account ,   'secret_sauce' );
    expect( page ).toHaveURL( /inventory/ );
  `;
  assert.strictEqual(sig(a), sig(b), 'same actions + same values + same assertion must collapse');
});

test('#6b same behavior, different TC id/title/wording still deduplicates', () => {
  const a = `await cartModule.addItem('backpack'); await cartModule.checkout();`;
  const b = `await cartModule.addItem('backpack'); await cartModule.checkout();`;
  assert.strictEqual(sig(a), sig(b));
});

// ── FIX 3: generation-integrity gate ─────────────────────────────────────────
test('#7 5 selected / 5 generated => integrity PASS', () => {
  const selected = ['TC_001', 'TC_002', 'TC_003', 'TC_004', 'TC_005'];
  const r = generationIntegrity(selected, new Set(selected), new Set());
  assert.strictEqual(r.complete, true);
  assert.deepStrictEqual(r.missing, []);
});

test('#8 5 selected / 3 generated => integrity FAIL', () => {
  const selected = ['TC_001', 'TC_002', 'TC_003', 'TC_004', 'TC_005'];
  const r = generationIntegrity(selected, new Set(['TC_001', 'TC_002', 'TC_005']), new Set());
  assert.strictEqual(r.complete, false);
  assert.strictEqual(r.missing.length, 2);
});

test('#9 missing requested scenarios are reported by ID', () => {
  const selected = ['TC_001', 'TC_002', 'TC_003', 'TC_004', 'TC_005'];
  const r = generationIntegrity(selected, new Set(['TC_001', 'TC_002', 'TC_005']), new Set());
  assert.deepStrictEqual(r.missing, ['TC_003', 'TC_004']);
});

test('#10 an already-automated scenario counts as legitimately reused (not missing)', () => {
  const selected = ['TC_001', 'TC_002', 'TC_003'];
  // TC_002 legitimately reused an existing test; TC_001/TC_003 written this run.
  const r = generationIntegrity(selected, new Set(['TC_001', 'TC_003']), new Set(['TC_002']));
  assert.strictEqual(r.complete, true);
  assert.deepStrictEqual(r.missing, []);
});

// ── FIX 4: existing Module protection is preserved ───────────────────────────
const GOOD_MODULE = `import { type Page } from '@playwright/test';
import { Actions } from '../utils/Actions';
export class InventorySortModule {
  private readonly page: Page;
  private readonly actions: Actions;
  constructor(page: Page) {
    this.page = page;
    this.actions = new Actions(page);
  }
  async sortBy(value: string): Promise<void> { await this.actions.selectOption(this.page.locator('.sort'), value); }
}
`;
const BROKEN_MODULE = `import { type Page } from '@playwright/test';
export class InventorySortModule {
  private readonly page: Page;
  constructor(page: Page) { this.page = page; }
  async sortBy(value: string): Promise<void> { await this.actions.selectOption(this.page.locator('.sort'), value); }
}
`;

test('#11 existing Module constructor/Actions wiring cannot be destroyed by regen', () => {
  assert.deepStrictEqual(droppedConstructorWiring(GOOD_MODULE, BROKEN_MODULE), ['actions']);
  assert.strictEqual(isDestructiveOverwrite(GOOD_MODULE, BROKEN_MODULE, 'module'), true);

  const fw = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-dedup-'));
  try {
    fs.mkdirSync(path.join(fw, 'src/modules'), { recursive: true });
    fs.writeFileSync(path.join(fw, 'src/modules/InventorySortModule.ts'), GOOD_MODULE, 'utf8');
    writeFiles(fw, [{ rel: 'src/modules/InventorySortModule.ts', layer: 'module', content: BROKEN_MODULE }], {});
    const after = fs.readFileSync(path.join(fw, 'src/modules/InventorySortModule.ts'), 'utf8');
    assert.match(after, /this\.actions = new Actions\(page\)/, 'constructor wiring must survive');
  } finally {
    fs.rmSync(fw, { recursive: true, force: true });
  }
});

test('#12 a brand-new module can still be created normally', () => {
  const fw = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-dedup-'));
  try {
    fs.mkdirSync(path.join(fw, 'src/modules'), { recursive: true });
    const res = writeFiles(fw, [{ rel: 'src/modules/SortModule.ts', layer: 'module', content: GOOD_MODULE.replace(/InventorySortModule/g, 'SortModule') }], {});
    const rec = res.written.find((w) => w.path === 'src/modules/SortModule.ts');
    assert.ok(rec && rec.action === 'created');
    assert.ok(fs.existsSync(path.join(fw, 'src/modules/SortModule.ts')));
  } finally {
    fs.rmSync(fw, { recursive: true, force: true });
  }
});

// ── DEMO ACCEPTANCE — 5 selected => 5 distinct => 5 generated (no false dedup) ──
test('DEMO: 5 sorting scenarios yield 5 distinct signatures and full integrity', () => {
  const cases = [
    { id: 'TC_001', body: TC_001_NAME_AZ },
    { id: 'TC_002', body: TC_002_NAME_ZA },
    { id: 'TC_003', body: TC_003_PRICE_LOHI },
    { id: 'TC_004', body: TC_004_PRICE_HILO },
    { id: 'TC_005', body: TC_005_UNSUPPORTED },
  ];
  // Empty framework: no baseline tests → every distinct scenario is genuinely new.
  const signatures = cases.map((c) => sig(c.body));
  assert.strictEqual(new Set(signatures).size, 5, '5 selected scenarios must produce 5 distinct behaviors');

  // Simulate the loop writing each new case (empty baseline → nothing deduped away).
  const selectedNewIds = cases.map((c) => c.id);
  const writtenNewIds = new Set(selectedNewIds);
  const r = generationIntegrity(selectedNewIds, writtenNewIds, new Set());
  assert.strictEqual(r.complete, true, '5 selected must equal 5 written');
  assert.deepStrictEqual(r.missing, []);
});
