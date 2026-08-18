const path = require('path');
const fs = require('fs');
const os = require('os');

// Build a throwaway framework dir with a constructor-field page that DECLARES two Locator
// fields but forgot to initialize them (the exact TS2564 bug from the OrangeHRM run).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-fieldinit-'));
fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });

const dashboardPage = `import { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly dashboardHeading: Locator;
  readonly profileMenuButton: Locator;

  readonly logoutButton: Locator;

  constructor(page: Page) {
    this.dashboardHeading = page.getByRole('heading', { name: 'Dashboard' });
  }
}
`;
fs.writeFileSync(path.join(root, 'src', 'pages', 'DashboardPage.ts'), dashboardPage);

// getter-style page: no field decls at all → should be left untouched.
const loginPage = `import { Page, Locator } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}
  username = (): Locator => this.page.getByRole('textbox', { name: 'Username' });
}
`;
fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'pages', 'LoginPage.ts'), loginPage);

// Temporarily expose the pass.
const mod = require('../api/_tools/local_agent.js');
if (!mod.ensurePageFieldsInitialized) {
  console.log('SKIP: helper not exported'); process.exit(2);
}

const written = [
  { path: 'src/pages/DashboardPage.ts', layer: 'page' },
  { path: 'src/pages/LoginPage.ts', layer: 'page' },
];
// Evidence: profileMenuButton has a proven role+name; logoutButton falls back to inference.
const evidence = [
  { role: 'button', name: 'Profile menu' },
  { role: 'menuitem', name: 'Logout' },
];

const res = mod.ensurePageFieldsInitialized(root, written, evidence);
const out = fs.readFileSync(path.join(root, 'src', 'pages', 'DashboardPage.ts'), 'utf8');
console.log('=== DashboardPage after ===\n' + out);

const hasProfileInit = /this\.profileMenuButton\s*=/.test(out);
const hasLogoutInit = /this\.logoutButton\s*=/.test(out);
const headingUntouched = (out.match(/this\.dashboardHeading\s*=/g) || []).length === 1;
const loginOut = fs.readFileSync(path.join(root, 'src', 'pages', 'LoginPage.ts'), 'utf8');
const loginUntouched = loginOut === loginPage;

// idempotence: run again → no further change
const res2 = mod.ensurePageFieldsInitialized(root, written, evidence);
const out2 = fs.readFileSync(path.join(root, 'src', 'pages', 'DashboardPage.ts'), 'utf8');
const idempotent = out2 === out && res2.changed === false;

fs.rmSync(root, { recursive: true, force: true });

const pass = res.changed && hasProfileInit && hasLogoutInit && headingUntouched && loginUntouched && idempotent;
console.log({ hasProfileInit, hasLogoutInit, headingUntouched, loginUntouched, idempotent });
console.log('RESULT:', pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
