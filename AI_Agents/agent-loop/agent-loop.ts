/**
 * agent-loop.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * A standalone, environment-agnostic reproduction of Copilot agent-mode's browser
 * loop. It drives a REAL headless @playwright/cli session one action at a time, so
 * it behaves IDENTICALLY on your laptop, a cloud VM, or a GitHub Actions runner.
 *
 * THE ENTIRE FIX (why this works where blind batch-execution failed):
 *   The model NEVER pre-generates a batch of commands. It picks ONE tool call,
 *   we execute it against the live browser, and the REAL result (or a fresh
 *   snapshot with the currently-valid refs) goes back before it decides the next
 *   action. Refs (e15, f3e7…) are only ever used from the most recent snapshot —
 *   a ref that is not live is rejected, so the model must snapshot and re-pick.
 *
 * ── SETUP (run the same 3 lines everywhere: local, VM, GitHub Actions) ─────────
 *   npm i -g @playwright/cli
 *   npx playwright install --with-deps chromium
 *   # this module needs: npm i openai   (and tsx/ts-node OR compile with tsc)
 *
 * ── RUN ────────────────────────────────────────────────────────────────────────
 *   OPENAI_API_KEY=...  \
 *   npx tsx agent-loop.ts --url "https://app.example.com/feature" \
 *                         --goal "Log out via the user-profile dropdown and verify the login page appears"
 *
 *   Optional:
 *     --model <name>        (or env OPENAI_MODEL; default gpt-4o)
 *     --max <n>             max live steps (default 25)
 *     --state <file.json>   pre-saved storage state for auth (no creds via the CLI)
 *     OPENAI_BASE_URL       custom OpenAI-compatible gateway
 *     PLAYWRIGHT_CLI_BIN    override the playwright-cli executable name
 *
 * Exit code: 0 when finish status is "passed", 1 otherwise (CI-friendly).
 */

import OpenAI from 'openai';
import { existsSync } from 'node:fs';
import {
  CliSession, TOOLS, REF_TOOLS, buildCommand,
  extractYaml, extractRanLocator, extractPageUrl, parseRefs, redact,
  resolveCredentials, substituteCredentials, type Credentials,
  type RefRow,
} from './playwright-cli-tools';
import { runDiscovery, parseInventory, type DiscoveryResult, type FieldInventoryItem } from './discovery';
import {
  collectPageDiagnostics, classifyFailure, formatDiagnosticsReport,
  type FailureDiagnosis,
} from './page-diagnostics';

export interface AgentLoopOptions {
  /** Feature name + concrete instructions describing what to explore/verify. */
  goal: string;
  /** The single feature URL to start on. */
  url: string;
  model?: string;
  /** Max live tool calls before the loop stops itself. Default 25. */
  maxSteps?: number;
  /** Optional saved storage state (cookies) so an authed feature is reachable without a live login. */
  stateFile?: string;
  /** Login credentials — read from env by default; the LLM never receives these values. */
  credentials?: Credentials;
  /** Extra values to redact from all logs/traces (creds are always redacted regardless). */
  secrets?: string[];
  /**
   * Run bounded, read-only discovery (full-page field inventory) the first time a feature form is
   * reached, then require the controlled success submit to fill EVERY discovered field. Default ON;
   * set false for a plain single-flow walk (e.g. login-only smoke). The feature name is used to label
   * the discovery evidence.
   */
  discover?: boolean;
  feature?: string;
  onLog?: (line: string) => void;
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  locator?: string;
  context?: string;
  scopeHint?: LocatorScopeHint;
  prepopulatedFields?: PrepopulatedField[];
  /** VERIFIED-LIVE interaction contract for a ref-based action (the strongest codegen evidence). */
  interaction?: InteractionEvidence;
  url?: string;
  result: string;
}

/** A label-anchored locator for a repeated role/name discovered in the live snapshot. */
export interface LocatorScopeHint {
  role: string;
  name: string;
  matches: number;
  label: string;
  locator: string;
}

/**
 * A LocatorContract captured the instant an action ran against the REAL browser — the highest-priority
 * evidence codegen has. It records what was actually resolved and acted on, so codegen reuses the proven
 * interaction target instead of re-deriving a semantically weak locator (e.g. a bare getByRole('checkbox')
 * that resolves to a native input whose click a custom switch/wrapper span intercepts). Fully generic.
 */
export interface InteractionEvidence {
  controlId: string;          // stable label/name identifying the control
  action: string;             // click | check | uncheck | select | fill | type
  semanticRole: string;       // checkbox | switch | radio | combobox | textbox | button | …
  accessibleName: string;     // '' for an unnamed custom control (the switch/checkbox fingerprint)
  locatorEvidence: string;    // the proven interaction target: the label-scoped hint, else the CLI-run locator
  interactionTarget: string;  // the resolved control + ref actually acted on
  uniqueness: number;         // controls sharing this role/name in the live snapshot (1 = unique)
  custom: boolean;            // unnamed checkable OR ambiguous role ⇒ a bare role locator is unsafe
  actionability: 'verified-live'; // it really ran green against the live page
  provenByLiveTrace: true;
}


export interface PrepopulatedField {
  ref: string;
  label: string;
  value: string;
  context: string;
  kind?: 'text' | 'dropdown' | 'radio';
}

export interface AgentLoopResult {
  status: 'passed' | 'failed' | 'incomplete';
  summary: string;
  steps: AgentStep[];
  /** Bounded read-only discovery evidence captured on the feature form (present when discover !== false). */
  discovery?: DiscoveryResult;
  /** Root-cause diagnoses captured whenever expected feature content failed to hydrate. */
  diagnostics?: FailureDiagnosis[];
}

