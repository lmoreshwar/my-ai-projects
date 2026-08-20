/**
 * codegen-route-reuse.test.ts — regression tests for the generator fix (branch fix/codegen-route-reuse).
 *
 * These pin the SOURCE generator (not any generated repo) so a regeneration can never again ship a "green"
 * PR whose repository does not compile. They prove:
 *   A. every generated `routes.X` reference resolves to a real route,
 *   B. a generated module cannot reference a nonexistent route (repairable rejection),
 *   C. an existing reusable module is detected and codegen is REQUIRED to reuse it,
 *   D. regenerating an existing module may ADD methods but must not DROP an existing public method,
 *   E. the whole-repo tsc gate flags only NEWLY-introduced type errors (generated TS must compile).
 * (F — "the existing agent-loop tests stay 100% green" — is the full `npm test` run, not a case here.)
 *
 * The live `tsc --noEmit` invocation in typecheckFramework() is thin plumbing over parseTscErrors()/
 * newTypeErrors(); those pure functions carry the gate's decision logic and are unit-tested here so the
 * gate is deterministic and offline.
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertExistingModuleApiPreserved, assertRoutesResolvable } from '../codegen';
import { assertResolvedDependenciesUsed, resolveCapabilityDependencies } from '../capability-dependencies';
import { newTypeErrors, parseTscErrors } from '../generate';

type Candidate = Parameters<typeof assertRoutesResolvable>[1];

const makeFw = (): string => mkdtempSync(join(tmpdir(), 'blast-route-reuse-'));
const cleanup = (fw: string): void => rmSync(fw, { recursive: true, force: true });

function writeFile(fw: string, rel: string, content: string): void {
  const abs = join(fw, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** Write a minimal `src/config/index.ts` with the given `routes` entries + the canonical url helpers. */
function writeConfig(fw: string, routeLines: string[]): void {
  writeFile(fw, 'src/config/index.ts', [
    'export const routes = {',
    ...routeLines.map((line) => `  ${line},`),
    '} as const;',
    'export type RoutePath = (typeof routes)[keyof typeof routes] | string;',
    'export function urlFor(path: string): string { return path; }',
    'export function urlRegex(path: string): RegExp { return new RegExp(path); }',
    '',
  ].join('\n'));
}

/** Build a minimal LlmArtifacts candidate, overriding only the fields a given case needs. */
function buildCandidate(over: {
  pageContent?: string;
  moduleFile?: string;
  moduleContent?: string;
  specContent?: string;
  routes?: Record<string, string>;
} = {}): Candidate {
  const candidate: Candidate = {
    domain: 'sample',
    page: { file: 'src/pages/SamplePage.ts', content: over.pageContent ?? 'export class SamplePage {}' },
    module: { file: over.moduleFile ?? 'src/modules/SampleModule.ts', content: over.moduleContent ?? 'export class SampleModule {}' },
    spec: { file: 'src/tests/sample.spec.ts', content: over.specContent ?? "import { test } from '../fixtures';" },
  };
  if (over.routes) candidate.routes = over.routes;
  return candidate;
}

// ── A ────────────────────────────────────────────────────────────────────────
test('A: a generated routes.X that exists in config resolves cleanly (canonical-route assertion)', () => {
  const fw = makeFw();
  try {
    writeConfig(fw, ["login: '/'", "checkoutStepTwo: '/checkout-step-two.html'"]);
    // The SauceDemo expectation: assert the overview URL via the canonical route, never a hardcoded URL.
    const candidate = buildCandidate({
      specContent: [
        "import { routes, urlRegex } from '../config';",
        'export const check = (page: { toHaveURL(r: RegExp): void }): void => page.toHaveURL(urlRegex(routes.checkoutStepTwo));',
      ].join('\n'),
    });
    assert.doesNotThrow(() => assertRoutesResolvable(fw, candidate, []));
  } finally {
    cleanup(fw);
  }
});

