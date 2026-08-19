/**
 * diagnostics.test.ts — unit tests for the GENERIC dynamic-page failure diagnosis.
 * Runs with the Node built-in test runner via tsx: `npm test`.
 *
 * These cover WHY an SPA feature form can be absent after the bounded readiness settler gives up,
 * using ONLY the real, verified `@playwright/cli` DevTools output shapes (captured live from the
 * installed CLI): `console`, `network`, and `eval`. No real browser is used — parsers are pure and
 * the collector is exercised with a stubbed CLI session. Everything is application-agnostic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConsoleOutput,
  parseNetworkOutput,
  extractEvalResult,
  parsePageState,
  redactUrl,
  summarizeRequest,
  classifyFailure,
  formatDiagnosticsReport,
  collectPageDiagnostics,
  type PageDiagnostics,
  type CliRunner,
} from '../page-diagnostics';

/* ── Real CLI output samples (captured from playwright-cli v0.1.3) ────────────── */

const CONSOLE_TWO = [
  '### Result',
  'Total messages: 2 (Errors: 1, Warnings: 1)',
  '',
  '[ERROR] DIAG_ERR alpha 42 @ :0',
  '[WARNING] DIAG_WARN beta @ :0',
].join('\n');

const CONSOLE_ZERO = ['### Result', 'Total messages: 0 (Errors: 0, Warnings: 0)', ''].join('\n');

const NETWORK_MIX = [
  '### Result',
  '[GET] https://host/web/index.php/core/i18n/messages => [200] OK',
  '[POST] https://host/api/v2/leave/leave-balance => [500] Internal Server Error',
  '[GET] https://host/api/v2/leave/leave-types => [404] Not Found',
  '[GET] https://host/img/logo.png => [failed] net::ERR_ABORTED',
].join('\n');

const EVAL_APPLY_LEAVE = [
  '### Result',
  '{',
  '  "title": "OrangeHRM",',
  '  "url": "https://host/web/index.php/leave/applyLeave",',
  '  "readyState": "complete",',
  '  "headings": ["Apply Leave"],',
  '  "inputs": 1,',
  '  "formControls": 20,',
  '  "iframes": [],',
  '  "alerts": ["No Leave Types with the leave balance are available for applying"],',
  '  "visibleText": "Apply Leave No Leave Types with the leave balance are available for applying"',
  '}',
  '### Ran Playwright code',
  '```js',
  "await page.evaluate('() => …');",
  '```',
  '### Page',
  '- Page URL: https://host/web/index.php/leave/applyLeave',
].join('\n');

/* ── console parsing ─────────────────────────────────────────────────────────── */

test('parseConsoleOutput: parses the summary + individual messages', () => {
  const r = parseConsoleOutput(CONSOLE_TWO);
  assert.equal(r.available, true);
  assert.equal(r.total, 2);
  assert.equal(r.errors, 1);
  assert.equal(r.warnings, 1);
  assert.equal(r.messages.length, 2);
  assert.equal(r.messages[0].level, 'ERROR');
  assert.equal(r.messages[0].text, 'DIAG_ERR alpha 42');
  assert.equal(r.messages[0].location, ':0');
  assert.equal(r.messages[1].level, 'WARNING');
  assert.equal(r.messages[1].text, 'DIAG_WARN beta');
});

test('parseConsoleOutput: zero-message page is available with no errors', () => {
  const r = parseConsoleOutput(CONSOLE_ZERO);
  assert.equal(r.available, true);
  assert.equal(r.errors, 0);
  assert.equal(r.warnings, 0);
  assert.equal(r.messages.length, 0);
});

test('parseConsoleOutput: empty / CLI-error output is flagged unavailable', () => {
  assert.equal(parseConsoleOutput('').available, false);
  assert.equal(parseConsoleOutput('__CLI_ERROR__ spawn ENOENT').available, false);
  assert.equal(parseConsoleOutput('').errors, 0);
});

/* ── network parsing ─────────────────────────────────────────────────────────── */

test('parseNetworkOutput: parses method/url/status and flags failures', () => {
  const rows = parseNetworkOutput(NETWORK_MIX);
  assert.equal(rows.length, 4);

  assert.equal(rows[0].status, 200);
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].failed, false);

  assert.equal(rows[1].method, 'POST');
  assert.equal(rows[1].status, 500);
  assert.equal(rows[1].failed, true);
  assert.equal(rows[1].resourceType, 'xhr/fetch');
  assert.match(rows[1].statusText, /Internal Server Error/);

  assert.equal(rows[2].status, 404);
  assert.equal(rows[2].failed, true);

  assert.equal(rows[3].status, null); // aborted → no HTTP status
  assert.equal(rows[3].failed, true);
  assert.equal(rows[3].resourceType, 'static');
  assert.match(rows[3].statusText, /ERR_ABORTED/);
});

