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
import { readRoutesBlock, mergeRoutes, assertRoutesDefined, stripCommentsAndStrings } from '../codegen';

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