test('A: a routes.X returned in the model\'s own "routes" field also resolves (newly-added route)', () => {
  const fw = makeFw();
  try {
    writeConfig(fw, ["login: '/'"]);
    const candidate = buildCandidate({
      moduleContent: [
        "import { routes, urlFor } from '../config';",
        'export class SampleModule {',
        '  async open(): Promise<string> { return urlFor(routes.checkoutStepOne); }',
        '}',
      ].join('\n'),
      routes: { checkoutStepOne: '/checkout-step-one.html' },
    });
    assert.doesNotThrow(() => assertRoutesResolvable(fw, candidate, []));
  } finally {
    cleanup(fw);
  }
});

// ── B ────────────────────────────────────────────────────────────────────────
test('B: a generated module referencing a nonexistent route is rejected (repairable)', () => {
  const fw = makeFw();
  try {
    writeConfig(fw, ["login: '/'"]);
    const candidate = buildCandidate({
      moduleContent: [
        "import { routes, urlFor } from '../config';",
        'export class SampleModule {',
        '  async open(): Promise<string> { return urlFor(routes.doesNotExist); }',
        '}',
      ].join('\n'),
    });
    assert.throws(
      () => assertRoutesResolvable(fw, candidate, []),
      /undefined route reference\(s\)[\s\S]*doesNotExist/,
    );
  } finally {
    cleanup(fw);
  }
});

// ── C ────────────────────────────────────────────────────────────────────────
test('C: an existing reusable module is detected and codegen is required to reuse it', () => {
  const fw = makeFw();
  try {
    const domains = join(fw, '.ai-memory', 'domains');
    mkdirSync(domains, { recursive: true });
    writeFileSync(join(fw, '.ai-memory', 'capabilities.json'), JSON.stringify({
      $schema: 'reuse-capability-index/v2-sharded',
      sourceHash: 'sha1:fixture',
      domains: [{ domain: 'Inventory', shard: '.ai-memory/domains/inventory.json' }],
      testIndex: {
        TC_001: [{ domain: 'Inventory', spec: 'src/tests/add-product-to-cart.spec.ts', title: 'TC_001 add a product to the cart @AddProductToCart' }],
      },
    }));
    writeFileSync(join(domains, 'inventory.json'), JSON.stringify({
      domain: 'Inventory',
      modules: [{ file: 'src/modules/InventoryModule.ts', class: 'InventoryModule', methods: ['addBackpackToCart', 'goto'] }],
    }));

    const resolution = resolveCapabilityDependencies(fw, 'Cart View Contents', 'https://example.test/cart');
    assert.equal(resolution.dependencies[0]?.moduleClass, 'InventoryModule', 'the existing InventoryModule must be resolved as the prerequisite');

    // A generated module that IGNORES the resolved prerequisite is rejected — reuse is mandatory.
    assert.throws(
      () => assertResolvedDependenciesUsed('export class CartModule {}', resolution),
      /InventoryModule\.addBackpackToCart/,
    );

    // A module that reuses the existing workflow (instead of re-implementing it) passes.
    const reused = [
      "import { InventoryModule } from '../modules/InventoryModule';",
      'export class CartModule {',
      '  private readonly inventoryModule: InventoryModule;',
      '  constructor(page: unknown) { this.inventoryModule = new InventoryModule(page); }',
      '  async open(): Promise<void> { await this.inventoryModule.addBackpackToCart(); }',
      '}',
    ].join('\n');
    assert.doesNotThrow(() => assertResolvedDependenciesUsed(reused, resolution));
  } finally {
    cleanup(fw);
  }
});

