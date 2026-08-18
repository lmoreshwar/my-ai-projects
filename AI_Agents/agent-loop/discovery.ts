/**
 * discovery.ts — the exhaustive, evidence-first discovery subsystem.
 * ─────────────────────────────────────────────────────────────────────────────
 * BLAST used to explore a feature by driving only its MINIMUM happy path, so the
 * generated test filled 3 of ~12 fields. This module replaces that shallow scan
 * with a BOUNDED, READ-ONLY inventory of the WHOLE feature screen:
 *
 *   1. Snapshot the live page (the agent-loop already logged in + navigated here).
 *   2. Progressively `press PageDown` + re-snapshot until the accessibility tree
 *      STOPS changing (bounded — never an unlimited crawl).
 *   3. Parse EVERY semantic control from the merged accessibility tree (not just the
 *      interactable shortlist `parseRefs` returns) into a stable field inventory,
 *      each item carrying its real label, role, required/optional evidence, and a
 *      live locator observation.
 *   4. Optionally (flag-gated, best-effort) open reversible states (custom dropdowns)
 *      to read their options, restoring the baseline with a fresh authenticated goto.
 *   5. Evaluate a COMPLETENESS gate over the collected evidence.
 *
 * SAFETY (identical guarantees to the agent-loop):
 *   - It is READ-ONLY. It never clicks Save/Submit/Create/Delete/Logout — those are
 *     recorded in the inventory as actions, never activated here.
 *   - File uploads are inventoried and marked `blocked` ("No approved test fixture
 *     available") — no file is ever invented or uploaded.
 *   - Refs (e15, f3e7…) are OBSERVATION ids only; the durable locator evidence is a
 *     role/label-anchored Playwright expression, never an ephemeral ref.
 *
 * It reuses the existing @playwright/cli `CliSession` — no new crawler, no
 * app-specific wiring. BASE_URL + credentials remain the only app-specific inputs.
 */

import { CliSession, extractYaml, extractPageUrl } from './playwright-cli-tools';
// A VALUE import creates a static cycle with agent-loop (which imports runDiscovery),
// but the binding is only ever READ inside functions at run time — long after both
// modules finish loading — so CommonJS/tsx resolve it correctly. Verified via the
// `node -e "require('./discovery')"` load test.
import { deriveLocatorScopeHint } from './agent-loop';

/* ── Contract types (the versioned discovery vocabulary) ─────────────────────── */

export type ControlKind =
  | 'textbox' | 'textarea' | 'combobox' | 'select' | 'checkbox' | 'radio'
  | 'date' | 'file' | 'button' | 'link' | 'tab' | 'option' | 'other';

/** Durable, evidence-backed way to reach a control. `snapshotRef` is an OBSERVATION id only. */
export interface LocatorEvidence {
  source: 'snapshot' | 'action' | 'dom-inspection';
  strategy: 'role-name' | 'label-scoped' | 'placeholder' | 'text' | 'ref-only';
  role?: string;
  name?: string;
  label?: string;
  /** Exact Playwright locator expression when one is derivable from the live tree; never guessed. */
  locator?: string;
  /** Ephemeral CLI ref at capture time — an observation handle, NEVER a generated-code locator. */
  snapshotRef: string;
}

/** One discovered control on the feature screen, with all the evidence a plan/codegen needs. */
export interface FieldInventoryItem {
  /** Stable slug derived from the label/name (survives ref churn across snapshots). */
  id: string;
  label: string;
  role: string;
  accessibleName: string;
  type: ControlKind;
  section?: string;
  /** true/false when observable from the live tree (`*`/[required]); null when not observable. */
  required: boolean | null;
  placeholder?: string;
  /** A value the app already supplied before any interaction (prepopulated default). */
  defaultValue?: string;
  prepopulated: boolean;
  /** Options for a dropdown/select — from native children or a best-effort reversible open. */
  options?: string[];
  /** Appeared only after a state transition (tab/accordion/dropdown), not on the initial tree. */
  dynamic: boolean;
  /** Can this control be exercised with generated data on a read-only-safe path? */
  executable: boolean;
  /** Recorded but NOT executable (e.g. file upload with no fixture, destructive-only action). */
  blocked: boolean;
  blockedReason?: string;
  /** Save/Submit/Cancel/Search — an action button, not a fillable field. */
  isAction: boolean;
  locatorEvidence: LocatorEvidence | null;
  /** A small bounded slice of the live tree around the control (evidence, kept under the doc cap). */
  snapshotExcerpt: string;
}

