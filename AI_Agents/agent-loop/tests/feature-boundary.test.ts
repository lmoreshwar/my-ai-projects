/**
 * feature-boundary.test.ts — regression tests for generic FEATURE BOUNDARY / TARGET COMPLETION.
 * Runs with the Node built-in test runner via tsx: `npm test`.
 *
 * These pin the ten acceptance requirements for the fix that made exploration STOP at the requested
 * feature target (e.g. View Cart at cart.html) instead of wandering into downstream capabilities
 * (Checkout) and reporting a false failure. Everything is derived from the feature name + live
 * evidence (URLs, a11y snapshots) — no application- or feature-name-specific rules — so the same
 * behaviour holds for any enterprise app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  featureTokens, featureIntentIsView, pathMatchesFeature, snapshotHasContent,
  detectFeatureBoundary, detectSubmitCompletion, splitTrace, resolveFeatureStatus,
  featureIntentIsExit, detectExitCompletion, looksLikeLoginLanding,
} from '../feature-boundary';
import { authorFeatureVerificationScenarios } from '../codegen';
import type { AgentStep } from '../agent-loop';

// A cart page a11y snapshot with real content (items + Remove/Checkout actions).
const CART_CONTENT = `
- heading "Your Cart" [level=2]
- list [ref=e10]:
  - listitem "Sauce Labs Backpack" [ref=e11]
  - text "29.99" [ref=e12]
- button "Remove" [ref=e13]
- button "Checkout" [ref=e14]
`.trim();

// An empty cart: shell only, no items, no actionable content.
const EMPTY_CART = `
- heading "Your Cart" [level=2]
- text "Your cart is empty" [ref=e10]
`.trim();

// A checkout-overview page with NO form controls (the page the agent wrongly failed on).
const CHECKOUT_OVERVIEW = `
- heading "Checkout: Overview" [level=2]
- text "Payment Information" [ref=e30]
`.trim();

const INVENTORY = 'https://www.saucedemo.com/inventory.html';
const CART = 'https://www.saucedemo.com/cart.html';
const STEP_ONE = 'https://www.saucedemo.com/checkout-step-one.html';
const CHECKOUT = 'https://www.saucedemo.com/checkout-step-two.html';

function step(partial: Partial<AgentStep>): AgentStep {
  return { tool: 'snapshot', args: {}, result: '', ...partial };
}

// A realistic View Cart walk: login → inventory → add product → open cart (content) → checkout overview.
function viewCartWalk(): AgentStep[] {
  return [
    step({ tool: 'click', args: {}, locator: "getByRole('button', { name: 'Login' })", url: INVENTORY }),
    step({ tool: 'click', args: {}, locator: "getByRole('button', { name: 'Add to cart' })", url: INVENTORY }),
    step({ tool: 'click', args: {}, locator: "getByRole('link', { name: 'Cart' })", url: CART }),
    step({ tool: 'snapshot', args: { acceptance: true }, context: CART_CONTENT, url: CART }),
    // Downstream wandering the agent should NOT have done:
    step({ tool: 'click', args: {}, locator: "getByRole('button', { name: 'Checkout' })", url: CHECKOUT }),
    step({ tool: 'snapshot', args: {}, context: CHECKOUT_OVERVIEW, url: CHECKOUT }),
  ];
}

test('featureTokens strips intent verbs and keeps the target noun', () => {
  assert.deepEqual(featureTokens('View Cart'), ['cart']);
  assert.deepEqual(featureTokens('View Account'), ['account']);
  assert.deepEqual(featureTokens('Add Product to Cart'), ['product', 'cart']);
  assert.deepEqual(featureTokens('Create Case'), ['case']);
});

test('featureIntentIsView distinguishes read features from write flows', () => {
  assert.equal(featureIntentIsView('View Cart'), true);
  assert.equal(featureIntentIsView('Cart'), true);          // bare noun ⇒ view of that thing
  assert.equal(featureIntentIsView('Add Product to Cart'), false);
  assert.equal(featureIntentIsView('Create Case'), false);
  assert.equal(featureIntentIsView('Checkout'), false);
});

// 5. Feature URL may differ from initial navigation URL — inventory.html is NOT the cart target.
test('5. feature target URL may differ from the initial navigation URL', () => {
  const tokens = featureTokens('View Cart');
  assert.equal(pathMatchesFeature(INVENTORY, tokens), false);
  assert.equal(pathMatchesFeature(CART, tokens), true);
});

// 6. Feature target is detected from live evidence (content vs empty page).
test('6. feature target completion is detected from live content evidence', () => {
  assert.equal(snapshotHasContent(CART_CONTENT), true);
  assert.equal(snapshotHasContent(EMPTY_CART), false);
});

// 1. View Cart stops at cart.html.
test('1. View Cart detects the boundary at cart.html', () => {
  const b = detectFeatureBoundary('View Cart', INVENTORY, viewCartWalk());
  assert.equal(b.acceptanceVerified, true);
  assert.equal(b.targetUrl, CART);
  assert.equal(b.completionIndex, 3); // the cart acceptance snapshot
});

// 2. Checkout does not execute during View Cart — no downstream step is in the primary trace.
test('2. Checkout is excluded from the primary View Cart trace', () => {
  const b = detectFeatureBoundary('View Cart', INVENTORY, viewCartWalk());
  const { primaryTrace, downstreamTrace } = splitTrace(viewCartWalk(), b);
  const primaryLocators = primaryTrace.map((s) => s.locator || '').join(' | ');
  assert.equal(/checkout/i.test(primaryLocators), false);
  assert.ok(downstreamTrace.some((s) => /checkout/i.test(s.locator || '') || /checkout/i.test(s.context || '')));
});

// 3. Downstream failures do not fail the completed feature.
test('3. a downstream failure does not fail a completed feature', () => {
  const b = detectFeatureBoundary('View Cart', INVENTORY, viewCartWalk());
  assert.equal(resolveFeatureStatus('failed', b), 'passed');
});

// 4. Prerequisite Login / Add Product can be reused (they precede the feature target in the trace).
test('4. prerequisite login/add-product steps are separated for reuse', () => {
  const b = detectFeatureBoundary('View Cart', INVENTORY, viewCartWalk());
  const { prerequisiteTrace } = splitTrace(viewCartWalk(), b);
  const locs = prerequisiteTrace.map((s) => s.locator || '');
  assert.ok(locs.some((l) => /Login/i.test(l)));
  assert.ok(locs.some((l) => /Add to cart/i.test(l)));
  assert.equal(prerequisiteTrace.every((s) => !/Checkout/i.test(s.locator || '')), true);
});

// 7. Primary trace excludes downstream actions (end index = completion).
test('7. primary trace ends at feature completion', () => {
  const walk = viewCartWalk();
  const b = detectFeatureBoundary('View Cart', INVENTORY, walk);
  const { primaryTrace } = splitTrace(walk, b);
  assert.equal(primaryTrace.length, b.completionIndex + 1);
  assert.equal(primaryTrace[primaryTrace.length - 1].url, CART);
});

// 8. Primary success remains success after downstream exploration.
test('8. primary success survives later downstream exploration', () => {
  const b = detectFeatureBoundary('View Cart', INVENTORY, viewCartWalk());
  // Even though the walk continued into checkout, the resolved status stays passed.
  assert.equal(resolveFeatureStatus('incomplete', b), 'passed');
  assert.equal(resolveFeatureStatus('failed', b), 'passed');
});

// 9. A true failure BEFORE target completion still fails.
test('9. a failure before ever reaching the target still fails', () => {
  // Walk never reaches cart.html (target never verified).
  const noTarget: AgentStep[] = [
    step({ tool: 'click', args: {}, locator: "getByRole('button', { name: 'Login' })", url: INVENTORY }),
    step({ tool: 'snapshot', args: {}, context: CHECKOUT_OVERVIEW, url: INVENTORY }),
  ];
  const b = detectFeatureBoundary('View Cart', INVENTORY, noTarget);
  assert.equal(b.acceptanceVerified, false);
  assert.equal(resolveFeatureStatus('failed', b), 'failed');
  // An empty cart is reached but has no content ⇒ not accepted ⇒ failure preserved.
  const emptyWalk: AgentStep[] = [
    step({ tool: 'click', args: {}, locator: "getByRole('link', { name: 'Cart' })", url: CART }),
    step({ tool: 'snapshot', args: {}, context: EMPTY_CART, url: CART }),
  ];
  const eb = detectFeatureBoundary('View Cart', INVENTORY, emptyWalk);
  assert.equal(eb.acceptanceVerified, false);
  assert.equal(resolveFeatureStatus('failed', eb), 'failed');
});

// 10. View Cart produces an automation-ready scenario (non-empty Automation Trace).
test('10. View Cart produces an automation-ready verification scenario', () => {
  const walk = viewCartWalk();
  const b = detectFeatureBoundary('View Cart', INVENTORY, walk);
  const { primaryTrace } = splitTrace(walk, b);
  const scenarios = authorFeatureVerificationScenarios({ feature: 'View Cart', url: INVENTORY }, primaryTrace, null);
  assert.equal(scenarios.length, 1);
  const sc = scenarios[0];
  assert.equal(sc.ready, true);
  assert.equal(sc.blocked, false);
  assert.ok(sc.steps.length >= 1, 'scenario has a non-empty Automation Trace');
  // A terminal verification step is present.
  assert.ok(sc.steps.some((s) => /verify/i.test(s.action)));
  // No downstream/checkout step leaked into the authored scenario.
  assert.equal(sc.steps.every((s) => !/checkout/i.test(s.action)), true);
});

// A realistic "Checkout – Your Information" WRITE walk: login → cart → open checkout form → fill the 3
// fields → click Continue, which advances to the Overview (checkout-step-two) page that has NO form.
function checkoutInfoWalk(): AgentStep[] {
  return [
    step({ tool: 'click', args: {}, locator: "getByRole('button', { name: 'Login' })", url: INVENTORY }),
    step({ tool: 'click', args: {}, locator: "getByRole('link', { name: 'Cart' })", url: CART }),
    step({ tool: 'click', args: {}, locator: "getByRole('button', { name: 'Checkout' })", url: STEP_ONE }),
    step({ tool: 'fill', args: { value: 'Jane' }, locator: "getByRole('textbox', { name: 'First Name' })", url: STEP_ONE }),
    step({ tool: 'fill', args: { value: 'Doe' }, locator: "getByRole('textbox', { name: 'Last Name' })", url: STEP_ONE }),
    step({ tool: 'fill', args: { value: '90210' }, locator: "getByRole('textbox', { name: 'Zip/Postal Code' })", url: STEP_ONE }),
    step({ tool: 'click', args: {}, context: '- button "Continue" [ref=e40]', locator: "getByRole('button', { name: 'Continue' })", url: CHECKOUT }),
  ];
}

// 11. Write-flow completion is detected from INTERACTION evidence: fills + submit click + URL change.
test('11. write-flow submit completion is detected from fills + submit click + URL change', () => {
  const walk = checkoutInfoWalk();
  const c = detectSubmitCompletion(walk, INVENTORY);
  assert.ok(c, 'a submit completion is detected');
  assert.equal(c?.completionIndex, 6); // the Continue click
  assert.equal(c?.formIndex, 3);       // first fill on the form page
  assert.equal(c?.formUrl, STEP_ONE);
  assert.equal(c?.destUrl, CHECKOUT);
  assert.equal(c?.control, 'Continue');
});

// 12. A write feature whose post-submit page has NO form still resolves as passed (completed-via-redirect),
//     with completion recorded at the Continue click — not oscillating back to the form.
test('12. Checkout Your Information passes via redirect (post-submit page has no form)', () => {
  const walk = checkoutInfoWalk();
  const b = detectFeatureBoundary('Checkout - Your Information', INVENTORY, walk);
  assert.equal(b.view, false);
  assert.equal(b.acceptanceVerified, true);
  assert.equal(b.completedViaRedirect, true);
  assert.equal(b.completionIndex, 6);
  assert.equal(resolveFeatureStatus('failed', b), 'passed');
  const { primaryTrace, downstreamTrace } = splitTrace(walk, b);
  assert.equal(primaryTrace.length, b.completionIndex + 1);
  assert.equal(primaryTrace[primaryTrace.length - 1].url, CHECKOUT); // ends at the Continue click
  assert.equal(downstreamTrace.length, 0);
});

// 13. A blocked submit (validation kept the same URL) is NOT a completion — failure is preserved.
test('13. a submit that does not navigate (validation) is not a completion', () => {
  const walk = checkoutInfoWalk();
  walk[6] = step({ tool: 'click', args: {}, context: '- button "Continue" [ref=e40]', locator: "getByRole('button', { name: 'Continue' })", url: STEP_ONE }); // stayed on the form
  assert.equal(detectSubmitCompletion(walk, INVENTORY), null);
  const b = detectFeatureBoundary('Checkout - Your Information', INVENTORY, walk);
  assert.equal(b.acceptanceVerified, false);
  assert.equal(resolveFeatureStatus('failed', b), 'failed');
});

// The login/landing page reached after a successful Logout (the CORRECT success end-state of signing out).
const LOGIN = 'https://www.saucedemo.com/';
const LOGIN_FORM = `
- textbox "Username" [ref=e1]
- textbox "Password" [ref=e2]
- button "Login" [ref=e3]
`.trim();

// A realistic Logout walk: login → open the burger menu → click Logout → land back on the login page.
// Logout is a CLICK-ONLY exit (no fields, "logout" is not a submit verb) and its success page (login)
// contains no "logout" token — the exact class of case the form-submit detector cannot cover.
function logoutWalk(): AgentStep[] {
  return [
    step({ tool: 'click', args: {}, locator: "getByRole('button', { name: 'Login' })", url: INVENTORY }),
    step({ tool: 'click', args: {}, context: '- button "Open Menu" [ref=e5]', locator: "getByRole('button', { name: 'Open Menu' })", url: INVENTORY }),
    step({ tool: 'click', args: {}, context: '- link "Logout" [ref=e50]', locator: "getByRole('link', { name: 'Logout' })", url: LOGIN }),
    step({ tool: 'snapshot', args: {}, context: LOGIN_FORM, url: LOGIN }),
  ];
}

// 14. featureIntentIsExit recognizes sign-out features (and not ordinary read/write features).
test('14. featureIntentIsExit recognizes sign-out features', () => {
  assert.equal(featureIntentIsExit('Logout'), true);
  assert.equal(featureIntentIsExit('Log out'), true);
  assert.equal(featureIntentIsExit('Sign Out'), true);
  assert.equal(featureIntentIsExit('Log Off'), true);
  assert.equal(featureIntentIsExit('View Cart'), false);
  assert.equal(featureIntentIsExit('Checkout - Your Information'), false);
});

// 15. looksLikeLoginLanding accepts a login form or a bare landing/root URL, rejects normal content pages.
test('15. looksLikeLoginLanding detects the post-logout landing page', () => {
  assert.equal(looksLikeLoginLanding(LOGIN_FORM, LOGIN), true);     // explicit login form
  assert.equal(looksLikeLoginLanding('', LOGIN), true);            // bare root path (no snapshot needed)
  assert.equal(looksLikeLoginLanding('', 'https://app.example.com/login'), true);
  assert.equal(looksLikeLoginLanding(CART_CONTENT, CART), false);  // a real content page is not a landing
});

// 16. detectExitCompletion finds the sign-out click that navigated to the login/landing page.
test('16. detectExitCompletion is detected from a logout click + URL change to a login page', () => {
  const walk = logoutWalk();
  const e = detectExitCompletion(walk, INVENTORY);
  assert.ok(e, 'an exit completion is detected');
  assert.equal(e?.completionIndex, 2); // the Logout click
  assert.equal(e?.destUrl, LOGIN);
  assert.equal(e?.control, 'Logout');
});

// 17. REGRESSION: Logout resolves as passed on the FIRST finish — landing on the login page IS success,
//     the same principle as Checkout's post-submit Overview page (click-only exit, not a form submit).
test('17. Logout passes via click-only exit (login page IS the success signal)', () => {
  const walk = logoutWalk();
  const b = detectFeatureBoundary('Logout', INVENTORY, walk);
  assert.equal(b.acceptanceVerified, true);
  assert.equal(b.completedViaExit, true);
  assert.equal(b.completionIndex, 2);       // the Logout click
  assert.equal(b.targetUrl, LOGIN);
  assert.equal(resolveFeatureStatus('failed', b), 'passed');
  // The logout click is the feature step; login + open-menu are separated as prerequisites.
  const { primaryTrace, prerequisiteTrace } = splitTrace(walk, b);
  assert.ok(prerequisiteTrace.some((s) => /Login/i.test(s.locator || '')));
  assert.ok(primaryTrace.some((s) => /Logout/i.test(s.locator || '')));
});

// 18. A sign-out click during a NON-exit feature is NOT mistaken for that feature's completion.
test('18. a stray logout click does not complete a non-exit feature', () => {
  const walk: AgentStep[] = [
    step({ tool: 'click', args: {}, context: '- link "Logout" [ref=e50]', locator: "getByRole('link', { name: 'Logout' })", url: LOGIN }),
    step({ tool: 'snapshot', args: {}, context: LOGIN_FORM, url: LOGIN }),
  ];
  const b = detectFeatureBoundary('View Cart', INVENTORY, walk);
  assert.equal(b.acceptanceVerified, false); // logout is not a View Cart completion
  assert.equal(resolveFeatureStatus('failed', b), 'failed');
});

// 19. A logout click that did NOT navigate (still on the same page) is not a completion.
test('19. a logout click with no navigation is not an exit completion', () => {
  const walk: AgentStep[] = [
    step({ tool: 'click', args: {}, locator: "getByRole('button', { name: 'Login' })", url: INVENTORY }),
    step({ tool: 'click', args: {}, context: '- link "Logout" [ref=e50]', locator: "getByRole('link', { name: 'Logout' })", url: INVENTORY }), // stayed put
  ];
  assert.equal(detectExitCompletion(walk, INVENTORY), null);
  const b = detectFeatureBoundary('Logout', INVENTORY, walk);
  assert.equal(b.acceptanceVerified, false);
});
