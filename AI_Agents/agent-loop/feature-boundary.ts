/**
 * feature-boundary.ts — generic FEATURE BOUNDARY / TARGET COMPLETION for exploration.
 * ─────────────────────────────────────────────────────────────────────────────
 * A single requested feature has a *target*: the page/state that, once reached and
 * verified, means the feature is DONE. Exploration must STOP there and must NOT wander
 * into downstream capabilities (e.g. View Cart must not walk into Checkout). This module
 * is 100% generic — it derives everything from the feature name + live evidence (URLs and
 * accessibility snapshots) and contains NO application- or feature-name-specific rules.
 *
 * It distinguishes three trace segments:
 *   prerequisiteTrace — steps that establish the state needed to reach the feature (login,
 *                       add-to-cart, navigation) BEFORE the target page is first reached.
 *   featureTrace      — steps ON the target page up to and including acceptance verification.
 *   downstreamTrace   — anything AFTER acceptance (optional evidence; never affects success).
 * prerequisiteTrace + featureTrace = the primary automation trace for the requested feature.
 *
 * Type-only import of AgentStep (no runtime dependency on agent-loop → no import cycle).
 */
import type { AgentStep } from './agent-loop';

/** Intent verbs + articles/chrome words that are NEVER the feature target noun. */
const INTENT_STOPWORDS = new Set<string>([
  'view', 'see', 'show', 'display', 'open', 'get', 'go', 'goto', 'navigate', 'browse', 'list',
  'verify', 'check', 'read', 'review', 'inspect', 'find', 'search',
  'create', 'add', 'new', 'edit', 'update', 'modify', 'delete', 'remove', 'submit', 'save',
  'complete', 'make', 'do', 'place', 'register', 'generate', 'pay', 'checkout',
  'the', 'a', 'an', 'of', 'to', 'my', 'me', 'and', 'or', 'with', 'for', 'on', 'in', 'at',
  'page', 'screen', 'feature', 'widget', 'contents', 'content', 'details', 'detail', 'info',
  'information', 'section', 'flow', 'form',
]);

/** Verbs that indicate a WRITE/persist intent (create/edit/submit) — NOT a pure read/view. */
const WRITE_VERBS = new Set<string>([
  'create', 'add', 'new', 'edit', 'update', 'modify', 'delete', 'remove', 'submit', 'save',
  'complete', 'place', 'register', 'generate', 'pay', 'checkout', 'make',
]);

/** Verbs that explicitly indicate a READ/VIEW intent. */
const VIEW_VERBS = new Set<string>([
  'view', 'see', 'show', 'display', 'open', 'list', 'verify', 'read', 'review', 'browse', 'inspect',
]);

