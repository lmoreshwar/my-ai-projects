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
  reason: string;
}

/**
 * Analyze a completed walk's steps and locate the feature boundary from live evidence. Carries the
 * page URL forward across steps (goto/click set it; fills inherit it), so a snapshot step's stored
 * a11y context is attributed to the right page.
 */
export function detectFeatureBoundary(feature: string, initialUrl: string, steps: AgentStep[]): FeatureBoundaryResult {
  const tokens = featureTokens(feature);
  const view = featureIntentIsView(feature);
  const empty: FeatureBoundaryResult = {
    featureTokens: tokens, view, featureStartIndex: -1, completionIndex: -1,
    targetUrl: null, acceptanceVerified: false, reason: 'no feature target tokens',
  };
  if (!tokens.length) return empty;

  let currentUrl = initialUrl || '';
  let featureStartIndex = -1;
  let completionIndex = -1;
  let targetUrl: string | null = null;

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.url) currentUrl = step.url;
    const onTargetByPath = pathMatchesFeature(currentUrl, tokens);
    const onTargetByIdentity = !!step.context && snapshotIdentityMatchesFeature(step.context, tokens);
    const onTarget = onTargetByPath || onTargetByIdentity;
    if (!onTarget) continue;
    if (featureStartIndex < 0) { featureStartIndex = i; targetUrl = currentUrl; }
    if (completionIndex < 0 && step.context && snapshotHasContent(step.context)) {
      completionIndex = i;
    }
  }

  // WRITE-FLOW COMPLETION (generic): a create/edit/submit feature is DONE when its fields were filled
  // and a submit/continue/save click advanced the page (URL changed, no error). The destination is
  // often a summary/confirmation page with NO form of its own — INTERACTION evidence is the primary
  // completion signal, and that post-submit page must NOT be mistaken for "feature never reached".
  let completedViaRedirect = false;
  if (completionIndex < 0 && !view) {
    const submit = detectSubmitCompletion(steps, initialUrl);
    if (submit) {
      completionIndex = submit.completionIndex;
      if (featureStartIndex < 0) featureStartIndex = submit.formIndex;
      if (!targetUrl) targetUrl = submit.formUrl;
      completedViaRedirect = true;
    }
  }

  // EXIT/SIGN-OUT COMPLETION (generic, click-only): a logout/sign-out feature is DONE when a click on a
  // sign-out control navigated to a login/landing page. The successful end-state of logout IS the login
  // page, which contains no "logout" token — so it can never be found by path/identity, nor by the
  // form-submit detector (no fields filled, "logout" is not a submit verb). Gated on an exit feature.
  let completedViaExit = false;
  if (completionIndex < 0 && featureIntentIsExit(feature)) {
    const exit = detectExitCompletion(steps, initialUrl);
    if (exit) {
      completionIndex = exit.completionIndex;
      if (featureStartIndex < 0) featureStartIndex = exit.completionIndex;
      if (!targetUrl) targetUrl = exit.destUrl;
      completedViaExit = true;
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
    reason: acceptanceVerified
      ? completedViaExit
        ? `sign-out completed — a logout click navigated to the login/landing page "${targetUrl}" (feature-completed-via-exit)`
        : completedViaRedirect
          ? `write flow completed via submit "${targetUrl}" — fields filled then the page advanced to a post-submit page (feature-completed-via-redirect)`
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
