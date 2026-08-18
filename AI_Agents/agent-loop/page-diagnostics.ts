/**
 * page-diagnostics.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * GENERIC "dynamic page failure diagnosis" for the agentic Explore loop.
 *
 * WHEN IT RUNS
 *   The bounded content-readiness settler (see agent-loop.ts) re-snapshots a
 *   freshly-navigated SPA a few times so a client-rendered form has time to
 *   hydrate. When, after that bounded budget, the page still shows only the app
 *   shell/navigation (no feature content), we do NOT wait longer or retry — we
 *   collect ROOT-CAUSE evidence and classify WHY the expected content is absent.
 *
 * WHY THIS SHAPE (the architecture constraint)
 *   The browser lives inside the separate `playwright-cli` child process; there is
 *   NO in-process Playwright `Page`, so we cannot attach page.on('console' | …)
 *   listeners here. Instead we ask the CLI for the same signals through its real,
 *   verified DevTools subcommands:
 *       console            → JS console messages   (errors / warnings)
 *       network            → non-static requests since load (APIs/XHR/documents)
 *       eval  <fn>         → generic page state (title, url, DOM control counts,
 *                            visible text, iframes, ARIA alerts, readyState)
 *   Plus the a11y snapshot + screenshot the caller already captured. Every probe
 *   is best-effort: if a runner's CLI lacks a command the channel degrades to
 *   "unavailable" and the rest still report.
 *
 * 100% APPLICATION-AGNOSTIC
 *   No app-specific selectors, URLs, waits, or retries. The `eval` payload uses
 *   only standard DOM/ARIA queries, so it works for ANY page. Credentials and
 *   sensitive URL tokens are redacted before anything is logged or returned.
 */

/** Minimal CLI runner surface (CliSession satisfies it; tests pass a stub). */
export interface CliRunner {
  run(args: string[], timeoutMs?: number): Promise<string>;
}

/* ── Types ───────────────────────────────────────────────────────────────────── */

export interface ConsoleMessage {
  level: string; // ERROR | WARNING | INFO | LOG | DEBUG …
  text: string;
  location?: string;
}

export interface ConsoleReport {
  total: number;
  errors: number;
  warnings: number;
  messages: ConsoleMessage[];
  /** false when the CLI console channel did not respond (empty / unknown command). */
  available: boolean;
}

export interface NetworkRequest {
  method: string;
  url: string;
  /** null when the request never produced an HTTP status (failed/aborted/pending). */
  status: number | null;
  statusText: string;
  ok: boolean;
  failed: boolean;
  /** best-effort inference from url/method (static | xhr/fetch | document). */
  resourceType: string;
}

export interface NetworkReport {
  total: number;
  failed: NetworkRequest[];
  all: NetworkRequest[];
  available: boolean;
}

export interface IframeInfo {
  src: string;
  name: string;
  id: string;
}

export interface PageState {
  title: string;
  url: string;
  readyState: string;
  headings: string[];
  /** input,select,textarea count — the reliable "is there a real form?" signal. */
  inputs: number;
  /** broader control count incl. buttons/comboboxes (noisier; evidence only). */
  formControls: number;
  iframes: IframeInfo[];
  /** visible ARIA alert/status text (role=alert|status, aria-live). */
  alerts: string[];
  visibleText: string;
  available: boolean;
}

export interface PageDiagnostics {
  url: string;
  title: string;
  readyState: string;
  console: ConsoleReport;
  network: NetworkReport;
  page: PageState;
  a11y: { interactable: number; featureFields: number; heading: string };
  screenshotPath: string;
}

export type FailureCategory =
  | 'application-error'
  | 'snapshot-gap'
  | 'feature-unavailable'
  | 'unknown';

export interface FailureDiagnosis {
  category: FailureCategory;
  headline: string;
  detail: string;
  evidence: string[];
}

export interface CollectOptions {
  /** Known page url (fallback when eval can't report location). */
  url?: string;
  /** Screenshot path the caller already captured, recorded in the report. */
  screenshotPath?: string;
  a11yInteractable?: number;
  a11yFields?: number;
  a11yHeading?: string;
  /** console min-level (e.g. "warning"); default: no arg → all levels. */
  consoleLevel?: string;
  timeoutMs?: number;
  log?: (line: string) => void;
}

/* ── The generic page-state probe (runs in the browser via `eval`) ───────────── */

