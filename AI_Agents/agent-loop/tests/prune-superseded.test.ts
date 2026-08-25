/**
 * prune-superseded.test.ts — trace pruning of dead menu/disclosure toggles.
 *
 * Reproduces the cosmetic noise seen in the purchase-journey PR: the walk opened the hamburger menu,
 * then reached the cart by a direct URL navigation, so the menu click is dead weight. pruneSupersededSteps
 * must drop it — WITHOUT ever dropping a state-mutating click (add-to-cart is also non-navigating and also
 * followed by a navigation, but it MUST survive).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneSupersededSteps } from '../feature-boundary';
import type { AgentStep } from '../agent-loop';

const step = (tool: string, extra: Partial<AgentStep> = {}): AgentStep =>
  ({ tool, args: {}, result: '', ...extra });

const INVENTORY = 'https://shop.test/inventory.html';
const CART = 'https://shop.test/cart.html';

test('drops a menu-toggle click that is bypassed by a direct navigation', () => {
  const steps: AgentStep[] = [
    step('goto', { args: { url: INVENTORY }, url: INVENTORY }),
    step('click', { locator: "page.getByRole('button', { name: 'Open Menu' })", url: INVENTORY }),
    step('goto', { args: { url: CART }, url: CART }),
    step('click', { locator: "page.locator('[data-test=\"checkout\"]')", url: CART }),
  ];
  const pruned = pruneSupersededSteps(steps);
  assert.equal(pruned.length, 3, 'the dead menu click should be removed');
  assert.ok(!pruned.some((s) => /Open Menu/.test(s.locator || '')), 'no menu click remains');
});

test('KEEPS a state-mutating add-to-cart click even though it is non-navigating and followed by a goto', () => {
  const steps: AgentStep[] = [
    step('goto', { args: { url: INVENTORY }, url: INVENTORY }),
    step('click', { locator: "page.locator('[data-test=\"add-to-cart-sauce-labs-backpack\"]')", url: INVENTORY }),
    step('goto', { args: { url: CART }, url: CART }),
  ];
  const pruned = pruneSupersededSteps(steps);
  assert.equal(pruned.length, 3, 'add-to-cart must never be pruned');
  assert.ok(pruned.some((s) => /add-to-cart/.test(s.locator || '')));
});

test('KEEPS a menu click that itself navigated (url changed)', () => {
  const steps: AgentStep[] = [
    step('goto', { args: { url: CART }, url: CART }),
    step('click', { locator: "page.getByRole('link', { name: 'Menu' })", url: INVENTORY }),
    step('goto', { args: { url: INVENTORY }, url: INVENTORY }),
  ];
  assert.equal(pruneSupersededSteps(steps).length, 3);
});

test('KEEPS a menu toggle when the next step is a menu-item click (not a goto)', () => {
  const steps: AgentStep[] = [
    step('goto', { args: { url: INVENTORY }, url: INVENTORY }),
    step('click', { locator: "page.getByRole('button', { name: 'Open Menu' })", url: INVENTORY }),
    step('click', { locator: "page.getByRole('link', { name: 'Logout' })", url: INVENTORY }),
  ];
  assert.equal(pruneSupersededSteps(steps).length, 3, 'the menu was actually used → keep it');
});

test('skips an interleaved snapshot when looking for the superseding navigation', () => {
  const steps: AgentStep[] = [
    step('goto', { args: { url: INVENTORY }, url: INVENTORY }),
    step('click', { locator: "page.getByRole('button', { name: 'Open Menu' })", url: INVENTORY }),
    step('snapshot', { context: 'menu open' }),
    step('goto', { args: { url: CART }, url: CART }),
  ];
  const pruned = pruneSupersededSteps(steps);
  assert.ok(!pruned.some((s) => /Open Menu/.test(s.locator || '')), 'menu click removed across a snapshot');
});

test('is a no-op for a clean trace (returns the same array reference)', () => {
  const steps: AgentStep[] = [
    step('goto', { args: { url: INVENTORY }, url: INVENTORY }),
    step('click', { locator: "page.locator('[data-test=\"checkout\"]')", url: CART }),
  ];
  assert.equal(pruneSupersededSteps(steps), steps);
});
