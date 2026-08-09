/**
 * local_agent.js — Local automation provider for B.L.A.S.T. (no paid Copilot).
 *
 * B.L.A.S.T. becomes the "brain": it uses the configured LLM (Groq/Gemini/Ollama
 * via llm_connector) to generate the strict 3-layer Playwright code (Page/Module/
 * Spec) grounded on the framework's AGENT.md + capabilities index + existing files,
 * writes them into the framework repo, runs Playwright locally, and does ONE
 * self-heal round on failure. The framework's own SmartLocator handles runtime
 * healing; semantic locators keep specs robust.
 *
 * Configuration (env — never commit secrets):
 *   FRAMEWORK_PATH   absolute path to the AI Native Playwright Framework repo
 *   LLM_PLATFORM     groq | gemini | grok | openai | ollama  (default groq)
 *   LLM_API_KEY      API key for the platform (not needed for ollama)
 *   LLM_MODEL        optional model override
 *   LLM_ENDPOINT     optional (ollama base URL)
 *   AUTOMATION_PROVIDER=local  to force this provider
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const LLMConnector = require('./llm_connector');

const RUN_TIMEOUT_MS = Number(process.env.LOCAL_RUN_TIMEOUT_MS || 300000);
const FILE_RE = /===FILE:([^|=]+)\|(page|module|spec|fixture|config|other)===\s*\n([\s\S]*?)\n===ENDFILE===/g;

// Sensible default model per platform when none is configured for that platform.
const DEFAULT_MODEL = {
  groq: 'openai/gpt-oss-120b',
  gemini: 'gemini-2.5-flash',
  grok: 'grok-2',
  openai: 'gpt-4o',
  nvidia: 'nvidia/nemotron-3-super-120b-a12b',
  ollama: 'llama3',
};

// Does a model name belong to the given platform? Used to ignore a stale LLM_MODEL
// left over from a different platform (e.g. a llama model while switching to gemini).
function modelMatchesPlatform(model, platform) {
  const m = (model || '').toLowerCase();
  if (!m) return false;
  switch (platform) {
    case 'gemini': return m.startsWith('gemini');
    case 'groq': return /(llama|mixtral|gemma|qwen|deepseek|gpt-oss)/.test(m);
    case 'grok': return m.startsWith('grok');
    case 'nvidia': return m.startsWith('nvidia/') || /nemotron/.test(m);
    case 'openai': return /^(gpt|o1|o3|chatgpt)/.test(m);
    case 'ollama': return true;
    default: return false;
  }
}

function config() {
  const platform = (process.env.LLM_PLATFORM || 'groq').toLowerCase();

  // Prefer a platform-specific key so multiple providers can coexist in .env;
  // fall back to the generic LLM_API_KEY.
  const keyByPlatform = {
    groq: process.env.GROQ_API_KEY,
    gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    grok: process.env.GROK_API_KEY || process.env.XAI_API_KEY,
    nvidia: process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY,
    openai: process.env.OPENAI_API_KEY,
  };
  const apiKey = keyByPlatform[platform] || process.env.LLM_API_KEY || '';

  // Prefer a platform-specific model; then a generic LLM_MODEL but only if it
  // actually belongs to this platform; otherwise the platform default.
  const modelByPlatform = {
    groq: process.env.GROQ_MODEL,
    gemini: process.env.GEMINI_MODEL,
    grok: process.env.GROK_MODEL,
    nvidia: process.env.NVIDIA_MODEL,
    openai: process.env.OPENAI_MODEL,
  };
  let model = modelByPlatform[platform] || '';
  if (!model) {
    const generic = process.env.LLM_MODEL || '';
    model = modelMatchesPlatform(generic, platform) ? generic : (DEFAULT_MODEL[platform] || '');
  }

  return {
    frameworkPath: process.env.FRAMEWORK_PATH || '',
    platform,
    apiKey,
    model,
    endpoint: process.env.LLM_ENDPOINT || '',
  };
}

function isConfigured() {
  const { frameworkPath, platform, apiKey } = config();
  if (!frameworkPath || !fs.existsSync(frameworkPath)) return false;
  return platform === 'ollama' ? true : Boolean(apiKey);
}

function safeRead(absPath, maxChars = 8000) {
  try {
    const text = fs.readFileSync(absPath, 'utf8');
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n/* …trimmed… */` : text;
  } catch {
    return '';
  }
}

function firstMatchingFile(dir, suffix) {
  try {
    const found = fs.readdirSync(dir).find((f) => f.endsWith(suffix));
    return found ? path.join(dir, found) : '';
  } catch {
    return '';
  }
}

/**
 * Map a UI skill label to its framework skill folder + a short tag. Selecting a
 * skill in the UI now actually drives which SKILL.md grounds the agent AND which
 * behavior mode it runs in (new / modify / debug / heal / visual).
 */
const SKILL_MAP = {
  'New Automation': { key: 'new', dir: 'pw-new-automation', tag: 'pw-new-automation' },
  'Modify Automation': { key: 'modify', dir: 'pw-modify-test', tag: 'pw-modify-test' },
  'Debug': { key: 'debug', dir: 'pw-debug-failure', tag: 'pw-debug-failure' },
  'Self Healing': { key: 'heal', dir: 'pw-self-healing', tag: 'pw-self-healing' },
  'Visual Testing': { key: 'visual', dir: 'pw-visual-testing', tag: 'pw-visual-testing' },
};

/** Resolve the active skill for a job (defaults to New Automation). */
function resolveSkill(job) {
  return SKILL_MAP[(job && job.skill) || 'New Automation'] || SKILL_MAP['New Automation'];
}

// Groq free tier caps ~8K tokens/minute; a rich prompt + re-sent existing files
// blows that budget, so low-TPM providers get a lean grounding.
const LOW_TPM_PLATFORMS = new Set(['groq']);

/** Read framework grounding: rules, persona, skills, reuse index, and real exemplars. */
function readGrounding(fw, job) {
  const active = resolveSkill(job);
  const lean = LOW_TPM_PLATFORMS.has(config().platform);
  const b = lean
    ? { agent: 2200, persona: 1200, skill: 1700, heal: 0, caps: 2500, ex: 1400, spec: 1600, data: 900, fix: 1100, smart: 0 }
    : { agent: 6000, persona: 2500, skill: 4500, heal: 2000, caps: 4000, ex: 3000, spec: 3500, data: 2500, fix: 3000, smart: 1400 };
  return {
    agent: safeRead(path.join(fw, 'AGENT.md'), b.agent),
    persona: safeRead(firstMatchingFile(path.join(fw, '.github', 'agents'), '.agent.md'), b.persona),
    activeSkill: active,
    skillActive: safeRead(path.join(fw, '.github', 'skills', active.dir, 'SKILL.md'), b.skill),
    skillHeal: b.heal ? safeRead(path.join(fw, '.github', 'skills', 'pw-self-healing', 'SKILL.md'), b.heal) : '',
    capabilities: safeRead(path.join(fw, '.ai-memory', 'capabilities.json'), b.caps),
    pageEx: safeRead(firstMatchingFile(path.join(fw, 'src', 'pages'), 'Page.ts'), b.ex),
    moduleEx: safeRead(firstMatchingFile(path.join(fw, 'src', 'modules'), 'Module.ts'), b.ex),
    specEx: safeRead(firstMatchingFile(path.join(fw, 'src', 'tests'), '.spec.ts'), b.spec),
    testData: safeRead(path.join(fw, 'src', 'testdata', 'testData.json'), b.data),
    fixtures: safeRead(path.join(fw, 'src', 'fixtures', 'index.ts'), b.fix),
    smartLocator: b.smart ? safeRead(path.join(fw, 'src', 'utils', 'SmartLocator.ts'), b.smart) : '',
  };
}

function testCaseBlock(job) {
  return (job.testCases || [])
    .map((tc) => `- [${tc.id}] ${tc.title || ''}${tc.tags ? ` (tags: ${tc.tags})` : ''}`)
    .join('\n');
}

/** Derive a PascalCase domain name from the first test case's primary tag. */
function domainName(job) {
  const primary = ((job.testCases || [])[0]?.tags || 'App').split(',')[0].trim() || 'App';
  return primary.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'App';
}

/** PascalCase a spec basename ("add-to-cart" → "AddToCart", "login" → "Login"). */
function pascal(base) {
  return String(base || 'App').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'App';
}

/** Normalize free text for robust title matching (lowercase, alphanumerics + single spaces). */
function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Does the spec already cover this case? Matched by the case's distinctive TITLE.
 * TC ids (TC_001…) are NOT globally unique — different features reuse the same
 * numbering — so the id alone must NEVER count as a match (that wrongly maps a new
 * Product-Detail TC_001 onto Login's TC_001). Title match only; if the title is
 * missing/too short to be distinctive, treat as NOT covered (safer to regenerate;
 * the duplicate-id guard + non-destructive write still protect existing coverage).
 */
function idInText(text, tc) {
  const title = normalizeText(tc.title);
  if (title.length < 6) return false;
  return normalizeText(text).includes(title);
}

/** The title text the spec itself attaches to a given case id, e.g. `test('TC_009 UI Validation …'`. */
function specTitleForId(specText, id) {
  const esc = String(id || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = specText.match(new RegExp(`test\\s*\\(\\s*['"\`]\\s*${esc}\\b([^'"\`]*)`, 'i'));
  return m ? m[1] : '';
}

/** Fraction of the requested title's significant tokens that appear in the spec's title for that id. */
function titleOverlap(requested, specTitle) {
  const want = normalizeText(requested).split(' ').filter((w) => w.length >= 3);
  if (!want.length) return 0;
  const have = new Set(normalizeText(specTitle).split(' ').filter((w) => w.length >= 3));
  return want.filter((w) => have.has(w)).length / want.length;
}

/**
 * Coverage check scoped to an ALREADY-RESOLVED domain spec. A case counts as covered
 * only when it is the SAME test — never on a bare id collision. TC ids (TC_009…) are
 * NOT globally unique, so a shared id with a DIFFERENT title (e.g. the spec's TC_009
 * "UI Validation" vs a requested TC_009 "SQL injection in username") must NOT be
 * reported as already automated. Matched when the distinctive title appears verbatim,
 * OR the id is present AND the spec's own title for that id substantially overlaps the
 * requested title (tolerates minor wording drift on a re-submitted case).
 */
function caseCoveredInSpec(specText, tc) {
  if (idInText(specText, tc)) return true;
  const id = normalizeText(tc && tc.id);
  if (id.length < 4) return false;
  const idPresent = new RegExp(`(?:^| )${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?= |$)`).test(normalizeText(specText));
  if (!idPresent) return false;
  return titleOverlap(tc && tc.title, specTitleForId(specText, tc && tc.id)) >= 0.6;
}

/** List every spec file under src/tests with its basename + content. */
function listSpecs(fw) {
  const dir = path.join(fw, 'src', 'tests');
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.spec.ts'))
      .map((f) => ({ rel: `src/tests/${f}`, base: f.replace(/\.spec\.ts$/, ''), content: safeRead(path.join(dir, f), 16000) }));
  } catch {
    return [];
  }
}

/**
 * Resolve the real domain by SCANNING existing specs for the requested test-case
 * ids. This maps re-submitted cases (already automated in login.spec.ts) back to
 * the Login domain instead of a bogus new domain derived from a tag (e.g.
 * @UserLogin → "UserLogin"). Falls back to the tag-derived name for a truly new
 * domain. Returns { F, base, matched, matchedSpec, specRel, pageRel, moduleRel }.
 */
function resolveDomain(fw, job) {
  const specs = listSpecs(fw);
  let best = null;
  let bestCount = 0;
  for (const s of specs) {
    const count = (job.testCases || []).filter((tc) => idInText(s.content, tc)).length;
    if (count > bestCount) { best = s; bestCount = count; }
  }
  if (best && bestCount > 0) {
    const F = pascal(best.base);
    return { F, base: best.base, matched: true, matchedSpec: best, specRel: best.rel, pageRel: `src/pages/${F}Page.ts`, moduleRel: `src/modules/${F}Module.ts` };
  }
  const F = domainName(job);
  const base = F.toLowerCase();
  return { F, base, matched: false, matchedSpec: null, specRel: `src/tests/${base}.spec.ts`, pageRel: `src/pages/${F}Page.ts`, moduleRel: `src/modules/${F}Module.ts` };
}

/** Find existing files for this domain so the LLM can EXTEND (merge) rather than replace them. */
function findDomainFiles(fw, job) {
  const d = resolveDomain(fw, job);
  const targets = [
    { rel: d.pageRel, layer: 'page' },
    { rel: d.moduleRel, layer: 'module' },
    { rel: d.specRel, layer: 'spec' },
  ];
  return targets
    .map((t) => ({ ...t, content: safeRead(path.join(fw, t.rel), 16000) }))
    .filter((t) => t.content);
}

/**
 * Capture a live accessibility snapshot of the target URL using the framework's
 * own Playwright (evidence-based locators). Best-effort — returns '' on any failure.
 */
function captureSnapshot(fw, url) {
  return new Promise((resolve) => {
    if (!url) return resolve('');
    const dir = path.join(fw, '.blast-tmp');
    const script = path.join(dir, 'capture.cjs');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(script, [
        "const { chromium } = require('@playwright/test');",
        '(async () => {',
        '  const browser = await chromium.launch();',
        '  try {',
        '    const page = await browser.newPage();',
        "    await page.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 30000 });",
        '    await page.waitForTimeout(1000);',
        "    const snap = await page.locator('body').ariaSnapshot();",
        '    process.stdout.write(snap);',
        '  } finally { await browser.close(); }',
        '})().catch((e) => { process.stderr.write(String(e)); process.exit(1); });',
      ].join('\n'), 'utf8');
    } catch {
      return resolve('');
    }
    // Run via a relative path (cwd = framework) so a space-containing FRAMEWORK_PATH
    // isn't split when shell:true concatenates args.
    const child = spawn('node', ['.blast-tmp/capture.cjs', url], { cwd: fw, env: process.env, shell: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(''); }, 45000);
    child.on('close', () => {
      clearTimeout(timer);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve(out.trim().slice(0, 6000));
    });
    child.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

function buildSystemPrompt() {
  return [
    'You are the AI Native Playwright Engineer. You output ONLY code files in the exact 3-layer architecture.',
    'Binding rules: pages = locators only (semantic: getByRole/getByLabel/getByPlaceholder); modules = workflows using Actions/WaitHelper/WorkflowActions wrappers + Logger.step(); specs = assertions/intent using the custom fixtures.',
    'Never put business logic in pages. Never put assertions in modules. Never use raw Playwright in specs. No `any`. Reuse existing files where the capabilities index shows them.',
    'LOCATOR STANDARD (follow exactly): default to a SINGLE semantic strategy per element (getByRole/getByLabel/getByPlaceholder; app-owned data-test only when no role/label exists). Do NOT stack multiple locators by default. Add a SmartLocator.resolve fallback chain ONLY when an element is genuinely fragile, and then annotate it with a `// reason:` comment and use at most 3 strategies. Collections use plain Playwright locators, never SmartLocator.',
    'DATA & CONFIG: never hardcode credentials/data. Valid credentials come from credentials(\'app\') (src/config). Negative/other data lives in src/testdata/testData.json — reuse existing keys; if you need NEW data, emit an EXTENDED testData.json (config layer) that KEEPS all existing keys and ADDS yours.',
    'FIXTURES: specs consume fixtures (e.g. loginModule, loginPage, page) from src/fixtures. If you CREATE a new Page/Module, you MUST also emit an updated src/fixtures/index.ts (fixture layer) that keeps all existing fixtures and registers the new Page + Module.',
    'SPEC NAMING = DOMAIN, never a single scenario. Group every case for a page/module into ONE domain spec (login.spec.ts), one test() per case. If an existing domain spec is provided, ADD to it — never create a parallel file.',
    'Playwright hooks ONLY: use test.beforeAll/test.afterAll/test.beforeEach/test.afterEach — NEVER bare beforeAll/afterAll/beforeEach/afterEach (those are Jest/Mocha globals and are undefined here). Import { test, expect } from the framework fixture used by the exemplar spec, not from @playwright/test unless the exemplar does.',
    'Output format — for EACH file emit exactly:',
    '===FILE:<relative/path/from/repo/root>|<page|module|spec|fixture|config|other>===',
    '<full file content>',
    '===ENDFILE===',
    'Emit nothing else — no prose, no markdown fences.',
  ].join('\n');
}

/**
 * Per-skill behavior mode. The UI skill selection changes HOW the agent edits,
 * not just which SKILL.md is shown. Returns a directive block for the prompt.
 */
function skillModeDirective(job) {
  const key = resolveSkill(job).key;
  if (key === 'modify') {
    return [
      '\n## MODE: MODIFY (surgical) — this is a change request, NOT a new build.',
      '- Make the SMALLEST possible change to satisfy the request (e.g. update ONE locator, add ONE step/assertion).',
      '- Return ONLY the file(s) that actually change. Do not regenerate untouched files.',
      '- Preserve every existing test, locator, and method verbatim except the exact thing being changed.',
      '- If changing a locator, change it in the Page only; keep the module/spec unchanged unless the request says otherwise.',
    ].join('\n');
  }
  if (key === 'debug') {
    return [
      '\n## MODE: DEBUG (diagnose first, then minimally fix).',
      '- FIRST classify the failure as one of: Locator Change, Script Issue, UI/App Bug, Environment Issue, or Unknown.',
      '- Put your classification + root cause as a top-of-file `// [DEBUG] <category>: <reason>` comment in the changed spec/module.',
      '- If it is a Script Issue or Locator Change, apply the minimal fix.',
      '- If it is a UI/App Bug (the application is genuinely broken), DO NOT mask it — keep the assertion honest and add a `// [DEBUG] APP BUG:` note explaining what the app did wrong.',
      '- Never weaken or delete an assertion just to make a failing test green.',
    ].join('\n');
  }
  if (key === 'heal') {
    return [
      '\n## MODE: SELF-HEALING — harden fragile locators only.',
      '- For genuinely fragile elements, add a SmartLocator.resolve fallback chain (max 3 strategies) with a `// reason:` note.',
      '- Do NOT add fallback chains to stable role/label locators.',
    ].join('\n');
  }
  if (key === 'visual') {
    return [
      '\n## MODE: VISUAL (additive) — functional flow FIRST, visual snapshot LAST.',
      '- Keep/produce the full functional test. Add a Sauce Visual check as the LAST test.step only.',
      '- Use sauceVisualCheck gated by isVisualEnabled() (VISUAL=1). Never use toHaveScreenshot / Applitools / Percy.',
      '- Mask dynamic VALUES only via ignoreRegions; keep labels and layout compared.',
    ].join('\n');
  }
  return ''; // new automation = the default behavior already described above
}

function buildGeneratePrompt(job, g, snapshot, existing) {
  const existingBlock = (existing && existing.length)
    ? existing.map((f) => `===FILE:${f.rel}|${f.layer}===\n${f.content}\n===ENDFILE===`).join('\n')
    : '';
  return [
    `# Task: automate the following test case(s) for URL ${job.url || '(unknown)'} (env ${job.environment}).`,
    testCaseBlock(job),
    job.comments ? `\nExtra notes: ${job.comments}` : '',
    '\n## Agent persona (follow this role & workflow)\n' + (g.persona || g.agent),
    '\n## Framework rules (AGENT.md excerpt)\n' + g.agent,
    g.skillActive ? `\n## Active skill: ${g.activeSkill ? g.activeSkill.tag : 'pw-new-automation'} (selected in the UI — follow this skill's workflow)\n` + g.skillActive : '',
    g.skillHeal && (!g.activeSkill || g.activeSkill.key !== 'heal') ? '\n## Skill: pw-self-healing (SmartLocator fallback chain — apply only to genuinely fragile locators)\n' + g.skillHeal : '',
    skillModeDirective(job),
    '\n## Reuse index (capabilities.json)\n' + g.capabilities,
    snapshot ? '\n## Live page snapshot (EVIDENCE — derive real locators from these roles/names)\n' + snapshot : '',
    existingBlock
      ? '\n## Existing domain files — EXTEND these (return full content, keep every existing test/locator/method, ADD the new cases)\n' + existingBlock
      : '\n## Style exemplar — Page (locators only, single semantic strategy)\n' + g.pageEx
        + '\n## Style exemplar — Module (Actions wrappers + Logger.step, no assertions)\n' + g.moduleEx
        + '\n## Style exemplar — Spec (custom fixtures, credentials(), testData)\n' + g.specEx,
    '\n## Test data (src/testdata/testData.json — reuse keys; extend, never shrink)\n' + (g.testData || '{}'),
    '\n## Fixtures (src/fixtures/index.ts — register any NEW Page/Module here)\n' + (g.fixtures || ''),
    g.smartLocator ? '\n## SmartLocator API (use only for a justified fallback)\n' + g.smartLocator : '',
    '\n## Requirements',
    '- Reuse existing pages/modules/locators/fixtures from the index and exemplars before adding anything new.',
    '- Group ALL cases into ONE domain spec (one test() per case). If an existing domain spec is shown above, ADD the new cases to it — do NOT create a parallel spec.',
    '- NEVER emit two test() blocks with the same test-case id. Each TC id appears exactly once. If a case id already exists in the shown spec, keep that one test as-is — do not add a second test for the same id, even with a different title.',
    '- APPEND-ONLY: NEVER renumber, reorder, or change the id or title of any EXISTING test. Add the new case using EXACTLY the TC id given in the task, appended AFTER the existing tests. Every existing test keeps its exact id and title verbatim.',
    '- Locators: ONE semantic strategy per element by default (getByRole/getByLabel/getByPlaceholder; data-test only when no role/label). A SmartLocator fallback chain is allowed ONLY for a fragile element and MUST carry a `// reason:` note (max 3 strategies). No stacked speculative locators.',
    '- Data: use credentials(\'app\') for valid login and src/testdata/testData.json for other data. If new data is needed, emit an EXTENDED testData.json (config layer) preserving all existing keys.',
    '- NEVER truncate, abbreviate, or elide any file. Do not emit placeholders like `/* …trimmed… */`, `// ...`, or `…`. Every emitted file (especially JSON) MUST be its COMPLETE, valid content. JSON must parse (no comments) and keep every existing top-level key.',
    '- If you create a NEW Page/Module, also emit an updated src/fixtures/index.ts (fixture layer) that keeps existing fixtures and registers the new ones.',
    '- Modules use Actions/WaitHelper/WorkflowActions and Logger.step(); specs hold all expect() assertions and import { test, expect } from ../fixtures.',
    snapshot ? '- Base locators on the live snapshot above; do not invent selectors it does not support.' : '',
    '- If a file you emit already exists, return its FULL content — keep ALL existing tests/locators/methods and ADD the new ones. Never delete existing functionality.',
  ].filter(Boolean).join('\n');
}

function buildHealPrompt(job, files, runOutput, errorContext) {
  const current = files.map((f) => `===FILE:${f.rel}|${f.layer}===\n${f.content}\n===ENDFILE===`).join('\n');
  return [
    'The generated Playwright test FAILED. Fix the locators/logic and return the corrected files in the same ===FILE=== format.',
    'Prefer semantic locators. Only change what is needed to make the test pass. Keep the 3-layer split.',
    resolveSkill(job).key === 'debug'
      ? 'DEBUG MODE: first classify the failure (Locator Change / Script Issue / UI/App Bug / Environment / Unknown) as a top-of-file `// [DEBUG] <category>: <reason>` comment. If it is a genuine UI/App Bug, DO NOT mask it — keep the assertion honest and annotate `// [DEBUG] APP BUG:`. Never weaken an assertion just to go green.'
      : '',
    'If the error is a ReferenceError (e.g. "beforeAll is not defined") or "No tests found", the code used a bare test-runner global. Replace bare beforeAll/afterAll/beforeEach/afterEach with test.beforeAll/test.afterAll/test.beforeEach/test.afterEach and ensure test/expect are imported from the same fixture the exemplar spec uses.',
    '\n## Current files\n' + current,
    '\n## Test run output (tail)\n' + runOutput.slice(-6000),
    errorContext ? '\n## error-context.md\n' + errorContext.slice(-3000) : '',
  ].join('\n');
}

/** Parse the ===FILE=== blocks into {rel, layer, content}. */
function parseFiles(text) {
  const out = [];
  let m;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(text)) !== null) {
    out.push({ rel: m[1].trim().replace(/\\/g, '/'), layer: m[2], content: m[3] });
  }
  return out;
}

/** Deterministically fix common LLM mistakes in spec files (bare test-runner hooks). */
function sanitizeFiles(files) {
  const BARE_HOOK = /(^|[^.\w])(beforeAll|afterAll|beforeEach|afterEach)\s*\(/g;
  return files.map((f) => {
    if (f.layer !== 'spec') return f;
    const fixed = f.content.replace(BARE_HOOK, (_m, pre, hook) => `${pre}test.${hook}(`);
    return fixed === f.content ? f : { ...f, content: fixed };
  });
}

/** Extract the test-case ids (TC_001, TC-2, …) each test() block is titled with. */
function specTestIds(content) {
  const ids = [];
  const re = /\btest\s*(?:\.\w+)?\s*\(\s*[`'"]\s*(TC[_-]?\d+[A-Za-z_]*)/g;
  let m;
  while ((m = re.exec(content || '')) !== null) ids.push(m[1].toUpperCase().replace(/-/g, '_'));
  return ids;
}

/** Ids that appear more than once inside a single generated spec (true duplicates). */
function duplicateSpecIds(content) {
  const seen = new Set();
  const dups = new Set();
  for (const id of specTestIds(content)) {
    if (seen.has(id)) dups.add(id); else seen.add(id);
  }
  return [...dups];
}

/** Next unused TC id given a set of existing ids. Keeps 3-digit zero-padding (TC_016). */
function nextFreeTcId(existingIds) {
  let max = 0;
  for (const id of existingIds) {
    const m = /(\d+)/.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  let n = max + 1;
  let candidate = `TC_${String(n).padStart(3, '0')}`;
  while (existingIds.has(candidate)) { n += 1; candidate = `TC_${String(n).padStart(3, '0')}`; }
  return candidate;
}

/** Map each test's TC id → its normalized title, so we can detect renames/renumbers. */
function specIdTitleMap(content) {
  const map = new Map();
  const re = /\btest\s*(?:\.\w+)?\s*\(\s*[`'"]\s*(TC[_-]?\d+[A-Za-z_]*)\s+([^`'"]*)/g;
  let m;
  while ((m = re.exec(content || '')) !== null) {
    map.set(m[1].toUpperCase().replace(/-/g, '_'), normalizeText(m[2]));
  }
  return map;
}

/**
 * Append-only integrity check: every test present in `oldSpec` must still exist in
 * `newSpec` under the SAME id and (strongly overlapping) title. Returns a list of
 * violations — a non-empty result means the LLM renumbered/renamed existing tests,
 * which must be rejected (the spec is append-only).
 */
function renumberedTests(oldSpec, newSpec) {
  const before = specIdTitleMap(oldSpec);
  const after = specIdTitleMap(newSpec);
  const problems = [];
  for (const [id, title] of before) {
    if (!after.has(id)) { problems.push(`${id} removed/renumbered`); continue; }
    if (title && titleOverlap(title, after.get(id)) < 0.5) problems.push(`${id} retitled`);
  }
  return problems;
}

/**
 * Count the "significant members" of a file so we can tell whether an LLM
 * regeneration ADDS to an existing file (safe) or SHRINKS it (destructive —
 * the LLM dropped existing tests/locators/methods).
 *   spec   → number of test() cases
 *   page   → number of semantic locators (getBy* / locator())
 *   other  → falls back to length-only comparison
 */
function countMembers(content, layer) {
  const text = content || '';
  if (layer === 'spec') return (text.match(/\btest\s*(\.\w+)?\s*\(/g) || []).length;
  if (layer === 'page') return (text.match(/getBy[A-Za-z]+\s*\(|\.locator\s*\(/g) || []).length;
  if (layer === 'module') return (text.match(/\basync\s+[A-Za-z_]\w*\s*\(/g) || []).length;
  return 0; // config/fixture/testdata/other → guarded by length only
}

/**
 * Structural guard for JSON data files (e.g. src/testdata/testData.json). The
 * length-only guard is too weak here — an LLM can emit a truncated object (a
 * "…trimmed…" placeholder) that still clears the 60% length bar. Returns a reason
 * string when the overwrite is UNSAFE (keep the existing file), or '' when safe.
 *   - new content must be strict, parseable JSON (rejects comments/placeholders)
 *   - must not DROP any top-level key that already exists (never shrink data)
 */
function jsonOverwriteViolation(current, next) {
  let cur;
  try { cur = JSON.parse(current); } catch { return ''; } // current isn't strict JSON — nothing to protect
  let nxt;
  try { nxt = JSON.parse(next); } catch { return 'new content is not valid JSON (truncated or contains comments/placeholders)'; }
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(cur) && isObj(nxt)) {
    const dropped = Object.keys(cur).filter((k) => !(k in nxt));
    if (dropped.length) return `would drop existing top-level key(s): ${dropped.join(', ')}`;
  }
  return '';
}

/**
 * Would writing `next` over an existing `current` file DELETE existing coverage?
 * True when the new content drops tests/locators/methods, or shrinks by >40%.
 * Used to protect canonical files: reuse-first, never clobber working code.
 */
function isDestructiveOverwrite(current, next, layer) {
  const oldMembers = countMembers(current, layer);
  const newMembers = countMembers(next, layer);
  if (oldMembers > 0 && newMembers < oldMembers) return true;
  return next.trim().length < current.trim().length * 0.6;
}

/**
 * Safely write parsed files under FRAMEWORK_PATH/src.
 * - Refuses paths that escape the repo or src/.
 * - If a file already exists with identical content → REUSED (not rewritten).
 * - If the new content would DELETE existing tests/locators/methods (or shrink
 *   the file by >40%) → PROTECTED: the existing file is kept and reused, never
 *   clobbered. Only additive (growing) regenerations are allowed to overwrite.
 * - If it exists with additive changes → backs it up to <file>.bak-<ts> before OVERWRITE.
 * - Otherwise → CREATED.
 * Returns { written[{path,layer,reused,action}], backups[], report{created,reused,overwritten,protected} }.
 */
function writeFiles(fw, files) {
  const written = [];
  const backups = [];
  const report = { created: 0, reused: 0, overwritten: 0, protected: 0 };
  const root = path.resolve(fw);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  for (const f of files) {
    const abs = path.resolve(root, f.rel);
    if (!abs.startsWith(root + path.sep)) throw new Error(`Refusing to write outside framework: ${f.rel}`);
    const relFromRoot = path.relative(root, abs).replace(/\\/g, '/');
    if (!relFromRoot.startsWith('src/')) throw new Error(`Refusing to write outside src/: ${f.rel}`);

    const next = f.content.endsWith('\n') ? f.content : f.content + '\n';
    let action = 'created';

    if (fs.existsSync(abs)) {
      const current = fs.readFileSync(abs, 'utf8');
      if (current === next) {
        report.reused += 1;
        written.push({ path: relFromRoot, layer: f.layer, reused: true, action: 'reused' });
        continue; // identical — leave existing file untouched
      }
      if (isDestructiveOverwrite(current, next, f.layer)) {
        // Reuse-first guard: the regenerated file would drop existing coverage.
        // Keep the working file untouched instead of clobbering it.
        report.protected += 1;
        written.push({ path: relFromRoot, layer: f.layer, reused: true, action: 'protected' });
        continue;
      }
      if (relFromRoot.endsWith('.json')) {
        const bad = jsonOverwriteViolation(current, next);
        if (bad) {
          // Data-file guard: invalid JSON or dropped keys — keep the working file.
          report.protected += 1;
          written.push({ path: relFromRoot, layer: f.layer, reused: true, action: 'protected', reason: bad });
          continue;
        }
      }
      const bak = path.join(root, '.blast-backups', `${relFromRoot}.bak-${ts}`);
      fs.mkdirSync(path.dirname(bak), { recursive: true });
      fs.copyFileSync(abs, bak);
      backups.push(path.relative(root, bak).replace(/\\/g, '/'));
      action = 'overwritten';
      report.overwritten += 1;
    } else {
      report.created += 1;
    }

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, next, 'utf8');
    written.push({ path: relFromRoot, layer: f.layer, reused: false, action });
  }
  return { written, backups, report };
}

/** Refresh the reuse index so the next job sees accurate capabilities. Best-effort. */
function refreshIndex(fw) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'index'], { cwd: fw, env: process.env, shell: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, out: out + '\n[local] index refresh timed out.' }); }, 60000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, out: `index error: ${err.message}` }); });
  });
}

