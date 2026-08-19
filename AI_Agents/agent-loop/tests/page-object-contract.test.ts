/**
 * page-object-contract.test.ts — generated Module/Spec ↔ Page Object quality gate.
 *
 * Codegen runs transpile-only before its verify step, so an invented Page Object member can make it
 * all the way to CI. These tests lock the parser-based contract gate: it resolves imported Page
 * classes, checks every generated Module/Spec member access against public Page declarations, and
 * requires a newly generated, used locator to be copied from verified live evidence.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPageObjectContracts, locatorsEquivalent, normalizeLocatorExpression, type PageObjectArtifacts } from '../codegen';
import type { AgentStep } from '../agent-loop';

let FW = '';

before(() => {
  FW = mkdtempSync(join(tmpdir(), 'blast-page-contract-'));
});

after(() => {
  if (FW) rmSync(FW, { recursive: true, force: true });
});

function trace(locator: string): AgentStep[] {
  return [{ tool: 'click', args: {}, locator, result: '' }];
}

function artifacts(pageMembers: string, moduleMember: string, specMember: string): PageObjectArtifacts {
  return {
    page: {
      file: 'src/pages/SamplePage.ts',
      content: `
import { type Locator, type Page } from '@playwright/test';
export class SamplePage {
  constructor(private readonly page: Page) {}
${pageMembers}
}
`.trim(),
    },
    module: {
      file: 'src/modules/SampleModule.ts',
      content: `
import { type Page } from '@playwright/test';
import { SamplePage } from '../pages/SamplePage';
export class SampleModule {
  private readonly samplePage: SamplePage;
  constructor(page: Page) { this.samplePage = new SamplePage(page); }
  async run(): Promise<void> { await this.samplePage.${moduleMember}(); }
}
`.trim(),
    },
    spec: {
      file: 'src/tests/sample.spec.ts',
      content: `
import { test, expect } from '../fixtures';
import { SamplePage } from '../pages/SamplePage';
test('sample', async ({ page }) => {
  const samplePage = new SamplePage(page);
  await expect(samplePage.${specMember}()).toBeVisible();
});
`.trim(),
    },
  };
}

const HEADING = "  heading = (): Locator => this.page.getByRole('heading', { name: 'Sample' });";
const SAVE_BUTTON = "  saveButton = (): Locator => this.page.getByRole('button', { name: 'Save' });";

test('accepts valid Page Object property references from both the Module and Spec', () => {
  const generated = artifacts(HEADING, 'heading', 'heading');
  assert.doesNotThrow(() => assertPageObjectContracts(FW, generated, trace("getByRole('heading', { name: 'Sample' })")));
});

test('rejects a missing Spec Page Object property and lists the exact existing Page properties', () => {
  const generated = artifacts(HEADING, 'heading', 'missingButton');
  assert.throws(
    () => assertPageObjectContracts(FW, generated, trace("getByRole('heading', { name: 'Sample' })")),
    /samplePage\.missingButton[\s\S]*SamplePage\.missingButton[\s\S]*Existing SamplePage properties: heading[\s\S]*Do NOT invent a locator/,
  );
});

test('accepts a generated Page property only when its locator is copied from the verified trace', () => {
  const generated = artifacts(SAVE_BUTTON, 'saveButton', 'saveButton');
  assert.doesNotThrow(() => assertPageObjectContracts(FW, generated, trace("getByRole('button', { name: 'Save' })")));
});

test('rejects non-existent Page locators referenced by both a generated Module and Spec', () => {
  const generated = artifacts(HEADING, 'moduleOnlyButton', 'specOnlyButton');
  assert.throws(
    () => assertPageObjectContracts(FW, generated, trace("getByRole('heading', { name: 'Sample' })")),
    /this\.samplePage\.moduleOnlyButton[\s\S]*samplePage\.specOnlyButton/,
  );
});

test('rejects a generated Page locator whose declaration is not present in verified evidence', () => {
  const inferredButton = "  inferredButton = (): Locator => this.page.getByRole('button', { name: 'Invented' });";
  const generated = artifacts(inferredButton, 'inferredButton', 'inferredButton');
  assert.throws(
    () => assertPageObjectContracts(FW, generated, trace("getByRole('button', { name: 'Save' })")),
    /SamplePage\.inferredButton[\s\S]*not present in verified live evidence[\s\S]*Do NOT invent a locator/,
  );
});

test('rejects a generated Spec call to a Module method the imported Module does not declare', () => {
  const generated = artifacts(HEADING, 'heading', 'heading');
  generated.spec.content = `
import { test } from '../fixtures';
import { SampleModule } from '../modules/SampleModule';
test('sample', async ({ page }) => {
  const sampleModule = new SampleModule(page);
  await sampleModule.inventedWorkflow();
});
`.trim();
  assert.throws(
    () => assertPageObjectContracts(FW, generated, trace("getByRole('heading', { name: 'Sample' })")),
    /sampleModule\.inventedWorkflow[\s\S]*Existing SampleModule methods: run[\s\S]*Do NOT invent a Page locator/,
  );
});

test('rejects a generated Spec call whose Module method argument count is wrong', () => {
  const generated = artifacts(HEADING, 'heading', 'heading');
  generated.module.content = generated.module.content.replace('async run(): Promise<void>', 'async run(value: string): Promise<void>');
  generated.spec.content = `
import { test } from '../fixtures';
import { SampleModule } from '../modules/SampleModule';
test('sample', async ({ page }) => {
  const sampleModule = new SampleModule(page);
  await sampleModule.run();
});
`.trim();
  assert.throws(
    () => assertPageObjectContracts(FW, generated, trace("getByRole('heading', { name: 'Sample' })")),
    /sampleModule\.run\(\.\.\.\) passes 0 argument\(s\), but SampleModule\.run accepts 1/,
  );
});

/* ── Canonical locator equivalence: root prefix / await / action tail ignored, chain + args kept ── */

