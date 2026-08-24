/**
 * codegen.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Turn a VERIFIED action trace (from agent-loop.ts) into real framework files:
 * a Page Object (locators only), a Module (workflow), and a Spec (assertions),
 * matching the repo's 3-layer conventions.
 *
 * CAPABILITY / MEMORY REUSE (`.ai-memory/`)
 *   BEFORE writing anything it loads `.ai-memory/capabilities.json` + the domain
 *   shards and hands the model the existing pages/modules/methods so it REUSES a
 *   matching locator/method instead of duplicating one. AFTER writing it runs the
 *   repo's `npm run index` so the capability JSON is regenerated (write-back) and
 *   the next run reuses the new artifacts.
 *
 * The proven locators from the trace are the highest-priority evidence: the model
 * copies them verbatim into the Page so generated locators provably exist.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import OpenAI from 'openai';
import ts from 'typescript';
import { deriveLocatorScopeHint, isStableUniqueLocator, type AgentStep, type LocatorScopeHint, type InteractionEvidence } from './agent-loop';
import {
  assertDependencyArtifactsPreserved, assertResolvedDependenciesUsed, dependencyResolutionContext, writeCapabilityDependencyMemory,
  type CapabilityDependencyResolution,
} from './capability-dependencies';
import type {
  FieldInventoryItem, LocatorEvidence, DiscoveryState, CompletenessGate, ApplicationSummary, DiscoveryResult, StateTransition,
} from './discovery';

// Some gateways force a default reasoning_effort that conflicts with structured/tool calls on
// /v1/chat/completions. Send OPENAI_REASONING_EFFORT (e.g. "none") only when it is set.
function applyReasoning(params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming): void {
  const effort = (process.env.OPENAI_REASONING_EFFORT || '').trim();
  if (effort) (params as unknown as Record<string, unknown>).reasoning_effort = effort;
}

export interface CodegenJob {
  feature: string;
  url: string;
  testTypes?: string[];
  maxCases?: number;
  model?: string;
  /**
   * When the caller has selected specific discovery scenarios, this is the union of the executable
   * field labels those scenarios cover. codegen filters the trace to these fields and a coverage gate
   * verifies every one appears in the generated code (deterministic trace-to-code fidelity). Empty /
   * undefined = legacy behaviour (use the full trace, no coverage gate).
   */
  coverageFields?: string[];
  /**
   * Enriched LIVE discovery evidence (full-screen inventory + captured state transitions) so codegen
   * grounds every locator/option in what was actually OBSERVED, never inferred. Optional — legacy
   * callers omit it and codegen falls back to the verified trace alone.
   */
  discoveryEvidence?: DiscoveryEvidence;
  /** Internal prerequisite plan resolved from verified capabilities; never user-provided. */
  dependencyResolution?: CapabilityDependencyResolution;
  /**
   * AI-Native (test-case-driven) mode ONLY: the authoritative test cases to author, with their supplied
   * TC IDs + titles. When present, buildPrompt instructs the model to author EXACTLY these cases with these
   * IDs (never re-numbering), and the caller enforces the IDs deterministically after generation. Absent for
   * Autopilot (feature-driven) codegen, which authors sequential IDs from the trace as before — so this field
   * NEVER changes Autopilot behaviour.
   */
  caseContract?: Array<{ id: string; title: string }>;
}

/** The live discovery evidence codegen consumes: durable control inventory + before→after transitions. */
export interface DiscoveryEvidence {
  inventory: FieldInventoryItem[];
  transitions: StateTransition[];
}

export interface GeneratedArtifacts {
  domain: string;
  files: string[];
  reusedExisting: boolean;
}

/** A proposed test case shown to the user for approval BEFORE any code is written. */
export interface PlanCase {
  id: string;
  title: string;
  type: string;
  steps: string[];
  expectedResults: string;
}

/** AI-Native (test-case-driven) input: an already-authored test case whose intent is authoritative. */
export interface TestCaseInput {
  id: string;
  title: string;
  steps: string[];
  expectedResults?: string;
  type?: string;
  tags?: string[];
  testData?: Record<string, unknown>;
}
/** How a control relates to the requested feature — the auditable reason it is (or is not) automated. */
export type ControlClassification =
  | 'feature-input'    // a form field the scenario fills/selects/checks
  | 'feature-action'   // the controlled submit that completes the scenario
  | 'upload';          // a file input (executable only with an approved fixture)

/** One concrete, evidence-linked action inside a proposed scenario (an Automation Trace step). */
export interface ScenarioStep {
  order: number;
  action: string;        // human phrase, e.g. "Fill First Name"
  target: string;        // the control's label
  type: string;          // fill | select | check | upload | click
  classification: ControlClassification; // WHY this control is an automation step (feature-relevant only)
  input?: string;        // example valid value / where the data comes from
  expected?: string;
  fieldId?: string;      // links back to the FieldInventoryItem
  locatorEvidence?: LocatorEvidence | null;
  liveLocator?: string;  // the locator actually executed in the verified trace
  snapshotEvidence?: string; // the a11y-tree context proving the control exists
  blocked?: boolean;     // true = present in scope but NOT executable (e.g. upload with no fixture)
  blockedReason?: string;
  /** Live dropdown/option values captured by deep-crawl for a select step (evidence, never invented). */
  optionEvidence?: string[];
}

/** A proposed, evidence-backed scenario the user can select for automation in the approval UI. */
export interface Scenario {
  id: string;            // TC_001…
  title: string;
  type: string;          // positive | negative | boundary | …
  ready: boolean;        // true = a complete live trace + evidence backs it → automatable now
  blocked: boolean;      // true = cannot be automated as-is
  blockedReason?: string;
  steps: ScenarioStep[];
  expectedResults: string;
  coverage: { fieldIds: string[]; fieldLabels: string[] };
  /** Gap-aware planning (optional, backward compatible): set when this proposed scenario is already
   * automated by an existing test in the repo's reuse index, so the UI can pre-skip it and author only
   * the NEW (uncovered) scenarios. Undefined on legacy plans / when the repo has no index. */
  covered?: boolean;
  coveredBy?: { spec: string; testId: string; title: string };
}

/** The richer plan artifact (version 2) written by explore.ts and consumed by approve.ts / the API. */
export interface BlastPlanV2 {
  version: 2;
  feature: string;
  url: string;
  testTypes: string[];
  maxCases: number;
  status: string;                       // the exploration walk status
  summary: string;
  applicationSummary: ApplicationSummary | null;
  inventory: FieldInventoryItem[];
  states: DiscoveryState[];
  // Optional (backward compatible): LIVE before→action→after state-transition evidence + its schema
  // version. Older plans predate deep-crawl and simply omit these; readers must treat them as optional.
  transitions?: StateTransition[];
  discoveryVersion?: number;
  completeness: CompletenessGate | null;
  scenarios: Scenario[];
  trace: AgentStep[];                   // the VERIFIED success trace — evidence for codegen
  cases: PlanCase[];                    // legacy projection for older clients
}

interface LlmArtifacts {
  domain: string;
  page: { file: string; content: string };
  module: { file: string; content: string };
  spec: { file: string; content: string };
  testData?: Record<string, unknown>;
  routes?: Record<string, string>;
  uniqueFields?: UniqueField[];
  reusedFrom?: string[];
}

interface UniqueField {
  testDataPath: string;
  kind: 'numeric' | 'alphanumeric' | 'email';
  length?: number;
  // Present ONLY when the live trace exposed an inline collision validation for this field.
  collisionPageField?: string;
  collisionMessage?: string;
}

const safeRead = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const safeJson = (p: string): Record<string, unknown> | null => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Load the reuse index: existing pages/modules + their methods, fixtures, and the global testIndex. */
function loadCapabilities(fw: string): string {
  const root = safeJson(join(fw, '.ai-memory', 'capabilities.json'));
  if (!root) return '(no .ai-memory/capabilities.json — this is a fresh index)';
  const shardDir = join(fw, String(root.shardDir || '.ai-memory/domains'));
  const lines: string[] = [];
  lines.push(`Fixtures already registered: ${(root.fixtures as string[] || []).join(', ') || '(none)'}`);
  if (existsSync(shardDir)) {
    for (const f of readdirSync(shardDir).filter((x) => x.endsWith('.json'))) {
      const shard = safeJson(join(shardDir, f));
      if (!shard) continue;
      const pages = (shard.pages as Array<{ class: string; methods: string[] }> || [])
        .map((p) => `${p.class}: ${p.methods.join(', ')}`).join(' | ');
      const modules = (shard.modules as Array<{ class: string; methods: string[] }> || [])
        .map((m) => `${m.class}: ${m.methods.join(', ')}`).join(' | ');
      lines.push(`Domain "${shard.domain}" — pages [${pages}] modules [${modules}]`);
    }
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Gap-aware planning: match a PROPOSED scenario against the tests already automated
// in the repo (the reuse index's global testIndex) so explore can author only the
// NEW scenarios. Title-based (ids are not globally unique) and GENERIC — no app rules.
// ─────────────────────────────────────────────────────────────────────────────

/** One already-automated test recovered from the reuse index. */
export interface ExistingTest { spec: string; testId: string; title: string }

/** Normalize a test/scenario title for comparison: drop @tags, lowercase, keep alphanumerics. */
function normTitle(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/@\w+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'with', 'on', 'in', 'is', 'be', 'as',
  'test', 'verify', 'verifies', 'check', 'checks', 'ensure', 'that', 'when', 'then', 'should',
  'user', 'page', 'via', 'flow', 'case', 'scenario', 'valid', 'successfully',
]);

/** Distinctive (≥4-char, non-stopword) tokens that identify what a title is about. */
function titleTokens(s: string): Set<string> {
  return new Set(normTitle(s).split(' ').filter((w) => w.length >= 4 && !TITLE_STOPWORDS.has(w)));
}

/** Overlap of distinctive tokens between two titles, 0..1 (intersection / smaller set). */
function titleOverlap(a: string, b: string): number {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

/** Read the repo's reuse index and return every already-automated test with its title. */
export function existingTestTitles(fw: string): ExistingTest[] {
  const root = safeJson(join(fw, '.ai-memory', 'capabilities.json'));
  const testIndex = root && (root.testIndex as Record<string, unknown> | undefined);
  if (!testIndex) return [];
  const out: ExistingTest[] = [];
  for (const [testId, arr] of Object.entries(testIndex)) {
    const list = Array.isArray(arr) ? arr : [arr];
    for (const e of list as Array<{ spec?: string; title?: string }>) {
      if (e && e.title) out.push({ spec: String(e.spec || ''), testId, title: String(e.title) });
    }
  }
  return out;
}

/**
 * Is this proposed title already covered by an existing automated test? Title-first (ids are not
 * unique): (1) normalized-title substring either way, else (2) distinctive-token overlap ≥ 0.75.
 * Conservative on purpose — a miss just means the scenario is offered as NEW (never silently dropped).
 */
export function coveringTest(title: string, existing: ExistingTest[]): ExistingTest | null {
  const want = normTitle(title);
  if (want.length < 6 || !existing.length) return null;
  for (const e of existing) {
    const have = normTitle(e.title);
    if (have.length >= 6 && (have.includes(want) || want.includes(have))) return e;
  }
  let best: ExistingTest | null = null;
  let bestScore = 0;
  for (const e of existing) {
    const sc = titleOverlap(title, e.title);
    if (sc > bestScore) { bestScore = sc; best = e; }
  }
  return bestScore >= 0.75 ? best : null;
}

/**
 * Annotate proposed scenarios with prior-coverage flags from the repo's reuse index (mutates + returns
 * the same array). Each scenario gets `covered` (true when an existing test already automates it) and,
 * when covered, `coveredBy` (the existing spec/testId/title). Matches the bare scenario title AND the
 * feature-qualified title so generic titles like "positive path" still resolve to the right feature.
 * No index → all scenarios stay uncovered (new). Returns the count of scenarios found already covered.
 */
export function markCoveredScenarios(fw: string, feature: string, scenarios: Scenario[]): number {
  const existing = existingTestTitles(fw);
  let covered = 0;
  for (const s of scenarios) {
    const hit = coveringTest(s.title, existing) || coveringTest(`${feature} ${s.title}`, existing);
    if (hit) {
      s.covered = true;
      s.coveredBy = { spec: hit.spec, testId: hit.testId, title: hit.title };
      covered += 1;
    } else {
      s.covered = false;
    }
  }
  return covered;
}

/** Locate and parse the `export const routes = { ... } as const;` map so we know which routes exist. */
export function readRoutesBlock(fw: string): { file: string; body: string; keys: Set<string> } | null {
  for (const rel of ['src/config/index.ts', 'src/config.ts', 'src/config/routes.ts']) {
    const src = safeRead(join(fw, rel));
    if (!src) continue;
    const m = src.match(/export\s+const\s+routes\s*=\s*\{([\s\S]*?)\}\s*as\s+const\s*;/);
    if (!m) continue;
    const keys = new Set<string>();
    for (const km of m[1].matchAll(/([A-Za-z_]\w*)\s*:/g)) keys.add(km[1]);
    return { file: rel, body: m[1], keys };
  }
  return null;
}

/** Tell the model which routes.X keys already exist (reuse) so it only proposes genuinely-new ones. */
function routesContext(fw: string): string {
  const rb = readRoutesBlock(fw);
  if (!rb) return '(no routes map found — use RELATIVE paths resolved by baseURL)';
  return `Existing routes.X keys (REUSE these; only add a NEW key for a screen not listed): ${[...rb.keys].join(', ') || '(none)'}`;
}

/**
 * The wrapper utils generated code may call, and the `this.<prop>` each is invoked through in a Module
 * (the repo convention: this.actions = new Actions(page); this.workflowActions = new WorkflowActions(page);
 * this.waitHelper = new WaitHelper(page); this.logger = Logger.create(...)). This is the SINGLE source of
 * truth for BOTH the prompt contract and the post-generation validation gate, so the model is told — and
 * then held to — exactly the same allowed API. Framework-agnostic: only the utils that exist under `fw` count.
 */
const WRAPPER_UTILS: ReadonlyArray<{ className: string; prop: string; rel: string }> = [
  { className: 'Actions', prop: 'actions', rel: 'src/utils/Actions.ts' },
  { className: 'WorkflowActions', prop: 'workflowActions', rel: 'src/utils/WorkflowActions.ts' },
  { className: 'WaitHelper', prop: 'waitHelper', rel: 'src/utils/WaitHelper.ts' },
  { className: 'Logger', prop: 'logger', rel: 'src/utils/Logger.ts' },
];

/** Line-start tokens the method regex can match that are NOT wrapper methods (control flow / ctor). */
const NON_METHOD_KEYWORDS = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch', 'return']);

/**
 * Extract the PUBLIC instance method names + parameter lists from a TS class source. A `private`/`static`
 * method is written `private …`/`static …` at the line start, which this line-anchored regex does not
 * match (it only accepts an optional `public`/`async` then `name(`), so the result is exactly the methods
 * the generated code is allowed to call via `this.<prop>.<method>()` — the single extraction shared by the
 * prompt contract and the validation gate.
 */
function extractPublicMethods(src: string): Array<{ name: string; params: string }> {
  const out: Array<{ name: string; params: string }> = [];
  const re = /^\s*(?:public\s+)?(?:async\s+)?([a-zA-Z_]\w*)\s*\(([^)]*)\)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (NON_METHOD_KEYWORDS.has(m[1])) continue;
    out.push({ name: m[1], params: m[2].replace(/\s+/g, ' ').trim() });
  }
  return out;
}

/**
 * Split a raw TS parameter list on TOP-LEVEL commas only, so commas nested inside generics/objects/tuples
 * (`Record<string, string>`, `{ a: 1, b: 2 }`, `[a, b]`) are not treated as separators. `extractPublicMethods`
 * already captures only up to the first `)`, so parameter-level parentheses never reach here.
 */