function envForRun(job) {
  const map = { QA: 'qa', UAT: 'uat', Production: 'prod' };
  return { ...process.env, TEST_ENV: map[job.environment] || 'qa' };
}

/** Map the job's browser choice to a Playwright project name (null = all projects). */
function browserProject(job) {
  const map = { Chrome: 'desktop-chrome', Edge: 'desktop-edge', Firefox: 'desktop-firefox', Safari: 'desktop-safari' };
  if (job && job.browser === 'All') return null;
  return (job && map[job.browser]) || 'desktop-chrome';
}

/** Run the given spec files with Playwright. Returns { passed, output, summary }. */
function runPlaywright(fw, specRelPaths, job, opts = {}) {
  return new Promise((resolve) => {
    // Add the framework's StepsReporter when present so the in-app report can show per-test steps.
    let reporters = 'list,json';
    // Emit Allure results when the framework has the reporter (uploaded as a CI artifact).
    if (fs.existsSync(path.join(fw, 'node_modules', 'allure-playwright'))) {
      reporters += ',allure-playwright';
    }
    if (fs.existsSync(path.join(fw, 'src', 'utils', 'StepsReporter.ts'))) {
      reporters += ',./src/utils/StepsReporter.ts';
    }
    // Smoke scope (only on the final validation run) runs the whole @Smoke suite instead of the new spec.
    const smoke = opts.applyScope && job && job.testScope === 'Smoke';
    const targets = smoke ? [] : specRelPaths;
    const args = ['playwright', 'test', ...targets];
    const proj = browserProject(job);
    if (proj) args.push(`--project=${proj}`);
    if (smoke) args.push('--grep=@Smoke');
    if (job && job.parallel === 'Serial') args.push('--workers=1');
    args.push(`--reporter=${reporters}`);
    const env = { ...envForRun(job), PLAYWRIGHT_JSON_OUTPUT_NAME: 'test-results/results.json' };
    const child = spawn('npx', args, { cwd: fw, env, shell: true });
    let output = '';
    const onData = (d) => { output += d.toString(); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { child.kill('SIGKILL'); output += '\n[local] Run timed out.'; }, RUN_TIMEOUT_MS);
    child.on('close', (code) => { clearTimeout(timer); resolve({ passed: code === 0, output, summary: parseRunSummary(fw) }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ passed: false, output: output + `\n[local] spawn error: ${err.message}`, summary: null }); });
  });
}

