/**
 * codegen-login-reuse.test.ts — the shared-login rule must REUSE an existing login module.
 *
 * Regression for the "every feature module re-implements goto()+login()" gap: the login-module detector
 * used to key off the FILENAME (/login/i), so an app-named auth module (e.g. SauceDemoModule) that
 * structurally IS the login entry (defines goto()+login()) was missed and codegen fell through to
 * "LOGIN FROM SCRATCH". These pin content-based detection + the real class name in the emitted rule.
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loginGuidanceFor } from '../codegen';

const makeFw = (): string => mkdtempSync(join(tmpdir(), 'blast-login-reuse-'));
const cleanup = (fw: string): void => rmSync(fw, { recursive: true, force: true });

function writeFile(fw: string, rel: string, content: string): void {
  const abs = join(fw, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** A module class that structurally IS the login entry: defines goto() + login(). */
const authModule = (className: string, loginParams = ''): string => `import { type Page } from '@playwright/test';
export class ${className} {
  constructor(private readonly page: Page) {}
  async goto(): Promise<void> { await this.page.goto('/login'); }
  async login(${loginParams}): Promise<void> { await this.page.click('#login'); }
}
`;

test('REUSES an app-named auth module (SauceDemoModule) detected by CONTENT, not filename', () => {
  const fw = makeFw();
  try {
    writeFile(fw, 'src/modules/SauceDemoModule.ts', authModule('SauceDemoModule'));
    writeFile(fw, 'src/modules/CartModule.ts', 'export class CartModule { async goto() {} }');
    const rule = loginGuidanceFor(fw);
    assert.match(rule, /REUSE the existing SauceDemoModule/);
    assert.match(rule, /new SauceDemoModule\(page\)/);
    assert.match(rule, /sauceDemoModule\.goto\(\) \+ sauceDemoModule\.login\(\)/);
    assert.match(rule, /import \{ SauceDemoModule \} from '\.\.\/modules\/SauceDemoModule'/);
    assert.doesNotMatch(rule, /LOGIN FROM SCRATCH/);
  } finally {
    cleanup(fw);
  }
});

test('login() with a credentials parameter is called with credentials("app")', () => {
  const fw = makeFw();
  try {
    writeFile(fw, 'src/modules/LoginModule.ts', authModule('LoginModule', 'creds: { username: string; password: string }'));
    const rule = loginGuidanceFor(fw);
    assert.match(rule, /new LoginModule\(page\)/);
    assert.match(rule, /loginModule\.login\(credentials\("app"\)\)/);
  } finally {
    cleanup(fw);
  }
});

test('a registered login FIXTURE takes precedence over instantiating the module', () => {
  const fw = makeFw();
  try {
    writeFile(fw, 'src/modules/SauceDemoModule.ts', authModule('SauceDemoModule'));
    writeFile(fw, 'src/fixtures/index.ts', "export const test = base.extend({\n  loginModule: async ({ page }, use) => { await use(new LoginModule(page)); },\n});\n");
    const rule = loginGuidanceFor(fw);
    assert.match(rule, /'loginModule' fixture IS registered/);
    assert.match(rule, /destructure it/);
    assert.doesNotMatch(rule, /new SauceDemoModule\(page\)/);
  } finally {
    cleanup(fw);
  }
});

test('a feature module with goto() but NO login() is NOT mistaken for the login entry', () => {
  const fw = makeFw();
  try {
    writeFile(fw, 'src/modules/InventoryModule.ts', 'export class InventoryModule { async goto(): Promise<void> {} async sortByName(): Promise<void> {} }');
    const rule = loginGuidanceFor(fw);
    assert.match(rule, /LOGIN FROM SCRATCH/);
    assert.doesNotMatch(rule, /REUSE the existing/);
  } finally {
    cleanup(fw);
  }
});

test('no modules at all → LOGIN FROM SCRATCH', () => {
  const fw = makeFw();
  try {
    const rule = loginGuidanceFor(fw);
    assert.match(rule, /LOGIN FROM SCRATCH/);
  } finally {
    cleanup(fw);
  }
});