/** A reversible UI state visited during discovery (dropdown/tab/accordion/dialog). */
export interface DiscoveryState {
  id: string;
  kind: 'dropdown' | 'tab' | 'accordion' | 'dialog' | 'menu';
  trigger: string;
  options?: string[];
  revealedFieldIds: string[];
}

export interface ApplicationSummary {
  application: string;
  feature: string;
  entryUrl: string;
  finalUrl: string;
  pageTitle: string;
  headings: string[];
  authenticated: boolean;
}

export interface CompletenessCheck {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

/** The read-only discovery-time completeness gate (scenario-level gates live in codegen). */
export interface CompletenessGate {
  passed: boolean;
  checks: CompletenessCheck[];
  missing: string[];
}

export interface DiscoveryResult {
  applicationSummary: ApplicationSummary;
  inventory: FieldInventoryItem[];
  states: DiscoveryState[];
  scrolls: number;
  snapshots: number;
  stoppedReason: 'stable' | 'max-scrolls' | 'max-snapshots' | 'timeout';
  completeness: CompletenessGate;
}

export interface DiscoveryOptions {
  featureUrl: string;
  feature: string;
  application?: string;
  log?: (l: string) => void;
  limits?: Partial<DiscoveryLimits>;
  /** Best-effort reversible-state (dropdown-open) discovery — OFF by default (read-only-safe scroll+inventory is the tested core). */
  exploreStates?: boolean;
}

export interface DiscoveryLimits {
  maxScrolls: number;
  maxSnapshots: number;
  maxStates: number;
  maxDurationMs: number;
  /** Consecutive no-new-control scrolls that declare the page fully traversed. */
  stability: number;
}

const DEFAULT_LIMITS: DiscoveryLimits = {
  maxScrolls: 12,
  maxSnapshots: 30,
  maxStates: 15,
  maxDurationMs: 120000,
  stability: 2,
};

/* ── Classification helpers (heuristic, but evidence-driven — no invention) ───── */

const FILE_HINT = /\b(browse|choose file|upload|attach|no file selected|drag .* file)\b/i;
const FILE_FIELD_HINT = /\b(resume|cv|attachment|upload|file|photo|avatar|document)\b/i;
const DATE_HINT = /\bdate\b/i;
const TEXTAREA_HINT = /\b(notes?|description|comment|address|remark|message|about|bio)\b/i;
const ACTION_NAME = /^(save|submit|create|register|add|cancel|reset|back|search|delete|edit|update|proceed|next|continue|confirm|apply|download|logout|sign out)$/i;

/** App placeholder text ("-- Select --", "Type here", "yyyy-mm-dd") — a NON-label, NON-value token. */
function isPlaceholderish(text: string): boolean {
  const v = String(text || '').trim().replace(/\s+/g, ' ');
  if (!v) return true;
  if (/^-+\s*select\b/i.test(v)) return true;
  if (/^select(\s+(an?|one|option))?\s*(\.\.\.|…)?$/i.test(v)) return true;
  if (/^please\s+select\b/i.test(v)) return true;
  if (/^-{2,}.*-{2,}$/.test(v)) return true;
  if (/^type\s*here$/i.test(v)) return true;
  if (/^(yyyy|dd|mm)[-/. ]/i.test(v)) return true;
  if (/^enter\b/i.test(v) && v.length > 12) return true; // "Enter comma separated words..."
  return false;
}

function lineIndent(line: string): number {
  return (line.match(/^(\s*)/)?.[1].length) || 0;
}

function slugify(label: string, role: string, index: number): string {
  const base = String(label || role || 'control').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || role || 'control'}-${index}`;
}

interface RawControl {
  index: number;
  indent: number;
  role: string;
  name: string;
  ref: string;
  inlineValue: string;
  required: boolean;
  checked: boolean;
}

/** Detect a control row and capture role/name/ref/value/required from the raw snapshot line. */
function matchControl(line: string, index: number): RawControl | null {
  const m = line.match(/^\s*-?\s*([a-zA-Z]+)(?:\s+"([^"]*)")?([^\n]*)$/);
  if (!m) return null;
  const role = m[1].toLowerCase();
  const KNOWN = new Set([
    'textbox', 'searchbox', 'spinbutton', 'textarea', 'combobox', 'listbox', 'checkbox',
    'radio', 'switch', 'slider', 'button', 'link', 'menuitem', 'menuitemcheckbox', 'tab',
    'option', 'group', 'heading', 'text', 'paragraph', 'generic', 'img', 'region', 'dialog',
  ]);
  if (!KNOWN.has(role)) return null;
  const rest = m[3] || '';
  if (!/\[ref=[a-z0-9]+\]/.test(rest) && role !== 'text' && role !== 'paragraph' && role !== 'heading') return null;
  return {
    index,
    indent: lineIndent(line),
    role,
    name: (m[2] || '').trim(),
    ref: rest.match(/\[ref=([a-z0-9]+)\]/)?.[1] || '',
    inlineValue: rest.match(/:\s*"([^"]+)"/)?.[1]?.trim() || '',
    required: /\[required\]|\baria-required\b/i.test(rest),
    checked: /\[checked\]/.test(rest),
  };
}

/** A readable text/heading line that can label a nearby control, plus whether it flags required (`*`). */
function labelText(line: string): { text: string; required: boolean } | null {
  const m = line.match(/^\s*-?\s*(?:text|paragraph|heading|generic)\b[^"]*?(?::\s*|"\s*)([^"\n]+?)"?\s*$/);
  const raw = (m?.[1] || '').trim();
  if (!raw || !/[a-z0-9]/i.test(raw)) return null;
  const required = /\*\s*$/.test(raw) || /\brequired\b/i.test(raw);
  const text = raw.replace(/\*+\s*$/, '').trim();
  if (isPlaceholderish(text)) return null;
  return { text, required };
}

function classify(role: string, label: string, name: string, contextText: string): ControlKind {
  const hay = `${label} ${name} ${contextText}`;
  if (role === 'checkbox' || role === 'switch') return 'checkbox';
  if (role === 'radio') return 'radio';
  if (role === 'combobox' || role === 'listbox') return 'combobox';
  if (role === 'link') return 'link';
  if (role === 'tab') return 'tab';
  if (role === 'option') return 'option';
  if (role === 'button') {
    if (FILE_HINT.test(hay)) return 'file';
    return 'button';
  }
  // text-like roles
  if (FILE_HINT.test(hay) || (FILE_FIELD_HINT.test(label) && /browse|upload|attach/i.test(contextText))) return 'file';
  if (DATE_HINT.test(label)) return 'date';
  if (TEXTAREA_HINT.test(label) || role === 'textarea') return 'textarea';
  return 'textbox';
}

/**
 * Parse the FULL accessibility tree into a field inventory. Unlike `parseRefs` (which returns only
 * an interactable shortlist for the agent to click), this captures EVERY semantic control so the
 * plan can list an explicit step per field. Unnamed controls (duplicate "Type here" textboxes) are
 * anchored to their nearest live label so the locator evidence is stable and unambiguous.
 */
export function parseInventory(snapshot: string): FieldInventoryItem[] {
  const lines = String(snapshot || '').split('\n');
  const items: FieldInventoryItem[] = [];
  const seenRefs = new Set<string>();
  let section = '';
  let pending: { text: string; required: boolean; indent: number } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const heading = line.match(/^\s*-?\s*heading\s+"([^"]+)"/);
    if (heading) { section = heading[1].trim(); continue; }

    const lbl = labelText(line);
    if (lbl && !/\[ref=/.test(line)) {
      pending = { text: lbl.text, required: lbl.required, indent: lineIndent(line) };
      continue;
    }

    const ctrl = matchControl(line, i);
    if (!ctrl || !ctrl.ref) continue;
    if (seenRefs.has(ctrl.ref)) continue;

    // Skip pure structural containers that are not controls.
    if (['generic', 'group', 'region', 'dialog', 'img', 'paragraph', 'text'].includes(ctrl.role)) {
      pending = null;
      continue;
    }
    seenRefs.add(ctrl.ref);

    const meaningfulName = ctrl.name && !isPlaceholderish(ctrl.name) ? ctrl.name : '';
    const nearby = lines.slice(Math.max(0, i - 3), i + 2).join('\n');
    const label = meaningfulName || (pending && pending.text) || ctrl.name || `${ctrl.role} ${items.length + 1}`;
    const type = classify(ctrl.role, label, ctrl.name, nearby);
    const isAction = ctrl.role === 'button' && ACTION_NAME.test(ctrl.name);
    const required = ctrl.required || (pending && pending.text === label ? pending.required : false) || null;

    // Options for a native select/listbox: child `option "X"` lines.
    const options: string[] = [];
    const baseIndent = ctrl.indent;
    for (let j = i + 1; j < lines.length && lineIndent(lines[j]) > baseIndent; j += 1) {
      const opt = lines[j].match(/^\s*-?\s*option\s+"([^"]+)"/)?.[1]?.trim();
      if (opt && !isPlaceholderish(opt)) options.push(opt);
    }

    const isFile = type === 'file';
    const excerpt = lines.slice(Math.max(0, i - 2), i + 3).join('\n').slice(0, 400);

    items.push({
      id: slugify(label, ctrl.role, items.length + 1),
      label: String(label).replace(/\*+\s*$/, '').trim(),
      role: ctrl.role,
      accessibleName: ctrl.name,
      type,
      section: section || undefined,
      required: required === null ? null : Boolean(required),
      placeholder: ctrl.name && isPlaceholderish(ctrl.name) ? ctrl.name : undefined,
      defaultValue: ctrl.inlineValue && !isPlaceholderish(ctrl.inlineValue) ? ctrl.inlineValue : undefined,
      prepopulated: Boolean(ctrl.inlineValue && !isPlaceholderish(ctrl.inlineValue)) || (ctrl.role === 'radio' && ctrl.checked),
      options: options.length ? [...new Set(options)] : undefined,
      dynamic: false,
      executable: !isFile, // normalised in the loop below
      blocked: isFile,
      blockedReason: isFile ? 'No approved test fixture available' : undefined,
      isAction,
      locatorEvidence: buildLocatorEvidence(snapshot, ctrl, label, meaningfulName),
      snapshotExcerpt: excerpt,
    });
    pending = null;
  }

  // Normalise executable: fillable fields (non-file, non-action) are executable; action buttons are
  // steps but not "fields"; file uploads are blocked. Keep it simple + correct.
  for (const it of items) {
    if (it.type === 'file') { it.executable = false; it.blocked = true; }
    else if (it.isAction) { it.executable = true; it.blocked = false; }
    else { it.executable = true; it.blocked = false; }
  }
  return items;
}

/** Build durable locator evidence: role+name when uniquely named, else a live label-anchored scope. */
function buildLocatorEvidence(
  snapshot: string,
  ctrl: RawControl,
  label: string,
  meaningfulName: string,
): LocatorEvidence {
  // Uniquely-named interactive control → role/name is the most robust strategy.
  if (meaningfulName) {
    const sameName = (snapshot.match(new RegExp(`\\b${ctrl.role}\\s+"${meaningfulName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')) || []).length;
    if (sameName <= 1) {
      return {
        source: 'snapshot', strategy: 'role-name', role: ctrl.role, name: meaningfulName, label,
        locator: `getByRole('${ctrl.role}', { name: '${meaningfulName.replace(/'/g, "\\'")}' })`, snapshotRef: ctrl.ref,
      };
    }
  }
  // Ambiguous / unnamed → label-anchored scoped locator derived from the live tree.
  const hint = deriveLocatorScopeHint(snapshot, ctrl.ref, true);
  if (hint) {
    return { source: 'snapshot', strategy: 'label-scoped', role: ctrl.role, name: ctrl.name, label: hint.label, locator: hint.locator, snapshotRef: ctrl.ref };
  }
  if (label && !isPlaceholderish(label)) {
    return { source: 'snapshot', strategy: 'label-scoped', role: ctrl.role, name: ctrl.name, label, snapshotRef: ctrl.ref };
  }
  return { source: 'snapshot', strategy: 'ref-only', role: ctrl.role, name: ctrl.name, label, snapshotRef: ctrl.ref };
}