/**
 * Parse Playwright's JSON report (test-results/results.json) into a compact, UI-friendly
 * summary: pass/fail counts plus a per-test list with steps and error text.
 */
function parseRunSummary(fw) {
  try {
    const file = path.join(fw, 'test-results', 'results.json');
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    // StepsReporter (framework) writes per-test steps here; JSON reporter omits them.
    let stepMap = {};
    try {
      const stepsFile = path.join(fw, 'test-results', 'steps.json');
      if (fs.existsSync(stepsFile)) stepMap = JSON.parse(fs.readFileSync(stepsFile, 'utf8')) || {};
    } catch { stepMap = {}; }
    const tests = [];
    const flatSteps = (steps) => (steps || []).flatMap((s) => [
      { title: s.title, status: s.error ? 'failed' : 'passed' },
      ...flatSteps(s.steps),
    ]);
    const walk = (suite) => {
      (suite.specs || []).forEach((spec) => {
        const t = (spec.tests || [])[0] || {};
        const r = (t.results || [])[0] || {};
        const errObj = (r.errors && r.errors[0]) || r.error || null;
        const errMsg = errObj ? String(errObj.message || errObj).replace(/\u001b\[[0-9;]*m/g, '').trim() : '';
        const steps = (stepMap[spec.title] && stepMap[spec.title].length)
          ? stepMap[spec.title].slice(0, 60)
          : flatSteps(r.steps).slice(0, 40);
        tests.push({
          title: spec.title,
          status: spec.ok ? 'passed' : (r.status || 'failed'),
          durationMs: r.duration || 0,
          project: t.projectName || '',
          error: errMsg.split('\n').slice(0, 6).join('\n'),
          steps,
        });
      });
      (suite.suites || []).forEach(walk);
    };
    (data.suites || []).forEach(walk);
    const st = data.stats || {};
    return {
      total: tests.length,
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => t.status !== 'passed' && t.status !== 'skipped').length,
      skipped: st.skipped || tests.filter((t) => t.status === 'skipped').length,
      flaky: st.flaky || 0,
      durationMs: st.duration || 0,
      tests,
    };
  } catch {
    return null;
  }
}

