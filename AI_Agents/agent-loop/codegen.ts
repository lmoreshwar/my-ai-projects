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
import { deriveLocatorScopeHint, type AgentStep, type LocatorScopeHint } from './agent-loop';

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

/** Pull public method signatures from a wrapper util so the model calls only real methods. */
function wrapperSignatures(fw: string, rel: string): string {
  const src = safeRead(join(fw, rel));
  if (!src) return '';
  const sigs: string[] = [];
  const re = /^\s*(?:public\s+)?(?:async\s+)?([a-zA-Z_]\w*)\s*\(([^)]*)\)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (['constructor', 'if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1])) continue;
    sigs.push(`${m[1]}(${m[2].replace(/\s+/g, ' ').trim()})`);
  }
  return sigs.length ? `${rel}: ${[...new Set(sigs)].join('; ')}` : '';
}

/** Read one representative Page/Module/Spec so generated files match the repo's exact style. */
function readExemplars(fw: string): { page: string; module: string; spec: string } {
  const pick = (dir: string, prefer: RegExp): string => {
    const d = join(fw, dir);
    if (!existsSync(d)) return '';
    const files = readdirSync(d).filter((f) => f.endsWith('.ts'));
    const chosen = files.find((f) => prefer.test(f)) || files[0];
    return chosen ? safeRead(join(d, chosen)) : '';
  };
  return {
    page: pick('src/pages', /login/i),
    module: pick('src/modules', /login/i),
    spec: pick('src/tests', /login/i),
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
  const wrappers = ['src/utils/Actions.ts', 'src/utils/WaitHelper.ts', 'src/utils/Logger.ts', 'src/utils/WorkflowActions.ts']
    .map((r) => wrapperSignatures(fw, r)).filter(Boolean).join('\n');
  const caps = loadCapabilities(fw);
  const types = (job.testTypes && job.testTypes.length) ? job.testTypes.join(', ') : 'positive (happy path)';
  const prepopulated = prepopulatedFieldLabels(trace);
  return [
    `Generate Playwright test files for the feature "${job.feature}" at ${job.url}.`,
    `Cover these test types only: ${types}. Author at most ${job.maxCases || 3} test case(s).`,
    '',
    '## Verified live actions (HIGHEST-PRIORITY EVIDENCE — copy non-positional locators verbatim; an AMBIGUOUS scope hint overrides a positional CLI echo)',
    renderTrace(trace),
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
    '## Wrapper API contract (call ONLY these methods; never invent a wrapper method)',
    wrappers || '(no wrapper utils found)',
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
    '- DROPDOWNS: detect from the live snapshot whether it is a native <select> (use Actions.selectOption) or a custom JS dropdown (React-select/MUI/PrimeNG/OXD — click-to-open then getByRole("option", { name }) via selectDropdownOption/searchAndSelectOption). Never assume one pattern.',
    '- IFRAMES/SHADOW DOM: if the target is inside an iframe or shadow root (per the snapshot), use frameLocator()/shadow-piercing correctly — never fall back to a wrong-scope locator. WAITING: rely on Playwright auto-waiting; never use fixed sleeps — only waitFor(state) for genuinely async/animated UI, with a `// reason:` note.',
    '- Every generated Page locator MUST be based on the verified live explore evidence. Copy a non-positional echoed locator verbatim. When an action has an [AMBIGUOUS ...] scope hint, use its exact supplied locator instead of the CLI echo (which may use .first(), .last(), or .nth()). Never re-guess a locator.',
    '- Module = workflow methods using this.actions.* and this.logger.step(); construct its Page + Actions from the page in the constructor. Never put a raw locator or an assertion in a Module.',
    '- Spec = import { test, expect } from "../fixtures"; instantiate the new Module directly with the test\'s page, e.g. `const m = new <Feature>Module(page)`. Put all assertions here.',
    '- For login, the Module\'s login method takes (username, password); the spec passes credentials("app"). Do NOT hardcode credentials.',
    '- Reuse an existing Page/Module method from the reuse index when one already does the job.',
    '- ZERO hardcoded URLs (Pages, Modules AND specs). If src/config exposes a routes map + urlFor(path)/urlRegex(path), use urlFor(routes.X) for every goto() and urlRegex(routes.X) for every toHaveURL() assertion AND every waitForURL() navigation wait; otherwise use a RELATIVE path resolved by the configured baseURL. NEVER embed a full "https://host/..." literal NOR a raw inline URL regex (e.g. /\\/web\\/index\\.php\\/pim\\/.../ ) in a module or spec — a navigation wait on a dynamic landing path MUST use urlRegex(routes.X) on the stable prefix route.',
    '- NEW ROUTES: if you reference a routes.X key that is NOT already listed in the Route map above, you MUST also return it in a top-level "routes" object mapping that key to its VERIFIED RELATIVE path taken from the trace url (e.g. "pimAddEmployee": "/web/index.php/pim/addEmployee"). Every routes.X you reference must either already exist or be returned in "routes" — an undefined route fails the build.',
    '- URL ASSERTIONS: assert the ACTUAL post-action landing URL observed in the trace (the FINAL step\'s [url: ...]), not the form/origin URL. If that landing path contains a DYNAMIC segment (numeric id, hash, empNumber/245, uuid), assert urlRegex on the STABLE PREFIX route (e.g. urlRegex(routes.pimViewPersonalDetails)) — never assert an exact URL that embeds a run-specific id.',
    '- SEQUENTIAL, APPEND-ONLY numbering: each spec file owns its own TC_001, TC_002… sequence. When a spec for this feature already exists, read the highest existing TC_XXX and number NEW cases from the next free number (existing TC_001–TC_003 → new TC_004); never renumber, reorder, or overwrite an existing test() block — append after them and return the FULL file with every existing test kept verbatim.',
    '- Reuse SHARED METHODS/HELPERS, not just locators. Use the shared WorkflowActions/Actions helpers for EVERY common interaction family instead of bespoke code: custom dropdown -> selectDropdownOption(trigger, optionText); searchable/autocomplete -> searchAndSelectOption(input, text, optionText?); native <select> -> Actions.selectOption; checkbox -> setCheckbox(target, checked); radio -> selectRadioOption(label); date field -> selectDate(input, value); table read -> readTableCell(table, rowText, colIndex); table row action -> clickInRow(table, rowText, controlName); table row checkbox -> setRowCheckbox(table, rowText, checked); search box -> searchWithOptionalSubmit. If NONE of the existing helpers fits a new interaction, implement it as a parameterized METHOD ON THE NEW MODULE (workflow logic belongs in the Module) — NEVER inline interaction logic in the spec, and NEVER call or invent a WorkflowActions/Actions method that is not already in the Wrapper API contract (the shared utils are a FIXED API on this path; this JSON output cannot emit a modified util file). Reuse one helper for repeated flows (login/logout/common assertions) too.',
    '- TEST DATA: read every value via the testData accessor (never hardcode usernames/names/roles/expected text in a spec). Reuse an existing matching entry before adding a new one; only add genuinely-new keys. Keep every existing testData key.',
    '- APP-PREPOPULATED FIELDS: every field listed in the App-prepopulated fields section is an application-owned default. Do NOT create a Page locator for it, add testData for it, fill/clear/type it, include it in uniqueFields, or assert its literal value. Leave it untouched unless the approved test case explicitly requests custom entry.',
    '- UNIQUE CONSTRAINTS: identifiers, usernames, email addresses, codes, references, and record numbers must NEVER use a fixed final value. Store only a readable seed in testData, import uniqueValue from "../utils/UniqueData" (add retryOnCollision only in mode B below), and generate a FRESH value for EACH submit via uniqueValue(seed, { kind, length }). TWO modes: (A) DEFAULT — if the live trace NEVER showed an inline duplicate/"already exists" validation for the field, just fill the fresh uniqueValue() and Save (NO retry, NO collision locator); return a uniqueFields descriptor with only testDataPath+kind (+length) and OMIT collisionPageField/collisionMessage. (B) COLLISION RETRY — ONLY when the live trace ACTUALLY exposed an inline collision validation for the field, wrap the submit in retryOnCollision({ page: this.page, successUrl: urlRegex(routes.X), collision: this.<page>.collisionLocator, makeValue: () => uniqueValue(seed, { kind, length }), submit: async (value) => { fill the field with value; click Save; }, collisionMessage }); the Page MUST expose that exact live collision locator, retry ONLY when it appears (all other errors/timeouts fail), and do NOT add a second waitForURL after the helper. Return one uniqueFields descriptor per unique field so codegen can enforce this contract.',
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
    '  "routes": { <NEW routes.X keys → verified relative path (e.g. "pimAddEmployee": "/web/index.php/pim/addEmployee"), or omit if none are new> },',
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

const UNIQUE_DATA_UTILITY_SOURCE = [
  "import { type Locator, type Page } from '@playwright/test';",
  "import { TIMEOUTS } from './constants';",
  '',
  "export type UniqueValueKind = 'numeric' | 'alphanumeric' | 'email';",
  '',
  'let sequence = 0;',
  '',
  'export function uniqueValue(seed: string, options: { kind?: UniqueValueKind; length?: number } = {}): string {',
  '  sequence += 1;',
  "  const kind = options.kind ?? 'alphanumeric';",
  '  const token = `${Date.now()}${sequence}`;',
  '  const length = Math.max(1, options.length ?? 8);',
  "  if (kind === 'numeric') return token.replace(/\\D/g, '').slice(-(options.length ?? 7));",
  "  if (kind === 'email') {",
  "    const [localPart = 'auto', domain = 'example.test'] = seed.trim().split('@');",
  "    return `${localPart || 'auto'}+${token.slice(-length)}@${domain || 'example.test'}`;",
  '  }',
  "  const prefix = seed.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'auto';",
  '  return `${prefix}-${token.slice(-length)}`;',
  '}',
  '',
  'export async function retryOnCollision(options: {',
  '  page: Page;',
  '  successUrl: string | RegExp;',
  '  collision: Locator;',
  '  makeValue: () => string;',
  '  submit: (value: string) => Promise<void>;',
  '  attempts?: number;',
  '  timeout?: number;',
  '  collisionMessage?: string;',
  '}): Promise<string> {',
  '  const attempts = Math.max(1, options.attempts ?? 3);',
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
  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [
      { role: 'system', content: 'You are a senior Playwright/TypeScript engineer. Reuse existing framework code, copy proven locators verbatim, and reply with STRICT JSON only.' },
      { role: 'user', content: buildPrompt(fw, job, trace) },
    ],
    temperature: 0,
  };
  applyReasoning(params);
  const completion = await client.chat.completions.create(params);

  const raw = completion.choices[0]?.message?.content || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Codegen: model did not return JSON.');
  let art: LlmArtifacts;
  try { art = JSON.parse(match[0]); } catch (e) { throw new Error(`Codegen: invalid JSON (${(e as Error).message}).`); }
  if (!art.page?.content || !art.module?.content || !art.spec?.content) {
    throw new Error('Codegen: reply missing page/module/spec content.');
  }
  assertNoPositionalPageLocators(art.page.file || 'generated Page', art.page.content);
  assertPrepopulatedFieldsUntouched(art, trace);
  assertUniqueFieldsHandled(art);

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