const SYSTEM_PROMPT = [
  'You are a browser-automation agent driving a REAL headless browser to EXHAUSTIVELY explore and verify ONE feature.',
  'You act by calling the provided tools, ONE at a time, and reading the real result before the next call.',
  '',
  'HARD RULES:',
  '1. ALWAYS call `snapshot` before any ref-based action. Refs (e15, f3e7…) are ONLY valid for the snapshot you just read.',
  '2. Use ONLY refs that appear in the MOST RECENT snapshot. Never invent a ref or reuse one from an earlier page state.',
  '3. EXHAUSTIVE COVERAGE (not the minimum path): once you reach the feature form, the tool result will give you a DISCOVERED FIELD INVENTORY listing every control on the whole screen. Your one controlled success run MUST fill EVERY field marked "fill" with realistic, valid, generated data — including OPTIONAL fields (e.g. middle name, contact number, keywords, date, notes) and dropdowns/checkboxes — before you Save. Do NOT stop after the first two or three fields. Skip ONLY fields marked "app-prepopulated" (leave untouched) or "BLOCKED" (e.g. file upload with no fixture).',
  '4. To reveal a hidden control (Logout, Settings, a menu item, a custom dropdown list), first CLICK the thing that opens it — a user avatar/profile image, a ⋮/kebab/hamburger/caret icon, a dropdown trigger — then snapshot; the revealed items appear in the NEXT snapshot.',
  '5. LOGIN: when a login form is present and the goal needs an authenticated page, fill the username field with the literal placeholder {{USERNAME}} and the password field with {{PASSWORD}}, then submit. The real values are injected securely — you must NEVER write an actual username or password. After you are logged in, do not re-enter credentials.',
  '6. CREATE FLOWS: when the INITIAL live form snapshot marks a field as app-prepopulated, never fill, clear, assert a fixed value for, or otherwise overwrite it. For an EMPTY editable identifier, username, email, code, reference, or record-number field, fill a fresh value before Save/Submit. After Save/Submit, call snapshot (not find) and verify the real outcome. If the live page shows a duplicate/collision validation, record that message, change only that empty unique value, submit again, and snapshot the outcome. Never finish passed while still on the form after a failed submit.',
  '7. READ-ONLY UNTIL THE SINGLE SUCCESS SUBMIT: explore, snapshot, and fill fields freely, but click a destructive/persistent control (Save, Submit, Create, Delete, Logout) EXACTLY ONCE — the final controlled success submit after every field is filled. Never delete or repeat destructive actions.',
  '8. When the goal is achieved (or no useful action remains), call `finish` with status "passed" (goal verified), "failed" (a real defect/blocker), or "incomplete".',
  '',
  'Work efficiently and do not narrate — just make tool calls.',
].join('\n');

/** Render the live refs the model is allowed to act on, most-relevant first. */
function renderRefs(refs: RefRow[]): string {
  if (!refs.length) return '(no interactable elements found on this page)';
  return refs.slice(0, 60).map((r) => `- ref=${r.ref} ${r.role}${r.name ? ` "${r.name}"` : ''}`).join('\n');
}

/** Keep the parent/label lines around the chosen live ref so codegen can scope unnamed controls. */
function snapshotContextForRef(snapshot: string, ref: string): string {
  if (!snapshot || !ref) return '';
  const lines = snapshot.split('\n');
  const index = lines.findIndex((line) => line.includes(`[ref=${ref}]`));
  if (index < 0) return '';
  return lines.slice(Math.max(0, index - 8), Math.min(lines.length, index + 9)).join('\n').slice(0, 1200);
}

interface SnapshotControl {
  index: number;
  indent: number;
  role: string;
  name: string;
}

function snapshotControl(line: string, index: number): SnapshotControl | null {
  const match = line.match(/^\s*-?\s*([a-zA-Z]+)(?:\s+"([^"]*)")?[^\n]*\[ref=[a-z0-9]+\]/);
  if (!match) return null;
  return { index, indent: lineIndent(line), role: match[1].toLowerCase(), name: (match[2] || '').trim() };
}

function stableSnapshotText(line: string): string {
  const colonText = line.match(/:\s*"?([^"\n]+?)"?\s*$/)?.[1] || '';
  const namedContainer = line.match(/(?:heading|group|region|dialog|fieldset|row)\s+"([^"]+)"/)?.[1] || '';
  const text = (colonText || namedContainer).replace(/\*+$/, '').trim();
  return /[a-z0-9]/i.test(text) ? text : '';
}

function nearestLabelInSnapshot(lines: string[], target: SnapshotControl): string {
  let child = target;
  while (child.index > 0) {
    let parentIndex = -1;
    for (let index = child.index - 1; index >= 0; index -= 1) {
      if (lineIndent(lines[index]) < child.indent) {
        parentIndex = index;
        break;
      }
    }
    if (parentIndex < 0) return '';
    for (let index = child.index - 1; index > parentIndex; index -= 1) {
      if (lineIndent(lines[index]) !== child.indent) continue;
      const label = stableSnapshotText(lines[index]);
      if (label && label !== child.name) return label;
    }
    const parent = snapshotControl(lines[parentIndex], parentIndex);
    if (!parent) return stableSnapshotText(lines[parentIndex]);
    child = parent;
  }
  return '';
}