function readErrorContext(fw) {
  const candidates = [
    path.join(fw, 'ai-debug-report', 'error-context.md'),
    path.join(fw, 'test-results'),
  ];
  for (const c of candidates) {
    try {
      if (c.endsWith('.md') && fs.existsSync(c)) return fs.readFileSync(c, 'utf8');
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
        const walk = (dir) => fs.readdirSync(dir).flatMap((n) => {
          const p = path.join(dir, n);
          return fs.statSync(p).isDirectory() ? walk(p) : [p];
        });
        const ctx = walk(c).find((p) => p.endsWith('error-context.md'));
        if (ctx) return fs.readFileSync(ctx, 'utf8');
      }
    } catch { /* ignore */ }
  }
  return '';
}

async function llmGenerate(prompt, system) {
  const c = config();
  const connector = new LLMConnector(c.platform, c.apiKey, c.endpoint);
  const res = await connector.generateContent(prompt, system, c.model || null);
  return typeof res === 'object' ? res.content : res;
}

/**
 * Build a reuse-first implementation plan by INSPECTING the local framework
 * (existing domain files + capabilities index) BEFORE any code is generated.
 * Reports which requested cases are already automated (reuse) vs new (add),
 * and which layer files will be extended vs created — so the user can review
 * and approve before anything runs locally.
 * Returns { plan, missingInfo, reusedFiles }.
 */