// ── D ────────────────────────────────────────────────────────────────────────
test('D: regenerating an existing module may ADD methods but must not DROP an existing public method', () => {
  const fw = makeFw();
  try {
    const rel = 'src/modules/CompletePurchaseModule.ts';
    writeFile(fw, rel, [
      'export class CompletePurchaseModule {',
      '  async goto(): Promise<void> {}',
      '  async establishPurchase(): Promise<void> {}',
      '}',
    ].join('\n'));

    // Additive rewrite keeps establishPurchase and ADDS completePurchase → allowed.
    const additive = buildCandidate({
      moduleFile: rel,
      moduleContent: [
        'export class CompletePurchaseModule {',
        '  async goto(): Promise<void> {}',
        '  async establishPurchase(): Promise<void> {}',
        '  async completePurchase(first: string, last: string, zip: string): Promise<void> {}',
        '}',
      ].join('\n'),
    });
    assert.doesNotThrow(() => assertExistingModuleApiPreserved(fw, additive));

    // Dropping establishPurchase (the exact #24/#25 defect that broke an older spec) → rejected.
    const dropped = buildCandidate({
      moduleFile: rel,
      moduleContent: [
        'export class CompletePurchaseModule {',
        '  async goto(): Promise<void> {}',
        '  async completePurchase(first: string, last: string, zip: string): Promise<void> {}',
        '}',
      ].join('\n'),
    });
    assert.throws(
      () => assertExistingModuleApiPreserved(fw, dropped),
      /removes existing public method\(s\) \[establishPurchase\]/,
    );
  } finally {
    cleanup(fw);
  }
});

test('D: a brand-new module (no file on disk) has no prior API to preserve', () => {
  const fw = makeFw();
  try {
    const fresh = buildCandidate({
      moduleFile: 'src/modules/BrandNewModule.ts',
      moduleContent: 'export class BrandNewModule { async goto(): Promise<void> {} }',
    });
    assert.doesNotThrow(() => assertExistingModuleApiPreserved(fw, fresh));
  } finally {
    cleanup(fw);
  }
});

// ── D (signature compatibility) ───────────────────────────────────────────────
// The EXACT latest SauceDemo failure: completePurchase() → completePurchase(first,last,zip) turned three
// previously-absent arguments into newly-REQUIRED ones, breaking every existing caller with TS2554. The
// name-only gate missed it; these pin the parameter-compatibility dimension.
test('D-sig: existing no-arg method → generated REQUIRED-arg method is REJECTED (the TS2554 defect)', () => {
  const fw = makeFw();
  try {
    const rel = 'src/modules/CompletePurchaseModule.ts';
    writeFile(fw, rel, [
      'export class CompletePurchaseModule {',
      '  async goto(): Promise<void> {}',
      '  async completePurchase(): Promise<void> {}',
      '}',
    ].join('\n'));
    const breaking = buildCandidate({
      moduleFile: rel,
      moduleContent: [
        'export class CompletePurchaseModule {',
        '  async goto(): Promise<void> {}',
        '  async completePurchase(first: string, last: string, zip: string): Promise<void> {}',
        '}',
      ].join('\n'),
    });
    assert.throws(
      () => assertExistingModuleApiPreserved(fw, breaking),
      /changes the call signature[\s\S]*completePurchase[\s\S]*now requires 3/,
    );
  } finally {
    cleanup(fw);
  }
});

test('D-sig: existing OPTIONAL parameter → generated REQUIRED parameter is REJECTED', () => {
  const fw = makeFw();
  try {
    const rel = 'src/modules/SearchModule.ts';
    writeFile(fw, rel, [
      'export class SearchModule {',
      '  async search(term?: string): Promise<void> {}',
      '}',
    ].join('\n'));
    const breaking = buildCandidate({
      moduleFile: rel,
      moduleContent: [
        'export class SearchModule {',
        '  async search(term: string): Promise<void> {}',
        '}',
      ].join('\n'),
    });
    assert.throws(
      () => assertExistingModuleApiPreserved(fw, breaking),
      /changes the call signature[\s\S]*search[\s\S]*now requires 1/,
    );
  } finally {
    cleanup(fw);
  }
});

