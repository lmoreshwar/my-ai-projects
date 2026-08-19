/**
 * dependency-resolution.test.ts — internal, automatic capability reuse.
 *
 * The user supplies only a URL + feature. These tests prove BLAST reads the verified capability
 * index and live evidence itself, selects a prerequisite workflow without any dependency input,
 * requires codegen to reuse that workflow, and stores the resulting relationship in private memory.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertDependencyArtifactsPreserved, assertResolvedDependenciesUsed, resolveCapabilityDependencies, writeCapabilityDependencyMemory,
} from '../capability-dependencies';

let FW = '';

before(() => {
  FW = mkdtempSync(join(tmpdir(), 'blast-dependencies-'));
  const memory = join(FW, '.ai-memory', 'domains');
  mkdirSync(memory, { recursive: true });
  writeFileSync(join(FW, '.ai-memory', 'capabilities.json'), JSON.stringify({
    $schema: 'reuse-capability-index/v2-sharded',
    sourceHash: 'sha1:fixture',
    domains: [{ domain: 'Inventory', shard: '.ai-memory/domains/inventory.json' }],
    testIndex: {
      TC_001: [{
        domain: 'Inventory',
        spec: 'src/tests/add-product-to-cart.spec.ts',
        title: 'TC_001 add a product to the cart @AddProductToCart @Smoke',
      }],
    },
  }, null, 2));
  writeFileSync(join(memory, 'inventory.json'), JSON.stringify({
    domain: 'Inventory',
    modules: [{
      file: 'src/modules/InventoryModule.ts',
      class: 'InventoryModule',
      methods: ['addBackpackToCart', 'goto'],
    }],
  }, null, 2));
});

after(() => {
  if (FW) rmSync(FW, { recursive: true, force: true });
});

test('automatically resolves Add Product to Cart as View Cart Contents prerequisite with no user dependency input', () => {
  const resolution = resolveCapabilityDependencies(FW, 'Cart View Contents', 'https://example.test/cart');
  assert.deepEqual(resolution.dependencies.map((dependency) => ({
    module: dependency.moduleClass,
    method: dependency.method,
    spec: dependency.spec,
    provides: dependency.provides,
  })), [{
    module: 'InventoryModule',
    method: 'addBackpackToCart',
    spec: 'src/tests/add-product-to-cart.spec.ts',
    provides: ['cart'],
  }]);
});

test('uses live discovery evidence to resolve a prerequisite when the feature name omits the state term', () => {
  const resolution = resolveCapabilityDependencies(FW, 'View Contents', 'https://example.test/cart', {
    inventory: [{ label: 'Cart', accessibleName: 'Cart' }],
  });
  assert.equal(resolution.dependencies[0]?.method, 'addBackpackToCart');
  assert.ok(resolution.evidenceTerms.includes('cart'), 'the state term must be derived from live evidence');
});

test('does not turn the already-automated Add Product to Cart feature into its own dependency', () => {
  const resolution = resolveCapabilityDependencies(FW, 'Add Product to Cart', 'https://example.test/inventory');
  assert.deepEqual(resolution.dependencies, []);
});

test('does not select unrelated verified capabilities', () => {
  const resolution = resolveCapabilityDependencies(FW, 'Manage User Profile', 'https://example.test/profile');
  assert.deepEqual(resolution.dependencies, []);
});

test('requires the generated Module to reuse the automatically resolved verified workflow', () => {
  const resolution = resolveCapabilityDependencies(FW, 'Cart View Contents', 'https://example.test/cart');
  const reusedModule = `
import { InventoryModule } from '../modules/InventoryModule';
export class CartModule {
  private readonly inventoryModule: InventoryModule;
  constructor(page: unknown) { this.inventoryModule = new InventoryModule(page); }
  async open(): Promise<void> { await this.inventoryModule.addBackpackToCart(); }
}
`;
  assert.doesNotThrow(() => assertResolvedDependenciesUsed(reusedModule, resolution));
  assert.throws(
    () => assertResolvedDependenciesUsed('export class CartModule {}', resolution),
    /InventoryModule\.addBackpackToCart[\s\S]*preserve its Page\/Module\/Spec artifacts/,
  );
});

test('preserves existing prerequisite Page/Module/Spec assets instead of overwriting them', () => {
  const resolution = resolveCapabilityDependencies(FW, 'Cart View Contents', 'https://example.test/cart');
  assert.doesNotThrow(() => assertDependencyArtifactsPreserved({
    page: 'src/pages/CartPage.ts', module: 'src/modules/CartModule.ts', spec: 'src/tests/view-cart.spec.ts',
  }, resolution));
  assert.throws(
    () => assertDependencyArtifactsPreserved({
      page: 'src/pages/CartPage.ts', module: 'src/modules/InventoryModule.ts', spec: 'src/tests/view-cart.spec.ts',
    }, resolution),
    /would overwrite the internally resolved prerequisite[\s\S]*Preserve src\/modules\/InventoryModule\.ts/,
  );
});

test('writes the generated capability relationship to private dependency memory without changing the capability index schema', () => {
  const resolution = resolveCapabilityDependencies(FW, 'Cart View Contents', 'https://example.test/cart');
  const written = writeCapabilityDependencyMemory(FW, 'Cart View Contents', {
    page: 'src/pages/CartPage.ts', module: 'src/modules/CartModule.ts', spec: 'src/tests/view-cart.spec.ts',
  }, resolution);
  assert.equal(written, '.ai-memory/dependencies.json');
  const memory = JSON.parse(readFileSync(join(FW, written!), 'utf8'));
  assert.equal(memory.$schema, 'blast-capability-dependencies/v1');
  assert.deepEqual(memory.capabilities['src/tests/view-cart.spec.ts'].requires.map((dependency: { method: string }) => dependency.method), ['addBackpackToCart']);
  const index = JSON.parse(readFileSync(join(FW, '.ai-memory', 'capabilities.json'), 'utf8'));
  assert.equal(index.$schema, 'reuse-capability-index/v2-sharded', 'the normal index remains its existing schema');
});