function buildPlan(job, fwOverride) {
  const { frameworkPath, platform, model } = config();
  const fw = fwOverride || frameworkPath;
  const logs = [];
  const log = (m) => logs.push(m);
  const missingInfo = [];
  if (!job.url) missingInfo.push('Application URL is required to capture live locators (evidence-based).');
  if (!job.testCases || job.testCases.length === 0) missingInfo.push('No test cases selected for automation.');
  if (!fw || !fs.existsSync(fw)) missingInfo.push('FRAMEWORK_PATH is not set or does not exist on this machine.');

  const dom = fw && fs.existsSync(fw) ? resolveDomain(fw, job) : { F: domainName(job), matched: false, pageRel: '', moduleRel: '', specRel: '' };
  const F = dom.F;
  const pageRel = dom.pageRel || `src/pages/${F}Page.ts`;
  const moduleRel = dom.moduleRel || `src/modules/${F}Module.ts`;
  const specRel = dom.specRel || `src/tests/${F.toLowerCase()}.spec.ts`;

  log(`[plan] Planning "${F}" automation locally at ${fw || '(FRAMEWORK_PATH not set)'}.`);
  log('[plan] Reading framework memory: AGENT.md + agent persona + skills (pw-new-automation, pw-self-healing)…');
  const hasCaps = fw ? fs.existsSync(path.join(fw, '.ai-memory', 'capabilities.json')) : false;
  log(`[plan] Reading reuse index: .ai-memory/capabilities.json — ${hasCaps ? 'found ✓' : 'NOT found (run npm run index)'}.`);
  if (dom.matched) log(`[plan] Matched existing domain "${dom.base}" by scanning specs for your test-case ids → reusing ${specRel}.`);

  const existing = fw && fs.existsSync(fw) ? findDomainFiles(fw, job) : [];
  const byLayer = Object.fromEntries(existing.map((e) => [e.layer, e]));
  const specContent = byLayer.spec ? byLayer.spec.content : '';
  const specTestCount = (specContent.match(/\btest\s*\(/g) || []).length;
  log(existing.length
    ? `[plan] Existing domain files found: ${existing.map((e) => e.rel).join(', ')}.`
    : `[plan] No existing "${F}" domain files — this will be a fresh page/module/spec.`);
  if (specContent) log(`[plan] Existing spec "${specRel}" already contains ${specTestCount} test(s).`);

  const cases = (job.testCases || []).map((tc) => ({ ...tc, exists: caseCoveredInSpec(specContent, tc) }));
  const already = cases.filter((c) => c.exists);
  const toAdd = cases.filter((c) => !c.exists);
  log(`[plan] Reuse analysis: ${cases.length} selected → ${already.length} already automated (reuse), ${toAdd.length} new (generate).`);
  already.forEach((c) => log(`[plan]   ✅ ${c.id} already exists → reuse`));
  toAdd.forEach((c) => log(`[plan]   🆕 ${c.id} not found → will generate`));
  if (specTestCount > cases.length && !toAdd.length) {
    log(`[plan] Note: the spec file holds ${specTestCount} test(s) total (a superset of your ${cases.length} selected). Running the spec executes ALL ${specTestCount}.`);
  }

  const reusedFiles = existing.map((e) => e.rel);
  ['src/config/index.ts', 'src/utils/constants.ts'].forEach((p) => {
    if (fw && fs.existsSync(path.join(fw, p))) reusedFiles.push(p);
  });
  log('[plan] Implementation plan ready — review & approve to run locally.');

  const fileLine = (rel, layer) => {
    const ex = byLayer[layer];
    if (!ex) return `- **CREATE** \`${rel}\` (no existing ${layer} for “${F}”)`;
    if (!toAdd.length) return `- **REUSE** \`${rel}\` (exists — reused as-is, no changes written)`;
    return `- **EXTEND** \`${rel}\` (exists — kept & only added to; never regenerated smaller)`;
  };

  const lines = [
    `# Implementation Plan — ${job.skill || 'New Automation'} (${job.environment || 'QA'})`,
    '',
    `Runs **locally** via Playwright in the AI Native framework (\`desktop-chrome\`, headless).`,
    `Provider: local · LLM: ${platform}/${model || 'default'}`,
    `Target URL: ${job.url || '(missing)'}`,
    `Reuse index (.ai-memory/capabilities.json): ${hasCaps ? 'found ✓' : 'not found (run npm run index)'}`,
    '',
    '## Test-case reuse analysis',
  ];

  if (already.length) {
    lines.push(`> 🛡 ${already.length} of ${cases.length} selected case(s) are **already automated** in \`${specRel}\` — these will be **REUSED as-is**, not regenerated:`);
    already.forEach((c) => lines.push(`  - ✅ ${c.id} ${c.title || ''} — already exists → reuse`));
  }
  if (toAdd.length) {
    lines.push(`> ＋ ${toAdd.length} case(s) are **new** and will be added:`);
    toAdd.forEach((c) => lines.push(`  - 🆕 ${c.id} ${c.title || ''} — new → generate`));
  }
  if (specTestCount > cases.length && !toAdd.length) {
    lines.push('', `> ℹ️ \`${specRel}\` already contains **${specTestCount} test(s)** — a superset of your ${cases.length} selected. Running the spec executes **all ${specTestCount}** (Playwright runs the whole file), which is why the report shows ${specTestCount} tests.`);
  }
  if (!toAdd.length && already.length) {
    lines.push('', '**Nothing new to generate** — every selected case already exists. Approving will just re-run the existing local tests and produce a fresh report.');
  }

  lines.push(
    '',
    '## Files',
    fileLine(pageRel, 'page'),
    fileLine(moduleRel, 'module'),
    fileLine(specRel, 'spec'),
  );
  if (reusedFiles.length) {
    lines.push(`- ♻ Reuse shared: ${[...new Set(reusedFiles)].map((r) => `\`${r}\``).join(', ')}`);
  }
  if (!toAdd.length && already.length) {
    lines.push(
      '',
      '## How it will run (on Approve)',
      '1. **No LLM call, no code generated** — every selected case already exists.',
      `2. Re-run the existing spec locally with Playwright (\`--project=desktop-chrome\`): \`${specRel}\`.`,
      '3. Verify the capabilities index (no changes expected — pure reuse).',
      '4. Show the fresh HTML report in the UI.',
    );
  } else {
    lines.push(
      '',
      '## How it will run (on Approve)',
      '1. Write a JSON job brief + capture a live locator snapshot of the URL (evidence-based).',
      `2. Ask the LLM ONLY for the ${toAdd.length} new case(s) (${toAdd.map((c) => c.id).join(', ')}); existing tests/locators are preserved (non-destructive guard — a file can only grow, never be replaced by something smaller). Duplicate ids are rejected before writing.`,
      '3. Run the spec locally with Playwright (`--project=desktop-chrome`), one self-heal round on failure.',
      '4. Refresh the capabilities index (npm run index) and show the HTML report in the UI.',
    );
  }

  return { plan: lines.join('\n'), missingInfo, reusedFiles: [...new Set(reusedFiles)], logs };
}

/**
 * Write a lightweight JSON job contract into the framework (.blast-jobs/) so the
 * run is reproducible and the framework has a machine-readable brief (skill, agent,
 * env, url, selected test cases). Returns the repo-relative path or '' on failure.
 */
function writeJobFile(fw, job) {
  try {
    const dir = path.join(fw, '.blast-jobs');
    fs.mkdirSync(dir, { recursive: true });
    const rel = `.blast-jobs/blast-job-${job.jobId}.json`;
    const brief = {
      jobId: job.jobId,
      project: job.project || '',
      environment: job.environment || 'QA',
      url: job.url || '',
      agent: job.agent || 'AI Native Playwright Engineer',
      skill: job.skill || 'New Automation',
      executionMode: job.executionMode || 'GenerateAndExecute',
      comments: job.comments || '',
      testCases: (job.testCases || []).map((tc) => ({
        id: tc.id,
        title: tc.title || '',
        tags: tc.tags || '',
        description: tc.description || '',
        preconditions: tc.preconditions || '',
        testData: tc.testData || '',
        steps: tc.steps || '',
        expectedResults: tc.expectedResults || '',
        comments: tc.comments || '',
      })),
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(fw, rel), JSON.stringify(brief, null, 2), 'utf8');
    return rel;
  } catch {
    return '';
  }
}

