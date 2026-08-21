/**
 * codegen-nav-repair.test.ts — deterministic duplicate-feature-navigation repair (bug #3).
 *
 * The assertSingleNavigationPath gate is correct and stays. The defect was RELYING ON THE LLM to repair a
 * duplicate-nav spec. repairDuplicateFeatureNavigation fixes it mechanically BEFORE the gate: when beforeEach
 * AND a test both navigate to the feature, it reduces beforeEach to shared login only. A login goto() is
 * shared setup and is preserved. When there is no duplicate, the content is returned untouched.
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairDuplicateFeatureNavigation, assertSingleNavigationPath } from '../codegen';

/* ── I. Duplicate feature navigation is deterministically repaired (not left to the LLM) ─── */

test('repairDuplicateFeatureNavigation strips beforeEach feature nav when a test also navigates', () => {
  const dup = `
test.describe('Complete Product Purchase Journey', () => {
  test.beforeEach(async ({ loginModule, page }) => {
    await loginModule.goto();
    await loginModule.login(u, p);
    await page.goto(urlFor(routes.inventory));
  });
  test('[TC_001] purchase', async ({ page }) => {
    const checkoutModule = new CheckoutModule(page);
    await checkoutModule.goto();
    await checkoutModule.completePurchase(details);
  });
});`;
  const res = repairDuplicateFeatureNavigation({ file: 'spec', content: dup });
  assert.equal(res.changed, true);
  // beforeEach keeps login, loses the feature page.goto().
  assert.match(res.content, /await loginModule\.goto\(\);/);
  assert.match(res.content, /await loginModule\.login\(u, p\);/);
  const beBody = res.content.match(/beforeEach\s*\([\s\S]*?=>\s*\{([\s\S]*?)\n\s*\}\s*\)\s*;?/)?.[1] || '';
  assert.ok(!/page\.goto\(/.test(beBody), 'beforeEach must no longer contain feature page.goto()');
  // The test still owns feature navigation.
  assert.match(res.content, /await checkoutModule\.goto\(\);/);
  // And the gate now passes on the repaired content.
  assert.doesNotThrow(() => assertSingleNavigationPath({ file: 'spec', content: res.content }));
});

test('repairDuplicateFeatureNavigation strips a duplicate feature Module.goto() from beforeEach', () => {
  const dup = `
test.describe('X', () => {
  test.beforeEach(async ({ loginModule }) => {
    await loginModule.goto();
    await loginModule.login(u, p);
    const checkoutModule = new CheckoutModule(page);
    await checkoutModule.goto();
  });
  test('[TC_001] buy', async ({ page }) => {
    const checkoutModule = new CheckoutModule(page);
    await checkoutModule.goto();
  });
});`;
  const res = repairDuplicateFeatureNavigation({ file: 'spec', content: dup });
  assert.equal(res.changed, true);
  const beBody = res.content.match(/beforeEach\s*\([\s\S]*?=>\s*\{([\s\S]*?)\n\s*\}\s*\)\s*;?/)?.[1] || '';
  assert.ok(!/checkoutModule\.goto\(\)/.test(beBody), 'beforeEach must lose the feature Module.goto()');
  assert.doesNotThrow(() => assertSingleNavigationPath({ file: 'spec', content: res.content }));
});

test('repairDuplicateFeatureNavigation leaves a login-only beforeEach untouched', () => {
  const clean = `
test.describe('X', () => {
  test.beforeEach(async ({ loginModule }) => {
    await loginModule.goto();
    await loginModule.login(u, p);
  });
  test('[TC_001] add', async ({ page }) => {
    const checkoutModule = new CheckoutModule(page);
    await checkoutModule.goto();
  });
});`;
  const res = repairDuplicateFeatureNavigation({ file: 'spec', content: clean });
  assert.equal(res.changed, false);
  assert.equal(res.content, clean);
});

test('repairDuplicateFeatureNavigation does not touch a single-path spec that navigates only in beforeEach', () => {
  // Nav lives ONLY in beforeEach (no test nav) → not a duplicate → gate never fires → no repair.
  const single = `
test.describe('X', () => {
  test.beforeEach(async ({ loginModule, page }) => {
    await loginModule.goto();
    await loginModule.login(u, p);
    await page.goto(urlFor(routes.inventory));
  });
  test('[TC_001] view', async ({ page }) => {
    await expect(page).toHaveURL(urlRegex(routes.inventory));
  });
});`;
  const res = repairDuplicateFeatureNavigation({ file: 'spec', content: single });
  assert.equal(res.changed, false);
  assert.equal(res.content, single);
});

test('repairDuplicateFeatureNavigation preserves a login Module.goto() even while removing feature nav', () => {
  const dup = `
test.describe('X', () => {
  test.beforeEach(async ({ page }) => {
    const loginModule = new LoginModule(page);
    await loginModule.goto();
    await loginModule.login(u, p);
    await page.goto(urlFor(routes.inventory));
  });
  test('[TC_001] buy', async ({ page }) => {
    const checkoutModule = new CheckoutModule(page);
    await checkoutModule.goto();
  });
});`;
  const res = repairDuplicateFeatureNavigation({ file: 'spec', content: dup });
  assert.equal(res.changed, true);
  // The login Module.goto() (shared setup) survives; only the feature page.goto() is removed.
  assert.match(res.content, /await loginModule\.goto\(\);/);
  const beBody = res.content.match(/beforeEach\s*\([\s\S]*?=>\s*\{([\s\S]*?)\n\s*\}\s*\)\s*;?/)?.[1] || '';
  assert.ok(!/page\.goto\(/.test(beBody), 'feature page.goto() removed from beforeEach');
  assert.doesNotThrow(() => assertSingleNavigationPath({ file: 'spec', content: res.content }));
});
