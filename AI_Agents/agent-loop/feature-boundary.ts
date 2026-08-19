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

  const acceptanceVerified = completionIndex >= 0;
  return {
    featureTokens: tokens,
    view,
    featureStartIndex,
    completionIndex,
    targetUrl,
    acceptanceVerified,
    reason: acceptanceVerified
      ? `feature target ${targetUrl} reached and content verified at step ${completionIndex + 1}`
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
