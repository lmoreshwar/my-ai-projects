/**
 * playwright-cli-tools.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The tool layer for the agentic browser loop. It does TWO things:
 *   1. Exposes every @playwright/cli command as an OpenAI function-calling tool
 *      (TOOLS) so the model can request ONE action at a time.
 *   2. Actually executes that command against a REAL headless browser session
 *      (CliSession.run) and parses the real output the model needs back.
 *
 * WHY THIS EXISTS
 *   @playwright/cli refs (e15, f3e7…) are only valid for the exact page state at
 *   the moment `snapshot` was taken. The model must therefore act on the LIVE
 *   snapshot it just read — never a ref it invented or one from an older state.
 *   This file makes the CLI the single source of truth for what exists on the page.
 *
 * COMMAND SURFACE (verified against @playwright/cli):
 *   playwright-cli -s=<session> open|goto|snapshot|find|click|fill|type|press|
 *                              select|upload|check|uncheck|hover|drag|screenshot|
 *                              close|state-load|--version
 *   - snapshot output wraps the accessibility tree in a ```yaml … ``` block whose
 *     rows look like:  - button "Login" [ref=e15]
 *   - after a mutating action the CLI echoes the REAL Playwright code it ran in a
 *     ```js … ``` block, and prints `Page URL: <url>` so navigation is detectable.
 *
 * ENVIRONMENT PARITY
 *   - Always headless (never pass --headed) so it runs identically on a server/CI.
 *   - Binary + args are the same everywhere; only PLAYWRIGHT_CLI_BIN can override
 *     the executable name if it is not on PATH.
 */

import { spawn } from 'node:child_process';
import type OpenAI from 'openai';

/** The @playwright/cli executable. Override with PLAYWRIGHT_CLI_BIN if not on PATH. */
const CLI_BIN = process.env.PLAYWRIGHT_CLI_BIN || 'playwright-cli';

/** One interactable element parsed from a live snapshot. */
export interface RefRow {
  role: string;
  name: string;
  ref: string;
}

/**
 * A single headless @playwright/cli session. Every command is namespaced with the
 * session id so parallel loops never collide. Best-effort: a spawn/timeout failure
 * resolves with whatever output was captured rather than throwing, so the loop can
 * decide how to recover instead of crashing.
 */
export class CliSession {
  readonly id: string;

  constructor(id?: string) {
    this.id = id || `agent-${Date.now().toString(36)}`;
  }

  run(args: string[], timeoutMs = 40000): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn(CLI_BIN, [`-s=${this.id}`, ...args], { shell: true });
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { out += d.toString(); });
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(out); }, timeoutMs);
      child.on('close', () => { clearTimeout(timer); resolve(out); });
      child.on('error', (e) => { clearTimeout(timer); resolve(`__CLI_ERROR__ ${e.message}`); });
    });
  }
}

/* ── Output parsers (the model only ever sees REAL, current page data) ───────── */

/** Pull the accessibility tree out of a snapshot's ```yaml … ``` block (or raw text). */
export function extractYaml(cliOutput: string): string {
  const m = String(cliOutput || '').match(/```yaml\n([\s\S]*?)```/);
  return (m ? m[1] : String(cliOutput || '')).trim();
}

/** @playwright/cli echoes the EXACT Playwright code it ran in a ```js … ``` block. */
export function extractRanLocator(cliOutput: string): string {
  const m = String(cliOutput || '').match(/```js\n([\s\S]*?)```/);
  return m ? m[1].trim() : '';
}

/** The CLI prints `Page URL: <url>` after an action — used to detect navigation. */
export function extractPageUrl(cliOutput: string): string {
  const m = String(cliOutput || '').match(/Page URL:\s*(\S+)/);
  return m ? m[1] : '';
}

/**
 * Parse `- role "name" [ref=eNN]` rows into interactable refs. Standard controls
 * come first; then menu OPENERS (avatar/icon `img`) and named styled containers,
 * because a feature's key control (Logout, Settings, a menu entry) is often hidden
 * behind a nameless toggle that must be clicked to reveal it. Refs may be plain
 * (`e15`) or frame-scoped (`f3e7`).
 */