/** Split a phrase into lowercase alphanumeric word tokens. */
function words(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * The significant target-noun tokens of a feature name (intent verbs + articles dropped).
 * "View Cart" → ["cart"];  "View Account" → ["account"];  "Add Product to Cart" → ["product","cart"].
 * Tokens shorter than 3 chars are dropped (too weak to match a path reliably).
 */
export function featureTokens(feature: string): string[] {
  const out: string[] = [];
  for (const w of words(feature)) {
    if (INTENT_STOPWORDS.has(w)) continue;
    if (w.length < 3) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/**
 * Whether the requested feature is a READ/VIEW (safe to STOP as soon as its target renders) vs a
 * WRITE flow (must run to its own submit). A leading/any WRITE verb ⇒ not a view. Otherwise view —
 * including a bare noun ("Cart", "Account"), which is a view of that thing.
 */
export function featureIntentIsView(feature: string): boolean {
  const ws = words(feature);
  if (ws.some((w) => WRITE_VERBS.has(w))) return false;
  if (ws.some((w) => VIEW_VERBS.has(w))) return true;
  return true; // bare noun ⇒ view of that thing
}

/** Control labels whose click ENDS a session (logout / sign-out / log-off). Matched to the clicked
 * control's accessible name or id (underscores/hyphens normalized to spaces first). Generic — no app rules. */
const EXIT_CONTROL_RE = /\b(?:log\s?out|sign\s?out|log\s?off|sign\s?off|logout|signout|logoff)\b/i;

/** Labels/paths that identify a login/sign-in destination — the successful landing page after an exit. */
const LOGIN_CONTROL_RE = /\b(?:log\s?in|sign\s?in|log\s?on|login|signin|logon)\b/i;

/**
 * Whether the requested feature is a sign-out/exit action. Its successful end-state is the login/landing
 * page (which by definition contains no "logout" token), so path/identity matching can never confirm it —
 * detectExitCompletion supplies the completion signal instead.
 */
export function featureIntentIsExit(feature: string): boolean {
  return EXIT_CONTROL_RE.test(String(feature || ''));
}

/**
 * Verbs denoting a DISCRETE ACTION the user performs to fulfil a feature (as opposed to a passive view).
 * Stored as base forms; gerund/plural/past inputs are stemmed to these (sorting→sort). Fully generic — no
 * app- or feature-name-specific rules. This is the axis the action-verification acceptance keys on.
 */
const ACTION_VERBS = new Set<string>([
  'add', 'create', 'new', 'edit', 'update', 'modify', 'save', 'submit', 'delete', 'remove', 'register',
  'generate', 'checkout', 'pay', 'place', 'purchase', 'buy', 'order', 'confirm', 'apply', 'complete',
  'send', 'post', 'login', 'signin', 'logon', 'logout', 'signout', 'logoff', 'sort', 'filter', 'search',
  'find', 'select', 'choose', 'pick', 'toggle', 'enable', 'disable', 'switch', 'check', 'uncheck',
  'upload', 'download', 'reset', 'cancel', 'clear', 'change', 'assign', 'move', 'arrange',
]);

/** The subset of ACTION_VERBS that PERSIST via a form SUBMIT — a filled form for one of these completes at
 * its submit control (the generalized fills-then-submit rule), not at a mid-flow verb-labeled button. */
const WRITE_ACTION_VERBS = new Set<string>([
  'add', 'create', 'new', 'edit', 'update', 'modify', 'save', 'submit', 'delete', 'remove', 'register',
  'generate', 'checkout', 'pay', 'place', 'purchase', 'buy', 'order', 'confirm', 'apply', 'complete', 'send', 'post',
]);

/** Light stemmer: normalize gerund/plural/past forms so "sorting"→"sort", "removes"→"remove", "matches"→"match". */
function stemToken(word: string): string {
  const s = String(word || '').toLowerCase();
  if (s.length <= 3) return s;
  if (s.endsWith('ing') && s.length > 5) return s.slice(0, -3);
  if (s.endsWith('ies') && s.length > 4) return `${s.slice(0, -3)}y`;
  if (/(?:ch|sh|ss|x|z)es$/.test(s)) return s.slice(0, -2);
  if (s.endsWith('s') && !s.endsWith('ss') && s.length > 3) return s.slice(0, -1);
  return s;
}

/** The feature's ACTION VERB tokens (stemmed, in ACTION_VERBS). "Product Sorting"→["sort"]; "View Cart"→[]. */
export function featureActionVerbs(feature: string): string[] {
  const out: string[] = [];
  for (const w of words(feature)) {
    const st = stemToken(w);
    if (ACTION_VERBS.has(st) && !out.includes(st)) out.push(st);
  }
  return out;
}

/**
 * Whether the feature's intent is a discrete ACTION (has an action verb, or is a sign-out / sign-in) rather
 * than a pure view/navigation. Action features are accepted by VERIFYING THE ACTION; view features fall back
 * to destination-content. This is the single routing switch — no per-shape branching.
 */
export function featureIsActionIntent(feature: string): boolean {
  const f = String(feature || '');
  return featureActionVerbs(f).length > 0 || EXIT_CONTROL_RE.test(f) || LOGIN_CONTROL_RE.test(f);
}

/** The host of a URL (no scheme/path/query), lowercased; '' for a relative URL. */
function urlHost(url: string): string {
  const m = String(url || '').trim().toLowerCase().match(/^[a-z]+:\/\/([^/]+)/);
  return m ? m[1] : '';
}

/**
 * Whether the requested "feature" is really the APPLICATION/SITE itself — its name matches the host of
 * the app URL (e.g. feature "SauceDemo" on https://www.saucedemo.com). Such a feature has NO distinct
 * inner target page whose path or heading carries the site's own name (apps rarely brand inner pages
 * with their domain), so destination-token matching can NEVER confirm it. When true, acceptance falls
 * back to "got past the entry/login screen onto real in-app content". Fully generic: compares the
 * feature's flattened tokens to the flattened host — no application- or feature-name-specific rules.
 */
export function featureIsApplicationItself(feature: string, initialUrl: string): boolean {
  if (featureIsActionIntent(feature)) return false; // an action feature is verified by its action, not this
  const host = urlHost(initialUrl).replace(/[^a-z0-9]/g, '');
  if (!host) return false;
  const flat = featureTokens(feature).join('');
  if (flat.length < 4) return false; // too short to be a confident site-name match
  return host.includes(flat);
}

/** The path portion of a URL (no scheme/host/query/hash), lowercased. Robust to relative URLs. */
function urlPath(url: string): string {
  let s = String(url || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\/[^/]+/, ''); // strip scheme + host
  s = s.replace(/[?#].*$/, '');           // strip query + hash
  return s;
}

/** A token and its naive de-pluralized form (cart/carts, category/categories → categor). */
function tokenVariants(token: string): string[] {
  const v = [token];
  if (token.endsWith('ies') && token.length > 4) v.push(`${token.slice(0, -3)}y`, token.slice(0, -3));
  else if (token.endsWith('s') && token.length > 3) v.push(token.slice(0, -1));
  return v;
}

/**
 * Does this URL's PATH identify the feature target? True when any feature token (or its de-pluralized
 * form) appears in the path. This is what lets the target legitimately differ from the entry URL:
 * enter inventory.html for "View Cart" → only cart.html matches ["cart"].
 */
export function pathMatchesFeature(url: string, tokens: string[]): boolean {
  const path = urlPath(url);
  if (!path || !tokens.length) return false;
  return tokens.some((t) => tokenVariants(t).some((v) => v.length >= 3 && path.includes(v)));
}

/** Does any heading/title line in a snapshot name the feature target? (page-identity fallback for SPAs.) */
export function snapshotIdentityMatchesFeature(snapshot: string, tokens: string[]): boolean {
  if (!snapshot || !tokens.length) return false;
  for (const line of snapshot.split('\n')) {
    const m = line.match(/^\s*-?\s*(?:heading|title|banner)\b[^"]*"([^"]+)"/i);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (tokens.some((t) => tokenVariants(t).some((v) => v.length >= 3 && name.includes(v)))) return true;
  }
  return false;
}

const FORM_FIELD_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'slider']);
const DATA_ROLES = new Set(['table', 'grid', 'treegrid', 'row', 'gridcell', 'cell', 'columnheader', 'rowheader', 'option', 'list', 'listitem', 'article']);
const CONTENT_ROLES = new Set(['link', 'text', 'paragraph', 'heading', 'img', 'image', 'generic', 'listitem', 'cell', 'definition', 'term']);
const ACTION_BUTTON_RE = /\b(save|submit|apply|add|create|update|edit|delete|remove|assign|upload|download|confirm|reset|next|continue|register|generate|checkout|proceed|place)\b/i;
const REF_LINE_RE = /^\s*-?\s*([a-zA-Z]+)(?:\s+"([^"]*)")?[^\n]*\[ref=[a-z0-9]+\]/;

/**
 * Whether a snapshot shows real feature CONTENT (not an empty/shell page). Generic acceptance signal:
 * a data region (table/list/rows), an action button, ≥2 form fields, or ≥3 named content nodes. An
 * EMPTY cart / blank detail page (no rows, no items, no fields) returns false, so acceptance is never
 * declared on an empty target.
 */
export function snapshotHasContent(snapshot: string): boolean {
  const text = String(snapshot || '');
  if (!text) return false;
  let fields = 0;
  let dataRegion = false;
  let actionButton = false;
  let contentNodes = 0;
  for (const line of text.split('\n')) {
    const m = line.match(REF_LINE_RE);
    if (!m) continue;
    const role = m[1].toLowerCase();
    const name = (m[2] || '').trim();
    if (FORM_FIELD_ROLES.has(role)) fields += 1;
    else if (DATA_ROLES.has(role)) dataRegion = true;
    else if (role === 'button' && ACTION_BUTTON_RE.test(name)) actionButton = true;
    if (CONTENT_ROLES.has(role) && name) contentNodes += 1;
  }
  return dataRegion || actionButton || fields >= 2 || contentNodes >= 3;
}

/**
 * Submit/advance/persist button verbs whose click ENDS a form-submission-style feature. Deliberately
 * EXCLUDES `login`/`sign in`/`cancel`/`back` so a prerequisite login or a bail-out is never mistaken
 * for feature completion. Matched against the clicked button's accessible name.
 */
const SUBMIT_BUTTON_RE = /\b(save|submit|apply|create|update|confirm|continue|next|proceed|finish|complete|place|pay|checkout|register|generate)\b/i;

/** True when two URLs address the same page (path only — host/query/hash ignored). */
export function samePagePath(a: string, b: string): boolean {
  return urlPath(a) === urlPath(b);
}

/** The clicked button's label for a click step (interaction evidence first, snapshot context fallback). */
function submitButtonLabel(step: AgentStep): string {
  if (step.tool !== 'click') return '';
  const ix = step.interaction;
  if (ix && ix.semanticRole === 'button') {
    const named = ix.accessibleName || ix.controlId || '';
    if (named) return named;
  }
  const m = String(step.context || '').match(/button\s+"([^"]+)"/i);
  return m ? m[1] : '';
}

/**
 * The clicked control's label for ANY interactive role (button/link/menuitem/tab/option), evidence-first with
 * a snapshot-context fallback. Used for click-only EXIT detection where the sign-out control is often a
 * link/menuitem. Underscores/hyphens are normalized to spaces so an id like "logout_sidebar_link" reads as
 * "logout".
 */
function clickedControlLabel(step: AgentStep): string {
  if (step.tool !== 'click') return '';
  const ix = step.interaction;
  if (ix) {
    const named = ix.accessibleName || ix.controlId || '';
    if (named) return named.replace(/[_\-/]+/g, ' ').trim();
  }
  const m = String(step.context || '').match(/(?:button|link|menuitem|tab|option)\s+"([^"]+)"/i);
  return m ? m[1].replace(/[_\-/]+/g, ' ').trim() : '';
}

/**
 * Whether a destination is a login/landing page — the successful outcome of a sign-out. True when the
 * snapshot shows an explicit login form (a password field, or a login/sign-in button/link) OR the URL is a
 * bare landing/root path (or a /login|/signin|/auth path). Fully generic — no app-specific rules.
 */
export function looksLikeLoginLanding(snapshot: string, url: string): boolean {
  const text = String(snapshot || '');
  for (const line of text.split('\n')) {
    const m = line.match(REF_LINE_RE);
    if (!m) continue;
    const role = m[1].toLowerCase();
    const name = (m[2] || '').trim();
    if (role === 'textbox' && /\bpass(?:word|code)?\b/i.test(name)) return true;
    if ((role === 'button' || role === 'link') && LOGIN_CONTROL_RE.test(name)) return true;
  }
  const path = urlPath(url);
  if (path === '' || path === '/') return true;
  return /(?:^|\/)(?:login|signin|sign-in|logon|auth)(?:\.[a-z]+)?$/i.test(path);
}

/** A detected write-flow completion: fields filled on a form page, then a submit click advanced away. */
export interface SubmitCompletion {
  /** Index of the first fill on the form page. */
  formIndex: number;
  /** Index of the submit/continue/save click that completed the flow. */
  completionIndex: number;
  formUrl: string;
  destUrl: string;
  /** The submit button's label. */
  control: string;
}

/**
 * Detect a form-submission-style completion from live INTERACTION evidence (generic — no app rules):
 * at least one fill on a form page, followed by a submit/continue/save button click whose result
 * NAVIGATES to a different page (URL changed ⇒ the app accepted the submit — a blocking validation
 * would keep the same URL). The destination is often a summary/confirmation page with no form of its
 * own; that redirect IS the success signal, not a sign the feature was never reached. Returns the LAST
 * such sequence in the walk (the feature's own submit, after any prerequisite submits like login).
 */
export function detectSubmitCompletion(steps: AgentStep[], initialUrl = ''): SubmitCompletion | null {
  if (!steps || !steps.length) return null;
  // The page each step was INITIATED on: fills inherit the current page; a nav click's own url is the
  // NEXT page, so it is recorded here as having happened on the PREVIOUS page.
  const pageOf: string[] = [];
  let carry = initialUrl || '';
  for (let i = 0; i < steps.length; i += 1) {
    pageOf[i] = carry;
    if (steps[i].url) carry = String(steps[i].url);
  }
  let best: SubmitCompletion | null = null;
  for (let i = 0; i < steps.length; i += 1) {
    const control = submitButtonLabel(steps[i]);
    if (!control || !SUBMIT_BUTTON_RE.test(control)) continue;
    const formUrl = pageOf[i];
    const destUrl = String(steps[i].url || '');
    if (!formUrl || !destUrl || samePagePath(formUrl, destUrl)) continue; // no navigation ⇒ not accepted yet
    let firstFill = -1;
    for (let j = 0; j < i; j += 1) {
      const t = steps[j].tool;
      if ((t === 'fill' || t === 'type') && samePagePath(pageOf[j], formUrl)) { firstFill = j; break; }
    }
    if (firstFill < 0) continue; // at least one field must have been filled on the form page
    best = { formIndex: firstFill, completionIndex: i, formUrl, destUrl, control };
  }
  return best;
}

/** A detected click-only EXIT/sign-out completion: a logout/sign-out click that navigated to a login/landing page. */
export interface ExitCompletion {
  /** Index of the logout/sign-out click that ended the session. */
  completionIndex: number;
  fromUrl: string;
  destUrl: string;
  /** The clicked control's label. */
  control: string;
}

/**
 * Detect a click-only EXIT completion from live INTERACTION evidence (generic — no app rules): a click on a
 * logout/sign-out-labeled control whose result NAVIGATES to a different page that looks like a login/landing
 * page. This is the click-only analogue of detectSubmitCompletion — the successful outcome of "logout" is the
 * login page, which by definition has no "logout" token, so path/identity matching can never see it. Returns
 * the LAST such click in the walk.
 */
export function detectExitCompletion(steps: AgentStep[], initialUrl = ''): ExitCompletion | null {
  if (!steps || !steps.length) return null;
  const pageOf: string[] = [];
  let carry = initialUrl || '';
  for (let i = 0; i < steps.length; i += 1) {
    pageOf[i] = carry;
    if (steps[i].url) carry = String(steps[i].url);
  }
  let best: ExitCompletion | null = null;
  for (let i = 0; i < steps.length; i += 1) {
    const control = clickedControlLabel(steps[i]);
    if (!control || !EXIT_CONTROL_RE.test(control)) continue;
    const fromUrl = pageOf[i];
    const destUrl = String(steps[i].url || '');
    if (!fromUrl || !destUrl || samePagePath(fromUrl, destUrl)) continue; // no navigation ⇒ not exited yet
    // Destination must look like a login/landing page: the dest URL itself, or a later snapshot of it.
    const landing = looksLikeLoginLanding('', destUrl)
      || steps.some((s, j) => j >= i && samePagePath(String(s.url || ''), destUrl) && !!s.context && looksLikeLoginLanding(s.context, destUrl));
    if (!landing) continue;
    best = { completionIndex: i, fromUrl, destUrl, control };
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED ACTION-VERIFICATION acceptance — verify the ACTION, not the DESTINATION.
// ─────────────────────────────────────────────────────────────────────────────

/** Tools that represent a real user INTERACTION with a control (not navigation/observation). */
const ACTION_TOOLS = new Set<string>(['click', 'dblclick', 'fill', 'type', 'select', 'check', 'uncheck', 'press', 'hover', 'upload', 'setinputfiles', 'drag']);

/** Tool-result markers meaning the action itself FAILED (so it is not acceptance evidence). */
const RESULT_ERROR_RE = /\b(?:error|timeout(?:error)?|exception|unhandled|failed to|could not|unable to|not found|is not visible|strict mode violation|resolved to \d+ elements?)\b/i;

/** On-screen text meaning a submitted/attempted action was REJECTED (an unresolved validation error). */
const VALIDATION_ERROR_RE = /\b(?:is required|required field|must be|should be|is invalid|not valid|invalid (?:username|password|input|value|format|credentials)|please (?:enter|provide|fill|select|complete|correct)|already (?:exists|taken|registered|in use)|do(?:es)? not match|incorrect|epic sadface)\b/i;

/** Verb groups mapping a feature's intent to the interaction AFFORDANCE (role/tool) that fulfils it. */
const SELECT_VERBS = new Set<string>(['sort', 'filter', 'select', 'choose', 'pick', 'order', 'change', 'arrange']);
const TOGGLE_VERBS = new Set<string>(['toggle', 'enable', 'disable', 'switch', 'check', 'uncheck']);
const SEARCH_VERBS = new Set<string>(['search', 'find']);

/** Whether a step is a real control interaction (vs snapshot/goto/screenshot/wait). */
function stepIsAction(step: AgentStep): boolean {
  return ACTION_TOOLS.has(String(step.tool || '').toLowerCase());
}

/** Whether the recorded tool result for a step signals the action itself errored. */
function actionErrored(step: AgentStep): boolean {
  return RESULT_ERROR_RE.test(String(step.result || ''));
}

/**
 * The acted-upon control's label for ANY action (interaction evidence → snapshot context → locator name),
 * normalized (underscores/hyphens → spaces, lowercased) so an id like "product_sort_container" reads as words.
 * This is the DIRECT evidence of intent: what the model actually interacted with.
 */
function actedControlLabel(step: AgentStep): string {
  const ix = step.interaction;
  if (ix) {
    const named = ix.accessibleName || ix.controlId || '';
    if (named) return named.replace(/[_\-/]+/g, ' ').trim().toLowerCase();
  }
  const cm = String(step.context || '').match(/(?:button|link|menuitem|tab|option|checkbox|radio|switch|combobox|listbox|textbox|searchbox|spinbutton)\s+"([^"]+)"/i);
  if (cm) return cm[1].replace(/[_\-/]+/g, ' ').trim().toLowerCase();
  const lm = String(step.locator || '').match(/name:\s*['"]([^'"]+)['"]/i);
  if (lm) return lm[1].replace(/[_\-/]+/g, ' ').trim().toLowerCase();
  return '';
}

/** The acted-upon control's ARIA role (interaction evidence → snapshot context → locator getByRole). */
function actedControlRole(step: AgentStep): string {
  const ix = step.interaction;
  if (ix?.semanticRole) return ix.semanticRole.toLowerCase();
  const cm = String(step.context || '').match(REF_LINE_RE);
  if (cm) return cm[1].toLowerCase();
  const lm = String(step.locator || '').match(/getByRole\(\s*['"]([a-z]+)['"]/i);
  if (lm) return lm[1].toLowerCase();
  return '';
}

/** Whether a snapshot currently shows an unresolved validation/error message (an alert/status, or matching text). */
export function snapshotHasValidationError(snapshot: string): boolean {
  const text = String(snapshot || '');
  for (const raw of text.split('\n')) {
    const m = raw.match(REF_LINE_RE);
    if (!m) continue;
    const role = m[1].toLowerCase();
    const name = (m[2] || '').trim();
    if (role === 'alert') return true;
    if (!name) continue;
    if (role === 'status') return true;
    if (/^error\b/i.test(name) || VALIDATION_ERROR_RE.test(name)) return true;
  }
  return false;
}

/** Whether the feature's action verb is fulfilled by the acted control's affordance (role/tool). */
function affordanceMatches(actionVerbs: string[], role: string, tool: string): boolean {
  const t = String(tool || '').toLowerCase();
  const r = String(role || '').toLowerCase();
  if (actionVerbs.some((v) => SELECT_VERBS.has(v)) && (t === 'select' || ['combobox', 'listbox', 'option', 'menu', 'menuitem'].includes(r))) return true;
  if (actionVerbs.some((v) => TOGGLE_VERBS.has(v)) && (t === 'check' || t === 'uncheck' || ['checkbox', 'switch', 'radio'].includes(r))) return true;
  if (actionVerbs.some((v) => SEARCH_VERBS.has(v)) && (t === 'fill' || t === 'type') && ['searchbox', 'textbox'].includes(r)) return true;
  return false;
}

/** The page each step was INITIATED on (fills inherit the current page; a nav click's own url is the NEXT page). */
function pageOfSteps(steps: AgentStep[], initialUrl: string): string[] {
  const pageOf: string[] = [];
  let carry = initialUrl || '';
  for (let i = 0; i < steps.length; i += 1) {
    pageOf[i] = carry;
    if (steps[i].url) carry = String(steps[i].url);
  }
  return pageOf;
}

/** A unified ACTION-verified completion (verb-match, form-submit commit, or affordance-match). */
export interface ActionCompletion {
  completionIndex: number;
  featureStartIndex: number;
  targetUrl: string;
  control: string;
  via: 'verb' | 'commit' | 'affordance';
}

/**
 * UNIFIED ACTION-VERIFICATION acceptance (generic — one rule for EVERY interaction shape, no app rules).
 * Instead of asking "does the page I ended up on match the feature", it asks "was the control I actually
 * interacted with the feature itself":
 *   • MODE A (a form was filled): the feature is DONE at its own SUBMIT — fields filled then a submit/continue
 *     control advanced the page. A submit that does not advance means it was BLOCKED (not a completion).
 *     This is the former fills-then-submit case, now just one instance of "the acted control was the feature".
 *   • MODE B (no form fill): the LAST successful action whose control's own NAME matches the feature's action
 *     VERB (logout, remove, add, …), OR whose role/tool matches the feature's AFFORDANCE (sort→select,
 *     toggle→checkbox, search→searchbox) — with observable effect (navigation, or a following resolved
 *     snapshot) and NO unresolved validation error on the resulting screen.
 * Matching keys on the feature's action VERB (never its nouns), so a prerequisite that merely shares a noun
 * (e.g. clicking "Add to cart" while automating "Remove … from Cart") is never mistaken for the feature.
 */
export function detectActionCompletion(feature: string, steps: AgentStep[], initialUrl = '', resultingSnapshot = ''): ActionCompletion | null {
  if (!steps || !steps.length) return null;
  const actionVerbs = featureActionVerbs(feature);
  const exitFeature = EXIT_CONTROL_RE.test(String(feature || ''));
  const loginFeature = LOGIN_CONTROL_RE.test(String(feature || ''));
  if (!actionVerbs.length && !exitFeature && !loginFeature) return null;
  const writeIntent = actionVerbs.some((v) => WRITE_ACTION_VERBS.has(v));
  const pageOf = pageOfSteps(steps, initialUrl);
  // A FEATURE form fill is a fill on a page that is NOT the login/landing screen. A prerequisite LOGIN
  // fill (username/password) must never route a direct-action feature (e.g. "Add Product to Cart" — a
  // single "Add to cart" click with no form of its own) into the fills-then-submit path; otherwise MODE A
  // finds no feature submit and the real action (MODE B, verb-matched) is never evaluated.
  const hasFeatureFormFill = steps.some(
    (s, i) => (s.tool === 'fill' || s.tool === 'type') && !actionErrored(s) && !looksLikeLoginLanding(String(s.context || ''), pageOf[i]),
  );

  // MODE A — the FEATURE filled a form ⇒ it completes at its own submit (fields filled + submit advanced).
  if (writeIntent && hasFeatureFormFill) {
    const submit = detectSubmitCompletion(steps, initialUrl);
    if (!submit) return null;
    return { completionIndex: submit.completionIndex, featureStartIndex: submit.formIndex, targetUrl: submit.destUrl, control: submit.control, via: 'commit' };
  }

  // MODE B — direct action: the LAST control interaction that IS the feature (verb- or affordance-matched).
  let best: ActionCompletion | null = null;
  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    if (!stepIsAction(s) || actionErrored(s)) continue;
    const label = actedControlLabel(s);
    const role = actedControlRole(s);
    const labelTokens = words(label).map(stemToken);
    const verbMatch = actionVerbs.some((v) => labelTokens.includes(v))
      || (exitFeature && EXIT_CONTROL_RE.test(label))
      || (loginFeature && LOGIN_CONTROL_RE.test(label));
    const affMatch = affordanceMatches(actionVerbs, role, s.tool);
    if (!verbMatch && !affMatch) continue;
    const fromUrl = pageOf[i];
    const destUrl = String(s.url || '');
    const navigated = !!destUrl && !!fromUrl && !samePagePath(fromUrl, destUrl);
    // The screen AFTER this action: prefer a trailing snapshot recorded as a step; otherwise the
    // resolved screen captured at finish time. The live loop records plain `snapshot` calls as tool
    // RESULTS, not steps, so a non-navigating action (sort/toggle/remove) has NO trailing snapshot
    // step — its resolved state is only observable via the passed-in resultingSnapshot. Verifying the
    // ACTION (Playwright resolves select/click/check only after the control received the event) is the
    // effect; we do not require a navigation/destination.
    let lastCtx: string | null = null;
    for (let j = steps.length - 1; j > i; j -= 1) {
      if (!stepIsAction(steps[j]) && steps[j].context) { lastCtx = String(steps[j].context); break; }
    }
    const resolvedScreen = lastCtx != null ? lastCtx : (resultingSnapshot ? String(resultingSnapshot) : null);
    if (resolvedScreen != null && snapshotHasValidationError(resolvedScreen)) continue; // error on screen ⇒ not a completion
    const hasEffect = navigated || resolvedScreen != null;                              // navigated, or a resolved post-state is observable
    if (!hasEffect) continue;
    best = { completionIndex: i, featureStartIndex: i, targetUrl: navigated ? destUrl : (fromUrl || destUrl), control: label, via: verbMatch ? 'verb' : 'affordance' };
  }
  return best;
}

/** The result of analyzing a completed walk for its feature boundary. */
export interface FeatureBoundaryResult {
  featureTokens: string[];
  /** Whether the requested feature is a read/view (eligible for early STOP at target). */
  view: boolean;
  /** First step index ON the target page/route (−1 = target never reached). */
  featureStartIndex: number;
  /** Step index where the target's acceptance content was verified (−1 = not verified). */
  completionIndex: number;
  /** The URL identified as the feature target (null when not reached). */
  targetUrl: string | null;
  /** True when the target was reached AND its acceptance content was verified. */
  acceptanceVerified: boolean;
  /** True when acceptance came from a write-flow submit that advanced to a post-submit page. */
  completedViaRedirect?: boolean;
  /** True when acceptance came from a click-only sign-out that landed on a login/landing page. */
  completedViaExit?: boolean;
  /** True when acceptance came from the unified action-verification rule (the acted control WAS the feature). */
  completedViaAction?: boolean;
  reason: string;
}

/**
 * Analyze a completed walk's steps and locate the feature boundary from live evidence. Carries the
 * page URL forward across steps (goto/click set it; fills inherit it), so a snapshot step's stored
 * a11y context is attributed to the right page.
 */
export function detectFeatureBoundary(feature: string, initialUrl: string, steps: AgentStep[], resultingSnapshot = ''): FeatureBoundaryResult {
  const tokens = featureTokens(feature);
  const view = featureIntentIsView(feature);
  const actionIntent = featureIsActionIntent(feature);
  const empty: FeatureBoundaryResult = {
    featureTokens: tokens, view, featureStartIndex: -1, completionIndex: -1,
    targetUrl: null, acceptanceVerified: false, reason: 'no feature target tokens',
  };
  if (!tokens.length && !actionIntent) return empty;

  let featureStartIndex = -1;
  let completionIndex = -1;
  let targetUrl: string | null = null;
  let completedViaRedirect = false;
  let completedViaExit = false;
  let completedViaAction = false;

  // PRIMARY — VERIFY THE ACTION, NOT THE DESTINATION (one generic rule for every interaction shape).
  // For any feature whose intent is a discrete action (click / fill+submit / select / toggle / …),
  // acceptance is "the control the model actually interacted with was the feature itself" — its own
  // accessible name/role matched the feature's action verb/affordance (and, for a filled form, its
  // submit advanced with no validation error). This subsumes the former fills-then-submit and
  // click-only-exit special cases; there is no per-shape branching to keep extending.
  if (actionIntent) {
    const act = detectActionCompletion(feature, steps, initialUrl, resultingSnapshot);
    if (act) {
      completionIndex = act.completionIndex;
      featureStartIndex = act.featureStartIndex;
      targetUrl = act.targetUrl;
      completedViaAction = true;
      completedViaRedirect = act.via === 'commit';
      completedViaExit = act.via === 'verb' && featureIntentIsExit(feature);
    }
  } else if (featureIsApplicationItself(feature, initialUrl)) {
    // FEATURE == THE APPLICATION ITSELF (its name matches the app host, e.g. "SauceDemo" on
    // saucedemo.com). No inner page carries the site's own name in its path/heading, so destination-token
    // matching can NEVER confirm it. Acceptance = the walk got PAST the entry/login screen onto a real
    // in-app content page. Generic — derived from feature-vs-host + live content/login signals only.
    let currentUrl = initialUrl || '';
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (step.url) currentUrl = step.url;
      if (!step.context) continue;
      if (looksLikeLoginLanding(step.context, currentUrl)) continue; // still on the entry/login screen
      if (!snapshotHasContent(step.context)) continue;               // shell/empty page — not verified yet
      featureStartIndex = i; targetUrl = currentUrl; completionIndex = i;
      break;
    }
  } else {
    // FALLBACK — DESTINATION CONTENT (only for a pure view/navigation feature that has no single discrete
    // action to point to, e.g. "View the Dashboard"): stop once ON the requested target with real content.
    let currentUrl = initialUrl || '';
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (step.url) currentUrl = step.url;
      const onTarget = pathMatchesFeature(currentUrl, tokens)
        || (!!step.context && snapshotIdentityMatchesFeature(step.context, tokens));
      if (!onTarget) continue;
      if (featureStartIndex < 0) { featureStartIndex = i; targetUrl = currentUrl; }
      if (completionIndex < 0 && step.context && snapshotHasContent(step.context)) completionIndex = i;
    }
  }

  const acceptanceVerified = completionIndex >= 0;
  return {
    featureTokens: tokens,
    view,
    featureStartIndex,
    completionIndex,
    targetUrl,
    acceptanceVerified,
    completedViaRedirect,
    completedViaExit,
    completedViaAction,
    reason: acceptanceVerified
      ? completedViaExit
        ? `sign-out verified — a logout control was clicked and the app left to the login/landing page "${targetUrl}" (feature-completed-via-exit)`
        : completedViaRedirect
          ? `write flow verified — the feature's fields were filled and its submit control advanced to "${targetUrl}" with no validation error (feature-completed-via-redirect)`
          : completedViaAction
            ? `action verified — the model interacted with a control matching the requested feature at step ${completionIndex + 1}, which succeeded with no unresolved validation error (feature-completed-via-action)`
            : `feature target ${targetUrl} reached and content verified at step ${completionIndex + 1}`
      : featureStartIndex >= 0
        ? `feature target ${targetUrl} reached but no acceptance content verified`
        : 'feature target never reached',
  };
}

/** The three trace segments + the primary (prerequisite + feature) trace. */
export interface TraceSplit {
  prerequisiteTrace: AgentStep[];
  featureTrace: AgentStep[];
  downstreamTrace: AgentStep[];
  primaryTrace: AgentStep[];
}

/**
 * Split a walk into prerequisite / feature / downstream segments using the detected boundary.
 * When the target was never reached, everything is primary (no downstream to strip) so behavior is
 * unchanged for flows this concept does not apply to.
 */
export function splitTrace(steps: AgentStep[], boundary: FeatureBoundaryResult): TraceSplit {
  if (boundary.featureStartIndex < 0 || boundary.completionIndex < 0) {
    return { prerequisiteTrace: [], featureTrace: [], downstreamTrace: [], primaryTrace: steps.slice() };
  }
  const prerequisiteTrace = steps.slice(0, boundary.featureStartIndex);
  const featureTrace = steps.slice(boundary.featureStartIndex, boundary.completionIndex + 1);
  const downstreamTrace = steps.slice(boundary.completionIndex + 1);
  return { prerequisiteTrace, featureTrace, downstreamTrace, primaryTrace: [...prerequisiteTrace, ...featureTrace] };
}

/**
 * The definitive walk status once the boundary is known: a VERIFIED feature target is SUCCESS, even
 * when the agent later wandered into a downstream capability and reported failure there. A true
 * failure BEFORE acceptance (target never verified) is preserved.
 */
export function resolveFeatureStatus(
  walkStatus: 'passed' | 'failed' | 'incomplete',
  boundary: FeatureBoundaryResult,
): 'passed' | 'failed' | 'incomplete' {
  if (boundary.acceptanceVerified) return 'passed';
  return walkStatus;
}