test('summarizeRequest: compact, redacted one-liner', () => {
  const rows = parseNetworkOutput(NETWORK_MIX);
  const s = summarizeRequest(rows[1]);
  assert.match(s, /^POST https:\/\/host\/api\/v2\/leave\/leave-balance \[500\] xhr\/fetch — Internal Server Error$/);
});

/* ── eval / page-state parsing ──────────────────────────────────────────────── */

test('extractEvalResult: pulls the JSON body out of the ### Result block', () => {
  const body = extractEvalResult(EVAL_APPLY_LEAVE);
  assert.match(body, /^\{[\s\S]*\}$/);
  assert.doesNotMatch(body, /Ran Playwright code/);
});

test('parsePageState: parses the generic page probe JSON', () => {
  const p = parsePageState(EVAL_APPLY_LEAVE);
  assert.equal(p.available, true);
  assert.equal(p.title, 'OrangeHRM');
  assert.equal(p.readyState, 'complete');
  assert.equal(p.inputs, 1);
  assert.equal(p.formControls, 20);
  assert.deepEqual(p.headings, ['Apply Leave']);
  assert.equal(p.alerts.length, 1);
  assert.match(p.alerts[0], /No Leave Types/);
  assert.equal(p.iframes.length, 0);
});

test('parsePageState: tolerates an eval result returned as a quoted JSON string', () => {
  const quoted = '### Result\n' + JSON.stringify(JSON.stringify({ title: 'X', inputs: 3, url: 'https://x/y' }));
  const p = parsePageState(quoted);
  assert.equal(p.title, 'X');
  assert.equal(p.inputs, 3);
  assert.equal(p.url, 'https://x/y');
});

test('parsePageState: empty / unavailable output degrades cleanly', () => {
  const p = parsePageState('');
  assert.equal(p.available, false);
  assert.equal(p.inputs, 0);
});

/* ── url redaction ───────────────────────────────────────────────────────────── */

test('redactUrl: strips userinfo + sensitive query values, keeps benign params', () => {
  const out = redactUrl('https://user:pass@host/x?token=abc&q=1&access_token=zzz');
  assert.doesNotMatch(out, /user|pass|abc|zzz/);
  assert.match(out, /q=1/);
  assert.match(out, /token=REDACTED/);
  assert.match(out, /access_token=REDACTED/);
});

test('redactUrl: best-effort redaction for non-parseable urls', () => {
  const out = redactUrl('//u:p@host/cb?code=SECRET123&keep=1');
  assert.doesNotMatch(out, /u:p@/);
  assert.match(out, /code=REDACTED/);
  assert.match(out, /keep=1/);
});

/* ── classifier ──────────────────────────────────────────────────────────────── */

function mkDiag(over: Partial<PageDiagnostics> = {}): PageDiagnostics {
  const base: PageDiagnostics = {
    url: 'https://host/feature',
    title: 'App',
    readyState: 'complete',
    console: { total: 0, errors: 0, warnings: 0, messages: [], available: true },
    network: { total: 0, failed: [], all: [], available: true },
    page: { title: 'App', url: 'https://host/feature', readyState: 'complete', headings: [], inputs: 0, formControls: 0, iframes: [], alerts: [], visibleText: '', available: true },
    a11y: { interactable: 45, featureFields: 0, heading: 'Leave' },
    screenshotPath: 'blast-readiness-x.png',
  };
  return {
    ...base,
    ...over,
    console: { ...base.console, ...(over.console || {}) },
    network: { ...base.network, ...(over.network || {}) },
    page: { ...base.page, ...(over.page || {}) },
    a11y: { ...base.a11y, ...(over.a11y || {}) },
  };
}

test('classifyFailure: console errors → application-error', () => {
  const d = mkDiag({ console: { total: 1, errors: 1, warnings: 0, messages: [{ level: 'ERROR', text: 'Boom x is not a function' }], available: true } });
  const diag = classifyFailure(d);
  assert.equal(diag.category, 'application-error');
  assert.match(diag.headline, /console error/i);
});

test('classifyFailure: failed network request → application-error', () => {
  const failed = parseNetworkOutput(NETWORK_MIX).filter((r) => r.failed);
  const d = mkDiag({ network: { total: 4, failed, all: parseNetworkOutput(NETWORK_MIX), available: true } });
  const diag = classifyFailure(d);
  assert.equal(diag.category, 'application-error');
  assert.ok(diag.evidence.some((e) => /leave-balance/.test(e)));
});

test('classifyFailure: DOM has controls the a11y tree missed → snapshot-gap', () => {
  const d = mkDiag({ page: { ...mkDiag().page, inputs: 5, formControls: 9 }, a11y: { interactable: 45, featureFields: 0, heading: 'Leave' } });
  const diag = classifyFailure(d);
  assert.equal(diag.category, 'snapshot-gap');
  assert.match(diag.headline, /DOM contains/i);
});