test('D-sig: preserving the existing REQUIRED parameter count is ALLOWED', () => {
  const fw = makeFw();
  try {
    const rel = 'src/modules/CheckoutModule.ts';
    const body = [
      'export class CheckoutModule {',
      '  async enter(first: string, last: string): Promise<void> {}',
      '}',
    ].join('\n');
    writeFile(fw, rel, body);
    const same = buildCandidate({ moduleFile: rel, moduleContent: body });
    assert.doesNotThrow(() => assertExistingModuleApiPreserved(fw, same));
  } finally {
    cleanup(fw);
  }
});

test('D-sig: adding NEW parameters as OPTIONAL keeps existing callers compiling (ALLOWED)', () => {
  const fw = makeFw();
  try {
    const rel = 'src/modules/CompletePurchaseModule.ts';
    writeFile(fw, rel, [
      'export class CompletePurchaseModule {',
      '  async completePurchase(): Promise<void> {}',
      '}',
    ].join('\n'));
    const backwardCompatible = buildCandidate({
      moduleFile: rel,
      // the CORRECT backward-compatible design the gate steers the model toward.
      moduleContent: [
        'export class CompletePurchaseModule {',
        '  async completePurchase(first?: string, last?: string, zip?: string): Promise<void> {}',
        '}',
      ].join('\n'),
    });
    assert.doesNotThrow(() => assertExistingModuleApiPreserved(fw, backwardCompatible));
  } finally {
    cleanup(fw);
  }
});

test('D-sig: adding a NEW method for the new behaviour while preserving the existing one is ALLOWED', () => {
  const fw = makeFw();
  try {
    const rel = 'src/modules/CompletePurchaseModule.ts';
    writeFile(fw, rel, [
      'export class CompletePurchaseModule {',
      '  async completePurchase(): Promise<void> {}',
      '}',
    ].join('\n'));
    const added = buildCandidate({
      moduleFile: rel,
      moduleContent: [
        'export class CompletePurchaseModule {',
        '  async completePurchase(): Promise<void> {}',
        '  async completePurchaseWithDetails(first: string, last: string, zip: string): Promise<void> {}',
        '}',
      ].join('\n'),
    });
    assert.doesNotThrow(() => assertExistingModuleApiPreserved(fw, added));
  } finally {
    cleanup(fw);
  }
});

// ── E ────────────────────────────────────────────────────────────────────────
test('E: the tsc gate flags only NEWLY-introduced type errors, ignoring pre-existing repo debt', () => {
  // A pre-existing error (the rolled-back repo's establishPurchase break) present BEFORE generation.
  const baselineOut = "src/tests/complete-end-to-end-purchase.spec.ts(8,26): error TS2339: Property 'establishPurchase' does not exist on type 'CompletePurchaseModule'.";
  const baseline = parseTscErrors(baselineOut);
  assert.equal(baseline.size, 1);

  // The SAME pre-existing error, shifted to a new line/col by generated code → NOT counted as new.
  const shifted = "src/tests/complete-end-to-end-purchase.spec.ts(14,10): error TS2339: Property 'establishPurchase' does not exist on type 'CompletePurchaseModule'.";
  assert.deepEqual(newTypeErrors(baseline, shifted), []);

  // A genuinely new compile break introduced by the generated change → flagged.
  const afterNew = `${shifted}\nsrc/modules/CompletePurchaseModule.ts(31,5): error TS2554: Expected 3 arguments, but got 0.`;
  const introduced = newTypeErrors(baseline, afterNew);
  assert.equal(introduced.length, 1);
  assert.match(introduced[0], /CompletePurchaseModule\.ts :: error TS2554/);
});

test('E: parseTscErrors captures error lines and ignores summaries/blank lines', () => {
  const out = [
    '',
    "src/modules/SampleModule.ts(3,1): error TS1005: ';' expected.",
    'Found 1 error in src/modules/SampleModule.ts:3',
  ].join('\n');
  const errors = parseTscErrors(out);
  assert.equal(errors.size, 1);
  assert.equal([...errors][0], "src/modules/SampleModule.ts :: error TS1005: ';' expected.");
});