function descendantPredicate(role: string): string {
  if (['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(role)) return 'descendant::input or descendant::textarea or descendant::select';
  if (['checkbox', 'radio', 'switch'].includes(role)) return 'descendant::input or descendant::*[@role="checkbox" or @role="radio" or @role="switch"]';
  if (role === 'button') return 'descendant::button or descendant::*[@role="button"]';
  if (role === 'link') return 'descendant::a or descendant::*[@role="link"]';
  if (['menuitem', 'menuitemcheckbox', 'option'].includes(role)) return `descendant::*[@role="${role}"] or descendant::option`;
  return 'descendant::*';
}

function escapeTsLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Turn an ambiguous a11y role/name into a label-anchored, nearest-container locator.
 * The hint is derived only from the live snapshot; it never guesses an app-specific class.
 */
export function deriveLocatorScopeHint(snapshot: string, ref: string, forceAmbiguous = false): LocatorScopeHint | undefined {
  if (!snapshot || !ref) return undefined;
  const lines = snapshot.split('\n');
  const controls = lines.map(snapshotControl).filter((control): control is SnapshotControl => Boolean(control));
  const target = controls.find((control) => lines[control.index].includes(`[ref=${ref}]`));
  if (!target) return undefined;
  const matches = controls.filter((control) => control.role === target.role && control.name === target.name);
  // An UNNAMED checkable (checkbox/switch/radio) is a custom-widget fingerprint: a bare getByRole is
  // both weak (its native input is often overlaid by a wrapper span) and usually non-unique, so scope it
  // to its label even when it is the only one on the page.
  const unnamedCheckable = ['checkbox', 'radio', 'switch'].includes(target.role) && !target.name;
  if (!forceAmbiguous && matches.length < 2 && !unnamedCheckable) return undefined;
  const label = nearestLabelInSnapshot(lines, target);
  if (!label) return undefined;
  const roleOptions = target.name ? `, { name: '${escapeTsLiteral(target.name)}' }` : '';
  const locator = `page.getByText('${escapeTsLiteral(label)}', { exact: true }).locator('xpath=ancestor::*[${descendantPredicate(target.role)}][1]').getByRole('${target.role}'${roleOptions})`;
  return { role: target.role, name: target.name, matches: Math.max(matches.length, unnamedCheckable ? 1 : 2), label, locator };
}

/**
 * Build the VERIFIED-LIVE interaction contract for a ref-based action, from the snapshot the action ran
 * against. `custom` flags the cases where a bare getByRole is unsafe: an unnamed checkable widget or an
 * ambiguous role. Generic — no app-specific classes or names.
 */
export function interactionEvidenceForRef(
  snapshot: string,
  ref: string,
  action: string,
  provenLocator: string,
  scopeHint?: LocatorScopeHint,
): InteractionEvidence | undefined {
  if (!snapshot || !ref) return undefined;
  const lines = snapshot.split('\n');
  const controls = lines.map(snapshotControl).filter((control): control is SnapshotControl => Boolean(control));
  const target = controls.find((control) => lines[control.index].includes(`[ref=${ref}]`));
  if (!target) return undefined;
  const uniqueness = controls.filter((control) => control.role === target.role && control.name === target.name).length;
  const label = scopeHint?.label || nearestLabelInSnapshot(lines, target) || target.name;
  const unnamedCheckable = ['checkbox', 'radio', 'switch'].includes(target.role) && !target.name;
  const custom = unnamedCheckable || uniqueness > 1;
  return {
    controlId: label || target.name || ref,
    action,
    semanticRole: target.role,
    accessibleName: target.name,
    locatorEvidence: scopeHint?.locator || provenLocator || '',
    interactionTarget: `${target.role}${target.name ? ` "${target.name}"` : ' (unnamed)'} [ref=${ref}]`,
    uniqueness,
    custom,
    actionability: 'verified-live',
    provenByLiveTrace: true,
  };
}


const UNIQUE_FIELD_LABEL = /\b(employee\s*id|identifier|username|e-?mail|code|reference|record\s*number)\b/i;
const FINAL_SUBMIT_LABEL = /^(save|submit|create|register)$/i;

/** Find unnamed or named unique inputs associated with a nearby live snapshot label. */
function uniqueInputRefs(snapshot: string): string[] {
  const lines = snapshot.split('\n');
  const refs = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const ref = lines[index].match(/textbox[^\n]*\[ref=([a-z0-9]+)\]/)?.[1];
    if (!ref) continue;
    const context = lines.slice(Math.max(0, index - 3), index + 1).join('\n');
    if (UNIQUE_FIELD_LABEL.test(context)) refs.add(ref);
  }
  return [...refs];
}

/** App placeholder text ("-- Select --", "Select…", "Please Select") means NOTHING is chosen yet,
 * so a dropdown showing it is EMPTY and must still be filled — never treated as prepopulated. */
function isPlaceholderValue(value: string): boolean {
  const v = value.trim().replace(/\s+/g, ' ');
  if (!v) return true;
  if (/^-+\s*select\b/i.test(v)) return true;                     // "-- Select --", "--Select"
  if (/^select(\s+(an?|one|option))?\s*(\.\.\.|…)?$/i.test(v)) return true; // "Select", "Select..."
  if (/^please\s+select\b/i.test(v)) return true;                 // "Please Select"
  if (/^-{2,}.*-{2,}$/.test(v)) return true;                      // any "-- … --" wrapper
  return false;
}

/** Leading-whitespace width of a snapshot line = its depth in the accessibility tree. */
function lineIndent(line: string): number {
  return (line.match(/^(\s*)/)?.[1].length) || 0;
}

/** The nearest PRECEDING label line that names a control (never the value line itself). */
function precedingLabel(lines: string[], index: number, ref: string): string {
  return [...lines.slice(Math.max(0, index - 4), index)].reverse()
    .map((line) => line.match(/:\s*(.+?)\s*$/)?.[1]?.replace(/"/g, '').replace(/\*$/, '').trim() || '')
    .find((text) => text && !/^\d+$/.test(text) && !text.includes('[ref=')) || `Field ${ref}`;
}

/** The SELECTED value shown inside an OXD/native dropdown control, read from its child lines.
 * A dropdown never carries its value inline on the control row (unlike a textbox); the chosen
 * text lives on a deeper `generic [ref]: value` leaf, or a native `option "X" [selected]` child.
 * Icon-font carets (private-use glyphs with no letters/digits) are skipped — only real text counts. */
function dropdownSelectedValue(lines: string[], controlIndex: number): string {
  const controlIndent = lineIndent(lines[controlIndex]);
  for (let j = controlIndex + 1; j < lines.length && lineIndent(lines[j]) > controlIndent; j += 1) {
    const selectedOption = lines[j].match(/^\s*-?\s*option\s+"([^"]+)"[^\n]*\[selected\]/)?.[1]?.trim();
    if (selectedOption && /[a-z0-9]/i.test(selectedOption)) return selectedOption;
    const genericLeaf = lines[j].match(/^\s*-?\s*generic\s+\[ref=[a-z0-9]+\]:\s*"?([^"\n]+?)"?\s*$/)?.[1]?.trim();
    if (genericLeaf && /[a-z0-9]/i.test(genericLeaf)) return genericLeaf;
  }
  return '';
}

/** Capture non-empty fields present on the first snapshot of a form page before the agent touches
 * them — text inputs (value inline), dropdowns (value on a child line), and pre-checked radios. */
function prepopulatedFields(snapshot: string, filledRefs: Set<string>): PrepopulatedField[] {
  const lines = snapshot.split('\n');
  const fields: PrepopulatedField[] = [];
  const seen = new Set<string>();
  const add = (field: PrepopulatedField): void => {
    if (!field.ref || seen.has(field.ref) || filledRefs.has(field.ref)) return;
    if (!field.value || isPlaceholderValue(field.value)) return;
    seen.add(field.ref);
    fields.push(field);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // 1) TEXT INPUT — the auto-filled value is rendered inline on the textbox row itself.
    const textRef = line.match(/textbox[^\n]*\[ref=([a-z0-9]+)\]/)?.[1];
    if (textRef) {
      const value = line.match(/:\s*"([^"]+)"/)?.[1]?.trim() || '';
      if (value) {
        // Prefer the input's own accessible name; otherwise the nearest PRECEDING label line names
        // the field. Never derive the label from the value line itself (that produced value-as-label).
        const inlineName = line.match(/textbox\s+"([^"]+)"/)?.[1]?.trim();
        const label = inlineName || precedingLabel(lines, index, textRef);
        add({ ref: textRef, label, value, kind: 'text', context: lines.slice(Math.max(0, index - 3), index + 1).join('\n') });
      }
      continue;
    }

    // 2) DROPDOWN / SELECT — a clickable combobox, or an OXD-style clickable `generic`, whose
    //    chosen value sits on a deeper child line. A placeholder child ("-- Select --") is treated
    //    as EMPTY by `add`, so a genuinely-unselected dropdown is still left for the agent to fill.
    const dropRef = line.match(/^\s*-?\s*combobox\b[^\n]*\[ref=([a-z0-9]+)\]/)?.[1]
      || line.match(/^\s*-?\s*generic\b[^\n]*\[ref=([a-z0-9]+)\][^\n]*\[cursor=pointer\]/)?.[1];
    if (dropRef) {
      const value = dropdownSelectedValue(lines, index);
      if (value) {
        add({ ref: dropRef, label: precedingLabel(lines, index, dropRef), value, kind: 'dropdown', context: lines.slice(Math.max(0, index - 3), index + 3).join('\n') });
      }
      continue;
    }

    // 3) RADIO GROUP — an option already marked [checked] at initial load is an app default.
    if (/\bradio\b/.test(line) && /\[checked\]/.test(line)) {
      const radioRef = line.match(/\[ref=([a-z0-9]+)\]/)?.[1];
      const value = line.match(/radio\s+"([^"]+)"/)?.[1]?.trim() || '';
      if (radioRef && value) {
        const label = precedingLabel(lines, index, radioRef);
        add({ ref: radioRef, label: /^Field\s/.test(label) ? value : label, value, kind: 'radio', context: lines.slice(Math.max(0, index - 3), index + 1).join('\n') });
      }
      continue;
    }
  }
  return fields;
}

