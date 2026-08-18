/**
 * readiness.test.ts — unit tests for the post-navigation content-readiness settler.
 * Runs with the Node built-in test runner via tsx: `npm test`.
 *
 * These cover the fix for a client-rendered SPA (e.g. OrangeHRM) that paints its shell (sidebar +
 * topbar navigation) synchronously but hydrates the feature form a moment later — so a single
 * immediate snapshot races hydration and captures shell-only. `classifyReadiness` distinguishes
 * application shell/navigation from real feature content by a11y ROLE (never app-specific locators),
 * and `settleForContent` re-snapshots, briefly and boundedly, until content appears. No real browser
 * or real sleeps are used — the runner is stubbed and `sleep` is a no-op.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReadiness, settleForContent, buildReadinessDiagnostics, type SnapshotRunner } from '../agent-loop';

// OrangeHRM-style authenticated SHELL: sidebar menu (links/menuitems) + a menu search box, NO form.
const SHELL_ONLY_SNAPSHOT = `
- navigation "Sidepanel":
  - searchbox "Search" [ref=e10]
  - link "Admin" [ref=e11]
  - link "PIM" [ref=e12]
  - link "Leave" [ref=e13]
  - link "Time" [ref=e14]
  - link "Recruitment" [ref=e15]
  - menuitem "My Info" [ref=e16]
  - menuitem "Performance" [ref=e17]
  - menuitem "Dashboard" [ref=e18]
  - menuitem "Directory" [ref=e19]
- banner:
  - button "User" [ref=e20]
`.trim();

// Apply Leave FORM hydrated: Leave Type combobox, date textboxes, comments, Apply button.
const FEATURE_FORM_SNAPSHOT = `
- heading "Apply Leave" [level=5]
- text: Leave Type*
- combobox [ref=e40]: "-- Select --"
- text: From Date*
- textbox "From" [ref=e41]
- text: To Date*
- textbox "To" [ref=e42]
- text: Comments
- textbox [ref=e43]
- button "Apply" [ref=e44]
`.trim();

// A data/list screen: a results grid, no form fields.
const DATA_TABLE_SNAPSHOT = `
- heading "Leave List" [level=5]
- table:
  - row "Date Employee Type Status":
    - columnheader "Date" [ref=e50]
    - columnheader "Employee" [ref=e51]
  - row "2026-01-01 John Annual Approved" [ref=e52]
`.trim();

// Still loading — a progressbar/spinner over the shell, no feature content yet.
const LOADING_SNAPSHOT = `
- navigation "Sidepanel":
  - link "Leave" [ref=e13]
- progressbar "Loading" [ref=e60]
`.trim();

// Wrap a raw a11y tree the way @playwright/cli emits it, so extractYaml() recovers it.
const asCliOutput = (tree: string): string => '```yaml\n' + tree + '\n```';

test('classifyReadiness: shell-only (nav + lone menu search) is NOT ready', () => {
  const v = classifyReadiness(SHELL_ONLY_SNAPSHOT);
  assert.equal(v.ready, false);
  assert.equal(v.strongField, false);
  assert.equal(v.dataRegion, false);
  assert.equal(v.actionButton, false);
  assert.ok(v.navControls >= 5, `expected several nav controls, got ${v.navControls}`);
  assert.match(v.reason, /shell|navigation/i);
});

test('classifyReadiness: hydrated feature form IS ready (combobox + Apply button)', () => {
  const v = classifyReadiness(FEATURE_FORM_SNAPSHOT);
  assert.equal(v.ready, true);
  assert.equal(v.strongField, true); // the Leave Type combobox
  assert.equal(v.actionButton, true); // the "Apply" button
  assert.ok(v.featureFields >= 3, `expected several fields, got ${v.featureFields}`);
});

test('classifyReadiness: data/list screen IS ready via the results table', () => {
  const v = classifyReadiness(DATA_TABLE_SNAPSHOT);
  assert.equal(v.ready, true);
  assert.equal(v.dataRegion, true);
});

test('classifyReadiness: a lone searchbox (the menu filter) is NOT feature content', () => {
  const v = classifyReadiness('- searchbox "Search" [ref=e10]\n- link "Leave" [ref=e13]');
  assert.equal(v.ready, false);
  assert.equal(v.featureFields, 1);
});

test('classifyReadiness: a login form (two textboxes) IS ready', () => {
  const v = classifyReadiness('- textbox "Username" [ref=e1]\n- textbox "Password" [ref=e2]\n- button "Login" [ref=e3]');
  assert.equal(v.ready, true);
  assert.equal(v.featureFields, 2);
});

test('classifyReadiness: loading indicator is flagged and not ready', () => {
  const v = classifyReadiness(LOADING_SNAPSHOT);
  assert.equal(v.ready, false);
  assert.equal(v.loading, true);
  assert.match(v.reason, /loading/i);
});

test('classifyReadiness: empty snapshot is not ready', () => {
  const v = classifyReadiness('');
  assert.equal(v.ready, false);
  assert.equal(v.interactable, 0);
});

// A fake runner that returns a scripted sequence of snapshot outputs (no real browser).
function fakeRunner(sequence: string[]): SnapshotRunner & { calls: number } {
  const runner = {
    calls: 0,
    run(args: string[]): Promise<string> {
      // Non-snapshot calls (e.g. the diagnostics screenshot) just resolve empty.
      if (args[0] !== 'snapshot') return Promise.resolve('');
      const out = sequence[Math.min(runner.calls, sequence.length - 1)];
      runner.calls += 1;
      return Promise.resolve(asCliOutput(out));
    },
  };
  return runner;
}

const noSleep = (): Promise<void> => Promise.resolve();

test('settleForContent: returns immediately when the first snapshot already has content', async () => {
  const runner = fakeRunner([FEATURE_FORM_SNAPSHOT]);
  const res = await settleForContent(runner, { sleep: noSleep });
  assert.equal(res.settled, true);
  assert.equal(res.attempts, 1);
  assert.equal(runner.calls, 1);
  assert.equal(res.verdict.ready, true);
});

test('settleForContent: re-snapshots through shell-only frames until the form hydrates', async () => {
  const runner = fakeRunner([SHELL_ONLY_SNAPSHOT, SHELL_ONLY_SNAPSHOT, FEATURE_FORM_SNAPSHOT]);
  const res = await settleForContent(runner, { sleep: noSleep, maxAttempts: 6 });
  assert.equal(res.settled, true);
  assert.equal(res.attempts, 3);
  assert.equal(res.verdict.ready, true);
});

test('settleForContent: stays bounded and reports not-settled when content never appears', async () => {
  const runner = fakeRunner([SHELL_ONLY_SNAPSHOT]);
  const res = await settleForContent(runner, { sleep: noSleep, maxAttempts: 4 });
  assert.equal(res.settled, false);
  assert.equal(res.attempts, 4);
  assert.equal(runner.calls, 4);

  const diag = buildReadinessDiagnostics(res.snapshot, 'https://app/leave/applyLeave', res.verdict, res.attempts);
  assert.equal(diag.attempts, 4);
  assert.equal(diag.url, 'https://app/leave/applyLeave');
  assert.match(diag.reason, /shell|navigation/i);
  assert.ok(diag.navControls >= 5, `expected several nav controls in diagnostics, got ${diag.navControls}`);
});