function splitTopLevelParams(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of raw) {
    if (ch === '<' || ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '>' || ch === '}' || ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** A parameter is OPTIONAL when it is `name?`, has a default value (`= …`), or is a rest param (`...rest`). */
function isOptionalParam(param: string): boolean {
  const p = param.trim();
  if (!p) return true;
  if (p.startsWith('...')) return true;             // rest param — callable with zero of these
  const head = p.split(':')[0];                     // the portion before the type annotation
  if (/\?\s*$/.test(head)) return true;             // `name?: T`
  if (/(^|[^=!<>])=(?!=|>)/.test(p)) return true;   // default value `name: T = …` (ignores ==, =>, <=, >=)
  return false;
}

/** Minimum number of arguments an existing caller must pass = the count of leading REQUIRED parameters. */
function requiredParamCount(paramsRaw: string): number {
  return splitTopLevelParams(paramsRaw).filter((p) => p.trim() && !isOptionalParam(p)).length;
}

/** The set of public method NAMES a wrapper util exposes (empty when the util file is absent). */
function wrapperMethodNames(fw: string, rel: string): Set<string> {
  const src = safeRead(join(fw, rel));
  if (!src) return new Set();
  return new Set(extractPublicMethods(src).map((mm) => mm.name));
}

/**
 * Property-qualified wrapper contract for the prompt: each wrapper's REAL methods listed under the exact
 * `this.<prop>` the Module must call them on. A flat signature dump lets the model call a WorkflowActions
 * helper on this.actions (the live `this.actions.searchWithOptionalSubmit is not a function` crash);
 * qualifying every method by its owning property removes that ambiguity at generation time. Read live, so
 * the contract always matches the framework being generated into.
 */
function wrapperContract(fw: string): string {
  const blocks: string[] = [];
  for (const w of WRAPPER_UTILS) {
    const src = safeRead(join(fw, w.rel));
    if (!src) continue;
    const sigs = [...new Set(extractPublicMethods(src).map((mm) => `${mm.name}(${mm.params})`))];
    if (sigs.length) blocks.push(`- this.${w.prop}.<method>()  →  ${w.className}: ${sigs.join('; ')}`);
  }
  if (!blocks.length) return '(no wrapper utils found)';
  return [
    'Call each method ONLY on the property it is listed under. A method listed under one wrapper does NOT',
    'exist on the others — calling e.g. this.actions.searchWithOptionalSubmit (a WorkflowActions method)',
    'crashes at runtime with "is not a function". Construct every wrapper you use in the Module constructor',
    '(this.actions = new Actions(page); this.workflowActions = new WorkflowActions(page)). If a capability is',
    'listed on NO wrapper, implement it as a method ON THE NEW MODULE using the primitives below — never invent a util method.',
    ...blocks,
  ].join('\n');
}

/**
 * Canonical fallback exemplars used when the framework has no representative Page/Module/feature-spec
 * yet (e.g. a freshly reset repo). They encode the EXACT repo conventions — arrow-getter Page,
 * wrapper-driven Module with Logger, and a Spec that imports the fixtures barrel and instantiates the
 * Module directly — so a from-scratch generation still matches the 3-layer contract.
 */
const FALLBACK_PAGE_EXEMPLAR = `import { type Locator, type Page } from '@playwright/test';

/** Login screen — locators only. */
export class SampleLoginPage {
  constructor(private readonly page: Page) {}

  usernameInput = (): Locator => this.page.getByRole('textbox', { name: 'Username' });
  passwordInput = (): Locator => this.page.getByRole('textbox', { name: 'Password' });
  loginButton = (): Locator => this.page.getByRole('button', { name: 'Login' });
  errorMessage = (): Locator => this.page.getByRole('alert');
}
`;

const FALLBACK_MODULE_EXEMPLAR = `import { type Page } from '@playwright/test';
import { Actions } from '../utils/Actions';
import { Logger } from '../utils/Logger';
import { routes, urlFor } from '../config';
import { SampleLoginPage } from '../pages/SampleLoginPage';

/** Login workflow: open the page and submit credentials for an authenticated session. */
export class SampleLoginModule {
  private readonly page: Page;
  private readonly actions: Actions;
  private readonly logger = Logger.create('SampleLoginModule');
  private readonly loginPage: SampleLoginPage;

  constructor(page: Page) {
    this.page = page;
    this.actions = new Actions(page);
    this.loginPage = new SampleLoginPage(page);
  }

  /** Open the login page and wait for the username field. */
  async goto(): Promise<void> {
    this.logger.step(1, 'Open the login page');
    await this.actions.navigate(urlFor(routes.login), { readyElement: this.loginPage.usernameInput() });
  }

  /** Enter credentials and submit. */
  async login(username: string, password: string): Promise<void> {
    this.logger.step(2, 'Submit credentials');
    await this.actions.fill(this.loginPage.usernameInput(), username);
    await this.actions.fill(this.loginPage.passwordInput(), password);
    await this.actions.click(this.loginPage.loginButton());
  }
}
`;

const FALLBACK_SPEC_EXEMPLAR = `import { test, expect } from '../fixtures';
import { credentials, routes, urlRegex } from '../config';
import { SampleLoginModule } from '../modules/SampleLoginModule';

test.describe('Sample Login', () => {
  // Valid credentials should land on the inventory page.
  test('TC_001 valid credentials reach the app @SampleLogin @Smoke @Regression', async ({ page }) => {
    const loginModule = new SampleLoginModule(page);
    const { username, password } = credentials('app');
    await loginModule.goto();
    await loginModule.login(username, password);
    await expect(page).toHaveURL(urlRegex(routes.inventory));
  });
});
`;

/**
 * Find a reusable login Module by CONTENT, not by filename: the app's authentication entry is a module
 * class that DEFINES both a `goto()` and a `login(...)` method, even when it is named after the app (e.g.
 * SauceDemoModule) rather than `*Login*Module`. Returns the module's REAL class name + the login() arg
 * hint so the shared-login rule reuses it verbatim instead of re-authoring login in every feature module.
 * A conventionally-named auth file wins first (goto optional, preserving prior name-based behavior); any
 * other module must structurally BE an auth entry (both goto + login) to qualify. Fully generic.
 */
function findLoginModule(fw: string): { className: string; loginArgs: string } | null {
  const modulesDir = join(fw, 'src/modules');
  if (!existsSync(modulesDir)) return null;
  const files = readdirSync(modulesDir).filter((f) => f.endsWith('Module.ts') && !f.endsWith('.d.ts'));
  const named = (f: string): boolean => /login|signin|sign-in|auth/i.test(f);
  const consider = (src: string, requireGoto: boolean): { className: string; loginArgs: string } | null => {
    const loginDef = src.match(/^[ \t]*(?:public|private|protected)?\s*(?:async\s+)?login\s*\(([^)]*)\)/m);
    const cls = src.match(/export\s+class\s+(\w+)/);
    if (!loginDef || !cls) return null;
    if (requireGoto && !/^[ \t]*(?:public|private|protected)?\s*(?:async\s+)?goto\s*\(/m.test(src)) return null;
    return { className: cls[1], loginArgs: loginDef[1].trim() ? 'credentials("app")' : '' };
  };
  for (const f of files.filter(named)) {
    const hit = consider(safeRead(join(modulesDir, f)), false);
    if (hit) return hit;
  }
  for (const f of files.filter((f) => !named(f))) {
    const hit = consider(safeRead(join(modulesDir, f)), true);
    if (hit) return hit;
  }
  return null;
}

/** Whether the framework already has a reusable login Module and/or a registered login fixture. */
function loginAssets(fw: string): { loginModule: { className: string; loginArgs: string } | null; loginFixture: string | null } {
  const loginModule = findLoginModule(fw);
  let loginFixture: string | null = null;
  const fixturesSrc = safeRead(join(fw, 'src/fixtures/index.ts'));
  for (const m of fixturesSrc.matchAll(/^\s*(\w+)\s*:\s*async\s*\(/gm)) {
    if (/login/i.test(m[1])) { loginFixture = m[1]; break; }
  }
  return { loginModule, loginFixture };
}

/**
 * Build the SHARED LOGIN rule for the prompt from what ACTUALLY exists in the framework, so codegen
 * never tells the model to use a `loginModule` fixture that was never registered (the exact
 * "unknown parameter" crash on a reset repo). Three cases: a registered login fixture -> destructure
 * it; a LoginModule class but no fixture -> instantiate it; neither -> generate login from scratch.
 */
export function loginGuidanceFor(fw: string): string {
  const { loginModule, loginFixture } = loginAssets(fw);
  if (loginFixture) {
    return `- SHARED LOGIN: a '${loginFixture}' fixture IS registered - destructure it (async ({ page, ${loginFixture} }) => ...) and log in in test.beforeEach (${loginFixture}.goto() + ${loginFixture}.login(credentials("app"))). Feature navigation stays in the feature Module.goto() inside each test.`;
  }
  if (loginModule) {
    const inst = loginModule.className.charAt(0).toLowerCase() + loginModule.className.slice(1);
    return `- SHARED LOGIN — REUSE the existing ${loginModule.className}: it already exposes goto()+login(), so do NOT re-author login (no login()/goto() method, no username/password locators) in THIS feature's Module or Page. Import it (import { ${loginModule.className} } from '../modules/${loginModule.className}'), instantiate in the beforeEach/test body (const ${inst} = new ${loginModule.className}(page)) and call ${inst}.goto() + ${inst}.login(${loginModule.loginArgs}). NEVER destructure a '${inst}' fixture (it is not registered). Feature navigation stays in the feature Module.goto() inside each test.`;
  }
  return '- LOGIN FROM SCRATCH: there is NO login Module or login fixture yet. If the app requires login, generate the login step inside THIS feature\'s Module (a login() method that fills username/password from credentials("app") and submits) - do NOT reference a `loginModule` fixture (destructuring it fails with "unknown parameter"). Feature navigation stays in the feature Module.goto() inside each test.';
}

/** Read one representative Page/Module/feature-Spec so generated files match the repo's exact style. */
function readExemplars(fw: string): { page: string; module: string; spec: string } {
  // A representative FEATURE spec imports the fixtures barrel ('../fixtures'). Framework unit tests
  // (e.g. navigation.spec.ts) import '@playwright/test' directly and drive a fake page - using one as
  // the exemplar teaches the wrong import + shape, so exclude it and fall back to the canonical spec.
  const isFeatureSpec = (src: string): boolean =>
    /from\s+['"][^'"]*\/fixtures['"]/.test(src) && !/from\s+['"]@playwright\/test['"]/.test(src);
  const pick = (dir: string, prefer: RegExp, accept?: (src: string) => boolean): string => {
    const d = join(fw, dir);
    if (!existsSync(d)) return '';
    const candidates = readdirSync(d)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .map((f) => ({ f, src: safeRead(join(d, f)) }))
      .filter((x) => x.src && (!accept || accept(x.src)));
    const chosen = candidates.find((x) => prefer.test(x.f)) || candidates[0];
    return chosen ? chosen.src : '';
  };
  return {
    page: pick('src/pages', /login/i) || FALLBACK_PAGE_EXEMPLAR,
    module: pick('src/modules', /login/i) || FALLBACK_MODULE_EXEMPLAR,
    spec: pick('src/tests', /login/i, isFeatureSpec) || FALLBACK_SPEC_EXEMPLAR,
  };
}

/** Render the proven trace as authoritative locator evidence. */
function renderTrace(trace: AgentStep[]): string {
  if (!trace.length) return '(no verified actions captured)';
  return trace.map((t, i) => {
    const loc = t.locator ? t.locator.replace(/\s*\n\s*/g, ' ').slice(0, 220) : '(no locator)';
    const val = t.args && (t.args.value ?? t.args.text);
    const context = t.context ? `\n   [live snapshot context for this ref]\n${t.context}` : '';
    // Older approved plans predate scopeHint, so recover it from their captured snapshot context.
    const positionalLocator = /\.(?:first|last|nth)\s*\(/.test(t.locator || '');
    // A stable, unique test-id echo from the CLI's attribute-aware generator is the strongest target — copy
    // it verbatim and do NOT override it with a synthetic label-scoped xpath climb (which can anchor on
    // volatile nearby text such as a price). Only fall back to the scope hint for a positional/ambiguous echo.
    const scopeHint: LocatorScopeHint | undefined = isStableUniqueLocator(t.locator || '')
      ? undefined
      : (t.scopeHint
        || (positionalLocator ? deriveLocatorScopeHint(t.context || '', String(t.args?.ref || ''), true) : undefined));
    const scope = scopeHint
      ? `\n   [AMBIGUOUS ${scopeHint.role}${scopeHint.name ? ` "${scopeHint.name}"` : ''} match - ${scopeHint.matches} controls; use this EXACT label-scoped Page locator instead of the positional CLI echo]\n   ${scopeHint.locator}`
      : '';
    const prepopulated = t.prepopulatedFields?.length
      ? `\n   [app-prepopulated fields — never fill/assert]: ${t.prepopulatedFields.map((field) => field.label).join(', ')}`
      : '';
    return `${i + 1}. ${t.tool}${val ? ` "${val}"` : ''} → ${loc}${t.url ? `   [url: ${t.url}]` : ''}${context}${scope}${prepopulated}`;
  }).join('\n');
}

/** Render the LIVE discovery inventory as durable locator + option evidence (never invented). */
function renderDiscoveryInventory(ev?: DiscoveryEvidence): string {
  const inv = (ev?.inventory || []).filter((it) => !it.isAction);
  if (!inv.length) return '(no live discovery inventory attached)';
  return inv.slice(0, 40).map((it) => {
    const req = it.required === true ? 'required' : it.required === false ? 'optional' : 'req?';
    const loc = it.locatorEvidence?.locator
      ? ` locator=${it.locatorEvidence.locator}`
      : (it.accessibleName ? ` role=${it.role} name="${it.accessibleName}"` : ` role=${it.role}`);
    const opts = it.options?.length ? ` options=[${it.options.slice(0, 8).join(', ')}]` : '';
    const flags = [it.prepopulated ? 'app-prepopulated: never fill/assert' : '', it.blocked ? `BLOCKED: ${it.blockedReason || 'no fixture'}` : ''].filter(Boolean).join('; ');
    return `- ${it.label} [${it.type}, ${req}]${opts}${loc}${flags ? ` (${flags})` : ''}`;
  }).join('\n');
}

/** Render LIVE before→action→after transitions (dropdown options, date-picker, dependent fields). */
function renderStateTransitions(ev?: DiscoveryEvidence): string {
  const tr = ev?.transitions || [];
  if (!tr.length) return '(no state transitions captured)';
  return tr.slice(0, 20).map((t) => {
    const opts = t.options?.length ? ` options=[${t.options.slice(0, 12).join(', ')}]` : '';
    const sel = t.selectedOption ? ` selected="${t.selectedOption}"${t.resultingValue ? ` → value="${t.resultingValue}"` : ''}` : '';
    const rev = t.revealedFields.length ? ` reveals=[${t.revealedFields.slice(0, 8).join(', ')}]` : '';
    const loc = t.triggerLocator ? ` trigger=${t.triggerLocator}` : '';
    return `- ${t.kind} on "${t.trigger}"${opts}${sel}${rev}${loc} [VERIFIED live]`;
  }).join('\n');
}

/** Render the proven interaction target for every custom/ambiguous checkable-or-select control. */
function renderInteractionEvidence(trace: AgentStep[]): string {
  const risky = riskyInteractions(trace);
  if (!risky.length) return '(no custom/ambiguous interactive controls — standard role/label locators are fine)';
  return risky.map((ev) => {
    const why = ev.uniqueness > 1
      ? `${ev.uniqueness} same-role matches (ambiguous)`
      : 'custom unnamed widget (native input overlaid by a wrapper/switch span)';
    return `- ${ev.action} "${ev.controlId}" [${ev.semanticRole}] — ${why}. USE this proven target: ${ev.locatorEvidence}  (NEVER a bare getByRole('${ev.semanticRole}'))`;
  }).join('\n');
}

interface PrepopulatedEntry { label: string; value: string; kind?: string; }

/** Every prepopulated field captured across the trace, unique by label, with its kind + real value. */
export function prepopulatedFieldEntries(trace: AgentStep[]): PrepopulatedEntry[] {
  const byLabel = new Map<string, PrepopulatedEntry>();
  for (const field of trace.flatMap((step) => step.prepopulatedFields || [])) {
    if (!field.label || byLabel.has(field.label)) continue;
    byLabel.set(field.label, { label: field.label, value: field.value, kind: field.kind });
  }
  return [...byLabel.values()];
}

function buildPrompt(fw: string, job: CodegenJob, trace: AgentStep[]): string {
  const ex = readExemplars(fw);
  const wrappers = wrapperContract(fw);
  const caps = loadCapabilities(fw);
  const dependencies = dependencyResolutionContext(job.dependencyResolution);
  const loginGuidance = loginGuidanceFor(fw);
  const types = (job.testTypes && job.testTypes.length) ? job.testTypes.join(', ') : 'positive (happy path)';
  const prepopulated = prepopulatedFieldEntries(trace);
  return [
    `Generate Playwright test files for the feature "${job.feature}" at ${job.url}.`,
    `Cover these test types only: ${types}. Author at most ${job.maxCases || 3} test case(s).`,
    ...(job.caseContract && job.caseContract.length
      ? [
        '',
        '## AUTHORITATIVE TEST CASES (author EXACTLY these — supplied IDs + titles are FINAL, never renumber)',
        'Author ONE test() per row below, in this order. Put the EXACT id in brackets at the start of the test',
        'title, e.g. `test(\'[TC_003] <title> @Regression\', …)`. NEVER reset an id to TC_001 or change a title.',
        ...job.caseContract.map((c) => `- ${c.id}: ${c.title}`),
      ]
      : []),
    '',
    '## Verified live actions (HIGHEST-PRIORITY EVIDENCE — copy non-positional locators verbatim; an AMBIGUOUS scope hint overrides a positional CLI echo)',
    renderTrace(trace),
    '',
    '## Evidence priority (STRICT — a lower tier must NEVER override a higher one)',
    'VERIFIED LIVE INTERACTION EVIDENCE  >  VERIFIED LIVE TRACE  >  LIVE DISCOVERY INVENTORY  >  STATE TRANSITION EVIDENCE  >  REUSE INDEX (.ai-memory)  >  MODEL INFERENCE.',
    'Use ONLY locators and option values that appear in the evidence in this prompt. If no verified locator exists for a control, DO NOT invent one — omit that control. Never emit a dropdown/select option that the state-transition evidence below did not actually observe.',
    'For a custom or ambiguous checkable/select control, NEVER emit a bare getByRole(\'checkbox\'|\'switch\'|\'radio\'|\'combobox\'): reuse the exact proven interaction target below (a bare role locator resolves to a native input whose click a wrapper/switch span intercepts, or matches several controls).',
    '',
    '## Verified interaction evidence (custom/ambiguous controls — reuse the proven target, NEVER a bare role locator)',
    renderInteractionEvidence(trace),
    '',
    '## Live discovery inventory (durable locator + option evidence for every control on the feature screen)',
    renderDiscoveryInventory(job.discoveryEvidence),
    '',
    '## State transition evidence (LIVE before→action→after — dropdown options, date-picker, dependent fields, selected→resulting value)',
    renderStateTransitions(job.discoveryEvidence),
    '',
    '## Reuse index (.ai-memory) — REUSE these before creating anything new; never duplicate',
    caps,
    '',
    '## Automatically resolved prerequisite capabilities (INTERNAL — do not ask the user to select these)',
    dependencies,
    'The generated Module MUST construct and call every prerequisite workflow listed above before the new feature action. '
      + 'Those Page/Module/Spec artifacts are already verified: preserve them and implement ONLY the missing capability. '
      + 'Do NOT recreate a dependency locator or workflow.',
    '',
    '## Route map (src/config routes) — REUSE an existing routes.X; only add a genuinely-new one',
    routesContext(fw),
    '',
    '## Unique-value API (available at ../utils/UniqueData)',
    'uniqueValue(seed, { kind: "numeric" | "alphanumeric" | "email", length? }) creates a new value per attempt.',
    'retryOnCollision({ page, successUrl, collision, makeValue, submit, attempts?, collisionMessage? }) retries ONLY when the live collision locator becomes visible; it returns on success URL and rethrows every other timeout/error.',
    '',
    '## App-prepopulated fields (initial live form snapshot)',
    prepopulated.length
      ? prepopulated.map(({ label, value, kind }) =>
        (!kind || kind === 'text')
          ? `${label} (text field — the app already filled it; do not create a locator/testData, fill, clear, or assert its value)`
          : `${kind} already set to "${value}" (do not re-select/re-check this value; a page heading or static label of the same name may still be used as a read-only readiness/visibility assertion)`,
      ).join('; ')
      : '(none observed)',
    '',
    '## Wrapper API contract — call each method ONLY on the property it is listed under; never invent a wrapper method',
    wrappers,
    '',
    '## Style exemplars — match this EXACT structure',
    '### Page (locators ONLY — no workflows, no assertions)',
    ex.page.slice(0, 2200),
    '### Module (workflow via Actions + Logger — instantiate its own Page + Actions in the constructor)',
    ex.module.slice(0, 2200),
    '### Spec (assertions; import { test, expect } from "../fixtures")',
    ex.spec.slice(0, 2200),
    '',
    '## Rules',
    '- Page = locators only, arrow getters returning Locator, constructor(private readonly page: Page). Copy locators VERBATIM from the verified actions above.',
    '- LOCATOR STRATEGY (Playwright official priority — pick the HIGHEST-priority strategy the element ACTUALLY supports; fall back only when a higher one does not exist): (1) getByTestId() when the app exposes data-testid/data-test/data-qa; (2) getByRole(role, { name }) for interactive elements (button/link/textbox/checkbox/radio/menuitem/option) — the PRIMARY strategy; (3) getByLabel() for form fields with a real <label>; (4) getByPlaceholder() only when no label/role/testid; (5) getByText({ exact: true }) for static content/links; (6) getByAltText() for images; (7) CSS/XPath LAST RESORT and only SCOPED/chained (e.g. locator(".row", { hasText: "Admin" }).getByRole("textbox")). Default to ONE strategy per element; do NOT stack.',
    '- NEVER write a locator containing an auto-generated id/hash/framework class (e.g. #react-select-3, .MuiButton-root-482, .css-1a2b3c, numeric-suffix classes) — they change every build. Prefer role/label/text even when such an id is visible. NEVER a bare brittle class name.',
    '- DISAMBIGUATION: if a role/text locator matches MANY elements (tables, repeated rows, form fields with no distinct name), SCOPE from a stable parent (row/section/dialog/labelled group) and chain. For every [AMBIGUOUS ...] trace entry, use the supplied EXACT label-anchored Page locator; it was derived by climbing the live snapshot tree to the nearest distinguishing label and then selecting that label\'s nearest container with the target control. NEVER use .nth(), .first(), or .last() in a generated Page locator.',
    '- ITEM/CARD TITLE vs IMAGE LINK: in a repeated list/grid the item IMAGE link and the item TITLE link often share ONE accessible name (the image link\'s name comes from its alt text), so a bare getByRole(\'link\', { name }) resolves to BOTH — a strict-mode violation on .textContent()/.click(). To read or click a SINGLE item title, target its TEXT via getByText(name, { exact: true }) (matches only the title, not the alt-named image) or the item\'s stable data-test/testid title target — NEVER the bare named role. For ALL item names, use the repeated-item collection locator (a data-test shared by every item name) with .allTextContents()/.count(), not a per-name role locator.',
    '- LIST/COLLECTION READS (counts, sorting, "all items", table columns): read EVERY row through ONE COLLECTION locator — the SHARED data-test/testid/class every item exposes on its TEXT node (e.g. getByTestId(\'inventory-item-name\') or locator(\'[data-test="inventory-item-name"]\')) — consumed with .allTextContents()/.count(). NEVER back a collection getter with a single-item getByRole(role, { name }) or getByText(\'literal\'): a literal name hardcodes ONE runtime value (so the "collection" only ever sees that one row) and, for a link, ALSO matches the item image link (empty text) so an empty "" contaminates .allTextContents(). A collection getter returns MANY elements; it is never a single named element.',
    '- ORDERING/SORTING ASSERTIONS: verify order against an INDEPENDENT expected sequence, never the array\'s own re-sort. Read the collection, assert it is non-empty AND its .length equals the number of items observed, then assert it equals the SAME verified item names sorted by the rule under test. NEVER write expect(x).toEqual([...x].sort(...)) or expect(x).toEqual(x.slice().sort(...)) — comparing a value to a sorted copy of ITSELF is a tautology that proves nothing and FALSE-PASSES an already-ordered list.',
    '- DROPDOWNS: detect from the live snapshot whether it is a native <select> (use this.actions.selectOption) or a custom JS dropdown (React-select/MUI/PrimeNG/OXD — click-to-open then getByRole("option", { name }) via this.workflowActions.selectDropdownOption / this.workflowActions.searchAndSelectOption). Never assume one pattern.',
    '- IFRAMES/SHADOW DOM: if the target is inside an iframe or shadow root (per the snapshot), use frameLocator()/shadow-piercing correctly — never fall back to a wrong-scope locator. WAITING: rely on Playwright auto-waiting; never use fixed sleeps — only waitFor(state) for genuinely async/animated UI, with a `// reason:` note.',
    '- Every generated Page locator MUST be based on the verified live explore evidence. Copy a non-positional echoed locator verbatim. When an action has an [AMBIGUOUS ...] scope hint, use its exact supplied locator instead of the CLI echo (which may use .first(), .last(), or .nth()). Never re-guess a locator.',
    '- Module = workflow methods that call ONLY the wrapper properties + methods listed in the Wrapper API contract above, each on its OWN property (this.actions.* for primitive interactions, this.workflowActions.* for shared interaction helpers, this.waitHelper.* for waits, this.logger.* for logging). CONSTRUCT every wrapper you call in the constructor from the page (e.g. this.actions = new Actions(page); this.workflowActions = new WorkflowActions(page); this.waitHelper = new WaitHelper(page)) — only the ones you actually use. A method listed under one wrapper does NOT exist on another: calling a WorkflowActions helper on this.actions crashes at runtime with "is not a function". Never put a raw locator or an assertion in a Module.',
    '- Spec = import { test, expect } from "../fixtures"; instantiate the new Module directly with the test\'s page, e.g. `const m = new <Feature>Module(page)`. Put all assertions here.',
    '- STATE/VALUE ASSERTIONS (a count, badge, total, price, or status/confirmation value the flow produces): do NOT assert a lone short or generic literal via a bare unscoped page.getByText("1").toBeVisible() — a 1-3 char or generic literal matches many nodes (strict-mode ambiguity) and FALSE-PASSES when any unrelated element already shows that text, and toBeVisible only proves SOME element with that text exists, not that the state element holds the expected value. Instead SCOPE to the exact element the trace observed: add a getter on the feature Page (its getByRole(role, { name }) from the a11y evidence, or its stable data-test/testid when the evidence shows one) and assert the CONCRETE value from the spec with toHaveText/toContainText, e.g. expect(<feature>Page.<stateElement>()).toHaveText(testData.<a>.<b>). Reserve toBeVisible for presence-only checks (a heading/container that has no value to verify).',
    '- FIXTURES: the test callback may destructure ONLY { page } plus fixtures already listed in "Fixtures already registered" above (e.g. loginModule for shared login). This feature\'s brand-new Page/Module are NOT fixtures — codegen does not edit src/fixtures/index.ts — so NEVER write `async ({ <feature>Page })` or `async ({ <feature>Module })` (Playwright fails with "unknown parameter"). When the spec needs the new Page for an assertion, instantiate it directly in the test body: `const <feature>Page = new <Feature>Page(page)`; likewise `const <feature>Module = new <Feature>Module(page)`. The reuse exemplar destructures ITS OWN registered fixtures — do not copy that for a not-yet-registered feature.',
    '- For login, the Module\'s login method takes (username, password); the spec passes credentials("app"). Do NOT hardcode credentials.',
    loginGuidance,
    '- Reuse an existing Page/Module method from the reuse index when one already does the job.',
    '- ZERO hardcoded URLs (Pages, Modules AND specs). If src/config exposes a routes map + urlFor(path)/urlRegex(path), use urlFor(routes.X) for every goto() and urlRegex(routes.X) for every toHaveURL() assertion AND every waitForURL() navigation wait; otherwise use a RELATIVE path resolved by the configured baseURL. NEVER embed a full "https://host/..." literal NOR a raw inline URL regex (e.g. /\\/records\\/\\d+/ ) in a module or spec — a navigation wait on a dynamic landing path MUST use urlRegex(routes.X) on the stable prefix route.',
    '- NEW ROUTES: if you reference a routes.X key that is NOT already listed in the Route map above, you MUST also return it in a top-level "routes" object mapping that key to its VERIFIED RELATIVE path taken from the trace url (e.g. "createRecord": "/records/new"). Every routes.X you reference must either already exist or be returned in "routes" — an undefined route fails the build.',
    '- URL ASSERTIONS: assert the ACTUAL post-action landing URL observed in the trace (the FINAL step\'s [url: ...]), not the form/origin URL. If that landing path contains a DYNAMIC segment (numeric id, hash, /records/245, uuid), assert urlRegex on the STABLE PREFIX route (e.g. urlRegex(routes.recordDetails)) — never assert an exact URL that embeds a run-specific id.',
    '- NAVIGATION URL TYPE (hard rule — the wrong type crashes at runtime with "page.goto: url: expected string, got object"): page.goto() takes a URL STRING, so ALWAYS pass urlFor(routes.X). urlRegex(routes.X) returns a RegExp and is valid ONLY for expect(page).toHaveURL(urlRegex(routes.X)) and page.waitForURL(urlRegex(routes.X)). NEVER page.goto(urlRegex(...)), page.goto(/.../), page.goto(new RegExp(...)) or a bare page.goto(routes.X). Feature navigation belongs in the Module goto() using urlFor(routes.X).',
    '- ONE NAVIGATION PATH — no duplicate nav: test.beforeEach does SHARED LOGIN ONLY (loginModule.goto() + loginModule.login(credentials("app"))). Feature navigation lives in the feature Module.goto() called INSIDE each test. Do NOT also navigate to the feature from beforeEach (no page.goto(feature) there) when a test calls <feature>Module.goto() — that double-navigates. Pick the Module.goto() as the single authoritative path.',
    '- SEQUENTIAL, APPEND-ONLY numbering: each spec file owns its own TC_001, TC_002… sequence. When a spec for this feature already exists, read the highest existing TC_XXX and number NEW cases from the next free number (existing TC_001–TC_003 → new TC_004); never renumber, reorder, or overwrite an existing test() block — append after them and return the FULL file with every existing test kept verbatim.',
    '- Reuse SHARED METHODS/HELPERS, not just locators — but ONLY methods present in the Wrapper API contract, each called on its listed property. Typical mappings WHEN the contract lists them: custom dropdown -> this.workflowActions.selectDropdownOption(trigger, optionText); searchable/autocomplete -> this.workflowActions.searchAndSelectOption(input, text, optionText?); native <select> -> this.actions.selectOption(target, value); checkbox -> this.workflowActions.setCheckbox(target, checked); radio -> this.workflowActions.selectRadioOption(label); date field -> this.workflowActions.selectDate(input, value); table read -> this.workflowActions.readTableCell(table, rowText, colIndex); table row action -> this.workflowActions.clickInRow(table, rowText, controlName); table row checkbox -> this.workflowActions.setRowCheckbox(table, rowText, checked); search box -> this.workflowActions.searchWithOptionalSubmit(input, value, submit?). If NONE of the contract helpers fits a new interaction, implement it as a parameterized METHOD ON THE NEW MODULE (workflow logic belongs in the Module) — NEVER inline interaction logic in the spec, NEVER call a listed method on the wrong property, and NEVER invent a wrapper method that is not in the Wrapper API contract (the shared utils are a FIXED API on this path; this JSON output cannot emit a modified util file). Reuse one helper for repeated flows (login/logout/common assertions) too.',
    '- TEST DATA: read every value via the testData accessor (never hardcode usernames/names/roles/expected text in a spec). Reuse an existing matching entry before adding a new one; only add genuinely-new keys. Keep every existing testData key.',
    '- APP-PREPOPULATED FIELDS: every field listed in the App-prepopulated fields section is an application-owned default. Do NOT create a Page locator for it, add testData for it, fill/clear/type it, include it in uniqueFields, or assert its literal value. For a prepopulated dropdown/radio, do NOT re-select/re-check the value it already holds. Leave it untouched unless the approved test case explicitly requests custom entry. This does NOT forbid using a page/section heading or a static label as a READ-ONLY readiness or visibility assertion (e.g. asserting the "Products" heading is visible) — a heading/label is page chrome, not a prepopulated input value.',
    '- UNIQUE CONSTRAINTS (evidence-gated): treat a field as uniqueness-constrained ONLY when the LIVE trace actually exposed a duplicate/"already exists"/"already taken" validation for it. A field NAME alone is NOT evidence: a postal/ZIP code, phone/house/street number, or any "…code"/"…number"/"…id" the app accepts as a plain value is ORDINARY reusable testData — store a FIXED readable value, do NOT call uniqueValue(), and do NOT emit a uniqueFields entry for it. When (and only when) the live trace proved a uniqueness constraint on a genuine identifier/username/email/record-number, store only a readable seed in testData, import uniqueValue from "../utils/UniqueData" (add retryOnCollision only in mode B below), and generate a FRESH value for EACH submit via uniqueValue(seed, { kind, length }). TWO modes: (A) DEFAULT — if the field is proven-unique but the collision message is not an inline-recoverable locator, just fill the fresh uniqueValue() and Save (NO retry, NO collision locator); return a uniqueFields descriptor with only testDataPath+kind (+length) and OMIT collisionPageField/collisionMessage. (B) COLLISION RETRY — when the live trace exposed an inline collision validation with a locatable message for the field, wrap the submit in retryOnCollision({ page: this.page, successUrl: urlRegex(routes.X), collision: this.<page>.collisionLocator, makeValue: () => uniqueValue(seed, { kind, length }), submit: async (value) => { fill the field with value; click Save; }, collisionMessage }); the Page MUST expose that exact live collision locator, retry ONLY when it appears (all other errors/timeouts fail), and do NOT add a second waitForURL after the helper. Return one uniqueFields descriptor per unique field so codegen can enforce this contract. HARD REQUIREMENT: every uniqueFields entry you declare MUST have a matching uniqueValue(seed, { kind, length }) call AND an `import { uniqueValue } from "../utils/UniqueData"` in the Module that actually fills that field — declaring a uniqueFields descriptor without wiring uniqueValue() into the Module is REJECTED; if a field is not proven-unique, use ordinary FIXED testData for it rather than leaving an unimplemented uniqueFields entry.',
    '- TAGS — industry standard, stacked in the test() title: a feature/module tag in PascalCase (e.g. @AdminAddUser) PLUS suite tags — @Smoke on the primary happy-path case, @Regression on ALL cases. Do NOT use @Positive/@Negative. Match the domain naming already used in the repo.',
    '- TEST INDEPENDENCE: every test() runs STANDALONE (a case may be run individually via grep). Each test does its OWN login + navigation (prefer test.beforeEach for shared setup) and never depends on state left by a sibling test.',
    '- CLEAN CODE: match the exemplars\' indentation, no unused imports, no dead code, no duplicated boilerplate that belongs in a shared helper. Do not restate code or over-comment obvious lines.',
    '- DOC COMMENTS (neat, not noisy): put a ONE-LINE /** ... */ header on each Page and Module class stating its role, a ONE-LINE /** ... */ on each public Module method stating its intent, and a ONE-LINE // comment above each test() stating the scenario and expected outcome. One short intent line per class/method/test is the ceiling — never comment individual statements.',
    '',
    '## Output — STRICT JSON only (no prose, no markdown fences):',
    '{',
    '  "domain": "<kebab domain name>",',
    '  "page":   { "file": "src/pages/<Feature>Page.ts",   "content": "<full file>" },',
    '  "module": { "file": "src/modules/<Feature>Module.ts","content": "<full file>" },',
    '  "spec":   { "file": "src/tests/<feature>.spec.ts",   "content": "<full file>" },',
    '  "testData": { <any new keys the spec reads, or omit> },',
    '  "routes": { <NEW routes.X keys → verified relative path (e.g. "createRecord": "/records/new"), or omit if none are new> },',
    '  "uniqueFields": [{ "testDataPath": "<testData seed path>", "kind": "numeric|alphanumeric|email", "length": 7, "collisionPageField": "<Page collision locator property — ONLY if a live collision validation exists; OMIT otherwise>", "collisionMessage": "<exact live validation text — only alongside collisionPageField>" }],',
    '  "reusedFrom": ["<existing class/method you reused>"]',
    '}',
  ].join('\n');
}

/** Deep-merge new testData keys into the existing file (union — never drop existing keys). */
function mergeTestData(fw: string, additions?: Record<string, unknown>): string | null {
  if (!additions || !Object.keys(additions).length) return null;
  const p = join(fw, 'src', 'testdata', 'testData.json');
  const current = safeJson(p) || {};
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = merge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
      } else if (!(k in out)) {
        out[k] = v;
      }
    }
    return out;
  };
  writeFileSync(p, JSON.stringify(merge(current, additions), null, 4) + '\n');
  return p;
}

/** Add any NEW routes.X keys to src/config's routes map (union — never overwrite/drop an existing key). */
export function mergeRoutes(fw: string, additions?: Record<string, string>): string | null {
  if (!additions || !Object.keys(additions).length) return null;
  const rb = readRoutesBlock(fw);
  if (!rb) return null;
  const toAdd = Object.entries(additions).filter(([k, v]) => k && v && !rb.keys.has(k));
  if (!toAdd.length) return null;
  const file = join(fw, rb.file);
  const src = safeRead(file);
  if (!src) return null;
  const indent = (rb.body.match(/\n([ \t]+)\S/) || [, '    '])[1] as string;
  const insertion = toAdd.map(([k, v]) => `${indent}${k}: '${String(v).replace(/'/g, "\\'")}',`).join('\n');
  const next = src.replace(
    /(export\s+const\s+routes\s*=\s*\{[\s\S]*?)(\n[ \t]*\}\s*as\s+const\s*;)/,
    (_all, head: string, tail: string) => {
      const sep = /[{,]\s*$/.test(head) ? '' : ',';
      return `${head}${sep}\n${insertion}${tail}`;
    },
  );
  if (next === src) return null;
  writeFileSync(file, next);
  return rb.file;
}

/**
 * Remove line/block comments and single/double-quoted string literals so a `routes.X` only counts as
 * a REAL code reference. A JSDoc example (e.g. `urlRegex(routes.dashboard)` in the urlRegex doc block)
 * or a quoted string must NOT be treated as a live route usage. Template literals are left intact so a
 * genuine `routes.X` inside a `${…}` interpolation is still validated. Purely lexical + generic.
 */
export function stripCommentsAndStrings(src: string): string {
  return String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')        // block comments (incl. JSDoc)
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')     // line comments (but not the // in http://)
    .replace(/'(?:\\.|[^'\\])*'/g, "''")      // single-quoted strings
    .replace(/"(?:\\.|[^"\\])*"/g, '""');     // double-quoted strings
}

/**
 * Fail fast (before verifySpec) if a generated file references routes.X that is not defined in the
 * config routes map — turns the cryptic runtime `Cannot read properties of undefined (reading
 * 'startsWith')` into a clear build error naming the missing route. Comments/strings are stripped
 * first so a JSDoc example (e.g. the `urlRegex(routes.dashboard)` sample in config) can never be
 * mistaken for a live, undefined route reference.
 */
export function assertRoutesDefined(fw: string, files: string[]): void {
  const rb = readRoutesBlock(fw); // re-read AFTER mergeRoutes so freshly-added keys count as defined
  if (!rb) return; // this framework has no routes map — nothing to validate
  const missing = new Map<string, string>();
  for (const rel of files) {
    if (!rel.endsWith('.ts')) continue;
    const src = stripCommentsAndStrings(safeRead(join(fw, rel)));
    for (const m of src.matchAll(/\broutes\.([A-Za-z_]\w*)/g)) {
      if (!rb.keys.has(m[1]) && !missing.has(m[1])) missing.set(m[1], rel);
    }
  }
  if (missing.size) {
    const lines = [...missing].map(([key, rel]) => `route '${key}' is referenced in ${rel} but not defined in ${rb.file} routes`);
    throw new Error(`Codegen: undefined route reference(s):\n  - ${lines.join('\n  - ')}\nAdd the missing key(s) to the routes map (the model must return them in the "routes" field).`);
  }
}

/** The relative path (no scheme/host/query/hash) of a trace step url. */
function relPathFromTraceUrl(u: string): string {
  let s = String(u || '').trim();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\/[^/]+/i, ''); // strip scheme + host
  s = s.replace(/[?#].*$/, '');            // strip query + hash
  if (!s) return '';
  return s.startsWith('/') ? s : `/${s}`;
}

/** The camelCase key a path resolves to: "/checkout-step-one.html" → "checkoutStepOne". */
function camelKeyFromPath(path: string): string {
  const base = String(path || '').replace(/\.[a-z0-9]+$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = base.split(/[/\-_.]+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join('');
}

/** The verified relative path a missing routes.X key maps to — IFF exactly one trace url resolves to it. */
export function deriveRouteFromTrace(missingKey: string, trace: AgentStep[]): string | null {
  const matches = new Set<string>();
  for (const s of trace || []) {
    const rel = relPathFromTraceUrl(s.url || '');
    if (rel && camelKeyFromPath(rel) === missingKey) matches.add(rel);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

/**
 * IN-MEMORY, REPAIRABLE routes gate (runs inside the codegen self-repair loop). A routes.X referenced by
 * the generated page/module/spec must be EITHER already in the config map OR returned in the model's
 * top-level "routes" field. When missing, throw a repair message carrying the exact verified path from the
 * trace so the model can add it — instead of failing hard AFTER the loop (the old cause of the recurring
 * "undefined route reference" build break).
 */
export function assertRoutesResolvable(fw: string, candidate: LlmArtifacts, trace: AgentStep[]): void {
  const rb = readRoutesBlock(fw);
  if (!rb) return; // no routes map — nothing to validate
  const defined = new Set<string>(rb.keys);
  for (const k of Object.keys(candidate.routes || {})) if (k) defined.add(k); // the model's freshly-returned routes
  const files = [
    { file: candidate.page.file || 'Page', content: candidate.page.content },
    { file: candidate.module.file || 'Module', content: candidate.module.content },
    { file: candidate.spec.file || 'Spec', content: candidate.spec.content },
  ];
  const missing = new Map<string, string>();
  for (const f of files) {
    const src = stripCommentsAndStrings(f.content);
    for (const m of src.matchAll(/\broutes\.([A-Za-z_]\w*)/g)) {
      if (!defined.has(m[1]) && !missing.has(m[1])) missing.set(m[1], f.file);
    }
  }
  if (!missing.size) return;
  const lines = [...missing].map(([key, file]) => {
    const rel = deriveRouteFromTrace(key, trace);
    return `route '${key}' is referenced in ${file} but is neither defined in ${rb.file} nor returned in your "routes" field${rel ? ` — its VERIFIED path is "${rel}"` : ''}`;
  });
  throw new Error(`Codegen: undefined route reference(s):\n  - ${lines.join('\n  - ')}\nReturn EVERY new route key in the top-level "routes" field mapped to its VERIFIED relative path from the trace url (e.g. "checkoutStepOne": "/checkout-step-one.html"). Do NOT remove the reference.`);
}

/**
 * SAFETY NET (runs after generation, before the final assertRoutesDefined): if a referenced routes.X still
 * isn't defined — the model omitted it from "routes" despite the repair prompt — auto-derive its path from
 * the verified trace url (only when exactly one trace url resolves to that key) and merge it, so a stubborn
 * omission can never break the build. Evidence-based: the path always comes from the real trace.
 */
export function recoverMissingRoutes(fw: string, files: string[], trace: AgentStep[]): string | null {
  const rb = readRoutesBlock(fw);
  if (!rb) return null;
  const additions: Record<string, string> = {};
  for (const rel of files) {
    if (!rel.endsWith('.ts')) continue;
    const src = stripCommentsAndStrings(safeRead(join(fw, rel)));
    for (const m of src.matchAll(/\broutes\.([A-Za-z_]\w*)/g)) {
      const key = m[1];
      if (rb.keys.has(key) || additions[key]) continue;
      const derived = deriveRouteFromTrace(key, trace);
      if (derived) additions[key] = derived;
    }
  }
  return Object.keys(additions).length ? mergeRoutes(fw, additions) : null;
}

/** Positional Page locators are not stable evidence for a single form control. */
function assertNoPositionalPageLocators(file: string, content: string): void {
  if (!/\.(?:nth|first|last)\s*\(/.test(content)) return;
  throw new Error(`Codegen: positional locator found in ${file}. Scope the live control from its stable label/group instead of using .nth().`);
}

/** Roles for which a bare getByRole('<role>') is a known trap on custom widgets / ambiguous pages. */
const RISKY_INTERACTION_ROLES = ['checkbox', 'switch', 'radio', 'combobox'];

/** The custom/ambiguous interactive controls proven live during exploration (deduped by role+control). */
function riskyInteractions(trace: AgentStep[]): InteractionEvidence[] {
  const seen = new Set<string>();
  const out: InteractionEvidence[] = [];
  for (const step of trace) {
    const ev = step.interaction;
    if (!ev || !ev.custom || !RISKY_INTERACTION_ROLES.includes(ev.semanticRole)) continue;
    const key = `${ev.semanticRole}:${ev.controlId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

/**
 * VERIFIED-LIVE interaction gate (pre-execution). When exploration proved a control is a CUSTOM checkable
 * widget (an unnamed checkbox/switch/radio) or an AMBIGUOUS role, a bare getByRole('<role>') is unsafe: it
 * resolves to a native input whose click a wrapper/switch span intercepts, or it matches several controls.
 * This rejects that exact locator BEFORE Playwright runs and hands the repair loop the proven target to
 * reuse. Generic across every application — driven only by observed live evidence, never app selectors.
 */
export function assertProvenInteractionLocators(artFiles: Array<{ file: string; content: string }>, trace: AgentStep[]): void {
  for (const ev of riskyInteractions(trace)) {
    // A BARE role locator is chained DIRECTLY off the page: `page.getByRole('checkbox')` (also matches
    // `this.page.getByRole(...)`). A label/group-scoped form — `page.getByText('…').locator('…').getByRole('checkbox')`
    // or `.filter(…).getByRole('checkbox')` — is intentionally allowed because the scoping call sits between
    // `page.` and `getByRole`, so this pattern never matches it. A named getByRole('checkbox', { name: '…' })
    // carries a comma and is allowed too.
    const bare = new RegExp(`page\\.getByRole\\(\\s*['"]${ev.semanticRole}['"]\\s*\\)`);
    const hit = artFiles.find((f) => bare.test(f.content));
    if (!hit) continue;
    const why = ev.uniqueness > 1
      ? `the live trace shows ${ev.uniqueness} same-role ${ev.semanticRole} controls (ambiguous)`
      : `the live trace shows a custom (unnamed) ${ev.semanticRole} whose click is intercepted by a sibling/ancestor wrapper (e.g. a switch span)`;
    throw new Error(
      `Codegen: locator for "${ev.controlId}" in ${hit.file} resolves to a bare getByRole('${ev.semanticRole}'), but `
      + `${why}. Do NOT use generic getByRole('${ev.semanticRole}'). Reuse the EXACT live interaction target `
      + `captured during exploration: ${ev.locatorEvidence || '(the label-scoped locator from the trace)'}.`,
    );
  }
}

/**
 * A NAMED getByRole('<role>', { name }) chained DIRECTLY off the page is a strict-mode trap when the live
 * a11y snapshot shows that SAME (role, name) on >=2 elements — the classic image-link + title-link pair that
 * share one accessible name (SauceDemo item-N-img-link + item-N-title-link both named "Sauce Labs Backpack").
 * getByRole then resolves to 2 elements and every .textContent()/.click() throws. This rejects that locator
 * BEFORE Playwright runs so the repair loop switches to the INTENDED element's stable target. A SCOPED
 * locator (a call sits between `page.` and `.getByRole`, e.g. page.locator('.row').getByRole(...)) is left
 * alone. Evidence-only — driven by the captured snapshot, never app selectors.
 */
export function assertUniqueNamedRoleLocators(artFiles: Array<{ file: string; content: string }>, trace: AgentStep[]): void {
  const ambiguous = ambiguousSnapshotRoleNames(trace);
  if (!ambiguous.size) return;
  // page.getByRole('role', { name: '…' }) / this.page.getByRole(...) chained DIRECTLY off the page (no
  // scoping call in between). Quote-balanced name capture; a regex name (/…/) has no quote and is skipped.
  const NAMED = /(?:this\.)?page\.getByRole\(\s*['"]([\w-]+)['"]\s*,\s*\{[^}]*?\bname\s*:\s*(['"])((?:\\.|(?!\2).)*)\2/g;
  const unescape = (s: string): string => s.replace(/\\(['"\\])/g, '$1');
  for (const { file, content } of artFiles) {
    NAMED.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NAMED.exec(content)) !== null) {
      const role = m[1];
      const name = unescape(m[3]);
      if (!ambiguous.has(`${role}\u0000${name}`)) continue;
      throw new Error(
        `Codegen: getByRole('${role}', { name: '${name}' }) in ${file} matches >=2 elements in the live snapshot `
        + '(an image/icon link and a text/title link share this accessible name), so Playwright throws a strict-mode '
        + 'violation ("resolved to N elements"). Do NOT use a bare named role here and NEVER .first()/.nth()/.last(). '
        + "Use the INTENDED element's stable data-test/testid, or its exact TEXT via getByText(name, { exact: true }) "
        + "for a title/name read (the image link's name comes from alt text, so getByText hits only the title). For "
        + "ALL item names use the repeated item's data-test collection locator with .allTextContents()/.count().",
      );
    }
  }
}

/** Playwright APIs that read/count MANY elements at once — a getter used with one MUST be a collection. */
const COLLECTION_READ_APIS = ['allTextContents', 'allInnerTexts', 'all', 'count'];

/** Single-target text strategies — each resolves to ONE element by a literal name/text (never a collection). */
const SINGLE_TARGET_BY_TEXT = new Set(['getByText', 'getByLabel', 'getByPlaceholder', 'getByTitle', 'getByAltText']);

/** True when an args string starts with a STRING literal (quote/backtick) — a hardcoded single value. */
function startsWithStringLiteral(args: string): boolean {
  return /^\s*['"`]/.test(String(args || ''));
}

/** True when a getByRole(...) args string carries a name option whose value is a STRING literal. */
function roleHasLiteralName(args: string): boolean {
  return /\bname\s*:\s*['"`]/.test(String(args || ''));
}

/** Reduce a Page member's source (arrow getter, method body, or property initializer) to its locator expression. */
function pageMemberLocatorExpr(member: ts.ClassElement, source: ts.SourceFile): string {
  let src = pageMemberLocatorSource(member, source) || '';
  const arrowIdx = src.indexOf('=>');
  if (arrowIdx >= 0) src = src.slice(arrowIdx + 2);
  src = src.trim();
  if (src.startsWith('{')) {
    const ret = src.match(/return\s+([\s\S]+?);/);
    src = ret ? ret[1] : src.replace(/^\{|\}$/g, '');
  }
  return src.trim().replace(/^this\./, '').replace(/^page\./, '');
}

/**
 * Public Page members whose locator resolves to a SINGLE named/text element — its terminal strategy is a
 * getByRole(role, { name: 'literal' }) or a getByText/Label/Placeholder/Title/AltText('literal'). Keyed by
 * member name → a short description of the offending strategy. A collection-capable terminal (getByTestId, a
 * bare getByRole with no name, locator('.css')) is NOT single-target and is intentionally excluded. Generic.
 */
export function singleTargetNamedPageMembers(pageContent: string): Map<string, string> {
  const out = new Map<string, string>();
  const source = ts.createSourceFile('page.ts', String(pageContent || ''), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cls = source.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && !!s.name);
  if (!cls) return out;
  for (const member of cls.members) {
    if (hasNonPublicModifier(member) || hasStaticModifier(member)) continue;
    const name = sourceMemberName(member.name);
    if (!name) continue;
    const expr = pageMemberLocatorExpr(member, source);
    if (!expr) continue;
    const terminal = [...splitLocatorChain(expr)].reverse().find((s) => s.name.startsWith('getBy') || s.name === 'locator');
    if (!terminal) continue;
    if (terminal.name === 'getByRole' && roleHasLiteralName(terminal.args)) {
      out.set(name, "getByRole(..., { name: '…' })");
    } else if (SINGLE_TARGET_BY_TEXT.has(terminal.name) && startsWithStringLiteral(terminal.args)) {
      out.set(name, `${terminal.name}('…')`);
    }
  }
  return out;
}

/**
 * COLLECTION-READ HYGIENE gate. A Page getter consumed by a Playwright collection API (.allTextContents(),
 * .allInnerTexts(), .all(), .count()) MUST resolve to a real collection. Reject when that getter's locator is
 * a SINGLE named/text element (getByRole(role,{name:'…'}) or getByText/Label/…('…')): a named link ALSO
 * matches its sibling image link, so .allTextContents() leaks an empty "" (the live SauceDemo Name-sort
 * failure — productNames() = getByRole('link', { name: 'Sauce Labs Backpack' }) returned ["", "Sauce Labs
 * Backpack"]); and a literal name HARDCODES one runtime item so the "collection" can never see the others.
 * Deterministic + evidence-independent — it inspects the generated code's own shape, so it holds even when no
 * snapshot was captured. Generic across every application.
 */
export function assertCollectionReadsUseCollectionLocators(
  page: { file: string; content: string },
  consumers: Array<{ file: string; content: string }>,
): void {
  const singleTarget = singleTargetNamedPageMembers(page.content);
  if (!singleTarget.size) return;
  const apiAlt = COLLECTION_READ_APIS.join('|');
  for (const [member, strategy] of singleTarget) {
    const consumed = new RegExp(`\\.${member}\\s*\\(\\s*\\)\\s*\\.\\s*(?:${apiAlt})\\s*\\(`);
    const hit = consumers.find((f) => consumed.test(stripCommentsAndStrings(f.content)));
    if (!hit) continue;
    throw new Error(
      `Codegen: the collection read \`.${member}().<${apiAlt}>()\` in ${hit.file} is backed by a SINGLE-element `
      + `locator (${strategy}) in ${page.file}. A named/text locator resolves to ONE element (and a named link ALSO `
      + `matches its sibling image link, injecting an empty "" into .allTextContents()), and it hardcodes one runtime `
      + `value so the "collection" only ever sees that single item. Back "${member}" with a real COLLECTION locator `
      + `shared by EVERY item — the item's repeated data-test/testid (e.g. getByTestId('inventory-item-name') or `
      + `locator('[data-test="inventory-item-name"]')) — then read it with .allTextContents()/.count(). Never build a `
      + `collection from one item's name.`,
    );
  }
}

/**
 * TAUTOLOGICAL-ORDERING gate. Reject comparing a value to ITS OWN sorted/reversed copy —
 * expect(V).toEqual([...V].sort(…)) / V.slice().sort(…) / V.concat().sort(…) / Array.from(V).sort(…) /
 * .reverse(). It proves nothing: a value always equals a sorted copy of itself when it is already in that
 * order (the live SauceDemo A-Z case FALSE-PASSED this way while Z-A failed), and it silently tolerates a
 * dirty collection. A real order check compares the observed collection to an INDEPENDENT expected order.
 * Deterministic + generic — inspects only the spec's own shape.
 */
export function assertNoSelfReferentialSortAssertion(spec: { file: string; content: string }): void {
  const src = stripCommentsAndStrings(spec.content);
  const MATCHERS = '(?:toEqual|toStrictEqual|toMatchObject)';
  const PATTERNS: RegExp[] = [
    new RegExp(`expect\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)\\s*\\.\\s*(?:not\\s*\\.\\s*)?${MATCHERS}\\s*\\(\\s*\\[\\s*\\.\\.\\.\\s*\\1\\s*\\]\\s*\\.\\s*(?:sort|reverse)\\b`),
    new RegExp(`expect\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)\\s*\\.\\s*(?:not\\s*\\.\\s*)?${MATCHERS}\\s*\\(\\s*\\1\\s*\\.\\s*(?:slice|concat)\\s*\\(\\s*\\)\\s*\\.\\s*(?:sort|reverse)\\b`),
    new RegExp(`expect\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)\\s*\\.\\s*(?:not\\s*\\.\\s*)?${MATCHERS}\\s*\\(\\s*Array\\.from\\(\\s*\\1\\s*\\)\\s*\\.\\s*(?:sort|reverse)\\b`),
  ];
  for (const re of PATTERNS) {
    const m = src.match(re);
    if (!m) continue;
    throw new Error(
      `Codegen: tautological ordering assertion in ${spec.file}: \`expect(${m[1]}).toEqual(<a sorted copy of ${m[1]}>)\`. `
      + `Comparing a value to its OWN sorted/reversed copy proves nothing — it passes whenever the data is already in `
      + `that order (so an ascending list FALSE-PASSES) and it hides a dirty collection. Assert ordering against an `
      + `INDEPENDENT expected order: capture the item set, assert it is non-empty AND its .length matches the expected `
      + `item count, then compare the observed sequence to the SAME verified item names sorted by the rule under test — `
      + `never to a re-sort of the very array you are checking.`,
    );
  }
}

/**
 * page.goto()/.goto() require a URL STRING. urlRegex(routes.X) returns a RegExp and is valid ONLY for
 * expect(page).toHaveURL(...) and page.waitForURL(...). This rejects a goto() fed a regex/urlRegex/bare
 * route (the exact `page.goto: url: expected string, got object` runtime crash) BEFORE execution, so the
 * self-repair loop rewrites it to urlFor(routes.X). Generic across Page/Module/Spec — no app specifics.
 */
export function assertNavigationUrlContract(artFiles: Array<{ file: string; content: string }>): void {
  // A goto() whose FIRST argument is a RegExp form (urlRegex(...), new RegExp(...), /literal/) or a bare
  // routes.X reference is invalid — goto needs a resolved string (urlFor(routes.X)).
  const BAD_GOTO = /\.goto\(\s*(?:urlRegex\s*\(|new\s+RegExp\b|routes\.[A-Za-z_]|\/[^/*])/;
  for (const { file, content } of artFiles) {
    const line = content.split('\n').find((l) => BAD_GOTO.test(l));
    if (line) {
      throw new Error(
        `Codegen: invalid navigation in ${file}: \`${line.trim()}\`. page.goto() needs a URL STRING — use ` +
        `urlFor(routes.X). urlRegex(routes.X) is a RegExp and is ONLY valid for expect(page).toHaveURL(...) and ` +
        `page.waitForURL(...). Rewrite the goto() to urlFor(routes.X) (or call a Module navigation method that ` +
        `does), and keep urlRegex(...) only in URL assertions/waits.`,
      );
    }
  }
}

/**
 * One authoritative feature-navigation path. Catches the double-nav bug: beforeEach navigates to the
 * feature (raw page.goto or a feature Module.goto()) AND a test ALSO navigates via <feature>Module.goto().
 * A login Module/fixture goto() is the login page, not feature navigation, so it never counts. Reject the duplicate so
 * beforeEach is reduced to shared login only and the Module.goto() owns feature navigation. Generic.
 */
export function assertSingleNavigationPath(spec: { file: string; content: string }): void {
  const src = spec.content;
  const be = src.match(/beforeEach\s*\([\s\S]*?=>\s*\{([\s\S]*?)\n\s*\}\s*\)\s*;?/);
  const beforeBody = be?.[1] || '';
  const rest = be ? src.replace(be[0], '') : src;
  // Feature navigation = a raw page.goto() OR a Module.goto() whose module name does NOT contain
  // "login" (a login Module/fixture is shared setup, not feature navigation).
  const FEATURE_NAV = /\bpage\.goto\s*\(|\b(?![A-Za-z_]*[Ll]ogin)\w*Module\.goto\s*\(\s*\)/;
  if (FEATURE_NAV.test(beforeBody) && FEATURE_NAV.test(rest)) {
    throw new Error(
      `Codegen: duplicate feature navigation in ${spec.file}. beforeEach navigates to the feature AND a test ` +
      `also navigates (page.goto()/Module.goto()). Keep ONE path: beforeEach performs SHARED LOGIN ONLY ` +
      `(your login Module/fixture goto() + login(credentials("app"))), and the feature Module.goto() performs ` +
      `feature navigation inside each test. Remove the feature navigation from beforeEach.`,
    );
  }
}

/**
 * Deterministic repair for the duplicate-feature-navigation defect (bug #3). When the spec's beforeEach
 * navigates to the feature AND a test also navigates, mechanically reduce beforeEach to SHARED LOGIN ONLY by
 * dropping the feature-navigation statement(s) from it — the exact resolution assertSingleNavigationPath
 * recommends — so the fix never depends on the LLM self-repair round. A login Module/fixture goto() is shared
 * setup (not feature navigation) and is always preserved. Repairs ONLY when BOTH sites navigate (safe: the
 * test still owns feature navigation after the edit); otherwise the content is returned untouched so the gate
 * can judge it. Returns the (possibly unchanged) content + whether it changed. Generic; never app-specific.
 */
export function repairDuplicateFeatureNavigation(spec: { file: string; content: string }): { content: string; changed: boolean } {
  const src = spec.content;
  const be = src.match(/beforeEach\s*\([\s\S]*?=>\s*\{([\s\S]*?)\n\s*\}\s*\)\s*;?/);
  if (!be) return { content: src, changed: false };
  const beforeBody = be[1] || '';
  const rest = src.replace(be[0], '');
  const FEATURE_NAV = /\bpage\.goto\s*\(|\b(?![A-Za-z_]*[Ll]ogin)\w*Module\.goto\s*\(\s*\)/;
  // Safe ONLY when the test(s) ALSO navigate — then removing beforeEach's nav leaves exactly one path.
  if (!(FEATURE_NAV.test(beforeBody) && FEATURE_NAV.test(rest))) return { content: src, changed: false };
  const keptLines = beforeBody.split('\n').filter((line) => !FEATURE_NAV.test(line));
  if (keptLines.join('\n') === beforeBody) return { content: src, changed: false };
  const repairedBlock = be[0].replace(beforeBody, keptLines.join('\n'));
  return { content: src.replace(be[0], repairedBlock), changed: true };
}

/**
 * Anti-hallucination gate for FRAMEWORK (wrapper) APIs. Every `this.<wrapperProp>.<method>()` call in the
 * generated Page/Module/Spec MUST target a method that actually exists on that wrapper's source class.
 *
 * WHY THIS IS NECESSARY: generated code runs transpile-only (tsx / Playwright's esbuild — NO type-check),
 * so a method invoked on the WRONG wrapper (the live failure: this.actions.searchWithOptionalSubmit, which
 * is really a WorkflowActions method) compiles fine and only explodes at RUNTIME with "… is not a function".
 * This gate reads the ACTUAL wrapper sources under `fw` (the single source of truth shared with the prompt
 * contract), rejects any call whose method is absent from the wrapper it targets, and — when the method
 * lives on a DIFFERENT wrapper — tells the model the correct property so the self-repair loop fixes it on
 * the next attempt. Generic across frameworks; never app-specific. A framework exposing no wrapper utils is
 * a no-op, and calls on non-wrapper properties (this.page, this.<x>Page, Module self-calls) are ignored.
 */
export function assertWrapperMethodsExist(fw: string, artFiles: Array<{ file: string; content: string }>): void {
  // Real public methods per wrapper class + the convention property each is called on — read live so the
  // allowed API always matches the framework being generated into.
  const methodsByClass = new Map<string, Set<string>>();
  const conventionProps = new Map<string, string>();
  for (const w of WRAPPER_UTILS) {
    const names = wrapperMethodNames(fw, w.rel);
    if (!names.size) continue;
    methodsByClass.set(w.className, names);
    conventionProps.set(w.prop, w.className);
  }
  if (!methodsByClass.size) return; // framework exposes no wrapper utils — nothing to enforce.

  // The wrapper (if any) that DOES define a given method — used to point a misattributed call at the
  // right property (e.g. searchWithOptionalSubmit → this.workflowActions).
  const ownerOf = (method: string): { className: string; prop: string } | undefined => {
    const w = WRAPPER_UTILS.find((x) => methodsByClass.get(x.className)?.has(method));
    return w ? { className: w.className, prop: w.prop } : undefined;
  };

  const violations: string[] = [];
  const seen = new Set<string>();
  for (const { file, content } of artFiles) {
    if (!content) continue;
    // Map each `this.<prop>` to the wrapper class it is actually constructed from in THIS file (so a
    // non-conventional property name is still validated against the right class); seed with the naming
    // convention as a backstop for a wrapper used without an explicit `new` in this file.
    const propClass = new Map<string, string>(conventionProps);
    for (const a of content.matchAll(/this\.([A-Za-z_]\w*)\s*=\s*new\s+([A-Za-z_]\w*)\s*\(/g)) {
      if (methodsByClass.has(a[2])) propClass.set(a[1], a[2]);
    }
    for (const a of content.matchAll(/this\.([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\.create\s*\(/g)) {
      if (methodsByClass.has(a[2])) propClass.set(a[1], a[2]);
    }
    // Validate every wrapper method call: this.<prop>.<method>( … ).
    for (const c of content.matchAll(/this\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g)) {
      const [, prop, method] = c;
      const className = propClass.get(prop);
      if (!className) continue; // not a wrapper property (this.page, this.<x>Page, a Module self-call) — skip.
      if (methodsByClass.get(className)!.has(method)) continue; // real method on the right wrapper — OK.
      const key = `${file}::${prop}.${method}`;
      if (seen.has(key)) continue; // report each distinct violation once.
      seen.add(key);
      const owner = ownerOf(method);
      const fix = owner
        ? `It exists on ${owner.className} — call this.${owner.prop}.${method}(...) instead (construct this.${owner.prop} = new ${owner.className}(page) in the Module constructor).`
        : `No wrapper (${[...methodsByClass.keys()].join(', ')}) defines "${method}". Use an existing method that performs this action, or implement the workflow as a NEW parameterized method ON THE MODULE using existing primitives — do NOT invent a util method.`;
      violations.push(
        `  - ${file}: this.${prop}.${method}(...) — "${method}" does NOT exist on ${className}. ${fix}\n` +
        `    ${className} methods: ${[...methodsByClass.get(className)!].sort().join(', ')}`,
      );
    }
  }

  if (violations.length) {
    throw new Error(
      'Codegen: generated code calls framework wrapper method(s) that do not exist on the wrapper they target ' +
      '(the shared utils are a FIXED API — call ONLY methods that exist on the specific wrapper, and never invent one):\n' +
      violations.join('\n') +
      '\nFix by calling each method on the property that owns it (shown above), or by implementing the missing ' +
      'behaviour as a Module method built from existing primitives. Re-emit the COMPLETE corrected artifact.',
    );
  }
}

export interface PageObjectArtifacts {
  page: { file: string; content: string };
  module: { file: string; content: string };
  spec: { file: string; content: string };
}

interface PageObjectMember {
  locatorSource: string;
}

interface PageObjectContract {
  className: string;
  file: string;
  generated: boolean;
  members: Map<string, PageObjectMember>;
}

interface PageObjectReference {
  file: string;
  instance: string;
  member: string;
  page: PageObjectContract;
}

interface ModuleMethod {
  minimumArguments: number;
  maximumArguments: number;
}

interface ModuleContract {
  className: string;
  file: string;
  methods: Map<string, ModuleMethod>;
}

interface ModuleCall {
  file: string;
  instance: string;
  method: string;
  arguments: number;
  module: ModuleContract;
}

/** Normalise generated relative paths before resolving a TypeScript import. */
function normaliseSourcePath(file: string): string {
  return normalize(String(file || '')).replace(/\\/g, '/').replace(/^\.\//, '');
}

function sourceMemberName(name: ts.PropertyName | ts.PrivateIdentifier | undefined): string | undefined {
  if (!name || ts.isPrivateIdentifier(name)) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function hasNonPublicModifier(member: ts.ClassElement): boolean {
  return ts.canHaveModifiers(member) && !!ts.getModifiers(member)?.some((modifier) =>
    modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword,
  );
}

function hasStaticModifier(member: ts.ClassElement): boolean {
  return ts.canHaveModifiers(member) && !!ts.getModifiers(member)?.some((modifier) =>
    modifier.kind === ts.SyntaxKind.StaticKeyword,
  );
}

function pageMemberLocatorSource(member: ts.ClassElement, source: ts.SourceFile): string | undefined {
  if (ts.isPropertyDeclaration(member)) return member.initializer?.getText(source);
  if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member)) return member.body?.getText(source);
  return undefined;
}

function typeReferenceName(type: ts.TypeNode | undefined): string | undefined {
  if (!type || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return undefined;
  return type.typeName.text;
}

/** Playwright chain methods that RETURN a locator (safe to keep in a canonical locator identity). */
const LOCATOR_CHAIN_METHODS = new Set([
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId',
  'getByTitle', 'getByAltText', 'filter', 'first', 'last', 'nth', 'and', 'or', 'frameLocator',
]);

/** Split a locator chain into ordered `name(args)` segments, respecting nested parens and strings. */
function splitLocatorChain(input: string): Array<{ name: string; args: string }> {
  const segments: Array<{ name: string; args: string }> = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    if (segments.length > 0) {
      if (input[i] !== '.') break;
      i += 1;
    }
    const nameMatch = /^[A-Za-z_$][\w$]*/.exec(input.slice(i));
    if (!nameMatch) break;
    const name = nameMatch[0];
    i += name.length;
    if (input[i] !== '(') { segments.push({ name, args: '' }); continue; } // property access (no call)
    let depth = 0, inStr = false, quote = '';
    const start = i;
    for (; i < n; i += 1) {
      const c = input[i];
      if (inStr) {
        if (c === '\\') { i += 1; continue; }
        if (c === quote) inStr = false;
      } else if (c === '"' || c === "'" || c === '`') { inStr = true; quote = c; }
      else if (c === '(') depth += 1;
      else if (c === ')') { depth -= 1; if (depth === 0) { i += 1; break; } }
    }
    segments.push({ name, args: input.slice(start + 1, i - 1) });
  }
  return segments;
}

/** Drop whitespace OUTSIDE string literals, preserving the exact contents of each string. */
function stripStructuralWhitespace(input: string): string {
  let out = '', inStr = false, quote = '';
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < input.length) { out += input[i + 1]; i += 1; continue; }
      if (c === quote) inStr = false;
    } else if (c === '"' || c === "'" || c === '`') { inStr = true; quote = c; out += c; }
    else if (!/\s/.test(c)) out += c;
  }
  return out;
}

/**
 * Canonical identity of a Playwright locator expression. Semantically-identical locators written
 * differently — with or without a `page.`/`this.page.` root, wrapped in an arrow function/getter body,
 * or carrying an `await` prefix and an action suffix (`.fill(...)`, `.click()`, `.selectOption(...)`, …)
 * — collapse to the SAME string, while the locator CHAIN and the exact contents of string arguments are
 * preserved. Returns '' when the expression contains no locator chain. Generic; never app-specific.
 */
export function normalizeLocatorExpression(expression: string): string {
  let s = String(expression || '').trim();
  if (!s) return '';
  s = s.replace(/^(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+?)?=>\s*/, ''); // unwrap arrow header
  s = s.replace(/^\{\s*return\s+([\s\S]*?);?\s*\}$/, '$1').trim();      // unwrap `{ return EXPR; }`
  s = s.replace(/^(?:await\s+|return\s+)+/, '');
  s = s.replace(/^(?:this\.)?page\./, '');
  const kept: Array<{ name: string; args: string }> = [];
  for (const seg of splitLocatorChain(s)) {
    if (kept.length === 0) {
      if (!LOCATOR_CHAIN_METHODS.has(seg.name)) return ''; // not a locator root — nothing to verify
      kept.push(seg);
    } else if (LOCATOR_CHAIN_METHODS.has(seg.name)) {
      kept.push(seg);
    } else {
      break; // first non-locator method = the action/query tail; end of the locator chain
    }
  }
  if (!kept.length) return '';
  return stripStructuralWhitespace(kept.map((seg) => `${seg.name}(${seg.args})`).join('.'));
}

/** True when two locator expressions denote the SAME canonical locator identity. */
export function locatorsEquivalent(a: string, b: string): boolean {
  const ca = normalizeLocatorExpression(a);
  return ca !== '' && ca === normalizeLocatorExpression(b);
}

/**
 * Elements OBSERVED in a live a11y snapshot (role + accessible name) are verified evidence too. A feature
 * that ASSERTS a heading, or targets a control that only appears AFTER an action (e.g. "Back Home" on the
 * order-complete page), references elements captured in the RESULTING snapshot rather than in an interaction
 * step — so they are absent from interaction/discovery locator evidence and were being rejected as invented.
 * Surface each named snapshot node as getByRole('<role>', { name: '<name>' }) so the locator-evidence gate
 * accepts a grounded assertion/navigation locator. Parses only the snapshot text the agent actually
 * captured (nameless structural `generic` nodes are skipped) — generic, never app-specific.
 */
export function snapshotRoleNameLocators(trace: AgentStep[]): string[] {
  const out: string[] = [];
  const LINE = /^\s*-\s+([a-z][a-z-]*)\s+"((?:[^"\\]|\\.)*)"/;
  for (const step of trace) {
    const result = String(step.result || '');
    if (step.tool !== 'snapshot' && !/###\s*Snapshot|```yaml/.test(result)) continue;
    for (const raw of result.split('\n')) {
      const m = raw.match(LINE);
      if (!m) continue;
      const [, role, name] = m;
      if (role === 'generic' || !name) continue;
      out.push(`getByRole('${role}', { name: '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' })`);
    }
  }
  return out;
}

/**
 * Accessible (role, name) pairs that occur >=2x WITHIN A SINGLE captured a11y snapshot. A bare
 * getByRole(role, { name }) for one of these is a strict-mode trap: e.g. a repeated list/grid item's
 * IMAGE link and TITLE link expose ONE shared accessible name (SauceDemo `item-N-img-link` +
 * `item-N-title-link` both named "Sauce Labs Backpack"), so the locator resolves to 2 elements. Counting
 * is PER snapshot so a UNIQUE element captured across several snapshots is never mistaken for a duplicate.
 * Evidence-only, app-agnostic — parses just the snapshot text the agent actually captured.
 */
export function ambiguousSnapshotRoleNames(trace: AgentStep[]): Set<string> {
  const LINE = /^\s*-\s+([a-z][a-z-]*)\s+"((?:[^"\\]|\\.)*)"/;
  const ambiguous = new Set<string>();
  for (const step of trace) {
    const result = String(step.result || '');
    if (step.tool !== 'snapshot' && !/###\s*Snapshot|```yaml/.test(result)) continue;
    const counts = new Map<string, number>();
    for (const raw of result.split('\n')) {
      const m = raw.match(LINE);
      if (!m) continue;
      const [, role, name] = m;
      if (role === 'generic' || !name) continue;
      const key = `${role}\u0000${name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, n] of counts) if (n >= 2) ambiguous.add(key);
  }
  return ambiguous;
}

/** A live-snapshot node line: `- role "accessible name"` (nameless structural `generic` nodes excluded). */
const SNAPSHOT_ROLE_NAME_LINE = /^\s*-\s+([a-z][a-z-]*)\s+"((?:[^"\\]|\\.)*)"/;

/** Canonical identity of a role+name control so a Page locator can be matched to a snapshot node. */
function controlKey(role: string, name: string): string {
  return `${role.toLowerCase()}\u0000${name.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}

/** Host+path of a URL (query/hash and trailing slash dropped) so two snapshots of the SAME page compare equal. */
function pageIdentity(url: string): string {
  return String(url || '').split(/[?#]/)[0].replace(/\/+$/, '');
}

/**
 * Attribute every snapshot's observed role+name controls to the PAGE (URL) it was captured on, and report
 * the DESTINATION page = the page of the LAST snapshot in the trace (where a spec's terminal assertions run).
 * A snapshot step's own `url` is the page it snapshots; the last known url is carried forward for a snapshot
 * that does not restate it. Generic — driven only by per-page trace snapshots, never app/route specifics.
 */
export function controlsByPage(trace: AgentStep[]): {
  observedByPage: Map<string, Set<string>>;
  allObserved: Set<string>;
  destinationPage: string;
} {
  const observedByPage = new Map<string, Set<string>>();
  const allObserved = new Set<string>();
  let destinationPage = '';
  let carry = '';
  for (const step of trace) {
    const effectiveUrl = String(step.url || carry || '');
    const result = String(step.result || '');
    const isSnapshot = step.tool === 'snapshot' || /###\s*Snapshot|```yaml/.test(result);
    if (isSnapshot && effectiveUrl) {
      const key = pageIdentity(effectiveUrl);
      let set = observedByPage.get(key);
      if (!set) { set = new Set<string>(); observedByPage.set(key, set); }
      for (const raw of result.split('\n')) {
        const m = raw.match(SNAPSHOT_ROLE_NAME_LINE);
        if (!m) continue;
        const [, role, name] = m;
        if (role === 'generic' || !name) continue;
        const ck = controlKey(role, name);
        set.add(ck);
        allObserved.add(ck);
      }
      destinationPage = key;
    }
    if (step.url) carry = String(step.url);
  }
  return { observedByPage, allObserved, destinationPage };
}

/** Map each PUBLIC Page member to the role+name control its locator targets (the LAST named getByRole in it). */
function pageRoleNameMembers(pageContent: string): { className: string; members: Map<string, string> } {
  const members = new Map<string, string>();
  const source = ts.createSourceFile('page.ts', String(pageContent || ''), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cls = source.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && !!s.name);
  if (!cls) return { className: '', members };
  const ROLE_NAME = /getByRole\(\s*['"`]([\w-]+)['"`]\s*,\s*\{[^}]*?\bname\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g;
  for (const member of cls.members) {
    if (hasNonPublicModifier(member) || hasStaticModifier(member)) continue;
    const name = sourceMemberName(member.name);
    const src = pageMemberLocatorSource(member, source);
    if (!name || !src) continue;
    let last: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    ROLE_NAME.lastIndex = 0;
    while ((m = ROLE_NAME.exec(src))) last = m;
    if (!last) continue;
    const label = last[2] ?? last[3] ?? last[4] ?? '';
    if (!label) continue;
    members.set(name, controlKey(last[1], label));
  }
  return { className: cls.name?.text || '', members };
}

/** Positive presence/visibility matchers whose target MUST exist on the page the assertion runs on. */
const PRESENCE_MATCHERS = new Set(['toBeVisible', 'toBeInViewport', 'toBeEnabled', 'toBeChecked', 'toBeFocused']);

/**
 * PAGE-CONTEXT ASSERTION GATE. A generated spec's terminal assertions execute on the DESTINATION page — the
 * last page the verified trace observed. Reject a positive visibility/presence assertion that targets a
 * generated Page control the trace observed ONLY on a SOURCE page (before navigation) and NOT on the
 * destination page: the classic "assert Continue (checkout-step-one) after navigating to checkout-step-two"
 * defect that compiles green but times out at runtime because the code carried a source-page control past a
 * navigation. Controls proven on the destination page — and controls never observed anywhere (already covered
 * by the invented-locator evidence gate) — are left untouched. Generic: driven purely by per-page snapshot
 * evidence, no app/route specifics.
 */
export function assertAssertionsMatchDestinationPage(candidate: LlmArtifacts, trace: AgentStep[]): void {
  if (!trace || !trace.length) return;
  const { observedByPage, allObserved, destinationPage } = controlsByPage(trace);
  if (!destinationPage) return; // no snapshot evidence — other gates cover invented locators
  const destinationControls = observedByPage.get(destinationPage) || new Set<string>();
  if (!destinationControls.size) return; // destination page not snapshotted — don't risk a false positive

  const { className, members } = pageRoleNameMembers(candidate.page?.content || '');
  if (!className || !members.size) return;

  const specSource = ts.createSourceFile(
    candidate.spec?.file || 'spec.ts', String(candidate.spec?.content || ''), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  // Local instances of the generated Page (the undefined-fixture guard forces `new Page(page)` in the body).
  const instances = new Set<string>();
  const collectInstances = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isNewExpression(node.initializer) && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === className) {
      instances.add(node.name.text);
    }
    ts.forEachChild(node, collectInstances);
  };
  collectInstances(specSource);

  // Unwrap trailing locator refinements (.first()/.filter()/…) to the base `<instance>.<member>()` call.
  const resolveMember = (arg: ts.Expression): { instance: string; member: string } | null => {
    let node: ts.Expression = arg;
    while (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const owner = node.expression.expression;
      if (ts.isIdentifier(owner)) return { instance: owner.text, member: node.expression.name.text };
      if (ts.isNewExpression(owner) && ts.isIdentifier(owner.expression) && owner.expression.text === className) {
        return { instance: '', member: node.expression.name.text };
      }
      node = owner;
    }
    return null;
  };

  const violations: Array<{ member: string; control: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && PRESENCE_MATCHERS.has(node.expression.name.text)) {
      let negated = false;
      let expectArg: ts.Expression | undefined;
      let cur: ts.Node = node.expression.expression;
      // Walk the matcher chain back to the `expect(...)` call, noting any `.not.` (asserting ABSENCE is fine).
      while (cur) {
        if (ts.isCallExpression(cur) && ts.isIdentifier(cur.expression) && cur.expression.text === 'expect') { expectArg = cur.arguments[0]; break; }
        if (ts.isPropertyAccessExpression(cur)) { if (cur.name.text === 'not') negated = true; cur = cur.expression; continue; }
        if (ts.isCallExpression(cur)) { cur = cur.expression; continue; }
        break;
      }
      if (expectArg && !negated) {
        const ref = resolveMember(expectArg);
        if (ref && (ref.instance === '' || instances.has(ref.instance)) && members.has(ref.member)) {
          const ck = members.get(ref.member)!;
          if (!destinationControls.has(ck) && allObserved.has(ck)) violations.push({ member: ref.member, control: ck });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(specSource);

  if (violations.length) {
    const sourcePagesOf = (ck: string): string =>
      [...observedByPage.entries()].filter(([, set]) => set.has(ck)).map(([url]) => url).join(', ') || 'a prior page';
    const destSample = [...destinationControls].slice(0, 8).map((k) => k.split('\u0000')[1]).filter(Boolean);
    const lines = [...new Map(violations.map((v) => [v.member, v])).values()].map((v) => {
      const [role, name] = v.control.split('\u0000');
      return `  - ${className}.${v.member}() targets ${role} "${name}", which the trace observed only on ${sourcePagesOf(v.control)} — NOT on the destination page ${destinationPage}.`;
    });
    throw new Error(
      'Codegen: post-navigation assertion(s) reference a control from a PREVIOUS page, not the destination page the '
      + 'test lands on (this compiles but times out at runtime, e.g. asserting "Continue" from checkout-step-one after '
      + `navigating to checkout-step-two):\n${lines.join('\n')}\n`
      + `Controls the trace actually observed on the destination page (${destinationPage}): ${destSample.join(', ') || '(none captured)'}.\n`
      + 'Assert a control the trace observed ON THE DESTINATION PAGE, or assert the destination page state itself '
      + '(expect(page).toHaveURL(urlRegex(routes.X))). Do NOT reuse a source-page control after navigation. Re-emit the '
      + 'COMPLETE corrected spec.',
    );
  }
}

/**
 * Reject a generated Module or Spec that calls a Page Object member which the imported Page Object
 * does not declare. The gate uses the TypeScript parser rather than text matching so aliases,
 * `this.pageObject`, direct local Page instances, method-style getters, and property-style locators
 * are resolved consistently.
 *
 * A newly generated Page locator that is used by a Module/Spec must also match a locator captured in
 * the verified Automation Trace or live discovery inventory. Existing framework Page members are
 * reusable baseline capabilities; only a newly emitted Page declaration needs fresh evidence here.
 */
export function assertPageObjectContracts(
  fw: string,
  artifacts: PageObjectArtifacts,
  trace: AgentStep[],
  discoveryEvidence?: DiscoveryEvidence,
): void {
  const generatedFiles = [
    { file: normaliseSourcePath(artifacts.page.file), content: artifacts.page.content, kind: 'page' },
    { file: normaliseSourcePath(artifacts.module.file), content: artifacts.module.content, kind: 'module' },
    { file: normaliseSourcePath(artifacts.spec.file), content: artifacts.spec.content, kind: 'spec' },
  ];
  const generatedByFile = new Map(generatedFiles.map((entry) => [entry.file, entry]));
  const contracts = new Map<string, PageObjectContract | null>();
  const moduleContracts = new Map<string, ModuleContract | null>();

  const sourceFor = (file: string): string => generatedByFile.get(file)?.content || safeRead(join(fw, file));
  const importPath = (from: string, specifier: string): string | undefined => {
    if (!specifier.startsWith('.')) return undefined;
    return normaliseSourcePath(join(dirname(from), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`));
  };
  const loadPageObject = (file: string, className: string): PageObjectContract | undefined => {
    const key = `${file}::${className}`;
    if (contracts.has(key)) return contracts.get(key) || undefined;
    const content = sourceFor(file);
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = source.statements.find((statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
    );
    if (!declaration) {
      contracts.set(key, null);
      return undefined;
    }
    const members = new Map<string, PageObjectMember>();
    for (const member of declaration.members) {
      if (hasNonPublicModifier(member)) continue;
      const name = sourceMemberName(member.name);
      const locatorSource = pageMemberLocatorSource(member, source);
      if (name && locatorSource !== undefined) members.set(name, { locatorSource });
    }
    const contract: PageObjectContract = {
      className,
      file,
      generated: generatedByFile.get(file)?.kind === 'page',
      members,
    };
    contracts.set(key, contract);
    return contract;
  };

  const pageImports = (file: string, content: string): Map<string, PageObjectContract> => {
    const imports = new Map<string, PageObjectContract>();
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (!statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
      const importedFile = importPath(file, statement.moduleSpecifier.text);
      if (!importedFile || !importedFile.startsWith('src/pages/')) continue;
      for (const element of statement.importClause.namedBindings.elements) {
        const importedName = element.propertyName?.text || element.name.text;
        const page = loadPageObject(importedFile, importedName);
        if (page) imports.set(element.name.text, page);
      }
    }
    return imports;
  };

  const loadModule = (file: string, className: string): ModuleContract | undefined => {
    const key = `${file}::${className}`;
    if (moduleContracts.has(key)) return moduleContracts.get(key) || undefined;
    const source = ts.createSourceFile(file, sourceFor(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const declaration = source.statements.find((statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
    );
    if (!declaration) {
      moduleContracts.set(key, null);
      return undefined;
    }
    const methods = new Map<string, ModuleMethod>();
    for (const member of declaration.members) {
      if (!ts.isMethodDeclaration(member) || hasNonPublicModifier(member) || hasStaticModifier(member)) continue;
      const name = sourceMemberName(member.name);
      if (!name) continue;
      const required = member.parameters.filter((parameter) =>
        !parameter.dotDotDotToken && !parameter.questionToken && !parameter.initializer,
      ).length;
      const hasRest = member.parameters.some((parameter) => !!parameter.dotDotDotToken);
      methods.set(name, { minimumArguments: required, maximumArguments: hasRest ? Number.POSITIVE_INFINITY : member.parameters.length });
    }
    const contract = { className, file, methods };
    moduleContracts.set(key, contract);
    return contract;
  };

  const moduleImports = (file: string, content: string): Map<string, ModuleContract> => {
    const imports = new Map<string, ModuleContract>();
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (!statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
      const importedFile = importPath(file, statement.moduleSpecifier.text);
      if (!importedFile || !importedFile.startsWith('src/modules/')) continue;
      for (const element of statement.importClause.namedBindings.elements) {
        const importedName = element.propertyName?.text || element.name.text;
        const module = loadModule(importedFile, importedName);
        if (module) imports.set(element.name.text, module);
      }
    }
    return imports;
  };

  const references: PageObjectReference[] = [];
  for (const generated of generatedFiles.filter((entry) => entry.kind === 'module' || entry.kind === 'spec')) {
    const source = ts.createSourceFile(generated.file, generated.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const importedPages = pageImports(generated.file, generated.content);
    const instances = new Map<string, PageObjectContract>();
    const pageFromNew = (node: ts.Expression | undefined): PageObjectContract | undefined =>
      node && ts.isNewExpression(node) && ts.isIdentifier(node.expression)
        ? importedPages.get(node.expression.text)
        : undefined;
    const pageFromType = (type: ts.TypeNode | undefined): PageObjectContract | undefined => {
      const name = typeReferenceName(type);
      return name ? importedPages.get(name) : undefined;
    };
    const thisProperty = (node: ts.Expression): string | undefined =>
      ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword
        ? `this.${node.name.text}`
        : undefined;

    const collectInstances = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const page = pageFromNew(node.initializer) || pageFromType(node.type);
        if (page) instances.set(node.name.text, page);
      }
      if (ts.isPropertyDeclaration(node)) {
        const name = sourceMemberName(node.name);
        const page = pageFromNew(node.initializer) || pageFromType(node.type);
        if (name && page) instances.set(`this.${name}`, page);
      }
      if (ts.isParameter(node) && ts.getModifiers(node)?.length) {
        const name = ts.isIdentifier(node.name) ? node.name.text : undefined;
        const page = pageFromType(node.type);
        if (name && page) instances.set(`this.${name}`, page);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const name = thisProperty(node.left);
        const page = pageFromNew(node.right);
        if (name && page) instances.set(name, page);
      }
      ts.forEachChild(node, collectInstances);
    };
    collectInstances(source);

    const collectReferences = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const owner = ts.isIdentifier(node.expression)
          ? instances.get(node.expression.text)
          : instances.get(thisProperty(node.expression) || '') || pageFromNew(node.expression);
        if (owner) references.push({ file: generated.file, instance: node.expression.getText(source), member: node.name.text, page: owner });
      }
      ts.forEachChild(node, collectReferences);
    };
    collectReferences(source);
  }

  const missing = new Map<string, PageObjectReference>();
  for (const reference of references) {
    if (reference.page.members.has(reference.member)) continue;
    missing.set(`${reference.file}::${reference.instance}.${reference.member}`, reference);
  }
  if (missing.size) {
    const lines = [...missing.values()].map((reference) => {
      const existing = [...reference.page.members.keys()].sort().join(', ') || '(none)';
      return `  - ${reference.file}: ${reference.instance}.${reference.member} references ${reference.page.className}.${reference.member}, but it is not declared in ${reference.page.file}.\n`
        + `    Existing ${reference.page.className} properties: ${existing}.`;
    });
    throw new Error(
      'Codegen: undefined Page Object property reference(s):\n'
      + `${lines.join('\n')}\n`
      + 'Repair each reference by either adding the exact missing property to its Page Object ONLY with a locator copied from '
      + 'verified Automation Trace/discovery evidence, or changing the Module/Spec to an existing verified Page Object property. '
      + 'Do NOT invent a locator. Re-emit the COMPLETE corrected artifact.',
    );
  }

  const evidence = new Set<string>();
  for (const step of trace) {
    for (const locator of [step.locator, step.scopeHint?.locator, step.interaction?.locatorEvidence]) {
      const normalised = normalizeLocatorExpression(locator || '');
      if (normalised) evidence.add(normalised);
    }
  }
  for (const item of discoveryEvidence?.inventory || []) {
    const normalised = normalizeLocatorExpression(item.locatorEvidence?.locator || '');
    if (normalised) evidence.add(normalised);
  }
  for (const transition of discoveryEvidence?.transitions || []) {
    const normalised = normalizeLocatorExpression(transition.triggerLocator || '');
    if (normalised) evidence.add(normalised);
  }
  // Assertion targets + post-action controls (headings, "Back Home", etc.) live in the RESULTING a11y
  // snapshot, not in an interaction step — surface them as verified getByRole evidence so a grounded
  // assertion/navigation locator is accepted instead of rejected as invented.
  for (const locator of snapshotRoleNameLocators(trace)) {
    const normalised = normalizeLocatorExpression(locator);
    if (normalised) evidence.add(normalised);
  }

  const unverified = new Map<string, PageObjectReference>();
  for (const reference of references) {
    if (!reference.page.generated) continue;
    const declaration = reference.page.members.get(reference.member)!;
    const canonical = normalizeLocatorExpression(declaration.locatorSource);
    if (!canonical) continue; // not a locator expression — covered by other gates, never held to locator evidence
    if (!evidence.has(canonical)) unverified.set(`${reference.page.file}::${reference.member}`, reference);
  }
  if (unverified.size) {
    const knownEvidence = [...evidence].join(', ') || '(no verified live locator evidence was supplied)';
    const lines = [...unverified.values()].map((reference) => {
      const declaration = reference.page.members.get(reference.member)!;
      return `  - ${reference.page.file}: ${reference.page.className}.${reference.member} is used by ${reference.file}, but its locator declaration \`${declaration.locatorSource}\` is not present in verified live evidence.`;
    });
    throw new Error(
      'Codegen: generated Page Object locator(s) lack verified live evidence:\n'
      + `${lines.join('\n')}\n`
      + `  Verified locator evidence: ${knownEvidence}\n`
      + 'Do NOT invent a locator. Change the Module/Spec to an existing verified Page Object property, or declare the '
      + 'missing property with an EXACT locator copied from the verified Automation Trace or discovery evidence.',
    );
  }

  const moduleCalls: ModuleCall[] = [];
  for (const generated of generatedFiles.filter((entry) => entry.kind === 'module' || entry.kind === 'spec')) {
    const source = ts.createSourceFile(generated.file, generated.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const importedModules = moduleImports(generated.file, generated.content);
    const instances = new Map<string, ModuleContract>();
    const moduleFromNew = (node: ts.Expression | undefined): ModuleContract | undefined =>
      node && ts.isNewExpression(node) && ts.isIdentifier(node.expression)
        ? importedModules.get(node.expression.text)
        : undefined;
    const moduleFromType = (type: ts.TypeNode | undefined): ModuleContract | undefined => {
      const name = typeReferenceName(type);
      return name ? importedModules.get(name) : undefined;
    };
    const thisProperty = (node: ts.Expression): string | undefined =>
      ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword
        ? `this.${node.name.text}`
        : undefined;
    const collectInstances = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const module = moduleFromNew(node.initializer) || moduleFromType(node.type);
        if (module) instances.set(node.name.text, module);
      }
      if (ts.isPropertyDeclaration(node)) {
        const name = sourceMemberName(node.name);
        const module = moduleFromNew(node.initializer) || moduleFromType(node.type);
        if (name && module) instances.set(`this.${name}`, module);
      }
      if (ts.isParameter(node) && ts.canHaveModifiers(node) && ts.getModifiers(node)?.length) {
        const name = ts.isIdentifier(node.name) ? node.name.text : undefined;
        const module = moduleFromType(node.type);
        if (name && module) instances.set(`this.${name}`, module);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const name = thisProperty(node.left);
        const module = moduleFromNew(node.right);
        if (name && module) instances.set(name, module);
      }
      ts.forEachChild(node, collectInstances);
    };
    collectInstances(source);

    const collectCalls = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const receiver = node.expression.expression;
        const owner = ts.isIdentifier(receiver)
          ? instances.get(receiver.text)
          : instances.get(thisProperty(receiver) || '') || moduleFromNew(receiver);
        if (owner) {
          moduleCalls.push({
            file: generated.file,
            instance: receiver.getText(source),
            method: node.expression.name.text,
            arguments: node.arguments.length,
            module: owner,
          });
        }
      }
      ts.forEachChild(node, collectCalls);
    };
    collectCalls(source);
  }

  const missingModuleMethods = new Map<string, ModuleCall>();
  for (const call of moduleCalls) {
    if (call.module.methods.has(call.method)) continue;
    missingModuleMethods.set(`${call.file}::${call.instance}.${call.method}`, call);
  }
  if (missingModuleMethods.size) {
    const lines = [...missingModuleMethods.values()].map((call) =>
      `  - ${call.file}: ${call.instance}.${call.method}(...) references ${call.module.className}.${call.method}, but it is not declared in ${call.module.file}.\n`
      + `    Existing ${call.module.className} methods: ${[...call.module.methods.keys()].sort().join(', ') || '(none)'}.`,
    );
    throw new Error(
      'Codegen: undefined Module method reference(s):\n'
      + `${lines.join('\n')}\n`
      + 'Use an existing Module method, or add the missing method as a Module workflow built only from existing verified Page Object properties. '
      + 'Do NOT invent a Page locator. Re-emit the COMPLETE corrected artifact.',
    );
  }

  const wrongArity = moduleCalls.filter((call) => {
    const method = call.module.methods.get(call.method);
    return method && (call.arguments < method.minimumArguments || call.arguments > method.maximumArguments);
  });
  if (wrongArity.length) {
    const lines = wrongArity.map((call) => {
      const method = call.module.methods.get(call.method)!;
      const expected = method.minimumArguments === method.maximumArguments
        ? String(method.minimumArguments)
        : method.maximumArguments === Number.POSITIVE_INFINITY
          ? `${method.minimumArguments}+`
          : `${method.minimumArguments}-${method.maximumArguments}`;
      return `  - ${call.file}: ${call.instance}.${call.method}(...) passes ${call.arguments} argument(s), but ${call.module.className}.${call.method} accepts ${expected}.`;
    });
    throw new Error(
      'Codegen: Module method argument contract violation(s):\n'
      + `${lines.join('\n')}\n`
      + 'Call the existing Module method with its declared arguments. Do NOT change a Module signature unless the verified feature workflow requires it. Re-emit the COMPLETE corrected artifact.',
    );
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldIdentifier(label: string): string {
  const words = label.match(/[a-zA-Z0-9]+/g) || [];
  return words.map((word, index) => index === 0 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`).join('');
}

/** App-created defaults are evidence, not test input; reject any generated interaction with them. */
export function assertPrepopulatedFieldsUntouched(art: LlmArtifacts, trace: AgentStep[]): void {
  const generated = [
    art.page.content,
    art.module.content,
    art.spec.content,
    JSON.stringify(art.testData || {}),
    JSON.stringify(art.uniqueFields || []),
  ].join('\n');
  const entries = prepopulatedFieldEntries(trace);
  // A prepopulated TEXT field's identity IS its label, so protect it by name (no locator, testData,
  // fill or value assertion). Dropdowns/radios are protected by their selected VALUE below — NEVER
  // by their label: an unnamed widget's label may have been anchored to an adjacent page/section
  // title (e.g. "Products"), and the scenario must stay free to use that heading/label as a
  // READ-ONLY readiness/visibility assertion. Only a text field's label gates codegen here.
  for (const { label, kind } of entries) {
    if (kind && kind !== 'text') continue;
    if (!label || /^Field\s+/i.test(label)) continue;
    const identifier = fieldIdentifier(label);
    const labelMatch = new RegExp(escapeRegex(label), 'i');
    const identifierMatch = identifier ? new RegExp(`\\b${escapeRegex(identifier)}\\b`, 'i') : null;
    if (labelMatch.test(generated) || identifierMatch?.test(generated)) {
      throw new Error(`Codegen: app-prepopulated field '${label}' must be left untouched; remove its locator, test data, fill, assertion, and uniqueFields entry.`);
    }
  }
  // Dropdowns/radios are overwritten by VALUE (select/check), not by clearing a textbox — so also
  // reject any generated select/check that re-applies the real value the detector already found
  // chosen. This mirrors the Employee Id (text) protection for non-text prepopulated widgets.
  for (const { label, value, kind } of entries) {
    if ((kind !== 'dropdown' && kind !== 'radio') || !value) continue;
    const selectOver = new RegExp(
      `(selectOption|selectDropdownOption|searchAndSelectOption|chooseOption|selectByLabel|getByRole\\(\\s*['"]option['"]|\\.check\\s*\\()[\\s\\S]{0,120}${escapeRegex(value)}`,
      'i',
    );
    if (selectOver.test(generated)) {
      throw new Error(`Codegen: app-prepopulated ${kind} '${label}' is already set to '${value}'; do not select/check over it in the generated spec.`);
    }
  }
}

const UNIQUE_KEY = /(?:id|identifier|username|email|code|reference|number)$/i;

// A real uniqueness constraint is one the LIVE app proved — a duplicate/"already exists" validation
// surfaced during the explore walk. A field NAME alone is NOT evidence: "postalCode", "phoneNumber",
// and "areaCode" all match the name pattern yet are ordinary reusable values the app accepts as-is.
const UNIQUENESS_EVIDENCE_RE = /\b(already exists|already taken|already in use|already registered|duplicate|must be unique)\b/i;

/** True only when the VERIFIED trace surfaced a real duplicate/uniqueness validation from the live app. */
export function traceExposedUniquenessConstraint(trace: AgentStep[]): boolean {
  return (trace || []).some((step) =>
    UNIQUENESS_EVIDENCE_RE.test(String(step.result || '')) ||
    UNIQUENESS_EVIDENCE_RE.test(String(step.context || '')));
}

function collectLikelyUniqueDataPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      paths.push(...collectLikelyUniqueDataPaths(child, path));
    } else if (UNIQUE_KEY.test(key)) {
      paths.push(path);
    }
  }
  return paths;
}

export function assertUniqueFieldsHandled(art: LlmArtifacts, uniquenessObserved: boolean): void {
  const fields = art.uniqueFields || [];
  // FORCE a uniqueFields descriptor for a name-matching value ONLY when the live app actually proved
  // uniqueness (a duplicate/"already exists" validation observed during explore). Without that
  // evidence a "…code"/"…number"/"…id" value (postalCode, phoneNumber) is ordinary reusable testData
  // and must NEVER be pushed into uniqueValue()/retryOnCollision handling from its name alone.
  if (uniquenessObserved) {
    const likelyUniquePaths = collectLikelyUniqueDataPaths(art.testData);
    const plannedPaths = new Set(fields.map((field) => field.testDataPath.replace(/^testData\./, '')));
    const missingPlans = likelyUniquePaths.filter((path) => !plannedPaths.has(path));
    if (missingPlans.length) {
      throw new Error(`Codegen: static value(s) for unique field(s) ${missingPlans.join(', ')} require a uniqueFields descriptor and retryOnCollision handling.`);
    }
  }
  for (const field of fields) {
    if (!field.testDataPath) {
      throw new Error('Codegen: each uniqueFields descriptor requires a testDataPath.');
    }
    if (!art.module.content.includes('uniqueValue(')) {
      throw new Error(`Codegen: unique field '${field.testDataPath}' must generate a fresh value via uniqueValue() in its Module.`);
    }
    if (!art.module.content.includes("from '../utils/UniqueData'")) {
      throw new Error(`Codegen: unique field '${field.testDataPath}' must import its helpers from ../utils/UniqueData.`);
    }
    // retryOnCollision + a live collision locator are required ONLY when the trace exposed a collision validation.
    if (field.collisionPageField) {
      if (!art.module.content.includes('retryOnCollision(')) {
        throw new Error(`Codegen: unique field '${field.testDataPath}' has a collision locator and must retry via retryOnCollision() in its Module.`);
      }
      if (!new RegExp(`\\b${field.collisionPageField}\\b`).test(art.page.content)) {
        throw new Error(`Codegen: unique field '${field.testDataPath}' is missing Page collision locator '${field.collisionPageField}'.`);
      }
    }
  }
}

/**
 * Reject a spec that destructures a Playwright fixture the framework never registered.
 *
 * Codegen writes Page/Module/Spec/testData but deliberately does NOT edit src/fixtures/index.ts, so
 * a brand-new feature's Page/Module are NOT available as `async ({ recruitmentAddCandidatePage })`
 * fixtures — Playwright fails fast with `Test has unknown parameter "..."`. The reuse exemplar
 * (login/dashboard) legitimately destructures its OWN registered fixtures, which tempts the model to
 * mimic the pattern for the new feature. This gate turns that runtime crash into a repairable
 * message: instantiate the new Page/Module directly from `page` in the test body instead. Generic —
 * it reads the ACTUAL registered fixture names from this framework, so it holds for any repo.
 */
function assertNoUndefinedFixtures(fw: string, art: LlmArtifacts): void {
  // Playwright's built-in test-scoped args are always injectable without registration.
  const builtins = new Set(['page', 'context', 'request', 'browser', 'browserName', 'playwright', 'contextOptions', 'baseURL']);
  const registered = new Set<string>(builtins);
  // Harvest every fixture the framework actually registers (keys of base.extend({ name: async (…) })).
  const fixturesSrc = safeRead(join(fw, 'src/fixtures/index.ts'));
  for (const m of fixturesSrc.matchAll(/^\s*(\w+)\s*:\s*async\s*\(/gm)) registered.add(m[1]);
  // Collect every name the spec destructures from a test/hook callback: async ({ … }) => …
  const used = new Set<string>();
  for (const block of art.spec.content.matchAll(/async\s*\(\s*\{([^}]*)\}/g)) {
    for (const part of block[1].split(',')) {
      const name = part.split(':')[0].replace(/[^A-Za-z0-9_]/g, '');
      if (name) used.add(name);
    }
  }
  const unknown = [...used].filter((name) => !registered.has(name));
  if (unknown.length) {
    const example = unknown[0];
    const className = `${example[0].toUpperCase()}${example.slice(1)}`;
    const known = [...registered].filter((f) => !builtins.has(f)).join(', ') || '(none beyond built-ins)';
    throw new Error(
      `Codegen: the spec destructures undefined fixture(s) ${unknown.join(', ')}. This framework only registers ` +
      `${known} as fixtures and codegen must NOT edit src/fixtures/index.ts, so a new feature's Page/Module cannot be ` +
      `injected as a fixture. Instantiate each new Page/Module directly in the test body instead ` +
      `(e.g. const ${example} = new ${className}(page)) and destructure only { page } plus the registered fixtures above.`,
    );
  }
}

/** Normalise a field label so tolerant "does the code reference this field?" matching works. */
function coverageKey(label: string): string {
  return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Every identity a generated artifact may legitimately use to reference a trace field's control:
 * its human label/accessible name AND the verified locator identifiers (a data-test/testid id, a
 * getByTestId/getByLabel/getByPlaceholder/role-name argument). This lets the coverage gate accept a
 * field implemented via its PROVEN locator even when that id differs from the human label — e.g.
 * "Zip/Postal Code" filled through [data-test="postalCode"] (label ≠ test id). Evidence-only: every
 * token comes from the verified trace, never inference.
 */
function traceFieldIdentityTokens(step: AgentStep): string[] {
  const tokens: string[] = [];
  const push = (v?: string): void => { if (v) tokens.push(v); };
  push(step.interaction?.accessibleName);
  push(step.interaction?.controlId);
  push(step.scopeHint?.label);
  const loc = `${step.locator || ''} ${step.interaction?.locatorEvidence || ''} ${step.scopeHint?.locator || ''}`;
  for (const m of loc.matchAll(/data-(?:test|testid|qa)\s*=\s*["']([^"']+)["']/g)) push(m[1]);
  for (const m of loc.matchAll(/getByTestId\(\s*['"]([^'"]+)['"]/g)) push(m[1]);
  for (const m of loc.matchAll(/getByLabel\(\s*['"]([^'"]+)['"]/g)) push(m[1]);
  for (const m of loc.matchAll(/getByPlaceholder\(\s*['"]([^'"]+)['"]/g)) push(m[1]);
  for (const m of loc.matchAll(/name:\s*['"]([^'"]+)['"]/g)) push(m[1]);
  return tokens;
}

/**
 * Automation-Trace coverage gate. `coverageFields` lists the EXECUTABLE Automation Trace steps the
 * approved scenario exercises — feature controls only, never the discovery inventory and never blocked
 * (e.g. upload) steps. This gate rejects a reply that silently drops any executable trace step: the
 * generated Page+Module+Spec together must reference each one — by its label OR by any VERIFIED
 * locator identity for it (a data-test id / getByTestId / getByLabel argument from the trace),
 * appearing in a locator, a method name, a testData key, or plain text. Coverage is measured against
 * trace steps, NOT discovered controls, so unrelated navigation can never fail codegen. No selection =
 * legacy behaviour (gate is a no-op).
 */
export function assertTraceCoverage(art: LlmArtifacts, coverageFields?: string[], trace?: AgentStep[]): void {
  if (!coverageFields || !coverageFields.length) return;
  const haystack = coverageKey([art.page.content, art.module.content, art.spec.content, JSON.stringify(art.testData || {})].join('\n'));
  // Map each coverage label to the alternative identity tokens the verified trace proves for it, so a
  // field implemented via its data-test id (differing from the label) still counts as covered.
  const identityByLabel = new Map<string, Set<string>>();
  for (const step of trace || []) {
    const label = traceStepFieldLabel(step);
    if (!label) continue;
    const key = coverageKey(label);
    let set = identityByLabel.get(key);
    if (!set) { set = new Set<string>(); identityByLabel.set(key, set); }
    for (const token of traceFieldIdentityTokens(step)) {
      const tokenKey = coverageKey(token);
      if (tokenKey.length >= 2) set.add(tokenKey);
    }
  }
  const missing = coverageFields.filter((label) => {
    const key = coverageKey(label);
    if (key.length < 2) return false;
    if (haystack.includes(key)) return false;
    for (const alt of identityByLabel.get(key) || []) {
      if (haystack.includes(alt)) return false;
    }
    return true;
  });
  if (missing.length) {
    throw new Error(
      `Codegen: the generated code does not implement ${missing.length} Automation Trace step(s): ${missing.join(', ')}. ` +
      'Every executable Automation Trace step MUST be filled/selected/checked in the Module workflow and asserted or ' +
      'referenced in the Spec — do not collapse the flow to only the first few steps. Add the missing step(s) ' +
      'using the exact locator evidence from the trace, then re-emit the complete artifact.',
    );
  }
}

const UNIQUE_DATA_UTILITY_SOURCE = [
  "import { type Locator, type Page } from '@playwright/test';",
  "import { TIMEOUTS } from './constants';",
  '',
  "export type UniqueValueKind = 'numeric' | 'alphanumeric' | 'email';",
  '',
  'export interface UniqueValueOptions {',
  '  kind?: UniqueValueKind;',
  '  length?: number;',
  '}',
  '',
  'export interface CollisionRetryOptions {',
  '  page: Page;',
  '  successUrl: string | RegExp;',
  '  collision: Locator;',
  '  makeValue: () => string;',
  '  submit: (value: string) => Promise<void>;',
  '  attempts?: number;',
  '  timeout?: number;',
  '  collisionMessage?: string;',
  '}',
  '',
  'const DEFAULT_COLLISION_ATTEMPTS = 3;',
  'const MIN_COLLISION_ATTEMPTS = 1;',
  'const DEFAULT_NUMERIC_LENGTH = 7;',
  'const DEFAULT_TOKEN_LENGTH = 8;',
  'let sequence = 0;',
  '',
  'export function uniqueValue(seed: string, options: UniqueValueOptions = {}): string {',
  '  sequence += 1;',
  "  const kind = options.kind ?? 'alphanumeric';",
  '  const token = `${Date.now()}${sequence}`;',
  '  const length = Math.max(MIN_COLLISION_ATTEMPTS, options.length ?? DEFAULT_TOKEN_LENGTH);',
  "  if (kind === 'numeric') return token.replace(/\\D/g, '').slice(-(options.length ?? DEFAULT_NUMERIC_LENGTH));",
  "  if (kind === 'email') {",
  "    const [localPart = 'auto', domain = 'example.test'] = seed.trim().split('@');",
  "    return `${localPart || 'auto'}+${token.slice(-length)}@${domain || 'example.test'}`;",
  '  }',
  "  const prefix = seed.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'auto';",
  '  return `${prefix}-${token.slice(-length)}`;',
  '}',
  '',
  'export async function retryOnCollision(options: CollisionRetryOptions): Promise<string> {',
  '  const attempts = Math.max(MIN_COLLISION_ATTEMPTS, options.attempts ?? DEFAULT_COLLISION_ATTEMPTS);',
  '  const timeout = options.timeout ?? TIMEOUTS.LONG;',
  '  for (let attempt = 0; attempt < attempts; attempt += 1) {',
  '    const value = options.makeValue();',
  '    await options.submit(value);',
  '    const outcome = await Promise.race([',
  "      options.page.waitForURL(options.successUrl, { timeout }).then(() => 'success' as const),",
  "      options.collision.waitFor({ state: 'visible', timeout }).then(() => 'collision' as const),",
  '    ]);',
  "    if (outcome === 'success') return value;",
  '  }',
  "  const detail = options.collisionMessage ? `: ${options.collisionMessage}` : '';",
  '  throw new Error(`Unique-value collision persisted after ${attempts} attempts${detail}`);',
  '}',
  '',
].join('\n');

/** Ensure every generated framework can import the unique-value contract without manual setup. */
function ensureUniqueDataUtility(fw: string, fields?: UniqueField[]): string | null {
  if (!fields?.length) return null;
  const rel = 'src/utils/UniqueData.ts';
  const file = join(fw, rel);
  if (existsSync(file)) return null;
  writeFileSync(file, UNIQUE_DATA_UTILITY_SOURCE);
  return rel;
}

/** Run the repo's capability indexer so `.ai-memory` is regenerated (write-back). Best-effort. */
function refreshIndex(fw: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'index'], { cwd: fw, shell: true });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 90000);
    child.on('close', () => { clearTimeout(timer); resolve(); });
    child.on('error', () => { clearTimeout(timer); resolve(); });
  });
}

/** Keep a generated path inside the repo's src/ tree (prevents path traversal from the LLM). */
function safePath(fw: string, rel: string, fallback: string): string {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const target = clean.startsWith('src/') && !clean.includes('..') ? clean : fallback;
  return join(fw, target);
}

/** The set of NAMES a TypeScript module exports (best-effort). Returns null when the module uses a
 * wildcard re-export (`export * from`) or `export =`, so the caller SKIPS the strict check instead of
 * risking a false rejection. Generic — no framework/app specifics. */
function moduleExportedNames(src: string): Set<string> | null {
  if (/export\s+\*\s+from/.test(src) || /export\s*=/.test(src)) return null;
  const names = new Set<string>();
  if (/export\s+default\b/.test(src)) names.add('default');
  const decl = /export\s+(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(src)) !== null) names.add(m[1]);
  const block = /export\s*\{([^}]*)\}/g;
  while ((m = block.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const alias = part.trim().split(/\s+as\s+/i).pop()?.trim();
      if (alias) names.add(alias);
    }
  }
  return names;
}

/** Resolve a RELATIVE import specifier to an existing TS file on disk (.ts / .tsx / /index.ts), else null. */
function resolveTsImport(fromDir: string, spec: string): string | null {
  const base = normalize(join(fromDir, spec));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Every NAMED import from a RESOLVABLE module must be a REAL export of that module. Catches the class of
 * runtime crash where the model imports a symbol the target does not export (e.g. `import { testData } from
 * '../config'` when config exports no `testData`) → the binding is `undefined` → "Cannot read properties of
 * undefined". In-memory + repairable. Non-relative (node_modules) imports and sibling files still being
 * generated (not yet on disk) are skipped so a real dependency is never falsely rejected. Generic.
 */
export function assertImportsResolve(fw: string, files: Array<{ dir: string; file: string; content: string }>): void {
  const violations: string[] = [];
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  for (const f of files) {
    let m: RegExpExecArray | null;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(f.content)) !== null) {
      const spec = m[2];
      if (!spec.startsWith('.')) continue;
      const target = resolveTsImport(join(fw, f.dir), spec);
      if (!target || target.endsWith('.json')) continue;
      const exported = moduleExportedNames(safeRead(target));
      if (!exported) continue;
      for (const raw of m[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/i)[0].trim();
        if (!name || name === 'type') continue;
        if (!exported.has(name)) violations.push(`'${name}' is imported from '${spec}' in ${f.file} but that module does not export it`);
      }
    }
  }
  if (violations.length) {
    throw new Error(
      `Codegen: unresolved import(s): ${violations.join('; ')}. Import each symbol from the module that ` +
      `actually exports it, or define/inline the value — never import a symbol the target does not export.`,
    );
  }
}

/**
 * The FIRST brace-balanced `{…}` object in `text`, honoring string literals + escapes so a `}` (or `{`)
 * inside a generated code string never ends the object early. JSON strings are double-quoted; a single
 * quote only opens a string at top level (never inside a double-quoted value). Returns null when nothing
 * is balanced. Pure, never throws.
 */
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === '\'') { inStr = true; quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/**
 * Isolate ONE JSON object from a model reply that may be wrapped in ```json fences or surrounded by prose.
 * Robust by construction: prefer a fenced block's body, else scan the whole (fence-stripped) reply for the
 * first brace-balanced object. A stray markdown fence or explanatory sentence can never abort the run.
 * Returns null when no plausible object is present. Exported for tests. Pure, never throws.
 */
export function extractJsonObject(raw: string): string | null {
  if (!raw) return null;
  const candidates: string[] = [];
  // 1) Prefer any fenced ```json / ``` block whose body contains an object.
  const fenceRe = /```(?:json|jsonc|json5|js|ts|typescript)?\s*([\s\S]*?)```/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(raw)) !== null) { if (fm[1] && fm[1].includes('{')) candidates.push(fm[1]); }
  // 2) Fall back to the whole reply with fence markers stripped so a brace scan can still find the object.
  candidates.push(raw.replace(/```(?:json|jsonc|json5|js|ts|typescript)?/gi, ' ').replace(/```/g, ' '));
  for (const text of candidates) {
    const obj = firstBalancedObject(text);
    if (obj) return obj;
  }
  return null;
}

/**
 * Parse the model's STRICT-JSON reply into artifacts. Tolerant of markdown fences + surrounding prose via
 * extractJsonObject(); still throws a FORMAT-class error (which the repair loop retries with bounded
 * attempts) when nothing parseable is present or a required section is missing. Exported for tests.
 */
export function parseArtifacts(raw: string): LlmArtifacts {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) throw new Error('Codegen: model did not return JSON.');
  let candidate: LlmArtifacts;
  try { candidate = JSON.parse(jsonText); } catch (e) { throw new Error(`Codegen: invalid JSON (${(e as Error).message}).`); }
  if (!candidate.page?.content || !candidate.module?.content || !candidate.spec?.content) {
    throw new Error('Codegen: reply missing page/module/spec content.');
  }
  return candidate;
}

/** The pages/modules/tests directory a generated file lives in (for relative-import resolution). */
function artifactDir(file: string, fallback: string): string {
  const clean = String(file || '').replace(/\\/g, '/');
  return clean.startsWith('src/') && clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : fallback;
}

/**
 * API-PRESERVATION gate (in-memory, repairable). Regenerating an EXISTING module may ADD methods, but must
 * never DROP or RENAME a public method that other specs already depend on — the exact defect that shipped a
 * "green" PR whose repo no longer type-checked (a rewritten CompletePurchaseModule dropped a method an older
 * spec still called). Reads the current module's public API from disk and rejects a candidate that removes any
 * of it. Generic across every app — driven only by the public API already committed on disk.
 */
export function assertExistingModuleApiPreserved(fw: string, candidate: LlmArtifacts): void {
  const rel = candidate.module?.file;
  if (!rel) return;
  const existing = safeRead(join(fw, rel));
  if (!existing.trim()) return; // brand-new module — no prior API to preserve
  const beforeMethods = extractPublicMethods(existing);
  const afterMethods = extractPublicMethods(candidate.module.content);
  const before = new Set(beforeMethods.map((mm) => mm.name));
  const after = new Set(afterMethods.map((mm) => mm.name));

  // 1) REMOVED / RENAMED — a public method other specs already call would no longer resolve.
  const dropped = [...before].filter((name) => !after.has(name));
  if (dropped.length) {
    throw new Error(
      `Codegen: the regenerated ${rel} removes existing public method(s) [${dropped.join(', ')}] that other specs may `
      + `already call. Preserve the existing module API — keep ${dropped.length > 1 ? 'these methods' : 'this method'} and ADD a `
      + 'new method for any new behaviour instead of renaming or removing one. Re-emit the module with every existing '
      + 'public method still present.',
    );
  }

  // 2) SIGNATURE-INCOMPATIBLE — a still-present method now demands MORE required arguments than before, so existing
  //    callers passing the previous (smaller) argument count stop compiling (TS2554). New parameters must be OPTIONAL.
  const minRequired = (methods: Array<{ name: string; params: string }>, name: string): number =>
    Math.min(...methods.filter((mm) => mm.name === name).map((mm) => requiredParamCount(mm.params)));
  const broken: string[] = [];
  for (const name of [...before].filter((n) => after.has(n))) {
    const reqBefore = minRequired(beforeMethods, name);
    const reqAfter = minRequired(afterMethods, name);
    if (reqAfter > reqBefore) broken.push(`${name}(): was callable with ${reqBefore} argument(s), now requires ${reqAfter}`);
  }
  if (broken.length) {
    throw new Error(
      `Codegen: the regenerated ${rel} changes the call signature of existing public method(s) so existing callers no `
      + `longer compile (TS2554 "Expected N arguments, but got M"): ${broken.join('; ')}. Existing specs already call `
      + `${broken.length > 1 ? 'these methods' : 'this method'} with the previous argument count, so a newly-REQUIRED `
      + 'parameter is a breaking change. Keep the existing signature backward-compatible — make any new parameters '
      + 'OPTIONAL (e.g. completePurchase(first?: string, last?: string, zip?: string)) or add a SEPARATE new method for '
      + 'the new behaviour. Re-emit the module preserving every existing method call signature.',
    );
  }
}

/** Run EVERY in-memory quality gate against a parsed candidate. Throws ONE clear, repairable message. */
function runQualityGates(fw: string, job: CodegenJob, trace: AgentStep[], candidate: LlmArtifacts, uniquenessObserved: boolean): void {
  const page = { file: candidate.page.file || 'Page', content: candidate.page.content };
  const moduleFile = { file: candidate.module.file || 'Module', content: candidate.module.content };
  const spec = { file: candidate.spec.file || 'Spec', content: candidate.spec.content };
  assertDependencyArtifactsPreserved({ page: page.file, module: moduleFile.file, spec: spec.file }, job.dependencyResolution);
  assertExistingModuleApiPreserved(fw, candidate);
  assertNoPositionalPageLocators(candidate.page.file || 'generated Page', candidate.page.content);
  assertNavigationUrlContract([page, moduleFile, spec]);
  assertSingleNavigationPath(spec);
  assertPrepopulatedFieldsUntouched(candidate, trace);
  assertUniqueFieldsHandled(candidate, uniquenessObserved);
  assertNoUndefinedFixtures(fw, candidate);
  assertTraceCoverage(candidate, job.coverageFields, trace);
  assertResolvedDependenciesUsed(candidate.module.content, job.dependencyResolution);
  assertWrapperMethodsExist(fw, [page, moduleFile, spec]);
  assertPageObjectContracts(fw, { page, module: moduleFile, spec }, trace, job.discoveryEvidence);
  assertAssertionsMatchDestinationPage(candidate, trace);
  assertProvenInteractionLocators([page, moduleFile, spec], trace);
  assertUniqueNamedRoleLocators([page, moduleFile, spec], trace);
  // Collection-read hygiene: a getter read with .allTextContents()/.all()/.count() must be a real collection
  // locator, never a single named/text element (evidence-independent — holds even without a snapshot).
  assertCollectionReadsUseCollectionLocators(page, [page, moduleFile, spec]);
  // Ban a tautological ordering assertion (expect(x).toEqual([...x].sort(...))) that proves nothing.
  assertNoSelfReferentialSortAssertion(spec);
  // Every named import must resolve to a real export — prevents the `undefined` runtime read.
  assertImportsResolve(fw, [
    { dir: artifactDir(page.file, 'src/pages'), file: page.file, content: page.content },
    { dir: artifactDir(moduleFile.file, 'src/modules'), file: moduleFile.file, content: moduleFile.content },
    { dir: artifactDir(spec.file, 'src/tests'), file: spec.file, content: spec.content },
  ]);
  // In-memory + repairable: a routes.X reference must be defined in config OR returned in "routes".
  assertRoutesResolvable(fw, candidate, trace);
}

/**
 * The LLM request + self-repair loop shared by first-pass codegen and self-heal. When a quality gate
 * rejects the reply, the exact rejection is fed back and the model corrects its own output. A malformed
 * reply is a FORMAT problem with its own bounded retries so a single fluke can't kill the build. `validate`
 * parses + runs every gate. Returns the accepted artifacts. Generic.
 */
async function requestValidatedArtifacts(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  validate: (raw: string) => LlmArtifacts,
  log: (l: string) => void,
): Promise<LlmArtifacts> {
  const MAX_CODEGEN_ATTEMPTS = 3;
  const MAX_FORMAT_RETRIES = 2;
  const isFormatError = (msg: string): boolean =>
    /Codegen: (model did not return JSON|invalid JSON|reply missing page\/module\/spec content)/.test(msg);
  let art: LlmArtifacts | undefined;
  let lastError = '';
  let qualityAttempts = 0;
  let formatRetries = 0;
  for (;;) {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = { model, messages, temperature: 0 };
    applyReasoning(params);
    const completion = await client.chat.completions.create(params);
    const raw = completion.choices[0]?.message?.content || '';
    try {
      art = validate(raw);
      if (qualityAttempts + formatRetries > 0) log(`[codegen] repair succeeded (${qualityAttempts} gate repair(s), ${formatRetries} format retr(ies)).`);
      break;
    } catch (e) {
      lastError = (e as Error).message;
      if (isFormatError(lastError)) {
        formatRetries += 1;
        if (formatRetries > MAX_FORMAT_RETRIES) throw new Error(`${lastError} (unresolved after ${formatRetries} format retries)`);
        log(`[codegen] reply was not valid JSON (format retry ${formatRetries}/${MAX_FORMAT_RETRIES}): ${lastError} — re-requesting STRICT JSON…`);
        messages.push({ role: 'assistant', content: raw });
        messages.push({ role: 'user', content: [
          'Your previous reply could NOT be parsed as JSON:',
          '',
          lastError,
          '',
          'Re-emit the SAME artifact as ONE strict JSON object only — no prose, no markdown fences, no',
          'trailing commas, every string properly quoted and escaped. Keep every file and locator identical.',
        ].join('\n') });
        continue;
      }
      qualityAttempts += 1;
      if (qualityAttempts >= MAX_CODEGEN_ATTEMPTS) throw new Error(`${lastError} (unresolved after ${MAX_CODEGEN_ATTEMPTS} codegen attempts)`);
      log(`[codegen] quality gate rejected attempt ${qualityAttempts}/${MAX_CODEGEN_ATTEMPTS}: ${lastError} — asking the model to repair…`);
      messages.push({ role: 'assistant', content: raw });
      messages.push({ role: 'user', content: [
        'Your previous reply was REJECTED by an automated quality gate:',
        '',
        lastError,
        '',
        'Fix ONLY this problem and re-emit the COMPLETE corrected artifact as STRICT JSON',
        '(all of page/module/spec plus testData/routes/uniqueFields as needed), keeping every other',
        'file and locator exactly as before. No prose, no markdown fences.',
        '',
        'HARD CONSTRAINT (applies to EVERY repair attempt): full Automation Trace coverage is',
        'non-negotiable. NEVER drop, rename, or skip a field/step to dodge a gate — every executable',
        'Automation Trace step must stay fully implemented (filled/selected/clicked + referenced). If a',
        'gate is about a field\'s CLASSIFICATION (e.g. unique vs ordinary testData), CORRECT the',
        'classification for that same field; do not remove the field.',
      ].join('\n') });
    }
  }
  if (!art) throw new Error(lastError || 'Codegen: no usable reply.');
  return art;
}

/** Write the accepted artifacts to disk, merge testData/routes, refresh the reuse index, and return the
 * file list. Shared by first-pass codegen and self-heal so both persist identically. */
async function writeArtifacts(fw: string, job: CodegenJob, art: LlmArtifacts, trace: AgentStep[], log: (l: string) => void): Promise<GeneratedArtifacts> {
  const files: string[] = [];
  const feat = (job.feature || 'Feature').replace(/[^a-zA-Z0-9]/g, '') || 'Feature';
  const writes: Array<[string, string]> = [
    [safePath(fw, art.page.file, `src/pages/${feat}Page.ts`), art.page.content],
    [safePath(fw, art.module.file, `src/modules/${feat}Module.ts`), art.module.content],
    [safePath(fw, art.spec.file, `src/tests/${feat.toLowerCase()}.spec.ts`), art.spec.content],
  ];
  for (const [abs, content] of writes) {
    writeFileSync(abs, content.endsWith('\n') ? content : content + '\n');
    files.push(abs.replace(fw, '').replace(/^[\\/]/, '').replace(/\\/g, '/'));
  }
  const td = mergeTestData(fw, art.testData);
  if (td) files.push(td.replace(fw, '').replace(/^[\\/]/, '').replace(/\\/g, '/'));

  const uniqueUtility = ensureUniqueDataUtility(fw, art.uniqueFields);
  if (uniqueUtility) files.push(uniqueUtility);

  const rt = mergeRoutes(fw, art.routes);
  if (rt && !files.includes(rt)) files.push(rt);
  // Safety net: if a referenced route still isn't defined (model omitted it from "routes"), auto-derive it
  // from the verified trace url and merge — a stubborn omission can never break the build.
  const recovered = recoverMissingRoutes(fw, files, trace);
  if (recovered && !files.includes(recovered)) files.push(recovered);
  // Fail fast BEFORE verifySpec: every routes.X in a generated file must now be defined in config.
  assertRoutesDefined(fw, files);

  log(`[codegen] Wrote ${files.length} file(s). Refreshing capability index…`);
  await refreshIndex(fw);
  const dependencyMemory = writeCapabilityDependencyMemory(fw, job.feature, {
    page: writes[0][0].replace(fw, '').replace(/^[\\/]/, '').replace(/\\/g, '/'),
    module: writes[1][0].replace(fw, '').replace(/^[\\/]/, '').replace(/\\/g, '/'),
    spec: writes[2][0].replace(fw, '').replace(/^[\\/]/, '').replace(/\\/g, '/'),
  }, job.dependencyResolution);
  if (dependencyMemory && !files.includes(dependencyMemory)) files.push(dependencyMemory);
  log('[codegen] Capability index refreshed (.ai-memory written back).');

  return { domain: art.domain || feat.toLowerCase(), files, reusedExisting: !!(art.reusedFrom && art.reusedFrom.length) };
}

/** The generic heal instruction appended after the full codegen evidence when a verify run FAILED. */
function buildHealUserPrompt(currentFiles: string, failureOutput: string): string {
  return [
    'The generated Playwright test FAILED its verification run. Fix the ROOT cause and re-emit the COMPLETE',
    'corrected artifact as STRICT JSON (page/module/spec plus testData/routes/uniqueFields as needed), keeping',
    'the 3-layer split (pages = locators, modules = workflows, specs = assertions) and every unaffected file identical.',
    '',
    'HARD GUARDRAIL: NEVER weaken, delete, or loosen an assertion, and NEVER change an expected URL/outcome just to',
    'make the test pass. If a destination was not reached, fix the STEPS that get there — never change what you assert.',
    '',
    'DIAGNOSE FROM THE STACK TRACE + ERROR FIRST:',
    '- "Cannot read properties of undefined (reading \'<x>\')": a binding is undefined. If <x> was read off an',
    '  IMPORTED value, that symbol is NOT exported by the module it is imported from — import it from the module',
    '  that actually exports it, or define/inline the value. If it is a collaborator (this.<obj>.<x>()), assign',
    '  this.<obj> = new <Class>(page) in the constructor. If it is a data key, add that key with a concrete value.',
    '- A toHaveURL / waitFor / "to be visible" TIMEOUT while the browser is on the WRONG page means a PRECONDITION',
    '  was skipped: ADD the missing setup/navigation steps to REACH the target page, following the verified trace',
    '  order and REUSING existing Page/Module methods — do not change the locator or the final assertion.',
    '- An invented/misspelled control (a name that appears NOWHERE in the evidence) must be replaced with the single',
    '  closest REAL control from the verified trace; if none matches the intent, remove that invalid step.',
    '- "<obj>.<method> is not a function": the method does not exist — define it on the owning Page/Module (return the',
    '  FULL file) or call an existing method; never add methods to the shared wrappers.',
    '- "strict mode violation: ... resolved to N elements": your locator matches MORE THAN ONE element. Playwright',
    '  prints each match with its exact stable locator ("... aka locator(\'[data-test=...]\')"). Pick the ONE the step',
    '  INTENDS and REPLACE the ambiguous locator with that exact stable locator: for a name/title/text read or click,',
    '  choose the TEXT/title match (whose id/data-test does NOT contain img/image/icon/thumb), NOT the image link.',
    '  NEVER disambiguate with .first()/.last()/.nth().',
    '- A sort/order assertion that FAILS with a deep-equality diff showing an unexpected empty "" (or a re-ordered',
    '  clone): the collection read is DIRTY and/or the assertion is TAUTOLOGICAL. (1) If the Page getter behind the',
    '  .allTextContents()/.all()/.count() read is a single named/text locator (getByRole(role,{ name }) / getByText',
    '  (\'literal\')) it matches ONE item and, for a link, ALSO its image-link sibling → an empty "" leaks in; replace it',
    '  with the item\'s SHARED repeated data-test/testid collection locator (getByTestId(\'…\') / locator(\'[data-test="…"]\'))',
    '  so every row — and only the text nodes — are read. (2) NEVER assert expect(x).toEqual([...x].sort(...)) — comparing',
    '  an array to a sorted copy of ITSELF proves nothing and false-passes an already-ordered list. Assert the read is',
    '  non-empty and .length matches the item count, then compare it to the SAME verified item names sorted by the rule.',
    '',
    '## Current files on disk',
    currentFiles,
    '',
    '## Playwright failure output (the REAL error to fix)',
    failureOutput.slice(-6000),
  ].join('\n');
}

/**
 * Self-heal a generated spec that FAILED its verify run: read the current files, feed the REAL Playwright
 * failure + generic diagnostic rules back to the model, and return corrected, gate-passing artifacts written
 * to disk. Mirrors the mature engine's heal round. The GUARDRAIL in the prompt forbids weakening assertions
 * or changing expected outcomes to go green. Returns null when the reply is unusable. Generic.
 */
export async function healArtifacts(
  fw: string, job: CodegenJob, trace: AgentStep[], currentFiles: string[], failureOutput: string,
  log: (l: string) => void = console.log,
): Promise<GeneratedArtifacts | null> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
  const model = job.model || process.env.OPENAI_MODEL || 'gpt-4o';
  const pick = (frag: string): string => {
    const rel = currentFiles.find((f) => f.includes(frag));
    if (!rel) return '';
    const body = safeRead(join(fw, rel));
    return body ? `===FILE:${rel}===\n${body}\n===ENDFILE===` : '';
  };
  const current = [pick('/pages/'), pick('/modules/'), pick('/tests/'), pick('testData')].filter(Boolean).join('\n\n');
  const uniquenessObserved = traceExposedUniquenessConstraint(trace);
  const validate = (raw: string): LlmArtifacts => {
    const candidate = parseArtifacts(raw);
    const navFix = repairDuplicateFeatureNavigation({ file: candidate.spec.file || 'Spec', content: candidate.spec.content });
    if (navFix.changed) { candidate.spec.content = navFix.content; log('[codegen] deterministic repair: reduced beforeEach to shared login only (removed duplicate feature navigation).'); }
    runQualityGates(fw, job, trace, candidate, uniquenessObserved);
    return candidate;
  };
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You are a senior Playwright/TypeScript engineer. Fix the ROOT cause of a failing test and reply with STRICT JSON only.' },
    { role: 'user', content: buildPrompt(fw, job, trace) },
    { role: 'user', content: buildHealUserPrompt(current, failureOutput) },
  ];
  let art: LlmArtifacts;
  try { art = await requestValidatedArtifacts(client, model, messages, validate, log); }
  catch (e) { log(`[codegen] self-heal could not produce valid files: ${(e as Error).message}`); return null; }
  return writeArtifacts(fw, job, art, trace, log);
}

/**
 * Generate the Page/Module/Spec from a verified trace, reusing existing capabilities and writing
 * new artifacts + refreshing the index. Returns the files written. Throws on an unusable LLM reply.
 */
export async function generateFromTrace(
  fw: string,
  job: CodegenJob,
  trace: AgentStep[],
  log: (l: string) => void = console.log,
): Promise<GeneratedArtifacts> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
  const model = job.model || process.env.OPENAI_MODEL || 'gpt-4o';

  log('[codegen] Loading reuse index + exemplars and asking the model for files…');
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You are a senior Playwright/TypeScript engineer. Reuse existing framework code, copy proven locators verbatim, and reply with STRICT JSON only.' },
    { role: 'user', content: buildPrompt(fw, job, trace) },
  ];

  // Did the live explore walk actually prove a uniqueness constraint (a duplicate/"already exists"
  // validation)? Only then may codegen FORCE unique-value handling on a name-matching field.
  const uniquenessObserved = traceExposedUniquenessConstraint(trace);

  const validate = (raw: string): LlmArtifacts => {
    const candidate = parseArtifacts(raw);
    const navFix = repairDuplicateFeatureNavigation({ file: candidate.spec.file || 'Spec', content: candidate.spec.content });
    if (navFix.changed) { candidate.spec.content = navFix.content; log('[codegen] deterministic repair: reduced beforeEach to shared login only (removed duplicate feature navigation).'); }
    runQualityGates(fw, job, trace, candidate, uniquenessObserved);
    return candidate;
  };
  const art = await requestValidatedArtifacts(client, model, messages, validate, log);
  return writeArtifacts(fw, job, art, trace, log);
}

/**
 * Author the PROPOSED test cases for the approval gate — NO files are written.
 * Runs after the agent-loop has VERIFIED the flow, so every case references only
 * controls/actions that were actually observed in the trace (anti-hallucination).
 * Returns a list the website shows the user; on Approve, `generateFromTrace` turns
 * the SAME trace into code. Never throws — returns [] if the model reply is unusable.
 */
export async function authorPlanFromTrace(
  fw: string,
  job: CodegenJob,
  trace: AgentStep[],
  log: (l: string) => void = console.log,
): Promise<PlanCase[]> {
  if (!trace.length) return [];
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
  const model = job.model || process.env.OPENAI_MODEL || 'gpt-4o';
  const types = (job.testTypes && job.testTypes.length) ? job.testTypes.join(', ') : 'positive (happy path)';
  const maxCases = job.maxCases && job.maxCases > 0 ? job.maxCases : 3;

  const prompt = [
    `Propose the test cases to automate for the feature "${job.feature}" at ${job.url}.`,
    `Cover ONLY these test types: ${types}. Propose at most ${maxCases} case(s).`,
    '',
    '## Verified live actions (EVIDENCE — the flow was actually driven and confirmed)',
    renderTrace(trace),
    '',
    '## Rules',
    '- Author a case ONLY when the verified actions/observations support it — never invent a control, message, or a test type just to reach a count. Fewer real cases is correct.',
    '- Each case must have numbered, human-readable steps that follow the verified flow and one clear expected result.',
    '',
    '## Output — STRICT JSON only (no prose, no markdown fences):',
    '{ "cases": [ { "title": "<short title>", "type": "<positive|negative|boundary|security|accessibility>", "steps": ["1. …", "2. …"], "expectedResults": "<one clear expected outcome>" } ] }',
  ].join('\n');

  try {
    log('[plan] Authoring proposed test cases from the verified trace…');
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: [
        { role: 'system', content: 'You are a senior QA engineer. Propose only test cases the evidence supports. Reply with STRICT JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    };
    applyReasoning(params);
    const completion = await client.chat.completions.create(params);
    const raw = completion.choices[0]?.message?.content || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as { cases?: Array<Partial<PlanCase>> };
    const cases = Array.isArray(parsed.cases) ? parsed.cases : [];
    const out = cases.slice(0, maxCases).map((c, i): PlanCase => ({
      id: `TC_${String(i + 1).padStart(3, '0')}`,
      title: String(c.title || `Case ${i + 1}`).trim(),
      type: String(c.type || 'positive').trim().toLowerCase(),
      steps: Array.isArray(c.steps) ? c.steps.map((s) => String(s)) : [],
      expectedResults: String(c.expectedResults || '').trim(),
    })).filter((c) => c.title);
    log(`[plan] Proposed ${out.length} case(s).`);
    return out;
  } catch (e) {
    log(`[plan] Could not author cases: ${(e as Error).message}`);
    return [];
  }
}

// ─── Scenario authoring from exhaustive discovery ────────────────────────────────────────────────
// Deterministic (no LLM) so the plan is reproducible and unit-testable, and so EVERY executable field
// provably becomes an individual scenario step (fixing the shallow-collapse problem). The LLM is not
// needed here: discovery already gathered the real controls + evidence; we just shape them into
// selectable, evidence-linked scenarios.

/** The example value shown for a field in the plan (never a real secret — generated at run time). */
function exampleInputFor(item: FieldInventoryItem): string {
  switch (item.type) {
    case 'combobox': case 'select': return item.options?.length ? `one of: ${item.options.slice(0, 5).join(', ')}` : 'a valid option';
    case 'checkbox': return 'checked';
    case 'radio': return 'a valid choice';
    case 'date': return 'a valid date';
    case 'file': return 'an approved test fixture';
    default: return `a realistic ${item.label.toLowerCase()} value`;
  }
}

/** The URL the verified success submit navigated to (evidence for the positive expected result). */
function traceSuccessUrl(trace: AgentStep[]): string {
  for (let i = trace.length - 1; i >= 0; i--) {
    const s = trace[i];
    if (s.tool === 'snapshot' && (s.args as { after?: string })?.after === 'submit' && s.url) return s.url;
  }
  for (let i = trace.length - 1; i >= 0; i--) if (trace[i].url) return trace[i].url as string;
  return '';
}

/** Pull the role-name out of a submit locator, e.g. getByRole('button', { name: 'Save' }) → "Save". */
function locatorRoleName(locator?: string): string {
  const m = (locator || '').match(/name:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : '';
}

/**
 * One step of the AUTOMATION TRACE — the boundary between discovery inventory and codegen.
 * These are ONLY the controls/actions the approved scenario actually exercises; discovered navigation
 * and page infrastructure never appear here even though they remain in the discovery inventory.
 */
interface AutomationStep {
  action: 'fill' | 'select' | 'check' | 'uncheck' | 'upload' | 'click';
  target: string;            // control label
  liveLocator: string;       // locator executed in the verified trace
  snapshotEvidence?: string; // a11y context proving the control exists
  item?: FieldInventoryItem; // the matching discovery inventory item (evidence enrichment)
  blocked: boolean;          // true = in scope but NOT executable (e.g. upload with no fixture)
  blockedReason?: string;
  isSubmit: boolean;         // the single controlled submit that completes the scenario
}

const AUTOMATION_FIELD_TOOLS = new Set(['fill', 'type', 'select', 'check', 'uncheck']);

// Search/filter/pagination controls operate the LIST/results view, not the feature form. The agent may
// touch them while exploring, so they can appear in the verified trace — but a "create/edit <feature>"
// scenario must NOT include them (they belong to their own search scenario). Matched by accessible
// name/role, never by an app-specific label, so this stays generic across applications.
const LIST_CONTROL_RE = /^\s*(?:search|filters?)\s*$/i;

function isListControl(label: string, item?: FieldInventoryItem): boolean {
  if (LIST_CONTROL_RE.test(label)) return true;
  if (item?.role === 'searchbox') return true;
  return LIST_CONTROL_RE.test(item?.accessibleName || '');
}

/**
 * TEST DESIGN AGENT (deterministic planner) — convert the discovery inventory + verified trace into an
 * Automation Trace: ONLY the feature-relevant controls the scenario truly exercises.
 *
 * The verified trace already IS the automation scope: the agent only acted on real feature controls to
 * complete the flow (it navigated past — but never "filled" — navigation links). So we derive executable
 * steps from the trace's field actions (excluding credential/login fills) plus the single submit click,
 * then add any feature-relevant BLOCKED controls (e.g. file uploads with no fixture) as non-executable
 * steps. Discovered navigation/infrastructure (links, tabs, orphan controls) is intentionally excluded.
 */
function buildAutomationTrace(trace: AgentStep[], inventory: FieldInventoryItem[]): {
  executable: AutomationStep[];
  blocked: AutomationStep[];
  submit?: AutomationStep;
} {
  // Where did the flow submit? The last click before the post-submit snapshot is the controlled submit.
  let submitSnapshotIdx = -1;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i].tool === 'snapshot' && (trace[i].args as { after?: string })?.after === 'submit') { submitSnapshotIdx = i; break; }
  }
  const upperBound = submitSnapshotIdx >= 0 ? submitSnapshotIdx : trace.length;

  const executable: AutomationStep[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < upperBound; i++) {
    const s = trace[i];
    if (!AUTOMATION_FIELD_TOOLS.has(s.tool)) continue;
    const val = String((s.args as { value?: string; text?: string })?.value ?? (s.args as { text?: string })?.text ?? '');
    if (val.includes('{{')) continue;                 // credential (login) fill — never an automation target
    const label = traceStepFieldLabel(s);
    if (!label) continue;
    const key = coverageKey(label);
    if (seen.has(key)) continue;
    const item = inventory.find((it) => coverageKey(it.label) === key || (it.accessibleName && coverageKey(it.accessibleName) === key));
    if (isListControl(label, item)) continue; // search/filter/pagination operate the list view — not a create-scenario field
    seen.add(key);
    const action = (s.tool === 'type' ? 'fill' : s.tool) as AutomationStep['action'];
    executable.push({ action, target: item?.label || label, liveLocator: s.locator || '', snapshotEvidence: s.context, item, blocked: false, isSubmit: false });
  }

  // The single controlled submit that completed the flow.
  let submit: AutomationStep | undefined;
  for (let i = upperBound - 1; i >= 0; i--) {
    if (trace[i].tool !== 'click') continue;
    const s = trace[i];
    const label = traceStepFieldLabel(s) || locatorRoleName(s.locator) || 'Save';
    submit = { action: 'click', target: label, liveLocator: s.locator || '', snapshotEvidence: s.context, blocked: false, isSubmit: true };
    break;
  }

  // Feature-relevant BLOCKED controls: file uploads discovered on the form but not executable (no fixture).
  // They belong in the trace as BLOCKED (never silently dropped) but must NOT count as executable steps.
  const blocked: AutomationStep[] = [];
  for (const it of inventory) {
    if (it.type !== 'file' || !it.blocked) continue;
    const key = coverageKey(it.label);
    if (seen.has(key)) continue;
    seen.add(key);
    blocked.push({ action: 'upload', target: it.label, liveLocator: '', item: it, blocked: true, blockedReason: it.blockedReason || 'No approved test fixture available', isSubmit: false });
  }

  return { executable, blocked, submit };
}

/** Shape an Automation Trace step into the scenario/plan step model (with live evidence attached). */
function automationToScenarioStep(step: AutomationStep, order: number, expected?: string, transitions?: StateTransition[]): ScenarioStep {
  const verb = step.isSubmit ? 'Click'
    : step.action === 'select' ? 'Select'
    : step.action === 'check' ? 'Check'
    : step.action === 'uncheck' ? 'Uncheck'
    : step.action === 'upload' ? 'Upload'
    : 'Fill';
  const input = step.isSubmit ? undefined
    : step.item ? exampleInputFor(step.item)
    : step.action === 'upload' ? 'an approved test fixture'
    : `a realistic ${step.target.toLowerCase()} value`;
  const classification: ControlClassification = step.isSubmit ? 'feature-action'
    : step.action === 'upload' ? 'upload'
    : 'feature-input';
  return {
    order, action: `${verb} ${step.target}`, type: step.isSubmit ? 'click' : step.action,
    target: step.target, classification, fieldId: step.item?.id, input, expected,
    locatorEvidence: step.item?.locatorEvidence ?? null,
    liveLocator: step.liveLocator || undefined,
    snapshotEvidence: step.snapshotEvidence,
    blocked: step.blocked || undefined,
    blockedReason: step.blockedReason,
    optionEvidence: optionEvidenceFor(step, transitions),
  };
}

/** Prefer LIVE transition options, else the inventory item's captured options — never invented. */
function optionEvidenceFor(step: AutomationStep, transitions?: StateTransition[]): string[] | undefined {
  const item = step.item;
  if (!item) return undefined;
  if (transitions && transitions.length) {
    const key = coverageKey(item.label);
    const t = transitions.find((tr) => (tr.fieldId && tr.fieldId === item.id) || coverageKey(tr.trigger) === key);
    if (t?.options?.length) return t.options;
  }
  return item.options?.length ? item.options : undefined;
}

/**
 * Shape the discovery inventory + verified trace into selectable, evidence-backed scenarios whose
 * automation scope is the AUTOMATION TRACE (feature-relevant controls only), NOT the full discovery
 * inventory. Discovered navigation/infrastructure stays in the inventory dossier but never becomes an
 * automation step, so it can never cause a codegen coverage failure.
 *  • one READY positive scenario over every executable trace field + the controlled submit,
 *  • an optional READY "required fields only" positive scenario (when required is a strict subset),
 *  • one PROPOSED (ready=false) negative scenario per required field — surfaced for transparency but
 *    blocked because read-only discovery captured no live validation evidence to assert against.
 * BLOCKED controls (e.g. file uploads with no fixture) are listed in the trace but never executable.
 */
export function authorScenariosFromDiscovery(
  job: CodegenJob,
  discovery: DiscoveryResult,
  trace: AgentStep[],
): Scenario[] {
  const { executable, blocked, submit } = buildAutomationTrace(trace, discovery.inventory);
  const required = executable.filter((s) => s.item?.required === true);
  const successUrl = traceSuccessUrl(trace);
  const feat = job.feature || 'record';
  const maxCases = job.maxCases && job.maxCases > 0 ? job.maxCases : 6;
  const positiveExpected = successUrl
    ? `The ${feat} is saved and the app navigates to ${successUrl}.`
    : `The ${feat} is saved successfully and a confirmation is shown.`;

  const scenarios: Scenario[] = [];
  let idx = 0;
  const nextId = () => `TC_${String(++idx).padStart(3, '0')}`;

  // A — positive over the full Automation Trace: every executable feature field, listed blocked controls, + submit.
  if (executable.length || submit) {
    const steps: ScenarioStep[] = [];
    executable.forEach((s) => steps.push(automationToScenarioStep(s, steps.length + 1, undefined, discovery.transitions)));
    blocked.forEach((s) => steps.push(automationToScenarioStep(s, steps.length + 1)));
    if (submit) steps.push(automationToScenarioStep(submit, steps.length + 1, positiveExpected));
    scenarios.push({
      id: nextId(), title: `Create ${feat} with all fields populated`, type: 'positive',
      ready: executable.length > 0, blocked: false, steps, expectedResults: positiveExpected,
      // Coverage = executable Automation Trace fields ONLY (not the submit, not blocked, not navigation).
      coverage: { fieldIds: executable.map((s) => s.item?.id).filter((id): id is string => !!id), fieldLabels: executable.map((s) => s.target) },
    });
  }

  // B — required-only positive (only when required is a strict, non-empty subset).
  if (required.length && required.length < executable.length) {
    const steps: ScenarioStep[] = [];
    required.forEach((s) => steps.push(automationToScenarioStep(s, steps.length + 1, undefined, discovery.transitions)));
    if (submit) steps.push(automationToScenarioStep(submit, steps.length + 1, positiveExpected));
    scenarios.push({
      id: nextId(), title: `Create ${feat} with only the required fields`, type: 'positive',
      ready: true, blocked: false, steps, expectedResults: positiveExpected,
      coverage: { fieldIds: required.map((s) => s.item?.id).filter((id): id is string => !!id), fieldLabels: required.map((s) => s.target) },
    });
  }

  // C — one negative per required field (transparency; blocked until a live validation probe exists).
  for (const s of required) {
    if (scenarios.length >= maxCases) break;
    scenarios.push({
      id: nextId(), title: `Reject submission when ${s.target} is empty`, type: 'negative',
      ready: false, blocked: true,
      blockedReason: 'No live validation evidence was captured during read-only discovery — a validation probe is required before this negative case can be automated.',
      steps: [
        { order: 1, action: `Leave ${s.target} empty and fill the other required fields`, type: 'fill', classification: 'feature-input', target: s.target, fieldId: s.item?.id, locatorEvidence: s.item?.locatorEvidence ?? null },
        ...(submit ? [automationToScenarioStep(submit, 2)] : []),
      ],
      expectedResults: `A validation message is shown and the ${feat} is not saved while ${s.target} is empty.`,
      coverage: { fieldIds: s.item?.id ? [s.item.id] : [], fieldLabels: [s.target] },
    });
  }

  return scenarios.slice(0, maxCases);
}

/**
 * Author a READ/VIEW verification scenario from the PRIMARY trace (prerequisite + feature steps) when
 * the feature has no fillable form to discover — e.g. "View Cart", "View Account", "Open Dashboard".
 * The requested feature was reached and its content verified live (feature-boundary acceptance), so we
 * emit ONE ready scenario whose Automation Trace is the real navigation the walk performed plus a
 * terminal verification of the target's content. Fully generic: every step is derived from the live
 * trace and the feature name — no application- or feature-specific rules. Always yields a non-empty
 * Automation Trace so the plan is never empty for a successfully-verified read feature.
 */
export function authorFeatureVerificationScenarios(
  job: CodegenJob,
  primaryTrace: AgentStep[],
  applicationSummary?: ApplicationSummary | null,
): Scenario[] {
  const feat = job.feature || 'feature';
  // Navigation the walk performed to reach the target: real clicks, excluding credential/login submits.
  const navSteps: ScenarioStep[] = [];
  const seen = new Set<string>();
  for (const s of primaryTrace) {
    if (s.tool !== 'click') continue;
    const label = traceStepFieldLabel(s) || locatorRoleName(s.locator);
    if (!label) continue;
    const key = coverageKey(label);
    if (seen.has(key)) continue;
    seen.add(key);
    navSteps.push({
      order: navSteps.length + 1,
      action: `Click ${label}`,
      target: label,
      type: 'click',
      classification: 'feature-action',
      liveLocator: s.locator || undefined,
      snapshotEvidence: s.context,
    });
  }

  // Terminal verification: the acceptance evidence is the last on-target snapshot (feature-boundary stop).
  const acceptance = [...primaryTrace].reverse().find((s) => s.tool === 'snapshot' && s.context);
  const targetUrl = applicationSummary?.finalUrl || acceptance?.url || traceSuccessUrl(primaryTrace) || job.url;
  const verifyStep: ScenarioStep = {
    order: navSteps.length + 1,
    action: `Verify ${feat} is displayed with its expected content`,
    target: feat,
    type: 'assert',
    classification: 'feature-action',
    expected: targetUrl
      ? `The ${feat} page (${targetUrl}) is displayed and its content is present.`
      : `The ${feat} is displayed and its content is present.`,
    snapshotEvidence: acceptance?.context,
  };

  const steps = [...navSteps, verifyStep];
  const scenario: Scenario = {
    id: 'TC_001',
    title: `Verify ${feat} contents`,
    type: 'positive',
    ready: true,
    blocked: false,
    steps,
    expectedResults: verifyStep.expected || `The ${feat} is displayed with its expected content.`,
    coverage: { fieldIds: [], fieldLabels: navSteps.map((s) => s.target) },
  };
  return [scenario];
}

/** Legacy PlanCase projection of the richer scenarios, so older clients still render a plan list. */
export function scenariosToCases(scenarios: Scenario[]): PlanCase[] {
  return scenarios.map((s) => ({
    id: s.id, title: s.title, type: s.type,
    steps: s.steps.map((st) => `${st.order}. ${st.action}${st.input ? ` — ${st.input}` : ''}`),
    expectedResults: s.expectedResults,
  }));
}

// ─── AI-Native (test-case-driven) adapters ───────────────────────────────────────────────────────
// Deterministic (no LLM) so the supplied test cases become the authoritative contract: their IDs are
// preserved verbatim, distinct behaviours stay distinct (no false dedup), and generation integrity can be
// measured against the exact requested set. These are used ONLY by the test-case entrypoint; Autopilot's
// explore/approve path never calls them, so its behaviour is unchanged.

/** Canonical TC id form: TC_003. Accepts TC3 / tc-3 / "TC_003 …" and normalises to TC_ + 3-digit. */
export function normalizeTcId(id: string): string {
  const m = String(id || '').match(/(\d+)/);
  return m ? `TC_${m[1].padStart(3, '0')}` : String(id || '').trim();
}

/** Strip a leading [TC_00x] id and any @Tags from a test title so titles compare on behaviour only. */
function stripIdAndTags(title: string): string {
  return String(title || '').replace(/\[?TC[_-]?\d+\]?/gi, '').replace(/@\w+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Build the DIRECTED exploration goal from the supplied test cases. The test cases are authoritative intent —
 * the explorer must FOLLOW them and collect verified evidence, never rewrite or invent scenarios. Deterministic.
 */
export function buildTestCaseGoal(cases: TestCaseInput[]): string {
  const blocks = cases.map((c) => {
    const steps = (c.steps || []).map((s, i) => (/^\s*\d+[.)]/.test(s) ? s.trim() : `${i + 1}. ${s.trim()}`)).join('\n');
    const exp = c.expectedResults ? `\nExpected result: ${c.expectedResults}` : '';
    const data = c.testData && Object.keys(c.testData).length ? `\nTest data: ${JSON.stringify(c.testData)}` : '';
    return `### ${normalizeTcId(c.id)} — ${c.title}\nSteps:\n${steps}${exp}${data}`;
  }).join('\n\n');
  return [
    'Follow these EXACT, already-approved test cases against the application and collect verified browser',
    'evidence for every meaningful action and for each expected result. Log in first if a login form is',
    'present. Do NOT crawl unrelated areas, do NOT invent additional scenarios, and do NOT rewrite the test',
    'cases — they are the authoritative intent. For each step, perform the real action and capture the',
    'resulting on-screen state so locators and assertions are grounded in live evidence.',
    '',
    blocks,
  ].join('\n');
}

/**
 * Convert supplied test cases DIRECTLY into Scenario objects (no LLM authoring). Each Scenario preserves the
 * ORIGINAL TC id (authoritative — TC_003 stays TC_003) and title, so downstream integrity + ID enforcement
 * measure the exact requested set. Distinct titles/steps stay distinct scenarios (no false dedup). Generic.
 */
export function scenariosFromTestCases(cases: TestCaseInput[]): Scenario[] {
  return cases.map((c) => {
    const rawSteps = Array.isArray(c.steps) ? c.steps : [];
    const steps: ScenarioStep[] = rawSteps.map((s, i) => ({
      order: i + 1,
      action: String(s).replace(/^\s*\d+[.)]\s*/, '').trim(),
      target: '',
      type: 'click',
      classification: 'feature-action',
    }));
    const tagText = `${c.type || ''} ${(c.tags || []).join(' ')} ${c.title || ''}`.toLowerCase();
    const type = /negativ|invalid|unsupported|error|boundary/.test(tagText) ? 'negative' : (c.type || 'positive').toLowerCase();
    return {
      id: normalizeTcId(c.id),
      title: c.title,
      type,
      ready: true,
      blocked: false,
      steps,
      expectedResults: c.expectedResults || '',
      coverage: { fieldIds: [], fieldLabels: [] },
    };
  });
}

/** Every TC id that labels a test() in a spec, normalised (order-preserving, de-duplicated). */
export function extractSpecTestIds(content: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of String(content || '').matchAll(/test\s*(?:\.\w+)?\s*\(\s*(['"`])([\s\S]*?)\1/g)) {
    const idm = m[2].match(/TC[_-]?(\d+)/i);
    if (!idm) continue;
    const id = `TC_${idm[1].padStart(3, '0')}`;
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids;
}

/**
 * Generation integrity for the test-case path: which requested TC ids are present in the generated spec.
 * No silent dropping — the caller FAILS (no PR) when anything is missing. Deterministic.
 */
export function testCaseIntegrity(requestedIds: string[], specContent: string): { complete: boolean; missing: string[]; present: string[] } {
  const want = requestedIds.map(normalizeTcId);
  const have = new Set(extractSpecTestIds(specContent));
  const missing = want.filter((id) => !have.has(id));
  return { complete: missing.length === 0, missing, present: want.filter((id) => have.has(id)) };
}

/**
 * Deterministically enforce the authoritative TC ids on a generated spec. The LLM is prompted with the exact
 * ids, but this is the SAFETY NET: for each requested case, find the test whose title best matches (by behaviour,
 * ignoring any existing id/tags) and rewrite its bracketed id to the requested one when it differs. A test that
 * ALREADY carries the correct id is left untouched. Never creates duplicate ids (each block is claimed once).
 * Returns { content, changed, missing } — `missing` lists requested ids with no matching test (caller rejects).
 * Only edits test TITLES (safe: no body/locator/assertion changes). Generic; used only by the test-case path.
 */
export function enforceTestCaseIds(
  specContent: string,
  requested: Array<{ id: string; title: string }>,
): { content: string; changed: boolean; missing: string[] } {
  interface Blk { titleStart: number; titleEnd: number; title: string; id: string | null; claimed: boolean; }
  const blocks: Blk[] = [];
  for (const m of specContent.matchAll(/test\s*(?:\.\w+)?\s*\(\s*(['"`])([\s\S]*?)\1/g)) {
    const raw = m[2];
    const titleStart = (m.index ?? 0) + m[0].indexOf(raw);
    const idm = raw.match(/TC[_-]?(\d+)/i);
    blocks.push({ titleStart, titleEnd: titleStart + raw.length, title: raw, id: idm ? `TC_${idm[1].padStart(3, '0')}` : null, claimed: false });
  }
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const missing: string[] = [];

  // Pass 1: a block already carrying the exact requested id is correct — claim it, no edit.
  for (const req of requested) {
    const want = normalizeTcId(req.id);
    const exact = blocks.find((b) => !b.claimed && b.id === want);
    if (exact) exact.claimed = true;
  }
  // Pass 2: for each still-unsatisfied requested id, take the best behaviour-title match and rewrite its id.
  for (const req of requested) {
    const want = normalizeTcId(req.id);
    if (blocks.some((b) => b.claimed && b.id === want)) continue; // already satisfied in pass 1
    let best: Blk | null = null;
    let bestScore = 0;
    for (const b of blocks) {
      if (b.claimed) continue;
      const score = titleOverlap(stripIdAndTags(b.title), req.title);
      if (score > bestScore) { bestScore = score; best = b; }
    }
    if (!best) { missing.push(want); continue; }
    best.claimed = true;
    const newTitle = best.id
      ? best.title.replace(/TC[_-]?\d+/i, want)
      : `[${want}] ${best.title.replace(/^\[?\s*\]?\s*/, '')}`;
    if (newTitle !== best.title) edits.push({ start: best.titleStart, end: best.titleEnd, text: newTitle });
    best.id = want;
  }

  if (!edits.length) return { content: specContent, changed: false, missing };
  edits.sort((a, b) => b.start - a.start); // apply right-to-left so offsets stay valid
  let out = specContent;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { content: out, changed: true, missing };
}

/** Best-effort: which field label did a trace fill/select/check step target? (for trace filtering) */
function traceStepFieldLabel(step: AgentStep): string {
  if (step.scopeHint?.label) return step.scopeHint.label;
  if (step.interaction?.accessibleName) return step.interaction.accessibleName;
  const loc = step.locator || '';
  const byLabel = loc.match(/getByLabel\(\s*['"]([^'"]+)['"]/);
  if (byLabel) return byLabel[1];
  const byName = loc.match(/name:\s*['"]([^'"]+)['"]/);
  if (byName) return byName[1];
  const byPh = loc.match(/getByPlaceholder\(\s*['"]([^'"]+)['"]/);
  if (byPh) return byPh[1];
  return '';
}

/**
 * Filter the verified success trace down to the fields the SELECTED scenarios cover, so codegen writes
 * exactly the chosen flow. Credential (login) steps and every non-field action (goto, click, snapshot,
 * press) are always kept. When the selection covers all executable fields (or nothing is selected), the
 * full trace is returned unchanged. Returns { trace, coverageLabels } for the coverage gate.
 */
export function selectTraceForScenarios(
  trace: AgentStep[],
  scenarios: Scenario[],
  selectedIds: string[],
): { trace: AgentStep[]; coverageLabels: string[] } {
  const selected = scenarios.filter((s) => selectedIds.includes(s.id) && s.ready && !s.blocked);
  if (!selected.length) return { trace, coverageLabels: [] };
  const labels = new Set<string>();
  for (const s of selected) for (const l of s.coverage.fieldLabels) labels.add(coverageKey(l));
  const fieldTools = new Set(['fill', 'type', 'select', 'check', 'uncheck']);
  const filtered = trace.filter((step) => {
    if (!fieldTools.has(step.tool)) return true; // keep goto/click/press/snapshot/finish
    const val = String((step.args as { value?: string; text?: string })?.value ?? (step.args as { text?: string })?.text ?? '');
    if (val.includes('{{')) return true;         // keep credential (login) fills
    const label = traceStepFieldLabel(step);
    if (!label) return true;                       // unknown target — keep it (safer than dropping)
    return labels.has(coverageKey(label));
  });
  return { trace: filtered, coverageLabels: selected.flatMap((s) => s.coverage.fieldLabels) };
}