/** Infer a unique field's observed format from its auto-filled value, when one is present. */
function uniqueInputFormat(snapshot: string, ref: string): 'numeric' | 'email' | null {
  const line = snapshot.split('\n').find((candidate) => candidate.includes(`[ref=${ref}]`)) || '';
  const value = line.match(/:\s*"([^"]+)"/)?.[1] || '';
  if (/^\d+$/.test(value)) return 'numeric';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
  return null;
}

/** Return a concrete validation line from a post-submit snapshot, avoiding static form legends. */
function validationFromSnapshot(snapshot: string): string | null {
  return snapshot.split('\n').find((line) => /\b(already exists|already taken|duplicate|invalid|must be|should be|error)\b/i.test(line))?.trim() || null;
}

const POST_SUBMIT_POLL_INTERVAL_MS = 1500;
const POST_SUBMIT_TIMEOUT_MS = 30000;

interface SubmitOutcome {
  outcome: 'success' | 'validation' | 'timeout';
  url: string;
  snapshot: string;
  raw: string;
  validation: string | null;
}

/**
 * Bounded watcher run after ANY form submit: poll the live page until it either navigates away
 * (success), shows an inline validation (let the model react), or the timeout elapses (genuine
 * failure). Replaces the single immediate snapshot that raced the app's post-submit redirect.
 */
async function watchSubmitOutcome(session: CliSession, submitUrl: string): Promise<SubmitOutcome> {
  const deadline = Date.now() + POST_SUBMIT_TIMEOUT_MS;
  let last: SubmitOutcome = { outcome: 'timeout', url: submitUrl, snapshot: '', raw: '', validation: null };
  for (;;) {
    const raw = await session.run(['snapshot']);
    const snapshot = extractYaml(raw);
    const url = extractPageUrl(raw) || submitUrl;
    const validation = validationFromSnapshot(snapshot);
    last = { outcome: 'timeout', url, snapshot, raw, validation };
    if (url && url !== submitUrl) return { ...last, outcome: 'success' };
    if (validation) return { ...last, outcome: 'validation' };
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, POST_SUBMIT_POLL_INTERVAL_MS));
  }
}

/** Field types whose "was it filled?" is reliably detectable from a fill action (text-like inputs). */
const HARD_GATE_TYPES = new Set<FieldInventoryItem['type']>(['textbox', 'textarea', 'date']);

/** Normalise a label for tolerant comparison between the inventory and a live fill target. */
function normalizeLabel(text: string): string {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Does this snapshot look like a login form (so we must NOT run feature discovery on it yet)? */
function looksLikeLoginForm(snapshot: string): boolean {
  const hasLoginButton = /button[^\n]*"(?:log\s?in|sign\s?in)"/i.test(snapshot);
  const hasUserField = /(?:textbox|searchbox)[^\n]*"(?:username|user\s?name|email)"/i.test(snapshot);
  return hasLoginButton && hasUserField;
}

/** The label a fill/select/check action targeted — the control's own name, else its live scoped label. */
function filledLabelForRef(snapshot: string, rows: Map<string, RefRow>, ref: string): string {
  const name = rows.get(ref)?.name || '';
  if (name && !/^(type here|--\s*select|select|please select)/i.test(name.trim())) return name;
  const hint = deriveLocatorScopeHint(snapshot, ref, true);
  return hint?.label || name;
}

/** Human-readable inventory guidance injected into the snapshot result so the model fills EVERYTHING. */
function inventoryGuidance(inventory: FieldInventoryItem[]): string {
  if (!inventory.length) return '';
  const fill: string[] = [];
  const blocked: string[] = [];
  const prepop: string[] = [];
  const actions: string[] = [];
  for (const it of inventory) {
    const req = it.required === true ? ' (required)' : it.required === false ? ' (optional)' : '';
    if (it.isAction) { actions.push(it.label); continue; }
    if (it.prepopulated) { prepop.push(it.label); continue; }
    if (it.blocked) { blocked.push(`${it.label} — BLOCKED: ${it.blockedReason || 'not automatable'}`); continue; }
    fill.push(`${it.label} [${it.type}]${req}`);
  }
  const lines = ['', 'DISCOVERED FIELD INVENTORY (fill EVERY field below with realistic valid data before Save — do not skip optional ones):'];
  if (fill.length) lines.push(...fill.map((f) => `  • ${f}`));
  if (prepop.length) lines.push(`  App-prepopulated (leave untouched): ${prepop.join(', ')}`);
  if (blocked.length) lines.push(...blocked.map((b) => `  ⛔ ${b}`));
  if (actions.length) lines.push(`  Action(s): ${actions.join(', ')}`);
  return lines.join('\n');
}

/* ── Post-navigation content-readiness settling ───────────────────────────────────────────────
 * A client-rendered SPA paints its application shell (sidebar/topbar navigation) synchronously but
 * hydrates the feature content (form fields, data tables, action buttons) a moment later, after its
 * data request resolves. A single immediate snapshot can race that hydration and capture shell-only —
 * so the model sees no form and wrongly concludes the feature is missing. These helpers add a GENERIC,
 * bounded readiness check: classify a snapshot as shell-only vs feature-content (by a11y ROLE — never
 * app-specific locators) and re-snapshot a few times, briefly, until content appears. This does NOT
 * relax any success/completeness gate; it only ensures the model reads a settled page. */

/** App-shell/navigation roles present on essentially every authenticated page. */
const SHELL_ROLES = new Set(['link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab']);
/** Form-control roles that indicate real, actionable feature content. */
const FORM_FIELD_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'slider']);
/** Field roles the nav shell essentially never contains — one is strong proof of feature content. */
const STRONG_FIELD_ROLES = new Set(['spinbutton', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'slider']);
/** Tabular/data roles that indicate a list/search/detail feature screen. */
const DATA_ROLES = new Set(['table', 'grid', 'treegrid', 'row', 'gridcell', 'cell', 'columnheader', 'rowheader', 'option']);
/** Generic action-verb vocabulary (NOT app-specific) — a button named like this is feature content. */
const ACTION_BUTTON_RE = /\b(save|submit|apply|search|add|create|update|edit|delete|remove|assign|upload|download|confirm|reset|next|continue|register|generate)\b/i;
/** Loading/progress signals — while present, feature content is still rendering. */
const LOADING_RE = /\b(progressbar|loading|please wait|processing|spinner)\b/i;

