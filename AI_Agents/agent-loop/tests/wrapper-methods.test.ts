/**
 * wrapper-methods.test.ts — the FRAMEWORK-API anti-hallucination gate (assertWrapperMethodsExist).
 *
 * Reproduces the live BLAST failure: codegen emitted `this.actions.searchWithOptionalSubmit(...)`, but
 * searchWithOptionalSubmit is a WorkflowActions method — so it compiled (generated code runs transpile-only,
 * no type-check) and only crashed at RUNTIME with "… is not a function". These tests prove the gate reads
 * the ACTUAL wrapper sources, rejects a method called on the wrong (or no) wrapper with the correct repair
 * hint, and never false-positives on non-wrapper calls (this.page, Page objects, Module self-calls).
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertWrapperMethodsExist } from '../codegen';

/* ── A throwaway framework whose src/utils/* wrapper sources drive the gate ─────────────── */

// Actions exposes primitive interactions only. `resolveTarget` is PRIVATE and `toIsoDate` is STATIC —
// neither may be called via this.actions, so the gate must exclude both from the allowed set.
const ACTIONS_SRC = `
import { Page } from '@playwright/test';
export class Actions {
  constructor(private page: Page) {}
  async navigate(url: string): Promise<void> {}
  async click(target: string): Promise<void> {}
  async fill(target: string, value: string): Promise<void> {}
  async type(target: string, text: string): Promise<void> {}
  async waitForVisible(target: string): Promise<void> {}
  async selectOption(target: string, value: string): Promise<void> {}
  private resolveTarget(target: string): string { return target; }
  static toIsoDate(date: Date): string { return ''; }
}
`.trim();

// The shared workflow helpers live HERE, not on Actions — this is the crux of the misattribution bug.
const WORKFLOW_ACTIONS_SRC = `
import { Page } from '@playwright/test';
export class WorkflowActions {
  constructor(private page: Page) {}
  async searchWithOptionalSubmit(input: string, value: string, submit?: string): Promise<void> {}
  async selectDropdownOption(trigger: string, optionText: string): Promise<void> {}
  async setCheckbox(target: string, checked: boolean): Promise<void> {}
  private toLocator(target: string): string { return target; }
}
`.trim();

const LOGGER_SRC = `
export class Logger {
  constructor(private context: string) {}
  static create(context: string): Logger { return new Logger(context); }
  info(message: string): void {}
  step(stepNumber: number, description: string): void {}
  warn(message: string): void {}
  error(message: string): void {}
}
`.trim();

const WAIT_HELPER_SRC = `
import { Page } from '@playwright/test';
export class WaitHelper {
  constructor(private page: Page) {}
  async waitForLoader(): Promise<void> {}
  async waitForVisible(locator: string): Promise<void> {}
  private isLoaderVisible(): Promise<boolean> { return Promise.resolve(false); }
}
`.trim();

let FW = '';
let EMPTY_FW = '';

before(() => {
  FW = mkdtempSync(join(tmpdir(), 'blast-wrappers-'));
  mkdirSync(join(FW, 'src', 'utils'), { recursive: true });
  writeFileSync(join(FW, 'src', 'utils', 'Actions.ts'), ACTIONS_SRC);
  writeFileSync(join(FW, 'src', 'utils', 'WorkflowActions.ts'), WORKFLOW_ACTIONS_SRC);
  writeFileSync(join(FW, 'src', 'utils', 'Logger.ts'), LOGGER_SRC);
  writeFileSync(join(FW, 'src', 'utils', 'WaitHelper.ts'), WAIT_HELPER_SRC);
  // A framework with NO wrapper utils — the gate must degrade to a no-op there.
  EMPTY_FW = mkdtempSync(join(tmpdir(), 'blast-empty-'));
});

after(() => {
  if (FW) rmSync(FW, { recursive: true, force: true });
  if (EMPTY_FW) rmSync(EMPTY_FW, { recursive: true, force: true });
});

