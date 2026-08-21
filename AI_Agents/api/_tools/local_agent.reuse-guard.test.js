'use strict';

/**
 * BLAST Runner — existing-artifact preservation gate.
 *
 * Locks the deterministic guard that stops the Runner (New Automation AND self-heal) from replacing
 * an existing reusable Page/Module/Fixture with a regeneration that drops its constructor wiring,
 * framework dependencies, or existing public API. This is the exact regression behind the failing
 * run where a regenerated LoginModule lost `this.actions = new Actions(page)` and every generated
 * Product Catalog / Sorting test crashed with:
 *     TypeError: Cannot read properties of undefined (reading 'navigate')
 *
 * Pure — no LLM, no network, no Playwright. writeFiles() cases use an isolated temp framework.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isDestructiveOverwrite,
  droppedConstructorWiring,
  constructorWiredDeps,
  writeFiles,
} = require('./local_agent');

// ── Fixtures ────────────────────────────────────────────────────────────────
const EXISTING_LOGIN_MODULE = `import { type Page } from '@playwright/test';
import { Actions } from '../utils/Actions';
import { Logger } from '../utils/Logger';
import { routes, urlFor } from '../config';
import { LoginPage } from '../pages/LoginPage';

export class LoginModule {
  private readonly page: Page;
  private readonly actions: Actions;
  private readonly logger = Logger.create('LoginModule');
  private readonly loginPage: LoginPage;

  constructor(page: Page) {
    this.page = page;
    this.actions = new Actions(page);
    this.loginPage = new LoginPage(page);
  }

  async goto(): Promise<void> {
    this.logger.info('Navigate to the login page');
    await this.actions.navigate(urlFor(routes.login), { readyElement: this.loginPage.usernameInput() });
  }

  async login(username: string, password: string): Promise<void> {
    await this.actions.fill(this.loginPage.usernameInput(), username);
    await this.actions.fill(this.loginPage.passwordInput(), password);
    await this.actions.click(this.loginPage.loginButton());
  }
}
`;

// Regenerated LoginModule that DROPS `this.actions = new Actions(page)` from the constructor
// while still calling `this.actions.navigate(...)` — the exact corruption to reject.
const BROKEN_LOGIN_REPLACEMENT = `import { type Page } from '@playwright/test';
import { Logger } from '../utils/Logger';
import { routes, urlFor } from '../config';
import { LoginPage } from '../pages/LoginPage';

export class LoginModule {
  private readonly page: Page;
  private readonly logger = Logger.create('LoginModule');
  private readonly loginPage: LoginPage;

  constructor(page: Page) {
    this.page = page;
    this.loginPage = new LoginPage(page);
  }

  async goto(): Promise<void> {
    this.logger.info('Navigate to the login page');
    await this.actions.navigate(urlFor(routes.login), { readyElement: this.loginPage.usernameInput() });
  }

  async login(username: string, password: string): Promise<void> {
    await this.actions.fill(this.loginPage.usernameInput(), username);
    await this.actions.fill(this.loginPage.passwordInput(), password);
    await this.actions.click(this.loginPage.loginButton());
  }
}
`;

// Additive regen: constructor + existing API intact, ADDS a new method. Must be allowed.
const ADDITIVE_LOGIN = EXISTING_LOGIN_MODULE.replace(
  /}\s*$/,
  `
  async logout(): Promise<void> {
    await this.actions.click(this.loginPage.loginButton());
  }
}
`,
);

const EXISTING_INVENTORY_PAGE = `import { type Page, type Locator } from '@playwright/test';

export class InventoryPage {
  private readonly page: Page;
  readonly cartLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.cartLink = page.getByRole('link', { name: 'Cart' });
  }

  addToCartButton = (): Locator => this.page.getByRole('button', { name: 'Add to cart' });
}
`;

const BROKEN_INVENTORY_PAGE = `import { type Page, type Locator } from '@playwright/test';

export class InventoryPage {
  readonly cartLink: Locator;

  constructor() {
    this.cartLink = this.page.getByRole('link', { name: 'Cart' });
  }

  addToCartButton = (): Locator => this.page.getByRole('button', { name: 'Add to cart' });
}
`;

const EXISTING_FIXTURES = `import { test as base } from '@playwright/test';
import { Actions } from '../utils/Actions';
import { WorkflowActions } from '../utils/WorkflowActions';

export type TestFixtures = {
    actions: Actions;
    workflowActions: WorkflowActions;
};

export const test = base.extend<TestFixtures>({
    actions: async ({ page }, use) => { await use(new Actions(page)); },
    workflowActions: async ({ page }, use) => { await use(new WorkflowActions(page)); },
});
export { expect } from '@playwright/test';
`;

const SHRUNK_FIXTURES = `import { test as base } from '@playwright/test';
export const test = base;
export { expect } from '@playwright/test';
`;

// ── Temp-framework helpers ───────────────────────────────────────────────────
function makeFramework() {
  const fw = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-reuse-'));
  for (const sub of ['src/pages', 'src/modules', 'src/fixtures', 'src/tests']) {
    fs.mkdirSync(path.join(fw, sub), { recursive: true });
  }
  return fw;
}
function seed(fw, rel, content) {
  const abs = path.join(fw, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}
function read(fw, rel) {
  return fs.readFileSync(path.join(fw, rel), 'utf8');
}
function cleanup(fw) {
  try { fs.rmSync(fw, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Pure-function guard ──────────────────────────────────────────────────────
test('constructorWiredDeps captures this.X = … wiring from the constructor only', () => {
  const deps = constructorWiredDeps(EXISTING_LOGIN_MODULE);
  assert.ok(deps.has('actions'), 'actions must be detected as constructor-wired');
  assert.ok(deps.has('loginPage'), 'loginPage must be detected as constructor-wired');
});

test('droppedConstructorWiring flags a stripped, still-used dependency (this.actions)', () => {
  assert.deepStrictEqual(droppedConstructorWiring(EXISTING_LOGIN_MODULE, BROKEN_LOGIN_REPLACEMENT), ['actions']);
});

test('droppedConstructorWiring returns [] when the constructor wiring is preserved (additive)', () => {
  assert.deepStrictEqual(droppedConstructorWiring(EXISTING_LOGIN_MODULE, ADDITIVE_LOGIN), []);
});

test('#1 isDestructiveOverwrite REJECTS a LoginModule replacement that drops this.actions wiring', () => {
  assert.strictEqual(isDestructiveOverwrite(EXISTING_LOGIN_MODULE, BROKEN_LOGIN_REPLACEMENT, 'module'), true);
});

test('#2 isDestructiveOverwrite ALLOWS an additive LoginModule regen (constructor + API intact)', () => {
  assert.strictEqual(isDestructiveOverwrite(EXISTING_LOGIN_MODULE, ADDITIVE_LOGIN, 'module'), false);
});

test('#5 isDestructiveOverwrite REJECTS a Page regen that drops its constructor page wiring', () => {
  assert.strictEqual(isDestructiveOverwrite(EXISTING_INVENTORY_PAGE, BROKEN_INVENTORY_PAGE, 'page'), true);
});

// ── writeFiles integration (the write path all 3 sites share) ────────────────
test('#1 (write) existing LoginModule + destructive replacement => existing constructor preserved', () => {
  const fw = makeFramework();
  try {
    seed(fw, 'src/modules/LoginModule.ts', EXISTING_LOGIN_MODULE);
    const baselines = { 'src/modules/LoginModule.ts': new Set(['goto', 'login']) };
    const res = writeFiles(fw, [{ rel: 'src/modules/LoginModule.ts', layer: 'module', content: BROKEN_LOGIN_REPLACEMENT }], baselines);
    const after = read(fw, 'src/modules/LoginModule.ts');
    assert.match(after, /this\.actions = new Actions\(page\)/, 'constructor wiring must survive');
    assert.match(after, /this\.actions\.navigate/, 'goto still uses this.actions (now safely wired)');
    const rec = res.written.find((w) => w.path === 'src/modules/LoginModule.ts');
    assert.ok(rec && rec.reused === true, 'destructive replacement must be preserved, not overwritten verbatim');
  } finally { cleanup(fw); }
});

test('regression: the exact "Cannot read properties of undefined (reading \'navigate\')" cannot recur', () => {
  const fw = makeFramework();
  try {
    seed(fw, 'src/modules/LoginModule.ts', EXISTING_LOGIN_MODULE);
    writeFiles(fw, [{ rel: 'src/modules/LoginModule.ts', layer: 'module', content: BROKEN_LOGIN_REPLACEMENT }], {});
    const after = read(fw, 'src/modules/LoginModule.ts');
    // The only way goto() crashes is `this.actions` being undefined — assert it is wired.
    assert.match(after, /constructor\s*\(page: Page\)[\s\S]*this\.actions = new Actions\(page\)/,
      'this.actions must be initialized in the constructor so navigate() never reads undefined');
  } finally { cleanup(fw); }
});

test('#6 self-heal cannot overwrite an existing reusable module (2nd write preserves wiring)', () => {
  const fw = makeFramework();
  try {
    // Round 1: module created this run (no baseline).
    writeFiles(fw, [{ rel: 'src/modules/LoginModule.ts', layer: 'module', content: EXISTING_LOGIN_MODULE }], {});
    assert.match(read(fw, 'src/modules/LoginModule.ts'), /this\.actions = new Actions\(page\)/);
    // Round 2 (self-heal): re-emits a broken replacement — must be rejected, wiring kept.
    writeFiles(fw, [{ rel: 'src/modules/LoginModule.ts', layer: 'module', content: BROKEN_LOGIN_REPLACEMENT }], {});
    assert.match(read(fw, 'src/modules/LoginModule.ts'), /this\.actions = new Actions\(page\)/,
      'self-heal must not strip the constructor wiring of a module created earlier this run');
  } finally { cleanup(fw); }
});

test('#2 (write) existing LoginModule + additive method => safe merge lands the new method', () => {
  const fw = makeFramework();
  try {
    seed(fw, 'src/modules/LoginModule.ts', EXISTING_LOGIN_MODULE);
    const baselines = { 'src/modules/LoginModule.ts': new Set(['goto', 'login']) };
    writeFiles(fw, [{ rel: 'src/modules/LoginModule.ts', layer: 'module', content: ADDITIVE_LOGIN }], baselines);
    const after = read(fw, 'src/modules/LoginModule.ts');
    assert.match(after, /this\.actions = new Actions\(page\)/, 'constructor wiring preserved');
    assert.match(after, /async logout\(\)/, 'new method merged in');
    assert.match(after, /async goto\(\)/, 'existing API preserved');
  } finally { cleanup(fw); }
});

test('#3 existing fixture (fixtures/index.ts) is never overwritten by a shrinking regen', () => {
  const fw = makeFramework();
  try {
    seed(fw, 'src/fixtures/index.ts', EXISTING_FIXTURES);
    writeFiles(fw, [{ rel: 'src/fixtures/index.ts', layer: 'fixture', content: SHRUNK_FIXTURES }], {});
    const after = read(fw, 'src/fixtures/index.ts');
    assert.match(after, /workflowActions: async/, 'existing fixtures must be preserved');
    assert.match(after, /actions: async/, 'existing fixtures must be preserved');
  } finally { cleanup(fw); }
});

test('#4 existing Page Object is never overwritten by a destructive regen', () => {
  const fw = makeFramework();
  try {
    seed(fw, 'src/pages/InventoryPage.ts', EXISTING_INVENTORY_PAGE);
    const baselines = { 'src/pages/InventoryPage.ts': new Set(['cartLink', 'addToCartButton']) };
    writeFiles(fw, [{ rel: 'src/pages/InventoryPage.ts', layer: 'page', content: BROKEN_INVENTORY_PAGE }], baselines);
    const after = read(fw, 'src/pages/InventoryPage.ts');
    assert.match(after, /this\.page = page/, 'page wiring preserved');
    assert.match(after, /this\.cartLink = page\.getByRole/, 'existing locator wiring preserved');
  } finally { cleanup(fw); }
});

test('#7 a brand-new module that does not exist yet is allowed (created)', () => {
  const fw = makeFramework();
  try {
    const res = writeFiles(fw, [{ rel: 'src/modules/CartModule.ts', layer: 'module', content: EXISTING_LOGIN_MODULE.replace(/LoginModule/g, 'CartModule') }], {});
    const rec = res.written.find((w) => w.path === 'src/modules/CartModule.ts');
    assert.ok(rec && rec.action === 'created', 'a new module must be created');
    assert.ok(fs.existsSync(path.join(fw, 'src/modules/CartModule.ts')));
  } finally { cleanup(fw); }
});

test('#8 an identical re-emit of an existing module is reused untouched (no churn)', () => {
  const fw = makeFramework();
  try {
    seed(fw, 'src/modules/LoginModule.ts', EXISTING_LOGIN_MODULE);
    const res = writeFiles(fw, [{ rel: 'src/modules/LoginModule.ts', layer: 'module', content: EXISTING_LOGIN_MODULE }], { 'src/modules/LoginModule.ts': new Set(['goto', 'login']) });
    const rec = res.written.find((w) => w.path === 'src/modules/LoginModule.ts');
    assert.ok(rec && rec.reused === true && rec.action === 'reused');
  } finally { cleanup(fw); }
});