/**
 * Generate the 3-layer code, write it, run it, and self-heal once on failure.
 * Streams progress through the optional `onLog(line)` callback so the UI can
 * display logs live while work is in flight.
 * Returns { generatedFiles, reusedFiles, executionStatus, reportUrl, logs }.
 */
async function generateAndRun(job, onLog) {
  const { frameworkPath: fw } = config();
  const logs = [];
  const log = (m) => {
    logs.push(m);
    if (typeof onLog === 'function') { try { onLog(m); } catch { /* streaming best-effort */ } }
  };
  log(`[local] Provider active — framework at ${fw}.`);
  const activeSkill = resolveSkill(job);
  log(`[local] Skill selected: ${job.skill || 'New Automation'} → grounding on ${activeSkill.tag} (mode: ${activeSkill.key}).`);
  // READ-BEFORE contract: rebuild the reuse index from src/ BEFORE grounding. In a fresh
  // CI checkout .ai-memory/ is gitignored (absent), so without this the index reads empty
  // and reuse degrades (the agent re-creates Pages/Modules that already exist).
  log('[local] Building reuse index from src/ (npm run index) before grounding…');
  const preIdx = await refreshIndex(fw);
  log(preIdx.ok
    ? '[local] Reuse index built ✓ — capabilities.json is current for grounding.'
    : '[local] Reuse index build failed (non-fatal) — grounding will fall back to persona/skills.');
  log('[local] Reading framework memory: AGENT.md + agent persona + active skill + pw-self-healing + capabilities index…');
  const grounding = readGrounding(fw, job);
  log(grounding.capabilities
    ? '[local] Grounding loaded (persona, skills, exemplars, testData, fixtures) — reusing known pages/locators where possible.'
    : '[local] Capabilities index empty/missing — grounding from persona + skills + exemplars (run npm run index).');

  // 0) Contract file + evidence: JSON brief, live locator snapshot, existing domain files
  const jobFile = writeJobFile(fw, job);
  if (jobFile) log(`[local] Job brief written: ${jobFile}`);
  log('[local] Capturing live page snapshot for evidence-based locators…');
  const snapshot = await captureSnapshot(fw, job.url);
  log(snapshot ? `[local] Snapshot captured (${snapshot.length} chars).` : '[local] Snapshot unavailable — falling back to exemplars.');
  const existing = findDomainFiles(fw, job);
  if (existing.length) log(`[local] Extending existing domain files: ${existing.map((e) => e.rel).join(', ')}`);

  // 0b) Duplicate guard — decide what is genuinely NEW before touching the LLM.
  const domSpec = existing.find((e) => e.layer === 'spec');
  const specText = domSpec ? domSpec.content : '';
  const selected = job.testCases || [];
  const dupCases = selected.filter((tc) => caseCoveredInSpec(specText, tc));
  const newCases = selected.filter((tc) => !caseCoveredInSpec(specText, tc));
  dupCases.forEach((tc) => log(`[local] ⏭ Duplicate detected: ${tc.id} "${tc.title || ''}" already present in ${domSpec ? domSpec.rel : 'spec'} → reusing existing test, will NOT rewrite it.`));

  // If every selected case already exists, do NOT generate — reuse and just re-run.
  if (domSpec && newCases.length === 0) {
    log(`[local] All ${selected.length} selected case(s) already automated in ${domSpec.rel} — nothing new to generate. Reusing existing tests.`);
    log(`[local] Running (reuse-only): ${domSpec.rel}`);
    const reuseRun = await runPlaywright(fw, [domSpec.rel], job);
    log(reuseRun.passed ? '[local] Run PASSED.' : '[local] Run FAILED.');
    const idxR = await refreshIndex(fw);
    log(idxR.ok
      ? '[local] Capabilities index verified — no changes (pure reuse, no files written).'
      : '[local] Index refresh skipped/failed (non-fatal).');
    reuseRun.output.split('\n').slice(-25).forEach((line) => { if (line.trim()) log(line); });
    return {
      generatedFiles: existing.map((e) => ({ path: e.rel, layer: e.layer, reused: true, action: 'reused' })),
      reusedFiles: existing.map((e) => e.rel),
      backups: [],
      executionStatus: reuseRun.passed ? 'PASSED' : 'FAILED',
      reportUrl: 'playwright-report/index.html',
      reportSummary: reuseRun.summary || null,
      logs,
    };
  }
  // Generate only the genuinely new cases (existing tests are preserved). requestedIds is
  // filled with the ACTUAL id used per case — a colliding id is reassigned below, so this
  // must reflect the real (post-reassignment) id for the completion check to be accurate.
  const requestedIds = [];
  if (newCases.length) log(`[local] ${newCases.length} new case(s) to add: ${newCases.map((c) => c.id).join(', ')} (existing tests are preserved).`);

  // 1) Generate — ONE case per LLM call so each response stays small enough to
  //    complete on rate-limited free tiers (Groq 8K TPM) and can't truncate
  //    mid-file. Each iteration re-reads the domain so it extends the spec that
  //    the previous case just grew.
  const written = [];
  const allBackups = [];
  let files = [];               // last written batch — input for the self-heal round
  const seenPaths = new Map();  // de-dup written entries across cases (spec is rewritten each pass)
  const recordWrite = (w) => {
    if (seenPaths.has(w.path)) written[seenPaths.get(w.path)] = w;
    else { seenPaths.set(w.path, written.length); written.push(w); }
  };
  const logWrite = (w) => {
    const tag = w.action === 'reused' ? '♻ reused   '
      : w.action === 'protected' ? '🛡 kept (existing coverage preserved)'
      : w.action === 'overwritten' ? '⚠ extended '
      : '＋ created  ';
    log(`[local]   ${tag} ${w.path}${w.reason ? ` — ${w.reason}` : ''}`);
  };
  for (let i = 0; i < newCases.length; i++) {
    const tc = { ...newCases[i] };
    const existNow = findDomainFiles(fw, job); // reflects writes from earlier cases this run
    const specNow = (existNow.find((e) => e.layer === 'spec') || {}).content || '';
    const existingIds = new Set(specTestIds(specNow));
    // COLLISION GUARD (root cause of renumbering): if the requested id already labels a
    // DIFFERENT existing test, the LLM would be forced to renumber existing tests to keep
    // ids unique. Deterministically reassign this new case to the next free id instead.
    const wantId = String(tc.id || '').toUpperCase().replace(/-/g, '_');
    if (wantId && existingIds.has(wantId)) {
      const freeId = nextFreeTcId(existingIds);
      log(`[local] ⚠ Requested id ${wantId} already exists as a different test — reassigning the new case to ${freeId} (existing tests are NEVER renumbered).`);
      tc.id = freeId;
    } else if (wantId) {
      tc.id = wantId;
    }
    if (tc.id) requestedIds.push(String(tc.id).toUpperCase().replace(/-/g, '_'));
    log(`[local] Generating ${tc.id} "${tc.title || ''}" (${i + 1}/${newCases.length})…`);
    const genText = await llmGenerate(buildGeneratePrompt({ ...job, testCases: [tc] }, grounding, snapshot, existNow), buildSystemPrompt());
    let batch = sanitizeFiles(parseFiles(genText));
    if (batch.length === 0) { log(`[local] ⚠ ${tc.id}: LLM returned no parseable files — skipped.`); continue; }
    batch = batch.filter((f) => {
      if (f.layer !== 'spec') return true;
      const dups = duplicateSpecIds(f.content);
      if (dups.length) { log(`[local] ⚠ ${tc.id}: rejected spec ${f.rel} — duplicate id(s) ${dups.join(', ')}.`); return false; }
      // APPEND-ONLY GUARD: reject a spec that renumbered/renamed any pre-existing test.
      const renamed = renumberedTests(specNow, f.content);
      if (renamed.length) { log(`[local] ⚠ ${tc.id}: rejected spec ${f.rel} — it altered existing test(s): ${renamed.join('; ')}. Existing tests must be preserved verbatim.`); return false; }
      return true;
    });
    if (batch.length === 0) continue;
    const wr = writeFiles(fw, batch);
    allBackups.push(...wr.backups);
    wr.written.forEach((w) => { recordWrite(w); logWrite(w); });
    files = batch;
  }
  if (written.length === 0) {
    log('[local] Nothing written after generation — requested case(s) not automated. No PR.');
    return { generatedFiles: [], reusedFiles: [], executionStatus: 'FAILED', reportUrl: '', requestedCases: requestedIds, missingCases: requestedIds, verified: false, logs };
  }
  if (allBackups.length) log(`[local] Backups saved: ${allBackups.join(', ')}`);

  const specPaths = () => written.filter((w) => w.layer === 'spec').map((w) => w.path);
  if (specPaths().length === 0) {
    log('[local] No spec file generated (LLM output likely truncated) — requested case(s) NOT automated. Verification FAILED; no PR will be opened.');
    return { generatedFiles: written, reusedFiles: [], executionStatus: 'FAILED', reportUrl: '', requestedCases: requestedIds, missingCases: requestedIds, verified: false, logs };
  }

  // 2) Run
  log(`[local] Running: ${specPaths().join(', ')}`);
  let run = await runPlaywright(fw, specPaths(), job, { applyScope: true });
  log(run.passed ? '[local] Run PASSED.' : '[local] Run FAILED — attempting one self-heal round.');

  // 3) Self-heal once
  if (!run.passed) {
    const errorContext = readErrorContext(fw);
    const healInput = findDomainFiles(fw, job); // heal against the full spec on disk
    const healText = await llmGenerate(buildHealPrompt(job, healInput.length ? healInput : files, run.output, errorContext), buildSystemPrompt());
    const healed = sanitizeFiles(parseFiles(healText));
    if (healed.length) {
      const hr = writeFiles(fw, healed);
      hr.written.forEach((w) => { recordWrite(w); logWrite(w); });
      allBackups.push(...hr.backups);
      files = healed;
      log(`[local] Applied heal to ${hr.written.length} file(s). Re-running…`);
      run = await runPlaywright(fw, specPaths(), job, { applyScope: true });
      log(run.passed ? '[local] Re-run PASSED after heal.' : '[local] Re-run still FAILED.');
    } else {
      log('[local] Heal produced no parseable files.');
    }
  }

  // 4) Refresh the reuse index so the next job sees the new/updated assets.
  log('[local] Updating memory: refreshing capabilities index (npm run index)…');
  const idx = await refreshIndex(fw);
  const changedCount = written.filter((w) => w.action === 'created' || w.action === 'overwritten').length;
  log(idx.ok
    ? `[local] Capabilities index updated ✓ (.ai-memory/capabilities.json) — ${changedCount} file(s) changed this run.`
    : '[local] Index refresh skipped/failed (non-fatal).');
  run.output.split('\n').slice(-25).forEach((line) => { if (line.trim()) log(line); });

  // 5) Completion check — every requested new case MUST be present in the final
  // spec on disk. If the LLM dropped a case (or the write was protected), report
  // it so the caller can refuse to open a PR for cases that were never automated.
  const finalSpecText = specPaths().map((p) => safeRead(path.join(fw, p), 40000)).join('\n');
  const presentIds = new Set(specTestIds(finalSpecText));
  const missingCases = requestedIds.filter((id) => !presentIds.has(id));
  if (requestedIds.length && missingCases.length) {
    log(`[local] ⚠ VERIFICATION FAILED — requested case(s) NOT present after generation: ${missingCases.join(', ')}. They were not automated; no PR should be opened for them.`);
  } else if (requestedIds.length) {
    log(`[local] ✅ Verification passed — all ${requestedIds.length} requested case(s) present: ${requestedIds.join(', ')}.`);
  }

  return {
    generatedFiles: written,
    reusedFiles: written.filter((w) => w.reused).map((w) => w.path),
    backups: allBackups,
    executionStatus: run.passed ? 'PASSED' : 'FAILED',
    reportUrl: 'playwright-report/index.html',
    reportSummary: run.summary || null,
    requestedCases: requestedIds,
    missingCases,
    verified: missingCases.length === 0,
    logs,
  };
}