export function parseRefs(snapshot: string): RefRow[] {
  const re = /^\s*-?\s*([a-zA-Z]+)(?:\s+"([^"]*)")?[^\n]*\[ref=([a-z0-9]+)\]/;
  const interactable = new Set([
    'textbox', 'searchbox', 'spinbutton', 'button', 'link', 'checkbox', 'combobox',
    'radio', 'switch', 'slider', 'menuitem', 'menuitemcheckbox', 'tab', 'option', 'listitem',
  ]);
  const openerRoles = new Set(['img']);
  const namedContainerRoles = new Set(['generic', 'paragraph', 'group', 'menu', 'menubar', 'banner']);

  const rows: Array<RefRow & { prio: number }> = [];
  for (const line of String(snapshot || '').split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const role = m[1].toLowerCase();
    const name = (m[2] || '').trim();
    let prio: number;
    if (interactable.has(role)) prio = 0;
    else if (openerRoles.has(role)) prio = 1;
    else if (name && namedContainerRoles.has(role)) prio = 2;
    else continue;
    if (rows.some((r) => r.ref === m[3])) continue;
    rows.push({ role, name, ref: m[3], prio });
  }
  rows.sort((a, b) => a.prio - b.prio);
  return rows.map(({ prio, ...r }) => r);
}

/** Redact any known secret values before a line is logged. */
export function redact(text: string, secrets: string[]): string {
  let out = String(text || '');
  for (const s of secrets) {
    if (s) out = out.split(s).join('«redacted»');
  }
  return out;
}

/** Credentials the loop may use to log in — read ONLY from the environment, never from the LLM. */
export interface Credentials {
  username: string;
  password: string;
}

/** The tokens the model puts into login fields; the executor swaps them for the real env values. */
export const CRED_PLACEHOLDERS = { username: '{{USERNAME}}', password: '{{PASSWORD}}' } as const;

/** Load credentials from env (GitHub Actions secrets / VM env). Returns empty strings when unset. */
export function resolveCredentials(): Credentials {
  return {
    username: process.env.AGENT_USERNAME || process.env.APP_USERNAME || '',
    password: process.env.AGENT_PASSWORD || process.env.APP_PASSWORD || '',
  };
}

/**
 * Swap credential PLACEHOLDERS for the real env values just before the CLI runs. The model only
 * ever emits `{{USERNAME}}`/`{{PASSWORD}}`, so the real secret never enters the LLM transcript.
 * Returns the resolved value and whether a credential was injected (so the caller can redact it).
 */
export function substituteCredentials(value: string, creds: Credentials): { value: string; usedCredential: boolean } {
  let out = String(value ?? '');
  let used = false;
  if (out.includes(CRED_PLACEHOLDERS.username)) { out = out.split(CRED_PLACEHOLDERS.username).join(creds.username); used = true; }
  if (out.includes(CRED_PLACEHOLDERS.password)) { out = out.split(CRED_PLACEHOLDERS.password).join(creds.password); used = true; }
  return { value: out, usedCredential: used };
}

/* ── OpenAI tool schemas (one per @playwright/cli command) ───────────────────── */

const refParam = { type: 'string', description: 'A ref token (e.g. e15 or f3e7) taken from the MOST RECENT snapshot.' } as const;