/* ── The bounded, read-only discovery controller ─────────────────────────────── */

function mergeInventory(base: FieldInventoryItem[], next: FieldInventoryItem[]): { inventory: FieldInventoryItem[]; added: number } {
  const byKey = new Map<string, FieldInventoryItem>();
  const keyOf = (it: FieldInventoryItem): string => `${it.role}::${(it.label || it.accessibleName).toLowerCase()}::${it.type}`;
  for (const it of base) byKey.set(keyOf(it), it);
  let added = 0;
  for (const it of next) {
    const k = keyOf(it);
    if (!byKey.has(k)) { byKey.set(k, it); added += 1; }
  }
  return { inventory: [...byKey.values()], added };
}

function summarise(snapshot: string, url: string, feature: string, application: string, entryUrl: string): ApplicationSummary {
  const headings = [...snapshot.matchAll(/^\s*-?\s*heading\s+"([^"]+)"/gm)].map((m) => m[1].trim()).slice(0, 12);
  const pageTitle = headings[0] || feature;
  const hasLoginForm = /textbox[^\n]*"(?:username|user name|email)"/i.test(snapshot) && /button[^\n]*"(?:login|sign in)"/i.test(snapshot);
  return {
    application: application || new URL(entryUrl || url || 'http://app.local').host,
    feature,
    entryUrl: entryUrl || url,
    finalUrl: url,
    pageTitle,
    headings,
    authenticated: !hasLoginForm,
  };
}

