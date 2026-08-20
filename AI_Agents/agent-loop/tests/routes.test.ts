/**
 * routes.test.ts — regression tests for the config-routes lifecycle (merge + undefined-route gate).
 *
 * Reproduces the exact CI failure on the Product Details run:
 *   "Codegen: undefined route reference(s): route 'dashboard' is referenced in src/config/index.ts
 *    but not defined in src/config/index.ts routes"
 *
 * Root cause: the framework's OWN src/config/index.ts contains `urlRegex(routes.dashboard)` inside the
 * urlRegex JSDoc example, while routes = { login, inventory }. mergeRoutes correctly union-merges new
 * routes (it never regenerates config or drops keys), but after a merge the config file is scanned by
 * assertRoutesDefined — which used to match `routes.dashboard` INSIDE THE COMMENT and reject the build.
 * The fix strips comments/strings before scanning, so only REAL code references are validated. These
 * tests lock that behaviour AND prove existing routes are always preserved and merges are deterministic.
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  readRoutesBlock,
  mergeRoutes,
  assertRoutesDefined,
  stripCommentsAndStrings,
  assertRoutesResolvable,
  recoverMissingRoutes,
  deriveRouteFromTrace,
} from '../codegen';
import type { AgentStep } from '../agent-loop';

/* ── Temp-framework helpers ──────────────────────────────────────────────────── */