/**
 * A single-expression, app-agnostic page probe. Uses only standard DOM/ARIA so it
 * is safe on ANY page. Returned as JSON by `playwright-cli eval`.
 *
 * Cross-platform note: on Linux/CI the CLI is spawned with shell:false, so this whole
 * string is passed as ONE argv element and `eval` returns full page-state. On Windows
 * the CLI is spawned with shell:true, where cmd.exe interprets the function's shell
 * metacharacters (the `>` in `=>`, parentheses), so `eval` may return nothing. That is
 * fine: `collectPageDiagnostics` degrades the eval channel to "unavailable" and the
 * classification still runs on console + network + the caller's a11y snapshot.
 */
export const PAGE_STATE_EVAL =
  "() => { const q = s => document.querySelectorAll(s).length; " +
  "const t = ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').trim(); " +
  "const heads = Array.from(document.querySelectorAll('h1,h2,h3')).map(h => (h.textContent || '').trim()).filter(Boolean).slice(0, 8); " +
  "const frames = Array.from(document.querySelectorAll('iframe')).map(f => ({ src: f.getAttribute('src') || '', name: f.getAttribute('name') || '', id: f.id || '' })).slice(0, 10); " +
  "const alerts = Array.from(document.querySelectorAll('[role=alert],[role=status],[aria-live=assertive],[aria-live=polite]')).map(a => (a.textContent || '').trim()).filter(Boolean).slice(0, 6); " +
  "return { title: document.title || '', url: location.href, readyState: document.readyState, headings: heads, " +
  "inputs: q('input,select,textarea'), " +
  "formControls: q('form,input,select,textarea,button,[role=combobox],[role=listbox],[role=radio],[role=checkbox],[contenteditable=true]'), " +
  "iframes: frames, alerts: alerts, visibleText: t.slice(0, 700) }; }";

/* ── Small coercion helpers (CLI output is untrusted text/JSON) ───────────────── */

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 12) : [];
}

/** True when a CLI channel returned nothing usable (empty / spawn error / usage help). */
export function isCliUnavailable(raw: string): boolean {
  const t = String(raw || '').trim();
  if (!t) return true;
  if (t.startsWith('__CLI_ERROR__')) return true;
  return /unknown command|invalid command|^usage:/im.test(t);
}

/** Keep only the body under the first `### Result` block (CLI wraps output that way). */
function stripResultHeader(raw: string): string {
  let t = String(raw || '');
  if (isCliUnavailable(t)) return '';
  const idx = t.indexOf('### Result');
  if (idx >= 0) t = t.slice(idx + '### Result'.length);
  const next = t.indexOf('\n### ');
  if (next >= 0) t = t.slice(0, next);
  return t.trim();
}

/* ── URL redaction (never leak credentials/tokens in diagnostics) ────────────── */

const SENSITIVE_PARAM =
  /^(token|access_token|refresh_token|id_token|auth|authorization|apikey|api_key|key|secret|client_secret|password|pwd|sig|signature|code|jwt|session|sessionid|sid)$/i;

/** Strip userinfo and known sensitive query-parameter VALUES from a url. Generic. */
export function redactUrl(url: string): string {
  const raw = String(url || '');
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    for (const key of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_PARAM.test(key)) u.searchParams.set(key, 'REDACTED');
    }
    return u.toString();
  } catch {
    return raw
      .replace(/\/\/[^/@\s]+@/, '//')
      .replace(
        /([?&](?:token|access_token|refresh_token|id_token|apikey|api_key|key|secret|client_secret|password|pwd|sig|signature|code|jwt)=)[^&\s]+/gi,
        '$1REDACTED',
      );
  }
}

/* ── Parsers (pure — unit-tested against real CLI output shapes) ──────────────── */

/**
 * Parse `playwright-cli console` output:
 *   ### Result
 *   Total messages: 2 (Errors: 1, Warnings: 1)
 *
 *   [ERROR] some message @ https://host/app.js:12:3
 *   [WARNING] another @ :0
 */