/**
 * Run bounded, read-only discovery on the CURRENT page (the caller has already logged in and
 * navigated to `featureUrl`). Never submits, never uploads. Returns a full inventory + completeness.
 */
export async function runDiscovery(session: CliSession, opts: DiscoveryOptions): Promise<DiscoveryResult> {
  const log = opts.log || (() => {});
  const L: DiscoveryLimits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const started = Date.now();
  let snapshots = 0;

  const snap = async (): Promise<{ yaml: string; url: string }> => {
    const raw = await session.run(['snapshot']);
    snapshots += 1;
    return { yaml: extractYaml(raw), url: extractPageUrl(raw) };
  };

  log('[discovery] Capturing the full feature screen (read-only, bounded)…');
  const first = await snap();
  const summary = summarise(first.yaml, first.url || opts.featureUrl, opts.feature, opts.application || '', opts.featureUrl);
  let inventory = parseInventory(first.yaml);

  // Progressive scroll: PageDown + re-snapshot until the tree stops yielding new controls.
  let scrolls = 0;
  let stable = 0;
  let stoppedReason: DiscoveryResult['stoppedReason'] = 'stable';
  while (stable < L.stability) {
    if (scrolls >= L.maxScrolls) { stoppedReason = 'max-scrolls'; break; }
    if (snapshots >= L.maxSnapshots) { stoppedReason = 'max-snapshots'; break; }
    if (Date.now() - started > L.maxDurationMs) { stoppedReason = 'timeout'; break; }
    await session.run(['press', 'PageDown']);
    scrolls += 1;
    const s = await snap();
    const merged = mergeInventory(inventory, parseInventory(s.yaml));
    inventory = merged.inventory;
    if (merged.added === 0) stable += 1; else stable = 0;
  }
  log(`[discovery] Inventory: ${inventory.length} control(s) after ${scrolls} scroll(s) (${stoppedReason}).`);

  // Best-effort reversible-state discovery (OFF by default): open custom dropdowns to read options,
  // then restore the baseline with a fresh authenticated goto so the caller resumes on a clean form.
  const states: DiscoveryState[] = [];
  if (opts.exploreStates) {
    await discoverReversibleStates(session, opts, inventory, states, L, log).catch((e) => {
      log(`[discovery] reversible-state discovery skipped: ${(e as Error).message}`);
    });
    // Always restore the clean baseline for the caller's controlled success submit.
    await session.run(['goto', opts.featureUrl]).catch(() => {});
  }

  const completeness = evaluateCompleteness({ inventory, states, scrolls, snapshots, stoppedReason });

  return { applicationSummary: summary, inventory, states, scrolls, snapshots, stoppedReason, completeness };
}

