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
import { join } from 'node:path';
import OpenAI from 'openai';
import { deriveLocatorScopeHint, type AgentStep, type LocatorScopeHint, type InteractionEvidence } from './agent-loop';
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

/** Locate and parse the `export const routes = { ... } as const;` map so we know which routes exist. */
function readRoutesBlock(fw: string): { file: string; body: string; keys: Set<string> } | null {
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

  async goto(): Promise<void> {
    this.logger.step(1, 'Open the login page');
    await this.actions.navigate(urlFor(routes.login), { readyElement: this.loginPage.usernameInput() });
  }

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
  test('TC_001 valid credentials reach the app @SampleLogin @Smoke @Regression', async ({ page }) => {
    const loginModule = new SampleLoginModule(page);
    const { username, password } = credentials('app');
    await loginModule.goto();
    await loginModule.login(username, password);
    await expect(page).toHaveURL(urlRegex(routes.inventory));
  });
});
`;

/** Whether the framework already has a reusable login Module and/or a registered login fixture. */
function loginAssets(fw: string): { hasLoginModule: boolean; loginFixture: string | null } {
  let hasLoginModule = false;
  const modulesDir = join(fw, 'src/modules');
  if (existsSync(modulesDir)) {
    hasLoginModule = readdirSync(modulesDir).some((f) => /login/i.test(f) && f.endsWith('Module.ts'));
  }
  let loginFixture: string | null = null;
  const fixturesSrc = safeRead(join(fw, 'src/fixtures/index.ts'));
  for (const m of fixturesSrc.matchAll(/^\s*(\w+)\s*:\s*async\s*\(/gm)) {
    if (/login/i.test(m[1])) { loginFixture = m[1]; break; }
  }
  return { hasLoginModule, loginFixture };
}

/**
 * Build the SHARED LOGIN rule for the prompt from what ACTUALLY exists in the framework, so codegen
 * never tells the model to use a `loginModule` fixture that was never registered (the exact
 * "unknown parameter" crash on a reset repo). Three cases: a registered login fixture -> destructure
 * it; a LoginModule class but no fixture -> instantiate it; neither -> generate login from scratch.
 */
function loginGuidanceFor(fw: string): string {
  const { hasLoginModule, loginFixture } = loginAssets(fw);
  if (loginFixture) {
    return `- SHARED LOGIN: a '${loginFixture}' fixture IS registered - destructure it (async ({ page, ${loginFixture} }) => ...) and log in in test.beforeEach (${loginFixture}.goto() + ${loginFixture}.login(credentials("app"))). Feature navigation stays in the feature Module.goto() inside each test.`;
  }
  if (hasLoginModule) {
    return '- SHARED LOGIN: a LoginModule exists but is NOT a registered fixture - instantiate it in the beforeEach/test body (const loginModule = new LoginModule(page)) and call loginModule.goto() + loginModule.login(credentials("app")). NEVER destructure a `loginModule` fixture (it is not registered).';
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
    const scopeHint: LocatorScopeHint | undefined = t.scopeHint
      || (positionalLocator ? deriveLocatorScopeHint(t.context || '', String(t.args?.ref || ''), true) : undefined);
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

function prepopulatedFieldLabels(trace: AgentStep[]): string[] {
  return [...new Set(trace.flatMap((step) => step.prepopulatedFields || []).map((field) => field.label).filter(Boolean))];
}

interface PrepopulatedEntry { label: string; value: string; kind?: string; }

/** Every prepopulated field captured across the trace, unique by label, with its kind + real value. */
function prepopulatedFieldEntries(trace: AgentStep[]): PrepopulatedEntry[] {
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
  const loginGuidance = loginGuidanceFor(fw);
  const types = (job.testTypes && job.testTypes.length) ? job.testTypes.join(', ') : 'positive (happy path)';
  const prepopulated = prepopulatedFieldLabels(trace);
  return [
    `Generate Playwright test files for the feature "${job.feature}" at ${job.url}.`,
    `Cover these test types only: ${types}. Author at most ${job.maxCases || 3} test case(s).`,
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
    '## Route map (src/config routes) — REUSE an existing routes.X; only add a genuinely-new one',
    routesContext(fw),
    '',
    '## Unique-value API (available at ../utils/UniqueData)',
    'uniqueValue(seed, { kind: "numeric" | "alphanumeric" | "email", length? }) creates a new value per attempt.',
    'retryOnCollision({ page, successUrl, collision, makeValue, submit, attempts?, collisionMessage? }) retries ONLY when the live collision locator becomes visible; it returns on success URL and rethrows every other timeout/error.',
    '',
    '## App-prepopulated fields (initial live form snapshot)',
    prepopulated.length ? `${prepopulated.join(', ')} — the application already supplied their values before any agent interaction.` : '(none observed)',
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
    '- DROPDOWNS: detect from the live snapshot whether it is a native <select> (use this.actions.selectOption) or a custom JS dropdown (React-select/MUI/PrimeNG/OXD — click-to-open then getByRole("option", { name }) via this.workflowActions.selectDropdownOption / this.workflowActions.searchAndSelectOption). Never assume one pattern.',
    '- IFRAMES/SHADOW DOM: if the target is inside an iframe or shadow root (per the snapshot), use frameLocator()/shadow-piercing correctly — never fall back to a wrong-scope locator. WAITING: rely on Playwright auto-waiting; never use fixed sleeps — only waitFor(state) for genuinely async/animated UI, with a `// reason:` note.',
    '- Every generated Page locator MUST be based on the verified live explore evidence. Copy a non-positional echoed locator verbatim. When an action has an [AMBIGUOUS ...] scope hint, use its exact supplied locator instead of the CLI echo (which may use .first(), .last(), or .nth()). Never re-guess a locator.',
    '- Module = workflow methods that call ONLY the wrapper properties + methods listed in the Wrapper API contract above, each on its OWN property (this.actions.* for primitive interactions, this.workflowActions.* for shared interaction helpers, this.waitHelper.* for waits, this.logger.* for logging). CONSTRUCT every wrapper you call in the constructor from the page (e.g. this.actions = new Actions(page); this.workflowActions = new WorkflowActions(page); this.waitHelper = new WaitHelper(page)) — only the ones you actually use. A method listed under one wrapper does NOT exist on another: calling a WorkflowActions helper on this.actions crashes at runtime with "is not a function". Never put a raw locator or an assertion in a Module.',
    '- Spec = import { test, expect } from "../fixtures"; instantiate the new Module directly with the test\'s page, e.g. `const m = new <Feature>Module(page)`. Put all assertions here.',
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
    '- APP-PREPOPULATED FIELDS: every field listed in the App-prepopulated fields section is an application-owned default. Do NOT create a Page locator for it, add testData for it, fill/clear/type it, include it in uniqueFields, or assert its literal value. Leave it untouched unless the approved test case explicitly requests custom entry.',
    '- UNIQUE CONSTRAINTS: identifiers, usernames, email addresses, codes, references, and record numbers must NEVER use a fixed final value. Store only a readable seed in testData, import uniqueValue from "../utils/UniqueData" (add retryOnCollision only in mode B below), and generate a FRESH value for EACH submit via uniqueValue(seed, { kind, length }). TWO modes: (A) DEFAULT — if the live trace NEVER showed an inline duplicate/"already exists" validation for the field, just fill the fresh uniqueValue() and Save (NO retry, NO collision locator); return a uniqueFields descriptor with only testDataPath+kind (+length) and OMIT collisionPageField/collisionMessage. (B) COLLISION RETRY — ONLY when the live trace ACTUALLY exposed an inline collision validation for the field, wrap the submit in retryOnCollision({ page: this.page, successUrl: urlRegex(routes.X), collision: this.<page>.collisionLocator, makeValue: () => uniqueValue(seed, { kind, length }), submit: async (value) => { fill the field with value; click Save; }, collisionMessage }); the Page MUST expose that exact live collision locator, retry ONLY when it appears (all other errors/timeouts fail), and do NOT add a second waitForURL after the helper. Return one uniqueFields descriptor per unique field so codegen can enforce this contract. HARD REQUIREMENT: every uniqueFields entry you declare MUST have a matching uniqueValue(seed, { kind, length }) call AND an `import { uniqueValue } from "../utils/UniqueData"` in the Module that actually fills that field — declaring a uniqueFields descriptor without wiring uniqueValue() into the Module is REJECTED; if you truly cannot make a field fresh, drop its uniqueFields entry entirely rather than leaving it unimplemented.',
    '- TAGS — industry standard, stacked in the test() title: a feature/module tag in PascalCase (e.g. @AdminAddUser) PLUS suite tags — @Smoke on the primary happy-path case, @Regression on ALL cases. Do NOT use @Positive/@Negative. Match the domain naming already used in the repo.',
    '- TEST INDEPENDENCE: every test() runs STANDALONE (a case may be run individually via grep). Each test does its OWN login + navigation (prefer test.beforeEach for shared setup) and never depends on state left by a sibling test.',
    '- CLEAN CODE: match the exemplars\' indentation, no unused imports, no dead code, no duplicated boilerplate that belongs in a shared helper. One short comment only above a non-obvious step.',
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
function mergeRoutes(fw: string, additions?: Record<string, string>): string | null {
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
 * Fail fast (before verifySpec) if a generated file references routes.X that is not defined in the
 * config routes map — turns the cryptic runtime `Cannot read properties of undefined (reading
 * 'startsWith')` into a clear build error naming the missing route.
 */
function assertRoutesDefined(fw: string, files: string[]): void {
  const rb = readRoutesBlock(fw); // re-read AFTER mergeRoutes so freshly-added keys count as defined
  if (!rb) return; // this framework has no routes map — nothing to validate
  const missing = new Map<string, string>();
  for (const rel of files) {
    if (!rel.endsWith('.ts')) continue;
    const src = safeRead(join(fw, rel));
    for (const m of src.matchAll(/\broutes\.([A-Za-z_]\w*)/g)) {
      if (!rb.keys.has(m[1]) && !missing.has(m[1])) missing.set(m[1], rel);
    }
  }
  if (missing.size) {
    const lines = [...missing].map(([key, rel]) => `route '${key}' is referenced in ${rel} but not defined in ${rb.file} routes`);
    throw new Error(`Codegen: undefined route reference(s):\n  - ${lines.join('\n  - ')}\nAdd the missing key(s) to the routes map (the model must return them in the "routes" field).`);
  }
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldIdentifier(label: string): string {
  const words = label.match(/[a-zA-Z0-9]+/g) || [];
  return words.map((word, index) => index === 0 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`).join('');
}

/** App-created defaults are evidence, not test input; reject any generated interaction with them. */
function assertPrepopulatedFieldsUntouched(art: LlmArtifacts, trace: AgentStep[]): void {
  const generated = [
    art.page.content,
    art.module.content,
    art.spec.content,
    JSON.stringify(art.testData || {}),
    JSON.stringify(art.uniqueFields || []),
  ].join('\n');
  for (const label of prepopulatedFieldLabels(trace)) {
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
  for (const { label, value, kind } of prepopulatedFieldEntries(trace)) {
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

function assertUniqueFieldsHandled(art: LlmArtifacts): void {
  const likelyUniquePaths = collectLikelyUniqueDataPaths(art.testData);
  const fields = art.uniqueFields || [];
  const plannedPaths = new Set(fields.map((field) => field.testDataPath.replace(/^testData\./, '')));
  const missingPlans = likelyUniquePaths.filter((path) => !plannedPaths.has(path));
  if (missingPlans.length) {
    throw new Error(`Codegen: static value(s) for unique field(s) ${missingPlans.join(', ')} require a uniqueFields descriptor and retryOnCollision handling.`);
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
 * Automation-Trace coverage gate. `coverageFields` lists the EXECUTABLE Automation Trace steps the
 * approved scenario exercises — feature controls only, never the discovery inventory and never blocked
 * (e.g. upload) steps. This gate rejects a reply that silently drops any executable trace step: the
 * generated Page+Module+Spec together must reference each one (by its label appearing in a
 * getByLabel/getByRole locator, a method name, a testData key, or plain text). Coverage is measured
 * against trace steps, NOT discovered controls, so unrelated navigation can never fail codegen. No
 * selection = legacy behaviour (gate is a no-op).
 */
function assertTraceCoverage(art: LlmArtifacts, coverageFields?: string[]): void {
  if (!coverageFields || !coverageFields.length) return;
  const haystack = coverageKey([art.page.content, art.module.content, art.spec.content, JSON.stringify(art.testData || {})].join('\n'));
  const missing = coverageFields.filter((label) => {
    const key = coverageKey(label);
    return key.length >= 2 && !haystack.includes(key);
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

  // Parse the reply and run EVERY in-memory quality gate. Throws one clear message the model can repair against.
  const parseAndValidate = (raw: string): LlmArtifacts => {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Codegen: model did not return JSON.');
    let candidate: LlmArtifacts;
    try { candidate = JSON.parse(match[0]); } catch (e) { throw new Error(`Codegen: invalid JSON (${(e as Error).message}).`); }
    if (!candidate.page?.content || !candidate.module?.content || !candidate.spec?.content) {
      throw new Error('Codegen: reply missing page/module/spec content.');
    }
    assertNoPositionalPageLocators(candidate.page.file || 'generated Page', candidate.page.content);
    assertNavigationUrlContract([
      { file: candidate.page.file || 'Page', content: candidate.page.content },
      { file: candidate.module.file || 'Module', content: candidate.module.content },
      { file: candidate.spec.file || 'Spec', content: candidate.spec.content },
    ]);
    assertSingleNavigationPath({ file: candidate.spec.file || 'Spec', content: candidate.spec.content });
    assertPrepopulatedFieldsUntouched(candidate, trace);
    assertUniqueFieldsHandled(candidate);
    assertNoUndefinedFixtures(fw, candidate);
    assertTraceCoverage(candidate, job.coverageFields);
    assertWrapperMethodsExist(fw, [
      { file: candidate.page.file || 'Page', content: candidate.page.content },
      { file: candidate.module.file || 'Module', content: candidate.module.content },
      { file: candidate.spec.file || 'Spec', content: candidate.spec.content },
    ]);
    assertProvenInteractionLocators([
      { file: candidate.page.file || 'Page', content: candidate.page.content },
      { file: candidate.module.file || 'Module', content: candidate.module.content },
      { file: candidate.spec.file || 'Spec', content: candidate.spec.content },
    ], trace);
    return candidate;
  };

  // Self-repair loop: when a quality gate rejects the reply, feed the exact rejection back and let the
  // model correct its own output. Generic — this covers positional locators, prepopulated fields,
  // unique fields, and any future in-memory gate, instead of hand-patching one case.
  const MAX_CODEGEN_ATTEMPTS = 3;
  let art: LlmArtifacts | undefined;
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_CODEGEN_ATTEMPTS; attempt++) {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = { model, messages, temperature: 0 };
    applyReasoning(params);
    const completion = await client.chat.completions.create(params);
    const raw = completion.choices[0]?.message?.content || '';
    try {
      art = parseAndValidate(raw);
      if (attempt > 1) log(`[codegen] repair succeeded on attempt ${attempt}/${MAX_CODEGEN_ATTEMPTS}.`);
      break;
    } catch (e) {
      lastError = (e as Error).message;
      if (attempt === MAX_CODEGEN_ATTEMPTS) throw new Error(`${lastError} (unresolved after ${MAX_CODEGEN_ATTEMPTS} codegen attempts)`);
      log(`[codegen] quality gate rejected attempt ${attempt}/${MAX_CODEGEN_ATTEMPTS}: ${lastError} — asking the model to repair…`);
      messages.push({ role: 'assistant', content: raw });
      messages.push({ role: 'user', content: [
        'Your previous reply was REJECTED by an automated quality gate:',
        '',
        lastError,
        '',
        'Fix ONLY this problem and re-emit the COMPLETE corrected artifact as STRICT JSON',
        '(all of page/module/spec plus testData/routes/uniqueFields as needed), keeping every other',
        'file and locator exactly as before. No prose, no markdown fences.',
      ].join('\n') });
    }
  }
  if (!art) throw new Error(lastError || 'Codegen: no usable reply.');

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
  // Fail fast BEFORE verifySpec: every routes.X in a generated file must now be defined in config.
  assertRoutesDefined(fw, files);

  log(`[codegen] Wrote ${files.length} file(s). Refreshing capability index…`);
  await refreshIndex(fw);
  log('[codegen] Capability index refreshed (.ai-memory written back).');

  return { domain: art.domain || feat.toLowerCase(), files, reusedExisting: !!(art.reusedFrom && art.reusedFrom.length) };
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

/** Legacy PlanCase projection of the richer scenarios, so older clients still render a plan list. */
export function scenariosToCases(scenarios: Scenario[]): PlanCase[] {
  return scenarios.map((s) => ({
    id: s.id, title: s.title, type: s.type,
    steps: s.steps.map((st) => `${st.order}. ${st.action}${st.input ? ` — ${st.input}` : ''}`),
    expectedResults: s.expectedResults,
  }));
}

/** Best-effort: which field label did a trace fill/select/check step target? (for trace filtering) */
function traceStepFieldLabel(step: AgentStep): string {
  if (step.scopeHint?.label) return step.scopeHint.label;
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