test('locator() equals page.locator() (root prefix is ignored)', () => {
  assert.ok(locatorsEquivalent(`locator('[data-test="checkout"]')`, `page.locator('[data-test="checkout"]')`));
});

test('getByRole() equals page.getByRole() (root prefix is ignored)', () => {
  assert.ok(locatorsEquivalent(`getByRole('button', { name: 'Continue' })`, `page.getByRole('button', { name: 'Continue' })`));
});

test('getByText() equals page.getByText()', () => {
  assert.ok(locatorsEquivalent(`getByText('Example', { exact: true })`, `page.getByText('Example', { exact: true })`));
});

test('getByLabel() equals page.getByLabel()', () => {
  assert.ok(locatorsEquivalent(`getByLabel('First Name')`, `page.getByLabel('First Name')`));
});

test('getByPlaceholder() equals page.getByPlaceholder()', () => {
  assert.ok(locatorsEquivalent(`getByPlaceholder('Email')`, `page.getByPlaceholder('Email')`));
});

test('an await prefix + action suffix + arrow wrapper are stripped before comparison', () => {
  assert.ok(locatorsEquivalent(
    `await page.locator('[data-test="firstName"]').fill('Avery');`,
    `(): Locator => this.page.locator('[data-test="firstName"]')`,
  ));
});

test('equivalent locator chains compare equal regardless of root/whitespace', () => {
  assert.ok(locatorsEquivalent(
    `getByText('$29.99', { exact: true }).locator('xpath=ancestor::div[1]').getByRole('button', { name: 'Add to cart' })`,
    `page.getByText('$29.99',{ exact: true }).locator('xpath=ancestor::div[1]').getByRole('button',{ name: 'Add to cart' })`,
  ));
});

test('rejects an invented broader selector (named getByRole vs bare locator)', () => {
  assert.ok(!locatorsEquivalent(`page.getByRole('button', { name: 'Continue' })`, `page.locator('button')`));
});

test('rejects a broadened/wildcarded selector', () => {
  assert.ok(!locatorsEquivalent(`page.locator('[data-test="checkout"]')`, `page.locator('[data-test="*"]')`));
});

test('rejects a changed selector value', () => {
  assert.ok(!locatorsEquivalent(`locator('[data-test="firstName"]')`, `locator('[data-test="lastName"]')`));
});

test('normalizeLocatorExpression yields empty for a non-locator expression', () => {
  assert.equal(normalizeLocatorExpression(`'/checkout'`), '');
  assert.equal(normalizeLocatorExpression(`credentials('app')`), '');
});

/* ── Gate-level regression: equivalent locator syntax must NOT be rejected as unverified ── */

test('gate accepts page.locator([data-test]) when evidence is an await+action locator (checkout regression)', () => {
  const member = `  checkoutButton = (): Locator => this.page.locator('[data-test="checkout"]');`;
  const generated = artifacts(member, 'checkoutButton', 'checkoutButton');
  assert.doesNotThrow(() => assertPageObjectContracts(
    FW, generated, trace(`await page.locator('[data-test="checkout"]').click();`),
  ));
});

test('gate accepts page.getByRole() when the verified evidence is a bare getByRole()', () => {
  const member = `  firstName = (): Locator => this.page.getByRole('textbox', { name: 'First Name' });`;
  const generated = artifacts(member, 'firstName', 'firstName');
  assert.doesNotThrow(() => assertPageObjectContracts(
    FW, generated, trace(`getByRole('textbox', { name: 'First Name' })`),
  ));
});

test('gate still rejects a broadened generated locator that is not in verified evidence', () => {
  const member = `  checkoutButton = (): Locator => this.page.locator('button');`;
  const generated = artifacts(member, 'checkoutButton', 'checkoutButton');
  assert.throws(
    () => assertPageObjectContracts(FW, generated, trace(`await page.locator('[data-test="checkout"]').click();`)),
    /not present in verified live evidence/,
  );
});