function makeFramework(configTs: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'blast-routes-'));
  mkdirSync(join(dir, 'src', 'config'), { recursive: true });
  writeFileSync(join(dir, 'src', 'config', 'index.ts'), configTs);
  return dir;
}
function writeGen(fw: string, rel: string, content: string): void {
  const abs = join(fw, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
const cleanup = (fw: string) => rmSync(fw, { recursive: true, force: true });
const keys = (fw: string): string[] => [...(readRoutesBlock(fw)!.keys)].sort();

/* ── Fixtures ────────────────────────────────────────────────────────────────── */

// The REAL framework shape: routes = { login, inventory }, with `routes.dashboard` living ONLY inside
// the urlRegex JSDoc example (a documentation reference, not a live route usage).
const CONFIG_DASHBOARD_IN_COMMENT = [
  'export const routes = {',
  "    login: '/',",
  "    inventory: '/inventory.html',",
  '} as const;',
  '',
  '/**',
  ' * Build an env-agnostic RegExp for URL assertions.',
  ' * Example: await expect(page).toHaveURL(urlRegex(routes.dashboard)); // matches by path, not host',
  ' */',
  'export function urlRegex(p: string): RegExp { return new RegExp(p); }',
  '',
].join('\n');

// A config where dashboard is a REAL route key (and referenced) — must survive a feature merge.
const CONFIG_WITH_DASHBOARD = [
  'export const routes = {',
  "    login: '/',",
  "    inventory: '/inventory.html',",
  "    dashboard: '/dashboard.html',",
  '} as const;',
  '',
].join('\n');

// Existing A/B/C for the deterministic-merge test.
const CONFIG_ABC = [
  'export const routes = {',
  "    alpha: '/a',",
  "    bravo: '/b',",
  "    charlie: '/c',",
  '} as const;',
  '',
].join('\n');

/* ── #7 — reproduce THE EXACT CI failure ─────────────────────────────────────── */

test('#7 exact CI failure: routes.dashboard in the config JSDoc is NOT an undefined route reference', () => {
  const fw = makeFramework(CONFIG_DASHBOARD_IN_COMMENT);
  try {
    console.log(`[routes] before: { ${keys(fw).join(', ')} }`);
    // A generated feature that adds a new route and only uses defined routes.
    const changed = mergeRoutes(fw, { productDetail: '/inventory-item.html' });
    assert.equal(changed, 'src/config/index.ts', 'the new route is merged into the existing config');
    writeGen(fw, 'src/tests/productDetails.spec.ts',
      "import { routes, urlFor } from '../config';\nawait page.goto(urlFor(routes.productDetail));\n");
    // Before the fix this threw "route 'dashboard' ... not defined". It must NOT throw now.
    assert.doesNotThrow(
      () => assertRoutesDefined(fw, ['src/config/index.ts', 'src/tests/productDetails.spec.ts']),
      'a routes.X example inside a JSDoc comment must never be flagged as an undefined route',
    );
    console.log(`[routes] after:  { ${keys(fw).join(', ')} }`);
    assert.deepEqual(keys(fw), ['inventory', 'login', 'productDetail'], 'existing routes preserved + new one added');
  } finally { cleanup(fw); }
});

test('#7 preservation: an existing real dashboard route + a generated feature still contains dashboard', () => {
  const fw = makeFramework(CONFIG_WITH_DASHBOARD);
  try {
    console.log(`[routes] before: { ${keys(fw).join(', ')} }`);
    mergeRoutes(fw, { productDetail: '/inventory-item.html' });
    writeGen(fw, 'src/tests/pd.spec.ts', 'page.goto(urlFor(routes.productDetail));');
    assert.doesNotThrow(() => assertRoutesDefined(fw, ['src/config/index.ts', 'src/tests/pd.spec.ts']));
    console.log(`[routes] after:  { ${keys(fw).join(', ')} }`);
    assert.ok(readRoutesBlock(fw)!.keys.has('dashboard'), 'the pre-existing dashboard route must be preserved');
    assert.deepEqual(keys(fw), ['dashboard', 'inventory', 'login', 'productDetail']);
  } finally { cleanup(fw); }
});

/* ── #8 — deterministic union merge (A/B/C + D → A/B/C/D) ─────────────────────── */

test('#8 deterministic merge: existing A/B/C + a new verified route D → final routes are A/B/C/D', () => {
  const fw = makeFramework(CONFIG_ABC);
  try {
    console.log(`[routes] before: { ${keys(fw).join(', ')} }`);
    mergeRoutes(fw, { delta: '/d' });
    console.log(`[routes] after:  { ${keys(fw).join(', ')} }`);
    assert.deepEqual(keys(fw), ['alpha', 'bravo', 'charlie', 'delta'], 'no key dropped, no key invented, D added');

    // Re-merging an existing key is a no-op (never overwrites/duplicates).
    const again = mergeRoutes(fw, { alpha: '/DIFFERENT', delta: '/d' });
    assert.equal(again, null, 'merging only already-present keys makes no change');
    assert.deepEqual(keys(fw), ['alpha', 'bravo', 'charlie', 'delta']);
  } finally { cleanup(fw); }
});

/* ── #9 — a genuine unknown route in REAL code is still rejected ──────────────── */

test('#9 rejection: an unknown routes.X in REAL generated code (no evidence) is rejected', () => {
  const fw = makeFramework(CONFIG_DASHBOARD_IN_COMMENT);
  try {
    writeGen(fw, 'src/tests/bad.spec.ts', 'await page.goto(urlFor(routes.somethingUnverified));');
    assert.throws(
      () => assertRoutesDefined(fw, ['src/tests/bad.spec.ts']),
      /route 'somethingUnverified' is referenced in src\/tests\/bad\.spec\.ts but not defined/,
      'a real, undefined route reference must still fail the build',
    );
  } finally { cleanup(fw); }
});

/* ── Guards: comment/string ignored, but template-literal interpolation NOT over-stripped ── */

test('a routes.X inside a line/block comment or a quoted string in a generated file is ignored', () => {
  const fw = makeFramework(CONFIG_DASHBOARD_IN_COMMENT);
  try {
    const gen = [
      '// example only: urlFor(routes.commentedRoute)',
      '/* block doc: see routes.blockRoute */',
      "const help = 'refer to routes.stringRoute in the docs';",
      'await page.goto(urlFor(routes.inventory));',
    ].join('\n');
    writeGen(fw, 'src/tests/ok.spec.ts', gen);
    assert.doesNotThrow(() => assertRoutesDefined(fw, ['src/tests/ok.spec.ts']));
  } finally { cleanup(fw); }
});

test('an undefined routes.X inside a template-literal interpolation is STILL rejected (no over-stripping)', () => {
  const fw = makeFramework(CONFIG_DASHBOARD_IN_COMMENT);
  try {
    writeGen(fw, 'src/tests/tpl.spec.ts', 'const u = `${urlFor(routes.templatedUnknown)}`;');
    assert.throws(() => assertRoutesDefined(fw, ['src/tests/tpl.spec.ts']), /route 'templatedUnknown' is referenced/);
  } finally { cleanup(fw); }
});

test('stripCommentsAndStrings removes comment/string routes.X but keeps real code + template interpolations', () => {
  const src = [
    '// urlFor(routes.inComment)',
    '/* routes.inBlock */',
    "const s = 'routes.inString';",
    'goto(urlFor(routes.realCode));',
    'const t = `${urlFor(routes.inTemplate)}`;',
  ].join('\n');
  const found = new Set([...stripCommentsAndStrings(src).matchAll(/\broutes\.([A-Za-z_]\w*)/g)].map((m) => m[1]));
  assert.deepEqual([...found].sort(), ['inTemplate', 'realCode'], 'only real code + template interpolations survive');
});

/* ── #10–#14 — repairable in-loop route gate + trace-derived auto-recovery ─────────────
 *
 * Reproduces the recurring CI approve-phase break:
 *   "Codegen: undefined route reference(s): route 'checkoutStepOne' is referenced in
 *    src/modules/CheckoutYourInformationModule.ts but not defined in src/config/index.ts routes"
 *
 * Old cause: the route check ran AFTER the self-repair loop, so the model was never asked to add the
 * missing key. Fix = an in-memory, REPAIRABLE gate (assertRoutesResolvable) inside the loop that accepts
 * a key returned in the model's "routes" field, PLUS a trace-derived safety net (recoverMissingRoutes).
 */

// A minimal LlmArtifacts-shaped candidate (only the fields the gate reads).
function candidate(moduleContent: string, routes?: Record<string, string>) {
  return {
    domain: 'checkout',
    page: { file: 'src/pages/CheckoutPage.ts', content: '// page' },
    module: { file: 'src/modules/CheckoutYourInformationModule.ts', content: moduleContent },
    spec: { file: 'src/tests/checkout.spec.ts', content: '// spec' },
    routes,
  };
}
// A minimal AgentStep carrying only the verified url the derivation reads.
const step = (url: string): AgentStep => ({ tool: 'browser_navigate', args: {}, url, result: 'ok' });
const CHECKOUT_TRACE: AgentStep[] = [
  step('https://www.saucedemo.com/checkout-step-one.html'),
  step('https://www.saucedemo.com/checkout-step-two.html'),
];

test('#10 in-loop gate REJECTS a routes.X missing from config AND the model "routes" field — with the verified path', () => {
  const fw = makeFramework(CONFIG_DASHBOARD_IN_COMMENT);
  try {
    const mod = 'await this.actions.click(this.page.continueBtn);\nawait this.waitHelper.forUrl(urlRegex(routes.checkoutStepOne));';
    assert.throws(
      () => assertRoutesResolvable(fw, candidate(mod), CHECKOUT_TRACE),
      (e: Error) =>
        /route 'checkoutStepOne' is referenced/.test(e.message) &&
        /VERIFIED path is "\/checkout-step-one\.html"/.test(e.message),
      'a missing route must be a repairable error that names its verified path from the trace',
    );
  } finally { cleanup(fw); }
});

test('#11 in-loop gate ACCEPTS the reference when the model returns the key in its "routes" field', () => {
  const fw = makeFramework(CONFIG_DASHBOARD_IN_COMMENT);
  try {
    const mod = 'await this.waitHelper.forUrl(urlRegex(routes.checkoutStepOne));';
    assert.doesNotThrow(
      () => assertRoutesResolvable(fw, candidate(mod, { checkoutStepOne: '/checkout-step-one.html' }), CHECKOUT_TRACE),
      'the model self-repaired by returning the new route — the loop must let it through',
    );
  } finally { cleanup(fw); }
});

test('#11b in-loop gate ACCEPTS a reference to an already-defined config route', () => {
  const fw = makeFramework(CONFIG_DASHBOARD_IN_COMMENT);
  try {
    const mod = 'await this.waitHelper.forUrl(urlRegex(routes.inventory));';
    assert.doesNotThrow(() => assertRoutesResolvable(fw, candidate(mod), CHECKOUT_TRACE));
  } finally { cleanup(fw); }
});

test('#12 deriveRouteFromTrace maps a key to its path only when EXACTLY one trace url resolves to it', () => {
  assert.equal(deriveRouteFromTrace('checkoutStepOne', CHECKOUT_TRACE), '/checkout-step-one.html', 'unique match');
  assert.equal(deriveRouteFromTrace('checkoutStepTwo', CHECKOUT_TRACE), '/checkout-step-two.html', 'unique match');
  assert.equal(deriveRouteFromTrace('unseenRoute', CHECKOUT_TRACE), null, 'no trace url resolves to it → null');
  // Ambiguous: two different urls camelCase to the same key → refuse to guess.
  const ambiguous = [step('https://a.test/checkout-step-one.html'), step('https://b.test/checkout/step/one')];
  assert.equal(deriveRouteFromTrace('checkoutStepOne', ambiguous), null, 'ambiguous evidence → null (never guess)');
});

test('#13 safety net: recoverMissingRoutes auto-merges an omitted route from the trace so the build survives', () => {
  const fw = makeFramework(CONFIG_DASHBOARD_IN_COMMENT);
  try {
    // Simulate a generated module the model wrote WITHOUT returning the new route in "routes".
    writeGen(fw, 'src/modules/CheckoutYourInformationModule.ts',
      'await this.waitHelper.forUrl(urlRegex(routes.checkoutStepOne));');
    const files = ['src/config/index.ts', 'src/modules/CheckoutYourInformationModule.ts'];
    // Before recovery the route is undefined → the final gate would reject.
    assert.throws(() => assertRoutesDefined(fw, files), /route 'checkoutStepOne' .* not defined/);
    // Recover from the verified trace, then the final gate passes.
    const changed = recoverMissingRoutes(fw, files, CHECKOUT_TRACE);
    assert.equal(changed, 'src/config/index.ts', 'the derived route was merged into config');
    assert.ok(readRoutesBlock(fw)!.keys.has('checkoutStepOne'), 'checkoutStepOne is now defined');
    assert.deepEqual(keys(fw), ['checkoutStepOne', 'inventory', 'login'], 'existing routes preserved + derived one added');
    assert.doesNotThrow(() => assertRoutesDefined(fw, files), 'the build no longer breaks on the omitted route');
  } finally { cleanup(fw); }
});

test('#14 safety net stays silent when it cannot derive a path (never invents a route)', () => {
  const fw = makeFramework(CONFIG_DASHBOARD_IN_COMMENT);
  try {
    writeGen(fw, 'src/tests/bad.spec.ts', 'await page.goto(urlFor(routes.somethingWithNoTraceEvidence));');
    const changed = recoverMissingRoutes(fw, ['src/tests/bad.spec.ts'], CHECKOUT_TRACE);
    assert.equal(changed, null, 'no confident trace evidence → no merge (the real gate still rejects it)');
    assert.deepEqual(keys(fw), ['inventory', 'login'], 'config untouched');
  } finally { cleanup(fw); }
});