export const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: 'function', function: { name: 'goto', description: 'Navigate to a URL in the current page.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'snapshot', description: 'Capture the full accessibility tree of the CURRENT page. Returns the valid refs you may act on. ALWAYS call this before any ref-based action.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'find', description: 'Search the current page for text/regex and return matching elements. Use to locate a control before clicking.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'click', description: 'Click an element by its ref from the latest snapshot.', parameters: { type: 'object', properties: { ref: refParam }, required: ['ref'] } } },
  { type: 'function', function: { name: 'fill', description: 'Fill a text field by ref. For a login username/password field, put the placeholder {{USERNAME}} or {{PASSWORD}} (the real value is injected securely at run time). Never write a real secret.', parameters: { type: 'object', properties: { ref: refParam, value: { type: 'string' } }, required: ['ref', 'value'] } } },
  { type: 'function', function: { name: 'type', description: 'Type text into an element by ref (keystroke by keystroke). Use {{USERNAME}}/{{PASSWORD}} for login fields.', parameters: { type: 'object', properties: { ref: refParam, text: { type: 'string' } }, required: ['ref', 'text'] } } },
  { type: 'function', function: { name: 'press', description: 'Press a keyboard key (e.g. Enter, Tab). Optionally target a ref first.', parameters: { type: 'object', properties: { key: { type: 'string' }, ref: refParam }, required: ['key'] } } },
  { type: 'function', function: { name: 'select', description: 'Select an option in a <select>/combobox by ref.', parameters: { type: 'object', properties: { ref: refParam, value: { type: 'string' } }, required: ['ref', 'value'] } } },
  { type: 'function', function: { name: 'upload', description: 'Upload file(s) to a file input by ref.', parameters: { type: 'object', properties: { ref: refParam, files: { type: 'array', items: { type: 'string' } } }, required: ['ref', 'files'] } } },
  { type: 'function', function: { name: 'check', description: 'Check a checkbox/radio by ref.', parameters: { type: 'object', properties: { ref: refParam }, required: ['ref'] } } },
  { type: 'function', function: { name: 'uncheck', description: 'Uncheck a checkbox by ref.', parameters: { type: 'object', properties: { ref: refParam }, required: ['ref'] } } },
  { type: 'function', function: { name: 'hover', description: 'Hover over an element by ref (reveals hover menus).', parameters: { type: 'object', properties: { ref: refParam }, required: ['ref'] } } },
  { type: 'function', function: { name: 'drag', description: 'Drag one element onto another by refs.', parameters: { type: 'object', properties: { from: refParam, to: refParam }, required: ['from', 'to'] } } },
  { type: 'function', function: { name: 'screenshot', description: 'Capture a screenshot of the current page (optional path).', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'goBack', description: 'Go back to the previous page.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'finish', description: 'End the run. Call this when the feature is fully explored/verified OR when no useful action remains.', parameters: { type: 'object', properties: { status: { type: 'string', enum: ['passed', 'failed', 'incomplete'] }, summary: { type: 'string' } }, required: ['status', 'summary'] } } },
];

/** Map a tool call to its @playwright/cli argv. Returns null if required args are missing. */
export function buildCommand(name: string, a: Record<string, unknown>): string[] | null {
  const s = (v: unknown) => (v == null ? '' : String(v));
  switch (name) {
    case 'goto': return a.url ? ['goto', s(a.url)] : null;
    case 'snapshot': return ['snapshot'];
    case 'find': return a.query ? ['find', s(a.query)] : null;
    case 'click': return a.ref ? ['click', s(a.ref)] : null;
    case 'fill': return a.ref ? ['fill', s(a.ref), s(a.value)] : null;
    case 'type': return a.ref ? ['type', s(a.ref), s(a.text ?? a.value)] : null;
    case 'press': return a.key ? (a.ref ? ['press', s(a.ref), s(a.key)] : ['press', s(a.key)]) : null;
    case 'select': return a.ref ? ['select', s(a.ref), s(a.value)] : null;
    case 'upload': {
      const files = Array.isArray(a.files) ? a.files.map(s) : s(a.files).split(',').map((x) => x.trim()).filter(Boolean);
      return a.ref && files.length ? ['upload', s(a.ref), ...files] : null;
    }
    case 'check': return a.ref ? ['check', s(a.ref)] : null;
    case 'uncheck': return a.ref ? ['uncheck', s(a.ref)] : null;
    case 'hover': return a.ref ? ['hover', s(a.ref)] : null;
    case 'drag': return a.from && a.to ? ['drag', s(a.from), s(a.to)] : null;
    case 'screenshot': return a.path ? ['screenshot', s(a.path)] : ['screenshot'];
    case 'goBack': return ['back'];
    default: return null;
  }
}

/** Tools that reference an element by ref — the loop validates the ref is live before running. */
export const REF_TOOLS = new Set(['click', 'fill', 'type', 'select', 'upload', 'check', 'uncheck', 'hover']);
