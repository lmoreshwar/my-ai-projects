const mod = require('../api/_tools/local_agent.js');

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + msg); if (!cond) failures++; };

// --- Test 1: parseCliRefs now captures the profile-menu toggle (img + named container) ---
const snap = [
  '- textbox "Username" [ref=e1]',
  '- button "Login" [ref=e2]',
  '- img "profile picture" [ref=e3]',
  '- paragraph "Manda User" [ref=e4]',
  '- generic [ref=e5]',                 // nameless generic → must stay filtered out
  '- heading "Dashboard" [ref=e6]',     // structural, no opener role → filtered
].join('\n');
const refs = mod.parseCliRefs(snap);
const byRef = Object.fromEntries(refs.map((r) => [r.ref, r]));
ok(!!byRef.e3, 'avatar img "profile picture" is now an interactable ref (menu opener)');
ok(!!byRef.e4, 'named container paragraph "Manda User" is captured (styled toggle)');
ok(!byRef.e5, 'nameless generic is still filtered out (no noise)');
ok(refs[0] && refs[0].ref === 'e1', 'standard controls sort FIRST (prio 0) so the cap never drops them');

// --- Test 2: mergeExisting lands a heal locator fix on a constructor-field page ---
// Baseline page (job start): only dashboardHeading exists → immutable.
const baseNames = new Set(['dashboardHeading']);
const current = `import { Page, Locator } from '@playwright/test';
export class DashboardPage {
  readonly dashboardHeading: Locator;
  readonly profileDropdown: Locator;
  constructor(page: Page) {
    this.dashboardHeading = page.getByRole('heading', { name: 'Dashboard' });
    this.profileDropdown = page.getByRole('button', { name: 'Profile Dropdown' });
  }
}
`;
// Heal corrects ONLY the this-run locator (profileDropdown), keeps baseline verbatim.
const next = `import { Page, Locator } from '@playwright/test';
export class DashboardPage {
  readonly dashboardHeading: Locator;
  readonly profileDropdown: Locator;
  constructor(page: Page) {
    this.dashboardHeading = page.getByRole('heading', { name: 'Dashboard' });
    this.profileDropdown = page.getByAltText('profile picture');
  }
}
`;
const merged = mod.mergeExisting(current, next, 'page', baseNames);
ok(merged !== null, 'heal fix is NOT discarded — merge produced a change (guard no longer traps it)');
ok(merged && merged.includes("getByAltText('profile picture')"), 'corrected profileDropdown locator landed');
ok(merged && merged.includes("page.getByRole('heading', { name: 'Dashboard' })"), 'baseline dashboardHeading kept verbatim');

// --- Test 3: mergeExisting must NEVER change a BASELINE locator (regression guard) ---
const baseAll = new Set(['dashboardHeading', 'profileDropdown']); // both baseline now → immutable
const merged2 = mod.mergeExisting(current, next, 'page', baseAll);
ok(merged2 === null, 'when the locator is baseline, its change is refused (no regression of existing tests)');

process.exit(failures ? 1 : 0);