/** Verdict of classifying a live snapshot as app-shell vs feature content. Pure + unit-tested. */
export interface ReadinessVerdict {
  /** Feature content (form fields / data / action button) is present — safe for the model to act. */
  ready: boolean;
  featureFields: number;
  navControls: number;
  strongField: boolean;
  dataRegion: boolean;
  actionButton: boolean;
  loading: boolean;
  interactable: number;
  reason: string;
}

/**
 * Classify a live accessibility snapshot as application-shell-only vs feature-content-ready — using
 * ONLY generic a11y roles/verbs (never app-specific locators). "45 interactable elements" made up of
 * nav links/menuitems is NOT ready; a form field, data table, or action button IS. A lone searchbox is
 * treated as the shell's menu filter, so a single field alone does not count as ready.
 */
export function classifyReadiness(snapshot: string): ReadinessVerdict {
  const text = String(snapshot || '');
  const rowRe = /^\s*-?\s*([a-zA-Z]+)(?:\s+"([^"]*)")?[^\n]*\[ref=[a-z0-9]+\]/;
  let featureFields = 0;
  let navControls = 0;
  let strongField = false;
  let dataRegion = false;
  let actionButton = false;
  for (const line of text.split('\n')) {
    const m = line.match(rowRe);
    if (!m) continue;
    const role = m[1].toLowerCase();
    const name = (m[2] || '').trim();
    if (FORM_FIELD_ROLES.has(role)) {
      featureFields += 1;
      if (STRONG_FIELD_ROLES.has(role)) strongField = true;
    } else if (DATA_ROLES.has(role)) {
      dataRegion = true;
    } else if (SHELL_ROLES.has(role)) {
      navControls += 1;
    } else if (role === 'button' && ACTION_BUTTON_RE.test(name)) {
      actionButton = true;
    }
  }
  const loading = LOADING_RE.test(text);
  // Require a strong field, a data region, an action button, or >=2 fields (e.g. a login/multi-field
  // form). A single searchbox is the shell's menu filter, so it is NOT enough on its own.
  const ready = strongField || dataRegion || actionButton || featureFields >= 2;
  const reason = ready
    ? 'feature content present'
    : loading
      ? 'loading indicator present — feature content not yet rendered'
      : navControls > 0
        ? 'only application shell/navigation present'
        : 'no feature content detected';
  return { ready, featureFields, navControls, strongField, dataRegion, actionButton, loading, interactable: parseRefs(text).length, reason };
}

/** Minimal runner surface the settler needs — CliSession satisfies it; tests pass a stub. */
export interface SnapshotRunner {
  run(args: string[], timeoutMs?: number): Promise<string>;
}

export interface SettleOptions {
  maxAttempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface SettleResult {
  raw: string;
  snapshot: string;
  verdict: ReadinessVerdict;
  attempts: number;
  /** true when feature content appeared within the bounded budget. */
  settled: boolean;
}

const DEFAULT_SETTLE_ATTEMPTS = 6;
const DEFAULT_SETTLE_INTERVAL_MS = 800;
const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bounded, post-navigation content-readiness settler. Snapshots, and while the page shows only the
 * app shell/navigation, waits a SHORT interval and re-snapshots — up to a small budget — so an SPA
 * form has time to hydrate before the model reads it. Returns the moment feature content appears;
 * NEVER a single long fixed sleep, and NEVER blocks past the bounded budget (CI-safe).
 */
export async function settleForContent(session: SnapshotRunner, opts: SettleOptions = {}): Promise<SettleResult> {
  const maxAttempts = opts.maxAttempts && opts.maxAttempts > 0 ? opts.maxAttempts : DEFAULT_SETTLE_ATTEMPTS;
  const intervalMs = opts.intervalMs && opts.intervalMs >= 0 ? opts.intervalMs : DEFAULT_SETTLE_INTERVAL_MS;
  const sleep = opts.sleep || realSleep;
  let raw = '';
  let snapshot = '';
  let verdict = classifyReadiness('');
  let attempts = 0;
  for (let i = 0; i < maxAttempts; i += 1) {
    raw = await session.run(['snapshot']);
    snapshot = extractYaml(raw);
    verdict = classifyReadiness(snapshot);
    attempts = i + 1;
    if (verdict.ready) return { raw, snapshot, verdict, attempts, settled: true };
    if (i < maxAttempts - 1) {
      opts.log?.(`[agent] settling — attempt ${attempts}/${maxAttempts}: ${verdict.reason} (${verdict.interactable} interactable, ${verdict.navControls} nav); re-snapshot in ${intervalMs}ms`);
      await sleep(intervalMs);
    }
  }
  return { raw, snapshot, verdict, attempts, settled: false };
}

/** Diagnostics captured when the bounded settler still finds no feature content. */
export interface ReadinessDiagnostics {
  url: string;
  heading: string;
  interactable: number;
  navControls: number;
  featureFields: number;
  loadingIndicator: boolean;
  attempts: number;
  reason: string;
  snapshotExcerpt: string;
}

/** First heading in a snapshot — a human label for the current screen (a11y title proxy). */
export function snapshotHeading(snapshot: string): string {
  const m = String(snapshot || '').match(/^\s*-?\s*heading\s+"([^"]+)"/m);
  return m ? m[1].trim() : '';
}