/** A Module that constructs actions + logger (the standard shape) and runs `body` inside a method. */
function moduleWith(body: string): { file: string; content: string } {
  return {
    file: 'src/modules/SampleModule.ts',
    content: `
import { type Page } from '@playwright/test';
import { Actions } from '../utils/Actions';
import { WorkflowActions } from '../utils/WorkflowActions';
import { WaitHelper } from '../utils/WaitHelper';
import { Logger } from '../utils/Logger';
import { SamplePage } from '../pages/SamplePage';

export class SampleModule {
  private readonly actions: Actions;
  private readonly workflowActions: WorkflowActions;
  private readonly waitHelper: WaitHelper;
  private readonly samplePage: SamplePage;
  private readonly logger = Logger.create('SampleModule');

  constructor(private readonly page: Page) {
    this.actions = new Actions(page);
    this.workflowActions = new WorkflowActions(page);
    this.waitHelper = new WaitHelper(page);
    this.samplePage = new SamplePage(page);
  }

  async run(value: string): Promise<void> {
${body}
  }
}
`.trim(),
  };
}

/* ── 1. THE LIVE BUG: a WorkflowActions helper called on this.actions is rejected + redirected ─ */

test('rejects this.actions.searchWithOptionalSubmit and points to this.workflowActions', () => {
  const mod = moduleWith("    await this.actions.searchWithOptionalSubmit(this.samplePage.input, value);");
  assert.throws(
    () => assertWrapperMethodsExist(FW, [mod]),
    /does NOT exist on Actions[\s\S]*It exists on WorkflowActions[\s\S]*this\.workflowActions\.searchWithOptionalSubmit/,
  );
});

/* ── 2. A method that exists on NO wrapper is rejected as invent-a-util ─────────────────── */

test('rejects a method that exists on no wrapper', () => {
  const mod = moduleWith("    await this.actions.frobnicate(value);");
  assert.throws(
    () => assertWrapperMethodsExist(FW, [mod]),
    /"frobnicate" does NOT exist on Actions[\s\S]*No wrapper \(Actions, WorkflowActions, WaitHelper, Logger\) defines "frobnicate"/,
  );
});

/* ── 3. A nonexistent WorkflowActions method is rejected ────────────────────────────────── */

test('rejects a nonexistent WorkflowActions method', () => {
  const mod = moduleWith("    await this.workflowActions.pickMagically(value);");
  assert.throws(() => assertWrapperMethodsExist(FW, [mod]), /"pickMagically" does NOT exist on WorkflowActions/);
});

/* ── 4. A nonexistent Logger method is rejected ─────────────────────────────────────────── */

test('rejects a nonexistent Logger method', () => {
  const mod = moduleWith("    this.logger.trace(value);");
  assert.throws(() => assertWrapperMethodsExist(FW, [mod]), /"trace" does NOT exist on Logger/);
});

/* ── 5. A PRIVATE wrapper method may not be called (excluded from the allowed set) ───────── */

test('rejects a call to a private wrapper method', () => {
  const mod = moduleWith("    await this.actions.resolveTarget(value);");
  assert.throws(() => assertWrapperMethodsExist(FW, [mod]), /"resolveTarget" does NOT exist on Actions/);
});

/* ── 6. Valid calls on the CORRECT wrappers pass ────────────────────────────────────────── */

test('accepts valid methods called on their owning wrappers', () => {
  const mod = moduleWith([
    "    this.logger.step(1, 'do it');",
    "    await this.actions.fill(this.samplePage.input, value);",
    "    await this.workflowActions.searchWithOptionalSubmit(this.samplePage.input, value);",
    "    await this.workflowActions.selectDropdownOption(this.samplePage.trigger, value);",
    "    await this.waitHelper.waitForLoader();",
  ].join('\n'));
  assert.doesNotThrow(() => assertWrapperMethodsExist(FW, [mod]));
});

/* ── 7. The REPAIRED PimReports shape (Actions primitives + logger only) passes ──────────── */