/** Run a git command inside the framework repo. Returns { code, output }. */
function git(fw, args) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd: fw, env: process.env, shell: true });
    let output = '';
    const onData = (d) => { output += d.toString(); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: 1, output: output + '\n[git] timed out.' }); }, 120000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: 1, output: `[git] ${err.message}` }); });
  });
}

/**
 * Commit the generated tests on a fresh branch and push to origin.
 * Only the generated src/ files are staged (never .env, backups, or temp).
 * Returns { branch, pushed, compareUrl, logs }.
 */
async function pushBranch(job, onLog) {
  const { frameworkPath: fw } = config();
  const logs = [];
  const log = (m) => { logs.push(m); if (typeof onLog === 'function') { try { onLog(m); } catch { /* best-effort */ } } };

  const files = (job.generatedFiles || []).map((f) => f.path).filter((p) => p && p.startsWith('src/'));
  if (files.length === 0) throw new Error('No generated src/ files to push.');

  const branch = `blast/auto-${job.jobId}`.toLowerCase();
  log(`[push] Creating branch ${branch}…`);
  const co = await git(fw, ['checkout', '-B', branch]);
  if (co.code !== 0) throw new Error(`git checkout failed: ${co.output.slice(-300)}`);

  const add = await git(fw, ['add', '--', ...files.map((f) => `"${f}"`)]);
  if (add.code !== 0) throw new Error(`git add failed: ${add.output.slice(-300)}`);

  const ids = (job.testCases || []).map((tc) => tc.id).join(', ');
  const msg = `test(automation): ${job.jobId} — ${job.project || 'suite'} (${ids || 'cases'})`;
  const commit = await git(fw, ['commit', '-m', `"${msg}"`]);
  if (commit.code !== 0 && !/nothing to commit/i.test(commit.output)) {
    throw new Error(`git commit failed: ${commit.output.slice(-300)}`);
  }
  log(`[push] Committed ${files.length} file(s).`);

  const push = await git(fw, ['push', '-u', 'origin', branch]);
  if (push.code !== 0) throw new Error(`git push failed: ${push.output.slice(-300)}`);
  log('[push] Pushed to origin.');

  // Build a compare URL from the origin remote.
  const remote = await git(fw, ['remote', 'get-url', 'origin']);
  let compareUrl = '';
  const url = (remote.output || '').trim();
  const httpsMatch = url.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (httpsMatch) compareUrl = `https://github.com/${httpsMatch[1]}/compare/${branch}?expand=1`;
  if (compareUrl) log(`[push] Open a PR: ${compareUrl}`);

  return { branch, pushed: true, compareUrl, logs };
}

// ===================================================================
// Copilot handoff — hand the job to the LOCAL VS Code Copilot agent.
// B.L.A.S.T. writes a JSON brief + a prompt + a .bat that invokes
// `code chat --mode agent` so the real agentic flow (cli locator
// discovery, 3-layer build, run, heal) runs in the editor. Copilot
// appends progress to a log file that B.L.A.S.T. tails into the UI.
// ===================================================================