export function parseConsoleOutput(raw: string): ConsoleReport {
  const available = !isCliUnavailable(raw);
  const body = stripResultHeader(raw);
  const messages: ConsoleMessage[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*\[([A-Za-z]+)\]\s+(.*)$/);
    if (!m) continue;
    const level = m[1].toUpperCase();
    let text = m[2].trim();
    let location = '';
    const at = text.lastIndexOf(' @ ');
    if (at >= 0) {
      const tail = text.slice(at + 3).trim();
      // Treat the tail as a source location only when it looks like one (path:line / url / :0).
      if (/^:?\d+(:\d+)?$/.test(tail) || /^https?:\/\//i.test(tail) || /:\d+(:\d+)?$/.test(tail)) {
        location = tail;
        text = text.slice(0, at).trim();
      }
    }
    messages.push({ level, text, location });
  }
  const sum = body.match(/Total messages:\s*(\d+)\s*\(Errors:\s*(\d+),\s*Warnings:\s*(\d+)\)/i);
  const errors = sum ? Number(sum[2]) : messages.filter((m) => m.level === 'ERROR').length;
  const warnings = sum ? Number(sum[3]) : messages.filter((m) => m.level === 'WARNING').length;
  const total = sum ? Number(sum[1]) : messages.length;
  return { total, errors, warnings, messages, available };
}