/**
 * Open each custom dropdown once, snapshot its revealed options, and close it (Escape). Strictly
 * capped and fully defensive — any flake is caught and the baseline is restored by the caller. This
 * NEVER submits or navigates away; it only reads option evidence for combobox fields.
 */
async function discoverReversibleStates(
  session: CliSession,
  opts: DiscoveryOptions,
  inventory: FieldInventoryItem[],
  states: DiscoveryState[],
  L: DiscoveryLimits,
  log: (l: string) => void,
): Promise<void> {
  const dropdowns = inventory.filter((it) => it.type === 'combobox' && (!it.options || !it.options.length));
  let visited = 0;
  for (const dd of dropdowns) {
    if (visited >= L.maxStates) break;
    visited += 1;
    // Re-snapshot to get a fresh ref for this control (refs churn between actions).
    const fresh = extractYaml(await session.run(['snapshot']));
    const ref = fresh.split('\n').find((l) => new RegExp(`${dd.role}[^\\n]*\\[ref=`).test(l) && l.toLowerCase().includes((dd.accessibleName || dd.label).toLowerCase().slice(0, 12)))?.match(/\[ref=([a-z0-9]+)\]/)?.[1];
    if (!ref) continue;
    await session.run(['click', ref]);
    const opened = extractYaml(await session.run(['snapshot']));
    const options = [...opened.matchAll(/^\s*-?\s*option\s+"([^"]+)"/gm)].map((m) => m[1].trim()).filter((o) => !isPlaceholderish(o));
    if (options.length) {
      dd.options = [...new Set(options)];
      states.push({ id: `state-${dd.id}`, kind: 'dropdown', trigger: dd.label, options: dd.options, revealedFieldIds: [] });
      log(`[discovery] dropdown "${dd.label}" → ${dd.options.length} option(s).`);
    }
    await session.run(['press', 'Escape']).catch(() => {});
  }
}