/** Assemble structured diagnostics for a still-not-ready page (logged + fed back to the model). */
export function buildReadinessDiagnostics(snapshot: string, url: string, verdict: ReadinessVerdict, attempts: number): ReadinessDiagnostics {
  return {
    url: url || '(unknown)',
    heading: snapshotHeading(snapshot) || '(no heading in a11y tree)',
    interactable: verdict.interactable,
    navControls: verdict.navControls,
    featureFields: verdict.featureFields,
    loadingIndicator: verdict.loading,
    attempts,
    reason: verdict.reason,
    snapshotExcerpt: String(snapshot || '').slice(0, 1200),
  };
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const log = opts.onLog || ((l: string) => console.log(l));
  const creds = opts.credentials || resolveCredentials();
  // Credential VALUES are always redacted from logs/traces/tool results — they never reach the LLM.
  const secrets = [...(opts.secrets || []), creds.username, creds.password].filter(Boolean);
  const maxSteps = opts.maxSteps && opts.maxSteps > 0 ? opts.maxSteps : 25;
  const model = opts.model || process.env.OPENAI_MODEL || 'gpt-4o';

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });

  const session = new CliSession();
  const steps: AgentStep[] = [];
  const diagnostics: FailureDiagnosis[] = [];
  let liveRefs = new Set<string>();
  let liveRows = new Map<string, RefRow>();
  let latestSnapshot = '';
  let lastPageUrl = opts.url;
  let filledRefs = new Set<string>();
  let prepopulatedRefs = new Set<string>();
  let initialSnapshotUrls = new Set<string>();
  // Exhaustive-discovery state: the bounded read-only inventory of the feature form, plus the set of
  // field labels the agent has actually filled — used to gate the single success submit until every
  // discovered text field is populated (deterministic completeness of the success trace).
  let discovery: DiscoveryResult | undefined;
  let discoveredInventory: FieldInventoryItem[] = [];
  let discoveryRan = false;
  const filledLabels = new Set<string>();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `# Feature URL\n${opts.url}\n\n# Goal\n${opts.goal}` },
  ];

  const finish = (status: AgentLoopResult['status'], summary: string): AgentLoopResult => ({ status, summary, steps, discovery, diagnostics });

  try {
    // Open a headless session, optionally load a saved auth state, then land on the feature URL.
    await session.run(['open']);
    if (opts.stateFile && existsSync(opts.stateFile)) {
      await session.run(['state-load', opts.stateFile]);
      log('[agent] Loaded saved storage state (no credentials pass through the CLI).');
    }
    const gotoOut = await session.run(['goto', opts.url]);
    log(`[agent] Opened ${extractPageUrl(gotoOut) || opts.url}`);

    for (let step = 1; step <= maxSteps; step++) {
      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        parallel_tool_calls: false, // one live action at a time — the core of the fix
        temperature: 0,
      };
      // Some gateways force a default reasoning_effort that conflicts with function tools on
      // /v1/chat/completions. Send OPENAI_REASONING_EFFORT (e.g. "none") only when it is set.
      const effort = (process.env.OPENAI_REASONING_EFFORT || '').trim();
      if (effort) (params as unknown as Record<string, unknown>).reasoning_effort = effort;
      const completion = await client.chat.completions.create(params);

      const choice = completion.choices[0]?.message;
      if (!choice) return finish('incomplete', 'No response from the model.');

      // No tool call → the model is done talking; treat as incomplete unless it explicitly finished.
      const toolCalls = choice.tool_calls || [];
      if (!toolCalls.length) {
        return finish('incomplete', choice.content || 'Model returned no tool call.');
      }

      messages.push(choice);

      // parallel_tool_calls is off, so there is exactly one call to service.
      const call = toolCalls[0];
      if (call.type !== 'function') {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Unsupported tool call type.' });
        continue;
      }
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* keep {} */ }

      // Terminal tool.
      if (name === 'finish') {
        const status = (['passed', 'failed', 'incomplete'].includes(String(args.status)) ? args.status : 'incomplete') as AgentLoopResult['status'];
        const summary = String(args.summary || '');
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'ok' });
        log(`[agent] finish → ${status}: ${summary}`);
        return finish(status, summary);
      }

      // Anti-hallucination guard: a ref-based action must target a ref from the latest snapshot.
      if (REF_TOOLS.has(name)) {
        const ref = String(args.ref || '');
        if (!liveRefs.has(ref)) {
          const msg = `Ref "${ref}" is not present in the most recent snapshot. Call snapshot first and pick a ref from the returned list.`;
          messages.push({ role: 'tool', tool_call_id: call.id, content: msg });
          log(`[agent] ✗ ${name}(${ref}) rejected — stale/invalid ref; asking model to snapshot.`);
          continue;
        }
      }

      const actionRef = String(args.ref || '');
      const isFinalSubmit = name === 'click' && FINAL_SUBMIT_LABEL.test(liveRows.get(actionRef)?.name || '');
      if (isFinalSubmit) {
        const missingUniqueRefs = uniqueInputRefs(latestSnapshot)
          .filter((ref) => !filledRefs.has(ref) && !prepopulatedRefs.has(ref));
        if (missingUniqueRefs.length) {
          const msg = `Before submitting, fill a fresh value into each visible unique field ref: ${missingUniqueRefs.join(', ')}. Do not rely on an auto-filled default.`;
          messages.push({ role: 'tool', tool_call_id: call.id, content: msg });
          log(`[agent] ✗ ${name}(${actionRef}) blocked — ${msg}`);
          continue;
        }
        // Exhaustive-coverage gate: the single success submit must not fire while any discovered
        // text-like field is still empty. This deterministically forces the trace to include an
        // action per field (fixing shallow 3-field tests) without deadlocking on custom dropdowns
        // (those are strongly guided in the inventory text but not hard-gated here).
        const missingFields = discoveredInventory.filter((it) =>
          !it.isAction && !it.blocked && !it.prepopulated && HARD_GATE_TYPES.has(it.type)
          && !filledLabels.has(normalizeLabel(it.label)) && !filledLabels.has(normalizeLabel(it.accessibleName)));
        if (missingFields.length) {
          const msg = `Before Save, fill EVERY discovered field first. Still empty: ${missingFields.map((f) => f.label).join(', ')}. Fill each with realistic valid data (optional fields too), then Save.`;
          messages.push({ role: 'tool', tool_call_id: call.id, content: msg });
          log(`[agent] ✗ ${name}(${actionRef}) blocked — ${missingFields.length} discovered field(s) still empty.`);
          continue;
        }
      }

      if (name === 'fill' || name === 'type') {
        if (prepopulatedRefs.has(actionRef)) {
          const msg = `Field ref ${actionRef} was app-prepopulated in the initial form snapshot. Leave it untouched unless the goal explicitly requires a custom value.`;
          messages.push({ role: 'tool', tool_call_id: call.id, content: msg });
          log(`[agent] ✗ ${name}(${actionRef}) blocked — ${msg}`);
          continue;
        }
        const format = uniqueInputRefs(latestSnapshot).includes(actionRef)
          ? uniqueInputFormat(latestSnapshot, actionRef)
          : null;
        const value = String(name === 'fill' ? args.value : args.text ?? '');
        const invalidFormat = (format === 'numeric' && !/^\d+$/.test(value))
          || (format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
        if (invalidFormat) {
          const msg = `The live auto-filled unique field ref ${actionRef} uses ${format} format. Fill a fresh ${format} value instead.`;
          messages.push({ role: 'tool', tool_call_id: call.id, content: msg });
          log(`[agent] ✗ ${name}(${actionRef}) blocked — ${msg}`);
          continue;
        }
      }

      // For fill/type, swap credential placeholders for the real env values RIGHT BEFORE running the
      // CLI. The model only ever emits {{USERNAME}}/{{PASSWORD}}, so the real secret never enters the
      // transcript; the executed action still performs a genuine login. The value we keep in the
      // trace (for codegen) stays the placeholder, and all output is redacted.
      let placeholderValue = '';
      if (name === 'fill' || name === 'type') {
        const rawVal = String((name === 'fill' ? args.value : args.text) ?? '');
        placeholderValue = rawVal;
        const { value: realVal } = substituteCredentials(rawVal, creds);
        if (name === 'fill') args = { ...args, value: realVal };
        else args = { ...args, text: realVal };
      }

      const argv = buildCommand(name, args);
      if (!argv) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: `Missing required argument(s) for ${name}.` });
        continue;
      }

      // `snapshot` uses a bounded content-readiness settler so an SPA form has time to hydrate before
      // the model reads it; every other tool executes exactly once.
      let readinessNote = '';
      let raw: string;
      if (name === 'snapshot') {
        const settle = await settleForContent(session, { log });
        raw = settle.raw;
        if (settle.attempts > 1) log(`[agent] content-readiness settled after ${settle.attempts} snapshot attempt(s) — ${settle.verdict.reason}`);
        if (!settle.settled) {
          const diagUrl = extractPageUrl(raw) || lastPageUrl;
          const diag = buildReadinessDiagnostics(settle.snapshot, diagUrl, settle.verdict, settle.attempts);
          const shotPath = `blast-readiness-${Date.now().toString(36)}.png`;
          await session.run(['screenshot', shotPath]).catch(() => {});
          log(`[agent] \u26a0 readiness diagnostics — reason="${diag.reason}" url=${diag.url} heading="${diag.heading}" interactable=${diag.interactable} nav=${diag.navControls} fields=${diag.featureFields} loading=${diag.loadingIndicator} attempts=${diag.attempts} screenshot=${shotPath}`);
          readinessNote = `\n\nREADINESS DIAGNOSTIC (this does NOT relax any success gate): after ${diag.attempts} bounded re-snapshots the page still shows ${diag.reason}. url=${diag.url}; heading="${diag.heading}"; interactable=${diag.interactable}; navControls=${diag.navControls}; formFields=${diag.featureFields}; loadingIndicator=${diag.loadingIndicator}. If this feature should render a form it did not hydrate; otherwise the signed-in user may lack the data/permission to see it. Never report success without the actual form.`;

          // GENERIC dynamic-page failure diagnosis: gather browser-level root-cause evidence
          // (console errors, failed/4xx-5xx network, DOM/page state, iframes) via the CLI's real
          // DevTools subcommands and classify WHY the content is absent. Informational ONLY — it
          // never relaxes a success gate; the model must still finish("failed") when the form is
          // genuinely missing. No extra waits, no retries, no app-specific selectors.
          try {
            const pd = await collectPageDiagnostics(session, {
              url: diagUrl,
              screenshotPath: shotPath,
              a11yInteractable: diag.interactable,
              a11yFields: diag.featureFields,
              a11yHeading: diag.heading,
            });
            const diagnosis = classifyFailure(pd);
            diagnostics.push(diagnosis);
            const report = redact(formatDiagnosticsReport(pd, diagnosis), secrets);
            log(`[agent] \ud83d\udd2c dynamic-failure diagnosis — category=${diagnosis.category} console=${pd.console.errors}e/${pd.console.warnings}w network=${pd.network.failed.length}failed/${pd.network.total} domInputs=${pd.page.inputs} readyState=${pd.readyState || '?'}`);
            for (const line of report.split('\n')) log(`[diag] ${line}`);
            readinessNote += `\n\n${report}\n\nUse this to decide the outcome: if the feature form is genuinely absent, call finish("failed") and state the root-cause category (${diagnosis.category}); never report success without the actual form.`;
          } catch (e) {
            log(`[agent] dynamic-failure diagnosis skipped: ${(e as Error).message}`);
          }
        }
      } else {
        raw = await session.run(argv);
      }
      let toolResult: string;

      if (name === 'snapshot') {
        const yaml = extractYaml(raw);
        const refs = parseRefs(yaml);
        liveRefs = new Set(refs.map((r) => r.ref));
        liveRows = new Map(refs.map((ref) => [ref.ref, ref]));
        latestSnapshot = yaml;
        const pageUrl = extractPageUrl(raw);
        const snapshotUrl = pageUrl || lastPageUrl;
        const isInitialSnapshot = !initialSnapshotUrls.has(snapshotUrl);
        const detectedPrepopulatedFields = isInitialSnapshot ? prepopulatedFields(yaml, filledRefs) : [];
        if (isInitialSnapshot) initialSnapshotUrls.add(snapshotUrl);
        for (const field of detectedPrepopulatedFields) prepopulatedRefs.add(field.ref);
        if (detectedPrepopulatedFields.length) {
          steps.push({
            tool: 'snapshot',
            args: { initial: true, reason: 'prepopulated-field-detection' },
            context: redact(yaml, secrets).slice(0, 5000),
            prepopulatedFields: detectedPrepopulatedFields.map((field) => ({
              ...field,
              value: redact(field.value, secrets),
              context: redact(field.context, secrets),
            })),
            url: snapshotUrl,
            result: redact(raw, secrets).slice(0, 5000),
          });
        }
        const prepopulatedSummary = detectedPrepopulatedFields.length
          ? `\n\nApp-prepopulated fields — do NOT overwrite: ${detectedPrepopulatedFields.map((field) => `${field.label} (ref ${field.ref})`).join(', ')}`
          : '';

        // EXHAUSTIVE DISCOVERY: the first time we land on a real feature form (not the login page),
        // run a bounded, read-only inventory of the WHOLE screen so the model fills every field — not
        // just the first few. Discovery scrolls + re-snapshots, so afterwards the model must snapshot
        // again before any ref action (its refs are now stale — we clear liveRefs to force it).
        let discoveryGuidance = '';
        if (opts.discover !== false && !discoveryRan) {
          const preview = parseInventory(yaml).filter((it) => !it.isAction);
          const fillable = preview.filter((it) => ['textbox', 'textarea', 'combobox', 'select', 'checkbox', 'radio', 'date', 'file'].includes(it.type));
          if (!looksLikeLoginForm(yaml) && fillable.length >= 2) {
            discoveryRan = true;
            try {
              discovery = await runDiscovery(session, {
                featureUrl: snapshotUrl, feature: opts.feature || opts.goal.slice(0, 60),
                log,
                // Deep-crawl (bounded, reversible state-transition capture) is ON by default so codegen
                // gets live dropdown options / date-picker / dependent-field evidence. DEEP_CRAWL=0 opts out.
                deepCrawl: process.env.DEEP_CRAWL !== '0',
                exploreStates: process.env.DISCOVER_STATES === '1',
              });
              discoveredInventory = discovery.inventory;
              discoveryGuidance = inventoryGuidance(discoveredInventory);
              // Discovery moved the page (scroll/goto) — the model must re-snapshot before acting.
              liveRefs = new Set();
              log(`[agent] discovery complete — ${discoveredInventory.length} control(s), ${discovery.transitions.length} transition(s); completeness ${discovery.completeness.passed ? 'PASS' : 'gaps: ' + discovery.completeness.missing.join('; ')}`);
            } catch (e) {
              log(`[agent] discovery skipped: ${(e as Error).message}`);
            }
          }
        }

        toolResult = `Current URL: ${pageUrl || '(unchanged)'}\n\nInteractable elements you may act on now:\n${renderRefs(refs)}\n\nPage tree (context):\n${yaml.slice(0, 2500)}${prepopulatedSummary}${discoveryGuidance}${readinessNote}`;
        if (discoveryGuidance) toolResult += '\n\nNOTE: the page was scrolled during discovery — call snapshot again to get fresh refs before filling.';
        log(`[agent] snapshot → ${refs.length} interactable element(s)`);
        if (pageUrl) lastPageUrl = pageUrl;
      } else {
        const locator = extractRanLocator(raw);
        const pageUrl = extractPageUrl(raw);
        const context = snapshotContextForRef(latestSnapshot, String(args.ref || ''));
        const positionalLocator = /\.(?:first|last|nth)\s*\(/.test(locator);
        const scopeHint = deriveLocatorScopeHint(latestSnapshot, String(args.ref || ''), positionalLocator);
        // After any navigation/action the old refs are stale — force a fresh snapshot next.
        if (name === 'goto' || name === 'goBack') liveRefs = new Set();
        // Persist the PLACEHOLDER (never the real credential) so codegen stays secret-free.
        const recordedArgs = placeholderValue
          ? { ...args, ...(name === 'fill' ? { value: placeholderValue } : { text: placeholderValue }) }
          : args;
        if (name === 'fill' || name === 'type') filledRefs.add(actionRef);
        // Record which discovered field this action populated, so the success-submit completeness gate
        // knows the field is done. Covers text inputs (fill/type), native selects, and checkboxes.
        if (['fill', 'type', 'select', 'check', 'uncheck'].includes(name) && actionRef) {
          const label = filledLabelForRef(latestSnapshot, liveRows, actionRef);
          if (label) filledLabels.add(normalizeLabel(label));
        }
        // Capture the VERIFIED-LIVE interaction contract for ref-based actions (strongest codegen evidence).
        const interaction = actionRef
          ? interactionEvidenceForRef(latestSnapshot, actionRef, name, locator, scopeHint)
          : undefined;
        steps.push({
          tool: name,
          args: recordedArgs,
          locator,
          context: context ? redact(context, secrets) : undefined,
          scopeHint,
          interaction,
          url: pageUrl,
          result: redact(raw, secrets).slice(0, 400),
        });
        toolResult = [
          locator ? `Ran: ${redact(locator, secrets)}` : 'Action executed.',
          pageUrl ? `Current URL: ${pageUrl}` : '',
          'Call snapshot to see the updated page before your next ref-based action.',
        ].filter(Boolean).join('\n');
        log(`[agent] ${step}. ${name} ✓${pageUrl ? ` (→ ${pageUrl})` : ''}`);
        if (isFinalSubmit) {
          const submitUrl = pageUrl || lastPageUrl;
          const watch = await watchSubmitOutcome(session, submitUrl);
          const watchRefs = parseRefs(watch.snapshot);
          liveRefs = new Set(watchRefs.map((ref) => ref.ref));
          liveRows = new Map(watchRefs.map((ref) => [ref.ref, ref]));
          latestSnapshot = watch.snapshot;
          if (watch.url) lastPageUrl = watch.url;
          steps.push({
            tool: 'snapshot',
            args: { automatic: true, after: 'submit', outcome: watch.outcome },
            context: redact(watch.snapshot, secrets).slice(0, 5000),
            url: watch.url,
            result: redact(watch.raw, secrets).slice(0, 5000),
          });
          log(`[agent] post-submit watcher → ${watch.outcome} (${watch.url})`);
          if (watch.outcome === 'success') {
            return finish('passed', `Verified submit navigation from ${submitUrl} to ${watch.url}.`);
          }
          if (watch.outcome === 'timeout') {
            return finish('failed', `Submit produced neither navigation nor a validation message within ${POST_SUBMIT_TIMEOUT_MS}ms (url stayed ${watch.url}).`);
          }
          toolResult += `\n\nAutomatic post-submit outcome: validation\nURL: ${watch.url}\nValidation detected: ${watch.validation}\n${watch.snapshot.slice(0, 2500)}`;
        }
        if (pageUrl) lastPageUrl = pageUrl;
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: redact(toolResult, secrets) });
    }

    return finish('incomplete', `Reached the ${maxSteps}-step budget without finishing.`);
  } catch (e) {
    return finish('failed', `Loop error: ${(e as Error).message}`);
  } finally {
    await session.run(['close']).catch(() => {});
  }
}

