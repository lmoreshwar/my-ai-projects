/**
 * navigation-candidates.test.ts — evidence-based route seeding.
 *
 * Reproduces the exact failure from run AUTO-1787597723642: on the inventory page the explorer
 * missed the cart link and wandered into the "Open Menu" hamburger, then stalled. navigationCandidates
 * must surface the goal-relevant cart/checkout controls ABOVE the menu distractor, using only the live
 * snapshot + the goal text (no app-specific rule).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigationCandidates } from '../agent-loop';

// A realistic a11y snapshot excerpt: a menu opener, a cart link (with /url), and unrelated links.
const INVENTORY_SNAPSHOT = [
  '- button "Open Menu" [ref=e10]',
  '- link "Twitter" [ref=e11]:',
  '  - /url: https://twitter.com/saucelabs',
  '- link [ref=e12]:',
  '  - /url: /cart.html',
  '- button "Add to cart" [ref=e13]',
  '- link "About" [ref=e14]:',
  '  - /url: https://saucelabs.com/',
].join('\n');

test('ranks the goal-relevant cart route above the menu/opener distractor', () => {
  const cands = navigationCandidates(INVENTORY_SNAPSHOT, 'Complete the product purchase journey through checkout', 'Complete Product Purchase Journey');
  assert.ok(cands.length > 0, 'expected at least one candidate');
  // The cart link (href token "cart" is both a goal-relevant and an advance verb) must rank first.
  assert.equal(cands[0].ref, 'e12', 'the /cart.html link should be the top candidate');
  assert.equal(cands[0].href, '/cart.html');
  // The "Open Menu" opener must not outrank the cart route.
  const menuIndex = cands.findIndex((c) => c.name === 'Open Menu');
  assert.ok(menuIndex === -1 || menuIndex > 0, 'the menu opener must not be the top candidate');
});

test('scores an explicit Checkout button via generic forward-progress vocabulary', () => {
  const snapshot = [
    '- button "Continue Shopping" [ref=e1]',
    '- button "Checkout" [ref=e2]',
    '- link "Remove" [ref=e3]',
  ].join('\n');
  const cands = navigationCandidates(snapshot, 'complete purchase', 'Complete Product Purchase Journey');
  assert.equal(cands[0].name, 'Checkout', 'the Checkout button should rank first for a purchase goal');
});

test('always returns available links/buttons even with no goal overlap (fallback next move)', () => {
  const snapshot = [
    '- link "Alpha" [ref=e1]:',
    '  - /url: /alpha',
    '- button "Beta" [ref=e2]',
  ].join('\n');
  const cands = navigationCandidates(snapshot, 'unrelated goal xyz', 'Unrelated');
  assert.equal(cands.length, 2, 'both controls remain as fallback options');
});

test('returns nothing when the page exposes no links or buttons', () => {
  const snapshot = ['- textbox "Username" [ref=e1]', '- textbox "Password" [ref=e2]'].join('\n');
  assert.equal(navigationCandidates(snapshot, 'anything', 'Anything').length, 0);
});