function inferResourceType(method: string, url: string): string {
  if (/\.(png|jpe?g|gif|webp|svg|ico|css|woff2?|ttf|eot|map)(\?|#|$)/i.test(url)) return 'static';
  if (/\/graphql(\?|$)|\/api\/|\/rest\/|\.json(\?|#|$)|\/v\d+\//i.test(url) || method.toUpperCase() !== 'GET') {
    return 'xhr/fetch';
  }
  return 'document';
}

/**
 * Parse `playwright-cli network` output rows:
 *   [GET] https://host/api/x => [200] OK
 *   [POST] https://host/api/y => [500] Internal Server Error
 *   [GET] https://host/z => [failed] net::ERR_ABORTED
 */
export function parseNetworkOutput(raw: string): NetworkRequest[] {
  const body = stripResultHeader(raw);
  const out: NetworkRequest[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*\[([A-Za-z]+)\]\s+(\S+)\s*=>\s*\[?([^\]\s]+)\]?\s*(.*)$/);
    if (!m) continue;
    const method = m[1].toUpperCase();
    const url = m[2];
    const statusTok = m[3];
    const trailing = (m[4] || '').trim();
    const status = /^\d+$/.test(statusTok) ? Number(statusTok) : null;
    const ok = status != null && status < 400;
    const failed = status == null || status >= 400;
    const statusText = status == null ? trailing || statusTok : trailing;
    out.push({ method, url, status, statusText, ok, failed, resourceType: inferResourceType(method, url) });
  }
  return out;
}

/** Extract the raw text under a `### Result` block from an `eval` response. */
export function extractEvalResult(raw: string): string {
  const m = String(raw || '').match(/###\s*Result\s*\n([\s\S]*?)(?:\n###\s|\s*$)/);
  return (m ? m[1] : '').trim();
}

/** Parse the JSON page-state object returned by PAGE_STATE_EVAL. */
export function parsePageState(raw: string): PageState {
  const available = !isCliUnavailable(raw);
  const empty: PageState = {
    title: '', url: '', readyState: '', headings: [], inputs: 0, formControls: 0,
    iframes: [], alerts: [], visibleText: '', available,
  };
  const body = extractEvalResult(raw) || stripResultHeader(raw);
  if (!body) return empty;
  try {
    let parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed); // eval may quote the JSON
    if (!parsed || typeof parsed !== 'object') return empty;
    const obj = parsed as Record<string, unknown>;
    const framesRaw = Array.isArray(obj.iframes) ? (obj.iframes as unknown[]) : [];
    const iframes: IframeInfo[] = framesRaw
      .map((f) => {
        const o = f && typeof f === 'object' ? (f as Record<string, unknown>) : {};
        return { src: str(o.src), name: str(o.name), id: str(o.id) };
      })
      .slice(0, 10);
    return {
      title: str(obj.title),
      url: str(obj.url),
      readyState: str(obj.readyState),
      headings: strArray(obj.headings),
      inputs: num(obj.inputs),
      formControls: num(obj.formControls),
      iframes,
      alerts: strArray(obj.alerts),
      visibleText: str(obj.visibleText),
      available: true,
    };
  } catch {
    return empty;
  }
}

/* ── Formatting + classification ─────────────────────────────────────────────── */

/** One-line summary of a network request: METHOD url [status] type — message. */
export function summarizeRequest(r: NetworkRequest): string {
  const status = r.status == null ? r.statusText || 'failed' : String(r.status);
  const note = r.statusText && (r.status == null || r.status >= 400) ? ` — ${r.statusText}` : '';
  return `${r.method} ${redactUrl(r.url)} [${status}] ${r.resourceType}${note}`;
}

/**
 * ROOT-CAUSE classifier. Generic, evidence-first. Priority:
 *   1) application-error  — JS console errors and/or failed (4xx/5xx/aborted) requests.
 *   2) snapshot-gap       — DOM has real form controls the a11y snapshot did not expose.
 *   3) feature-unavailable— clean load but no form controls in the DOM (user/data/permission).
 *   4) unknown            — none of the above conclusively.
 */
export function classifyFailure(d: PageDiagnostics): FailureDiagnosis {
  const consoleErrors = d.console.errors;
  const failed = d.network.failed;
  const domInputs = d.page.inputs;
  const a11yFields = d.a11y.featureFields;

  if (consoleErrors > 0 || failed.length > 0) {
    const bits: string[] = [];
    if (consoleErrors > 0) bits.push(`${consoleErrors} console error(s)`);
    if (failed.length > 0) bits.push(`${failed.length} failed/4xx-5xx network request(s)`);
    return {
      category: 'application-error',
      headline: `Application/backend error — the page reported ${bits.join(' and ')} while the feature form should have hydrated.`,
      detail:
        'The feature form did not render because the application itself errored (a client-side JS exception and/or a failing API/network call). This is an app/environment defect — not a locator, wait, or timing problem. Report it as failed and attach the console/network evidence below.',
      evidence: [
        ...failed.slice(0, 8).map((r) => `network: ${summarizeRequest(r)}`),
        ...d.console.messages
          .filter((m) => m.level === 'ERROR')
          .slice(0, 8)
          .map((m) => `console: [${m.level}] ${m.text}`),
      ],
    };
  }

  if (domInputs >= 2 && a11yFields < 2) {
    return {
      category: 'snapshot-gap',
      headline: `Accessibility-snapshot gap — the DOM contains ${domInputs} form control(s) that the a11y snapshot did not expose (featureFields=${a11yFields}).`,
      detail:
        'The form IS present in the DOM but the accessibility snapshot the agent reads is missing it (e.g. controls inside an unlabeled region/custom widget, an a11y node not yet attached, or content inside an iframe). The fix belongs in the snapshot/parse layer — never in longer waits or app-specific selectors.',
      evidence: [
        `DOM: inputs=${domInputs}, formControls=${d.page.formControls}`,
        `a11y: featureFields=${a11yFields}, interactable=${d.a11y.interactable}`,
        d.page.iframes.length ? `iframes present: ${d.page.iframes.length} (form may be inside a frame)` : '',
      ].filter(Boolean),
    };
  }

  if (domInputs < 2) {
    const hint = d.page.alerts.length ? ` Visible message: "${d.page.alerts[0]}".` : '';
    return {
      category: 'feature-unavailable',
      headline: `Feature form not rendered — the DOM has no form controls (inputs=${domInputs}) and the app reported no errors.${hint}`,
      detail:
        'The page loaded cleanly but produced no form. The signed-in user/state most likely lacks the data, entitlement, permission, or a required precondition action to reveal this feature. This is not a locator/wait problem; report failed and quote the observed page message.',
      evidence: [
        ...d.page.alerts.slice(0, 4).map((a) => `alert: ${a}`),
        d.page.headings.length ? `headings: ${d.page.headings.join(' | ')}` : '',
        d.page.visibleText ? `visibleText: ${d.page.visibleText.slice(0, 240)}` : '',
      ].filter(Boolean),
    };
  }

  return {
    category: 'unknown',
    headline:
      'Inconclusive — feature content is absent but no console error, failed request, or DOM/a11y mismatch was detected.',
    detail:
      'Review the captured screenshot, a11y snapshot, and the evidence below to determine the cause.',
    evidence: [
      `DOM inputs=${domInputs}, a11y featureFields=${a11yFields}`,
      `network: ${d.network.total} request(s), ${failed.length} failed`,
      `console: ${d.console.errors} error(s), ${d.console.warnings} warning(s)`,
    ],
  };
}

/** Render a compact, human- and model-readable diagnostics report. */
export function formatDiagnosticsReport(d: PageDiagnostics, diag: FailureDiagnosis): string {
  const lines: string[] = [];
  lines.push('DYNAMIC PAGE FAILURE DIAGNOSIS (informational — does NOT relax any success gate)');
  lines.push(`Root cause category: ${diag.category}`);
  lines.push(diag.headline);
  lines.push('');
  lines.push('Evidence:');
  lines.push(`- URL: ${redactUrl(d.url) || '(unknown)'}`);
  lines.push(`- Document title: ${d.title || '(none)'}`);
  lines.push(`- Page readyState: ${d.readyState || '(unknown)'}`);
  lines.push(
    `- A11y snapshot: interactable=${d.a11y.interactable}, featureFields=${d.a11y.featureFields}` +
      (d.a11y.heading ? `, heading="${d.a11y.heading}"` : ''),
  );
  lines.push(`- DOM form controls: inputs=${d.page.inputs}, total=${d.page.formControls}`);
  if (d.page.headings.length) lines.push(`- Headings: ${d.page.headings.join(' | ')}`);
  lines.push(
    `- Console: ${d.console.errors} error(s), ${d.console.warnings} warning(s)` +
      (d.console.available ? '' : ' (console channel unavailable)'),
  );
  for (const m of d.console.messages.filter((x) => x.level === 'ERROR' || x.level === 'WARNING').slice(0, 10)) {
    lines.push(`    [${m.level}] ${m.text}`);
  }
  lines.push(
    `- Network: ${d.network.failed.length} failed / ${d.network.total} request(s)` +
      (d.network.available ? '' : ' (network channel unavailable)'),
  );
  for (const r of d.network.failed.slice(0, 10)) lines.push(`    ${summarizeRequest(r)}`);
  for (const a of d.page.alerts.slice(0, 5)) lines.push(`- Visible alert: ${a}`);
  if (d.page.iframes.length) {
    const srcs = d.page.iframes
      .map((f) => redactUrl(f.src) || f.name || f.id)
      .filter(Boolean)
      .slice(0, 5)
      .join(', ');
    lines.push(`- iframes: ${d.page.iframes.length}${srcs ? ` (${srcs})` : ''}`);
  }
  if (d.screenshotPath) lines.push(`- Screenshot: ${d.screenshotPath}`);
  if (d.page.visibleText) lines.push(`- Visible text (excerpt): ${d.page.visibleText.slice(0, 400)}`);
  lines.push('');
  lines.push(`Interpretation: ${diag.detail}`);
  return lines.join('\n');
}

/* ── Collector (impure — asks the CLI for the diagnostic channels) ───────────── */

async function safeRun(session: CliRunner, args: string[], timeoutMs: number): Promise<string> {
  try {
    return await session.run(args, timeoutMs);
  } catch (e) {
    return `__CLI_ERROR__ ${(e as Error).message}`;
  }
}

/**
 * Gather generic browser-failure diagnostics through the `@playwright/cli` DevTools
 * subcommands. Best-effort: any channel the CLI cannot serve degrades to
 * "unavailable" without throwing. Never waits/retries and never mutates the page
 * beyond a read-only `eval`.
 */
export async function collectPageDiagnostics(session: CliRunner, opts: CollectOptions = {}): Promise<PageDiagnostics> {
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 15000;
  const consoleArgs = opts.consoleLevel ? ['console', opts.consoleLevel] : ['console'];

  const consoleRaw = await safeRun(session, consoleArgs, timeoutMs);
  const networkRaw = await safeRun(session, ['network'], timeoutMs);
  // On Linux/CI (shell:false) this returns full page-state. On Windows (shell:true) cmd.exe
  // may interpret the eval function's metacharacters and return nothing — parsePageState then
  // flags the channel unavailable and classification falls back to console + network + a11y.
  const evalRaw = await safeRun(session, ['eval', PAGE_STATE_EVAL], timeoutMs);

  const consoleReport = parseConsoleOutput(consoleRaw);
  const all = parseNetworkOutput(networkRaw);
  const network: NetworkReport = {
    total: all.length,
    failed: all.filter((r) => r.failed),
    all,
    available: !isCliUnavailable(networkRaw),
  };
  const page = parsePageState(evalRaw);

  return {
    url: page.url || opts.url || '',
    title: page.title,
    readyState: page.readyState,
    console: consoleReport,
    network,
    page,
    a11y: {
      interactable: opts.a11yInteractable ?? 0,
      featureFields: opts.a11yFields ?? 0,
      heading: opts.a11yHeading || '',
    },
    screenshotPath: opts.screenshotPath || '',
  };
}