test('accepts a Module that uses only Actions primitives + Logger', () => {
  const page = {
    file: 'src/pages/PimReportsPage.ts',
    content: `
import { type Locator, type Page } from '@playwright/test';
export class PimReportsPage {
  constructor(private readonly page: Page) {}
  readonly reportNameTextbox: Locator = this.page.getByRole('textbox', { name: 'Report Name' });
  readonly searchButton: Locator = this.page.getByRole('button', { name: 'Search' });
}
`.trim(),
  };
  const mod = {
    file: 'src/modules/PimReportsModule.ts',
    content: `
import { type Page } from '@playwright/test';
import { Actions } from '../utils/Actions';
import { Logger } from '../utils/Logger';
import { PimReportsPage } from '../pages/PimReportsPage';

export class PimReportsModule {
  private readonly actions: Actions;
  private readonly pimReportsPage: PimReportsPage;
  private readonly logger = Logger.create('PimReportsModule');

  constructor(private readonly page: Page) {
    this.actions = new Actions(page);
    this.pimReportsPage = new PimReportsPage(page);
  }

  async searchReport(reportName: string): Promise<void> {
    this.logger.step(2, 'Search for an employee report');
    await this.actions.fill(this.pimReportsPage.reportNameTextbox, reportName);
    await this.actions.click(this.pimReportsPage.searchButton);
  }
}
`.trim(),
  };
  assert.doesNotThrow(() => assertWrapperMethodsExist(FW, [page, mod]));
});

/* ── 8. Non-wrapper property/instance calls are ignored (no false positives) ─────────────── */

test('ignores this.page.*, Page-object getters, and Module-instance calls in a spec', () => {
  const spec = {
    file: 'src/tests/sample.spec.ts',
    content: `
import { test, expect } from '../fixtures';
import { SampleModule } from '../modules/SampleModule';
import { SamplePage } from '../pages/SamplePage';

test('[TC_001] sample @Regression', async ({ page }) => {
  const sampleModule = new SampleModule(page);
  await sampleModule.run('value');            // Module method — not a wrapper, must be ignored
  const samplePage = new SamplePage(page);
  await expect(samplePage.heading).toBeVisible();
  await page.goto('/x');                       // Playwright API — must be ignored
});
`.trim(),
  };
  // The Page object legitimately calls this.page.getByRole(...) — also not a wrapper call.
  const page = {
    file: 'src/pages/SamplePage.ts',
    content: `
import { type Locator, type Page } from '@playwright/test';
export class SamplePage {
  constructor(private readonly page: Page) {}
  readonly heading: Locator = this.page.getByRole('heading', { name: 'Sample' });
}
`.trim(),
  };
  assert.doesNotThrow(() => assertWrapperMethodsExist(FW, [page, spec]));
});

/* ── 9. A non-conventional property name is mapped from its constructor `new` and validated ─ */

test('maps a non-conventional property name from its constructor and validates against it', () => {
  const valid = {
    file: 'src/modules/AltModule.ts',
    content: `
import { type Page } from '@playwright/test';
import { WorkflowActions } from '../utils/WorkflowActions';
export class AltModule {
  private readonly wf: WorkflowActions;
  constructor(private readonly page: Page) { this.wf = new WorkflowActions(page); }
  async run(v: string): Promise<void> { await this.wf.searchWithOptionalSubmit('#in', v); }
}
`.trim(),
  };
  assert.doesNotThrow(() => assertWrapperMethodsExist(FW, [valid]));

  const invalid = {
    file: 'src/modules/AltModule.ts',
    content: valid.content.replace('searchWithOptionalSubmit', 'doesNotExistHere'),
  };
  assert.throws(() => assertWrapperMethodsExist(FW, [invalid]), /"doesNotExistHere" does NOT exist on WorkflowActions/);
});

/* ── 10. A framework exposing no wrapper utils is a safe no-op ───────────────────────────── */

test('is a no-op when the framework has no wrapper utils', () => {
  const mod = moduleWith("    await this.actions.anythingGoesHere(value);");
  assert.doesNotThrow(() => assertWrapperMethodsExist(EMPTY_FW, [mod]));
});