// Resolve the real VS Code CLI launcher. On Windows the PATH entry is `code.cmd`
// (in <install>/bin), NOT `code.exe` — invoking `code.exe` from a .bat silently
// fails ("not recognized"), which leaves the handoff stuck at the seed log line.
function resolveCodeCli() {
  const candidates = [];
  const pushBin = (root) => {
    if (root) {
      candidates.push(path.join(root, 'bin', 'code.cmd'));
      candidates.push(path.join(root, 'bin', 'code-insiders.cmd'));
    }
  };
  pushBin('C:\\Program Files\\Microsoft VS Code');
  pushBin('C:\\Program Files (x86)\\Microsoft VS Code');
  if (process.env.LOCALAPPDATA) pushBin(path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'));
  // Also scan PATH for code.cmd / code-insiders.cmd.
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    candidates.push(path.join(dir, 'code.cmd'));
    candidates.push(path.join(dir, 'code-insiders.cmd'));
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return 'code'; // last resort: bare name (resolves code.cmd if it's on PATH)
}

function handoffPaths(fw, jobId) {
  const runDir = path.join(fw, '.blast-runs');
  const safe = String(jobId).replace(/[^A-Za-z0-9_-]/g, '_');
  return {
    runDir,
    jobJsonRel: `.blast-jobs/blast-job-${jobId}.json`,
    promptRel: `.blast-runs/${safe}-prompt.md`,
    logRel: `.blast-runs/${safe}.log`,
    inboxRel: `.blast-runs/${safe}.inbox`,
    batAbs: path.join(runDir, `run-blast-${safe}.bat`),
    logAbs: path.join(runDir, `${safe}.log`),
    inboxAbs: path.join(runDir, `${safe}.inbox`),
    stopRel: `.blast-runs/${safe}.stop`,
    stopAbs: path.join(runDir, `${safe}.stop`),
    promptAbs: path.join(runDir, `${safe}-prompt.md`),
  };
}

/** The instruction Copilot receives: run the real skill flow, log to the log file. */
function buildCopilotPrompt(job, paths) {
  // Render each case in full (steps + expected results) so Copilot automates the
  // real behaviour, not just the title. Falls back to a one-line summary when a
  // case carries no step detail (older jobs / summary-only selections).
  const fmt = (v) => String(v || '').replace(/\r/g, '').replace(/\n+/g, ' ').trim();
  const cases = (job.testCases || [])
    .map((tc) => {
      const header = `#### ${tc.id} ${tc.title || ''}${tc.tags ? ` [${tc.tags}]` : ''}`;
      const detail = [];
      if (fmt(tc.description)) detail.push(`- **Description:** ${fmt(tc.description)}`);
      if (fmt(tc.preconditions)) detail.push(`- **Pre-conditions:** ${fmt(tc.preconditions)}`);
      if (fmt(tc.testData)) detail.push(`- **Test Data:** ${fmt(tc.testData)}`);
      if (fmt(tc.steps)) detail.push(`- **Test Steps:** ${fmt(tc.steps)}`);
      if (fmt(tc.expectedResults)) detail.push(`- **Expected Results:** ${fmt(tc.expectedResults)}`);
      return detail.length ? [header, ...detail].join('\n') : `- ${tc.id} ${tc.title || ''}${tc.tags ? ` [${tc.tags}]` : ''}`;
    })
    .join('\n\n');
  return [
    '# B.L.A.S.T. → Copilot automation job',
    '',
    'You are the **AI Native Playwright Engineer**. Implement automation for the attached job',
    'brief by following the attached **pw-new-automation** skill and AGENT.md exactly.',
    '',
    '## Non-negotiable',
    '- Reuse-first: check `.ai-memory/capabilities.json` and existing pages/modules/specs before adding anything.',
    '- Evidence-based locators: use `@playwright/cli` (open the URL → snapshot → save real refs) for any NEW/changed locator. Never guess.',
    '- Strict 3-layer: pages = locators only, modules = workflows (Actions/WaitHelper/WorkflowActions + Logger.step), specs = assertions using fixtures.',
    '- Locator standard: one semantic strategy by default; a fallback needs a `// reason:` (max 3); collections use plain Playwright locators.',
    '- Do NOT create duplicate tests. If a case id already exists in the domain spec, reuse it — never add a second test for the same id.',
    '- Group all cases into ONE domain spec; extend the existing spec, never a parallel file.',
    '',
    `## Job: ${job.jobId} — ${job.project || 'suite'} (${job.environment || 'QA'})`,
    `Target URL: ${job.url || '(see brief)'}`,
    '',
    ...(String(job.plan || '').trim()
      ? ['## Approved implementation plan (follow this — the user reviewed/edited it)', '', String(job.plan).trim(), '']
      : []),
    '### Test cases',
    cases || '(see the attached brief)',
    '',
    '## If you need more information (ask the user via B.L.A.S.T., do NOT guess)',
    `- When you are blocked and need input, APPEND a line \`[copilot] NEEDS-INPUT <your question>\` to \`${paths.logRel}\` and pause.`,
    `- Then READ \`${paths.inboxRel}\` for the user's reply (B.L.A.S.T. writes each answer there as a \`[user] ...\` line). Wait/re-read until a new \`[user]\` line appears, then continue and log \`[copilot] RESUMED\`.`,
    '- Never fail the run just because you need input — ask and wait instead.',
    '',
    '## Definition of done',
    '1. `npx playwright test <spec> --project=desktop-chrome` passes with zero regressions.',
    '2. `npm run lint` → 0 and `npx tsc --noEmit` → 0.',
    '3. `npm run index` to refresh the capabilities index.',
    '',
    '## IMPORTANT — stream your progress to B.L.A.S.T.',
    `As you work, APPEND concise progress lines to \`${paths.logRel}\` (create it if missing) at each`,
    'milestone: reuse analysis, locator snapshot, files written, each test run, pass/fail, and the',
    'final report path. B.L.A.S.T. tails that file to show the live console. Also paste the tail of',
    'the Playwright run output into that same log. Keep secrets out of the log.',
    '',
    '### Status markers (REQUIRED — the UI keys off these exact lines)',
    'Write ONE of these as the LAST line when you finish or stop:',
    '- On success (spec passed, lint+tsc clean): `[copilot] DONE PASSED`',
    '- On a failing/blocked run you could not fix: `[copilot] DONE FAILED <one-line reason>`',
    '- If you must abort (missing info, cannot proceed): `[copilot] ERROR <one-line reason>`',
    'Emit a heartbeat line every major step so the console never looks frozen while you work.',
  ].join('\n');
}

/**
 * Write the JSON brief + prompt + .bat for the Copilot handoff.
 * Returns repo-relative + absolute paths so the route can spawn/return them.
 */
function writeCopilotHandoff(fw, job) {
  const paths = handoffPaths(fw, job.jobId);
  fs.mkdirSync(paths.runDir, { recursive: true });

  // 1) JSON brief (reuse the same contract the local run uses).
  const jobJsonRel = writeJobFile(fw, job) || paths.jobJsonRel;

  // 2) Seed the log so the tailer has something immediately.
  fs.writeFileSync(paths.logAbs, `[blast] Handoff created ${new Date().toISOString()} for ${job.jobId}. Waiting for Copilot to start…\n`, 'utf8');

  // 3) Prompt file (attached as context so the inline instruction stays short).
  fs.writeFileSync(paths.promptAbs, buildCopilotPrompt(job, paths), 'utf8');

  // 4) The .bat: cd into the framework, attach brief + prompt + skill + AGENT.md, run the
  //    agent with a SHORT inline instruction (a short arg auto-submits reliably; a long
  //    piped stdin prompt tends to open the chat without sending).
  // reason: select the repo's custom agent (name from .github/agents/*.agent.md) instead of the
  //   built-in generic 'agent' mode, so its persona + auto-loading skills (pw-new-automation) apply.
  const agentMode = 'AI Native Playwright Engineer';
  const skillRel = path.join('.github', 'skills', 'pw-new-automation', 'SKILL.md');
  const inline = `Follow the attached ${path.basename(paths.promptAbs)} exactly and implement this automation NOW: reuse-first, evidence-based locators via @playwright/cli, strict 3-layer, run the spec, and append your progress to ${paths.logRel}. Start immediately.`;
  const codeCli = resolveCodeCli();
  const bat = [
    '@echo off',
    'setlocal',
    `cd /d "${fw}"`,
    'echo [blast] Launching VS Code Copilot agent for this job...',
    `call "${codeCli}" chat --mode "${agentMode}" --reuse-window --add-file "${paths.promptAbs}" --add-file "${jobJsonRel}" --add-file "${skillRel}" --add-file "AGENT.md" "${inline.replace(/"/g, "'")}"`,
    `if errorlevel 1 echo [copilot] ERROR VS Code CLI launch failed - ensure "code" is on PATH>> "${paths.logRel}"`,
    'echo [blast] Handoff sent to Copilot. Watch the VS Code chat panel; execution logs stream to the B.L.A.S.T. console.',
    'endlocal',
    '',
  ].join('\r\n');
  fs.writeFileSync(paths.batAbs, bat, 'utf8');

  return {
    batAbs: paths.batAbs,
    batRel: `.blast-runs/run-blast-${String(job.jobId).replace(/[^A-Za-z0-9_-]/g, '_')}.bat`,
    logAbs: paths.logAbs,
    logRel: paths.logRel,
    promptRel: paths.promptRel,
    jobJsonRel,
  };
}

/** Spawn the handoff .bat detached so it opens VS Code without blocking the API. */
function launchCopilotHandoff(fw, job, { spawnBat = true } = {}) {
  const handoff = writeCopilotHandoff(fw, job);
  let launched = false;
  if (spawnBat) {
    try {
      const child = spawn('cmd.exe', ['/c', handoff.batAbs], {
        cwd: fw,
        env: process.env,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      launched = true;
    } catch {
      launched = false;
    }
  }
  return { ...handoff, launched };
}

/**
 * Read the current Copilot handoff log (tailed by the UI). Returns '' if none yet.
 * Sanitizes garbled bytes (the .bat/Playwright output can carry OEM/UTF-16 box-drawing
 * glyphs) so the streamed console stays readable instead of showing a wall of replacement
 * characters — that garbling is what made the logs look "disconnected" in the UI.
 */
function readCopilotLog(fw, jobId) {
  const { logAbs } = handoffPaths(fw, jobId);
  try {
    const raw = fs.readFileSync(logAbs, 'utf8');
    return raw
      .replace(/\uFFFD+/g, '')          // drop UTF-8 replacement chars (mis-decoded bytes)
      .replace(/[^\S\r\n\t]+$/gm, '')  // trim trailing junk whitespace per line
      .replace(/\r\n/g, '\n');
  } catch {
    return '';
  }
}

/**
 * Request a cooperative stop of a running Copilot handoff. We cannot force-kill the agent
 * running inside the VS Code chat, so we drop a stop sentinel + an inbox instruction the
 * agent checks at its next checkpoint, and echo a marker into the log for the live console.
 */
function requestCopilotStop(fw, jobId) {
  const { stopAbs, inboxAbs, logAbs } = handoffPaths(fw, jobId);
  const ts = new Date().toISOString();
  const stopLine = '[user] STOP — please halt this run now. Do not continue; stop at the next safe checkpoint and write a DONE FAILED stopped-by-user marker.\n';
  try { fs.mkdirSync(path.dirname(stopAbs), { recursive: true }); } catch { /* ignore */ }
  try { fs.writeFileSync(stopAbs, `STOP ${ts}\n`, 'utf8'); } catch { /* ignore */ }
  try { fs.appendFileSync(inboxAbs, stopLine, 'utf8'); } catch { /* ignore */ }
  try { fs.appendFileSync(logAbs, `[blast] STOP requested by user at ${ts}.\n${stopLine}`, 'utf8'); } catch { /* ignore */ }
  return true;
}

/** Append a user reply to the job's inbox (Copilot reads this to unblock) + echo into the log. */
function appendCopilotInput(fw, jobId, message) {
  const { inboxAbs, logAbs } = handoffPaths(fw, jobId);
  const line = `[user] ${String(message || '').replace(/\r?\n/g, ' ').trim()}\n`;
  try { fs.mkdirSync(path.dirname(inboxAbs), { recursive: true }); } catch { /* ignore */ }
  try { fs.appendFileSync(inboxAbs, line, 'utf8'); } catch { /* ignore */ }
  try { fs.appendFileSync(logAbs, line, 'utf8'); } catch { /* ignore */ }
  return true;
}

module.exports = {
  isConfigured,
  buildPlan,
  generateAndRun,
  pushBranch,
  config,
  resolveSkill,
  skillModeDirective,
  writeCopilotHandoff,
  launchCopilotHandoff,
  readCopilotLog,
  appendCopilotInput,
  requestCopilotStop,
};
