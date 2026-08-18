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
import type { AgentStep } from './agent-loop';

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
  reusedFrom?: string[];
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
    return `${i + 1}. ${t.tool}${val ? ` "${val}"` : ''} → ${loc}${t.url ? `   [url: ${t.url}]` : ''}`;
  }).join('\n');
}

function buildPrompt(fw: string, job: CodegenJob, trace: AgentStep[]): string {
  const ex = readExemplars(fw);
  const wrappers = ['src/utils/Actions.ts', 'src/utils/WaitHelper.ts', 'src/utils/Logger.ts', 'src/utils/WorkflowActions.ts']
    .map((r) => wrapperSignatures(fw, r)).filter(Boolean).join('\n');
  const caps = loadCapabilities(fw);
  const types = (job.testTypes && job.testTypes.length) ? job.testTypes.join(', ') : 'positive (happy path)';
  return [
    `Generate Playwright test files for the feature "${job.feature}" at ${job.url}.`,
    `Cover these test types only: ${types}. Author at most ${job.maxCases || 3} test case(s).`,
    '',
    '## Verified live actions (HIGHEST-PRIORITY EVIDENCE — copy these EXACT locators verbatim)',
    renderTrace(trace),
    '',
    '## Reuse index (.ai-memory) — REUSE these before creating anything new; never duplicate',
    caps,
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
    '- DISAMBIGUATION: if a role/text locator matches MANY elements (tables, repeated rows, form fields with no distinct name), SCOPE from a stable parent (row/section/dialog/labelled group) and chain — e.g. locator(".oxd-input-group", { hasText: "Username" }).getByRole("textbox"). Do NOT add nth-child indexing. Use .nth() ONLY as an absolute last resort and add a `// reason:` comment explaining why no stable scope exists.',
    '- DROPDOWNS: detect from the live snapshot whether it is a native <select> (use Actions.selectOption) or a custom JS dropdown (React-select/MUI/PrimeNG/OXD — click-to-open then getByRole("option", { name }) via selectDropdownOption/searchAndSelectOption). Never assume one pattern.',
    '- IFRAMES/SHADOW DOM: if the target is inside an iframe or shadow root (per the snapshot), use frameLocator()/shadow-piercing correctly — never fall back to a wrong-scope locator. WAITING: rely on Playwright auto-waiting; never use fixed sleeps — only waitFor(state) for genuinely async/animated UI, with a `// reason:` note.',
    '- Every generated Page locator MUST be the EXACT one verified live during explore (the real echoed @playwright/cli locator that follows this priority), never a re-guessed selector.',
    '- Module = workflow methods using this.actions.* and this.logger.step(); construct its Page + Actions from the page in the constructor. Never put a raw locator or an assertion in a Module.',
    '- Spec = import { test, expect } from "../fixtures"; instantiate the new Module directly with the test\'s page, e.g. `const m = new <Feature>Module(page)`. Put all assertions here.',
    '- For login, the Module\'s login method takes (username, password); the spec passes credentials("app"). Do NOT hardcode credentials.',
    '- Reuse an existing Page/Module method from the reuse index when one already does the job.',
    '- ZERO hardcoded URLs (Pages, Modules AND specs). If src/config exposes a routes map + urlFor(path)/urlRegex(path), use urlFor(routes.X) for every goto() and urlRegex(routes.X) for every toHaveURL() assertion; otherwise use a RELATIVE path resolved by the configured baseURL. NEVER embed a full "https://host/..." literal in a module or spec.',
    '- SEQUENTIAL, APPEND-ONLY numbering: each spec file owns its own TC_001, TC_002… sequence. When a spec for this feature already exists, read the highest existing TC_XXX and number NEW cases from the next free number (existing TC_001–TC_003 → new TC_004); never renumber, reorder, or overwrite an existing test() block — append after them and return the FULL file with every existing test kept verbatim.',
    '- Reuse SHARED METHODS/HELPERS, not just locators. Use the shared WorkflowActions/Actions helpers for EVERY common interaction family instead of bespoke code: custom dropdown -> selectDropdownOption(trigger, optionText); searchable/autocomplete -> searchAndSelectOption(input, text, optionText?); native <select> -> Actions.selectOption; checkbox -> setCheckbox(target, checked); radio -> selectRadioOption(label); date field -> selectDate(input, value); table read -> readTableCell(table, rowText, colIndex); table row action -> clickInRow(table, rowText, controlName); table row checkbox -> setRowCheckbox(table, rowText, checked); search box -> searchWithOptionalSubmit. If a recurring interaction has no helper, add ONE generic method to WorkflowActions and reuse it; never inline a one-off or regenerate a near-duplicate. Reuse one helper for repeated flows (login/logout/common assertions) too.',
    '- TEST DATA: read every value via the testData accessor (never hardcode usernames/names/roles/expected text in a spec). Reuse an existing matching entry before adding a new one; only add genuinely-new keys, and for values needing uniqueness use a deterministic, traceable name (e.g. auto_user_tc004), not a random one-off. Keep every existing testData key.',
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
