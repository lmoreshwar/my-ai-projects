/**
 * self-healing.test.ts — unit tests for the generic self-healing signal used by the explore loop.
 * Runs with the Node built-in test runner via tsx: `npm test`.
 *
 * The full retry loop lives inside runAgentLoop's closure (it steers a live LLM + live browser, so it
 * cannot be unit-tested without mocking both). This pins the one pure, extracted signal it depends on:
 * `snapshotSignature`, the fingerprint used to detect "the last action produced no visible change" —
 * the trigger for nudging the model to try a genuinely different approach instead of repeating itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotSignature } from '../agent-loop';

const INVENTORY_SNAPSHOT = `
- heading "Products" [level=2]
- button "Add to cart" [ref=e10]
- link "Cart" [ref=e11]
`.trim();

test('snapshotSignature is stable for the same url + interactable set (no visible change)', () => {
  const a = snapshotSignature('https://www.saucedemo.com/inventory.html', INVENTORY_SNAPSHOT);
  const b = snapshotSignature('https://www.saucedemo.com/inventory.html', INVENTORY_SNAPSHOT);
  assert.equal(a, b);
});

test('snapshotSignature changes when the URL changes (real navigation happened)', () => {
  const a = snapshotSignature('https://www.saucedemo.com/inventory.html', INVENTORY_SNAPSHOT);
  const b = snapshotSignature('https://www.saucedemo.com/cart.html', INVENTORY_SNAPSHOT);
  assert.notEqual(a, b);
});

test('snapshotSignature changes when the interactable elements change (real state change)', () => {
  const after = `
- heading "Products" [level=2]
- button "Remove" [ref=e10]
- link "Cart" [ref=e11]
`.trim();
  const a = snapshotSignature('https://www.saucedemo.com/inventory.html', INVENTORY_SNAPSHOT);
  const b = snapshotSignature('https://www.saucedemo.com/inventory.html', after);
  assert.notEqual(a, b);
});