test('classifyFailure: clean load, no form in DOM → feature-unavailable with the page message', () => {
  const d = mkDiag({ page: { ...mkDiag().page, inputs: 1, alerts: ['No Leave Types with the leave balance are available for applying'], visibleText: 'Apply Leave No Leave Types…' } });
  const diag = classifyFailure(d);
  assert.equal(diag.category, 'feature-unavailable');
  assert.match(diag.headline, /No Leave Types/);
});

test('classifyFailure: nothing conclusive → unknown', () => {
  const d = mkDiag({ page: { ...mkDiag().page, inputs: 1 } , a11y: { interactable: 45, featureFields: 0, heading: 'Leave' } });
  // inputs 1 falls into feature-unavailable; force the genuinely-ambiguous branch instead:
  const ambiguous = mkDiag({ page: { ...mkDiag().page, inputs: 3 }, a11y: { interactable: 45, featureFields: 3, heading: 'Leave' } });
  assert.equal(classifyFailure(ambiguous).category, 'unknown');
  assert.equal(classifyFailure(d).category, 'feature-unavailable');
});

test('classifyFailure: post-submit page with no form + arrivedViaSubmit → feature-completed-via-redirect', () => {
  const d = mkDiag({ arrivedViaSubmit: true, page: { ...mkDiag().page, inputs: 0, headings: ['Checkout: Overview'], visibleText: 'Payment Information: SauceCard #31337' } });
  const diag = classifyFailure(d);
  assert.equal(diag.category, 'feature-completed-via-redirect');
  assert.match(diag.headline, /post-submit/i);
});

test('classifyFailure: no-form page WITHOUT arrivedViaSubmit stays feature-unavailable', () => {
  const d = mkDiag({ arrivedViaSubmit: false, page: { ...mkDiag().page, inputs: 0, headings: ['Checkout: Overview'] } });
  assert.equal(classifyFailure(d).category, 'feature-unavailable');
});

/* ── report formatting ───────────────────────────────────────────────────────── */

test('formatDiagnosticsReport: includes category, redacted url, and failed requests', () => {
  const failed = parseNetworkOutput(NETWORK_MIX).filter((r) => r.failed);
  const d = mkDiag({
    url: 'https://host/feature?token=SECRET',
    network: { total: 4, failed, all: parseNetworkOutput(NETWORK_MIX), available: true },
  });
  const report = formatDiagnosticsReport(d, classifyFailure(d));
  assert.match(report, /Root cause category: application-error/);
  assert.match(report, /token=REDACTED/);
  assert.doesNotMatch(report, /token=SECRET/);
  assert.match(report, /leave-balance \[500\]/);
  assert.match(report, /Screenshot: blast-readiness-x\.png/);
});

/* ── collector (stubbed CLI session — no real browser) ───────────────────────── */

function stubSession(map: Record<string, string>): CliRunner & { calls: string[] } {
  return {
    calls: [] as string[],
    run(args: string[]): Promise<string> {
      this.calls.push(args.join(' '));
      return Promise.resolve(map[args[0]] ?? '');
    },
  };
}

test('collectPageDiagnostics: aggregates console + network + eval from the CLI', async () => {
  const session = stubSession({ console: CONSOLE_TWO, network: NETWORK_MIX, eval: EVAL_APPLY_LEAVE });
  const pd = await collectPageDiagnostics(session, { url: 'https://fallback/x', screenshotPath: 'shot.png', a11yInteractable: 45, a11yFields: 0, a11yHeading: 'Leave' });

  assert.equal(pd.console.errors, 1);
  assert.equal(pd.network.total, 4);
  assert.equal(pd.network.failed.length, 3);
  assert.equal(pd.page.inputs, 1);
  assert.equal(pd.url, 'https://host/web/index.php/leave/applyLeave'); // eval url wins over fallback
  assert.equal(pd.screenshotPath, 'shot.png');
  assert.equal(pd.a11y.featureFields, 0);
  // classify end-to-end: a failing API is the root cause here.
  assert.equal(classifyFailure(pd).category, 'application-error');
});

test('collectPageDiagnostics: a missing CLI channel degrades to unavailable, others still report', async () => {
  const session = stubSession({ console: '', network: '', eval: EVAL_APPLY_LEAVE });
  const pd = await collectPageDiagnostics(session, { url: 'https://fallback/x' });
  assert.equal(pd.console.available, false);
  assert.equal(pd.network.available, false);
  assert.equal(pd.network.total, 0);
  assert.equal(pd.page.available, true);
  assert.equal(pd.page.inputs, 1);
  // no console errors + no failed network + inputs<2 → feature-unavailable (the page message).
  assert.equal(classifyFailure(pd).category, 'feature-unavailable');
});