/* ── Completeness gate (discovery-time; scenario gates are enforced in codegen) ── */

export function evaluateCompleteness(input: {
  inventory: FieldInventoryItem[];
  states: DiscoveryState[];
  scrolls: number;
  snapshots: number;
  stoppedReason: DiscoveryResult['stoppedReason'];
}): CompletenessGate {
  const { inventory, stoppedReason } = input;
  const fillable = inventory.filter((i) => !i.isAction);
  const files = inventory.filter((i) => i.type === 'file');
  const missingEvidence = fillable.filter((i) => !i.locatorEvidence);
  const unblockedFiles = files.filter((i) => !i.blocked || !i.blockedReason);

  const checks: CompletenessCheck[] = [
    { id: 'page-inspected', label: 'Feature screen was snapshotted', passed: input.snapshots >= 1 },
    {
      id: 'scroll-complete',
      label: 'Below-the-fold content was traversed to stability',
      passed: stoppedReason === 'stable',
      detail: stoppedReason === 'stable' ? undefined : `scroll stopped early (${stoppedReason})`,
    },
    { id: 'controls-inventoried', label: 'At least one control was inventoried', passed: fillable.length >= 1 },
    {
      id: 'every-control-has-evidence',
      label: 'Every fillable control has live locator evidence',
      passed: missingEvidence.length === 0,
      detail: missingEvidence.length ? `${missingEvidence.length} control(s) lack evidence: ${missingEvidence.map((i) => i.label).join(', ')}` : undefined,
    },
    {
      id: 'uploads-blocked',
      label: 'Every file upload is marked non-executable with a reason',
      passed: unblockedFiles.length === 0,
      detail: unblockedFiles.length ? `${unblockedFiles.length} file control(s) not blocked` : undefined,
    },
  ];

  const missing = checks.filter((c) => !c.passed).map((c) => c.detail || c.label);
  return { passed: missing.length === 0, checks, missing };
}