/* ── CLI entrypoint: `npx tsx agent-loop.ts --url … --goal …` ─────────────────── */

function parseArgv(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

const invokedDirectly =
  (process.argv[1] || '').replace(/\\/g, '/').endsWith('agent-loop.ts') ||
  (process.argv[1] || '').replace(/\\/g, '/').endsWith('agent-loop.js') ||
  process.env.AGENT_LOOP_MAIN === '1';

if (invokedDirectly) {
  const args = parseArgv(process.argv.slice(2));
  const url = args.url || process.env.AGENT_URL || '';
  const goal = args.goal || process.env.AGENT_GOAL || '';
  if (!url || !goal) {
    console.error('Usage: npx tsx agent-loop.ts --url <feature-url> --goal "<what to explore/verify>"');
    process.exit(2);
  }
  runAgentLoop({
    url,
    goal,
    model: args.model,
    maxSteps: args.max ? Number(args.max) : undefined,
    stateFile: args.state,
    secrets: (process.env.AGENT_SECRETS || '').split(',').map((s) => s.trim()).filter(Boolean),
  })
    .then((res) => {
      console.log(`\n=== RESULT: ${res.status.toUpperCase()} ===\n${res.summary}`);
      console.log(`\nProven actions (${res.steps.length}):`);
      res.steps.forEach((s, i) => console.log(`${i + 1}. ${s.tool}${s.locator ? ` → ${s.locator.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`));
      process.exit(res.status === 'passed' ? 0 : 1);
    })
    .catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
}
