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
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const LLMConnector = require('./llm_connector');

const RUN_TIMEOUT_MS = Number(process.env.LOCAL_RUN_TIMEOUT_MS || 300000);
// The type-check gate compiles the generated code BEFORE the (slow) Playwright run so every
// contract violation (invented/missing method, wrong argument type/count, missing key) surfaces
// at once with file:line — the compiler encodes the WHOLE framework API. Skipped when TS absent.
const TSC_TIMEOUT_MS = Number(process.env.LOCAL_TSC_TIMEOUT_MS || 120000);
// How many times to ask the LLM for one case before giving up. LLMs are non-deterministic
// and sometimes answer a duplicate-looking case with prose (no ===FILE=== block); a retry
// (with a stricter directive) usually yields parseable code the behavioral dedup can then judge.
const GEN_ATTEMPTS = Number(process.env.BLAST_GEN_ATTEMPTS || 3);
const FILE_RE = /===FILE:([^|=]+)\|(page|module|spec|fixture|config|other)===\s*\n([\s\S]*?)\n===ENDFILE===/g;

// Sensible default model per platform when none is configured for that platform.
const DEFAULT_MODEL = {
  groq: 'openai/gpt-oss-120b',
  gemini: 'gemini-flash-latest',
  grok: 'grok-2',
  openai: 'gpt-5.6-luna',
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
 * Pick the most instructive spec exemplar. Prefer one that demonstrates an
 * authenticated flow (a test.beforeEach that logs in via the framework login
 * module) so the generator copies the "log in FIRST" pattern for auth-gated
 * pages; fall back to the first spec otherwise. App-agnostic — it matches the
 * framework's own login convention, not any specific site.
 */
function pickSpecExemplar(dir) {
  try {
    const specs = fs.readdirSync(dir).filter((f) => f.endsWith('.spec.ts'));
    if (!specs.length) return '';
    const authFirst = specs.find((f) => {
      const t = safeRead(path.join(dir, f), 20000);
      return /beforeEach/.test(t) && /\.login\s*\(/.test(t);
    });
    return path.join(dir, authFirst || specs[0]);
  } catch {
    return '';
  }
}

/**
 * Build heuristic-login auth for the generate-time snapshot from non-transient
 * sources only: APP_USERNAME/APP_PASSWORD (each app sets its own creds) plus
 * job.loginUrl/BASE_URL. Returns null when creds or a login target are missing
 * (snapshot then stays anonymous). App-agnostic — no site-specific values.
 */
function snapshotAuth(job) {
  const username = process.env.APP_USERNAME || process.env.EXPLORE_USER || '';
  const password = process.env.APP_PASSWORD || process.env.EXPLORE_PASS || '';
  if (!username || !password) return null;
  let loginUrl = (job && job.loginUrl && String(job.loginUrl).trim()) || process.env.BASE_URL || '';
  if (!loginUrl && job && job.url) { try { loginUrl = new URL(job.url).origin; } catch { loginUrl = ''; } }
  if (!loginUrl) return null;
  return { loginUrl, username, password };
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
/**
 * The AUTHORITATIVE public-method contract of the framework's shared action wrappers
 * (Actions/WaitHelper/WorkflowActions) plus the Logger. The LLM otherwise sees only ONE page + ONE
 * module exemplar and GUESSES methods that don't exist (e.g. `waitHelper.waitForURL`, or `Logger.step`
 * called statically) or passes the wrong argument type (e.g. `actions.press(object)` — press takes a
 * string) → runtime crashes the heal cannot recover. Surfacing the exact method set (and the static-vs-
 * instance shape of Logger) makes "call only methods that exist" enforceable. Generic: reads whatever
 * wrappers the framework ships under src/utils; skips any absent.
 */
function wrapperApi(fw, budget = 2200) {
  const wrappers = [
    ['Actions', 'this.actions', 'src/utils/Actions.ts'],
    ['WaitHelper', 'this.waitHelper', 'src/utils/WaitHelper.ts'],
    ['WorkflowActions', 'this.workflowActions', 'src/utils/WorkflowActions.ts'],
  ];
  const SKIP = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'function']);
  // Extract public method signatures, tagging static ones (matters for classes like Logger whose
  // step()/info() are INSTANCE methods but create() is static — calling them statically fails).
  const sigsOf = (src) => {
    const out = [];
    const re = /(^|\n)[ \t]*(public\s+|private\s+|protected\s+)?(static\s+)?(async\s+)?([a-zA-Z_]\w*)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      if (m[2] && m[2].trim() !== 'public') continue; // skip private/protected helpers
      const isStatic = !!m[3];
      const name = m[5];
      if (SKIP.has(name)) continue;
      // Balanced-paren scan of the parameter list (handles nested parens like `() => Promise`).
      let i = re.lastIndex - 1, depth = 0, params = '';
      for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '(') { depth++; if (depth === 1) continue; }
        else if (ch === ')') { depth--; if (depth === 0) { i++; break; } }
        params += ch;
      }
      // Confirm it is a method DECLARATION — the param list is followed by an opening body
      // brace, optionally with a `: ReturnType` annotation. A method CALL is followed by
      // `;`/`)`/`,`/`.` instead, so this excludes calls inside bodies. (if/for/while are SKIPped.)
      if (!/^\s*(:\s*[^\n{;]+)?\{/.test(src.slice(i))) continue;
      out.push({ name, isStatic, sig: `${name}(${params.replace(/\s+/g, ' ').replace(/,\s*$/, '').trim()})` });
    }
    return out;
  };
  const blocks = [];
  for (const [cls, inst, rel] of wrappers) {
    let src;
    try { src = fs.readFileSync(path.join(fw, rel), 'utf-8'); } catch { continue; }
    const sigs = [...new Set(sigsOf(src).map((s) => s.sig))];
    if (sigs.length) blocks.push(`${cls} — call as \`${inst}.<method>()\`:\n  ${sigs.join('\n  ')}`);
  }
  // Logger: created via a STATIC factory, then used as an INSTANCE — the exact shape the LLM keeps
  // getting wrong (it calls Logger.step()/Logger.info() statically, which do not exist on the class).
  try {
    const logSrc = fs.readFileSync(path.join(fw, 'src', 'utils', 'Logger.ts'), 'utf-8');
    const all = sigsOf(logSrc);
    const statics = [...new Set(all.filter((s) => s.isStatic).map((s) => s.sig))];
    const instance = [...new Set(all.filter((s) => !s.isStatic).map((s) => s.sig))];
    if (instance.length) {
      const factory = statics.find((s) => /^create\b/.test(s)) || 'create(context)';
      const stepSig = instance.find((s) => /^step\s*\(/.test(s));
      const numericFirst = stepSig && /^step\s*\(\s*\w+\s*:\s*number\b/.test(stepSig);
      const stepNote = numericFirst
        ? ` NOTE: step() takes a NUMERIC first argument (the step index) then the message — e.g. \`this.logger.step(1, '<message>')\`. To log a plain message with NO step number, call \`this.logger.info('<message>')\` (one string). NEVER call \`.step('<message>')\` with only a message string — it will not compile.`
        : '';
      blocks.push(
        `Logger — CREATE ONCE via the STATIC factory \`Logger.${factory}\` and store it (e.g. \`private logger = Logger.${factory.replace(/\(.*/, '')}('<Context>')\`), then call these INSTANCE methods on \`this.logger\`. NEVER call step()/info() statically on \`Logger\` (Logger.step / Logger.info do NOT exist):\n  ` + instance.join('\n  ') + stepNote,
      );
    }
  } catch { /* no Logger in this framework — skip */ }
  let text = blocks.join('\n');
  if (text.length > budget) text = text.slice(0, budget) + '\n… (truncated)';
  return text;
}

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
    capabilities: groundingIndex(fw, job, b.caps),
    wrapperApi: wrapperApi(fw, lean ? 1200 : 2200),
    pageEx: safeRead(firstMatchingFile(path.join(fw, 'src', 'pages'), 'Page.ts'), b.ex),
    moduleEx: safeRead(firstMatchingFile(path.join(fw, 'src', 'modules'), 'Module.ts'), b.ex),
    specEx: safeRead(pickSpecExemplar(path.join(fw, 'src', 'tests')), b.spec),
    testData: safeRead(path.join(fw, 'src', 'testdata', 'testData.json'), b.data),
    fixtures: safeRead(path.join(fw, 'src', 'fixtures', 'index.ts'), b.fix),
    smartLocator: b.smart ? safeRead(path.join(fw, 'src', 'utils', 'SmartLocator.ts'), b.smart) : '',
  };
}

function testCaseBlock(job) {
  return (job.testCases || [])
    .map((tc) => {
      const head = `- [${tc.id}] ${tc.title || ''}${tc.tags ? ` (tags: ${tc.tags})` : ''}`;
      const steps = String(tc.steps || '').trim();
      if (!steps) return head;
      const body = steps.split('\n').map((s) => `    ${s}`).join('\n');
      return `${head}\n  Journey/steps (follow IN ORDER; establish every precondition these imply through the app UI):\n${body}`;
    })
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

// Generic filler words that carry no domain signal. Excluded from distinctive matching so a
// bare id collision that only shares boilerplate ("user login with valid credentials") is NOT
// mistaken for the same test — the source of false "already automated" plan claims.
const GENERIC_TOKENS = new Set([
  'login', 'logout', 'user', 'users', 'valid', 'invalid', 'with', 'without', 'credentials',
  'credential', 'page', 'test', 'tests', 'verify', 'validate', 'validation', 'check', 'ensure',
  'the', 'and', 'for', 'using', 'use', 'from', 'into', 'that', 'this', 'when', 'then', 'should',
  'must', 'enter', 'click', 'button', 'field', 'fields', 'form', 'submit', 'attempt', 'attempts',
  'via', 'are', 'was', 'new', 'existing', 'system', 'app', 'application', 'flow', 'case',
  'scenario', 'successful', 'success', 'fail', 'failure', 'display', 'displays', 'shows', 'show',
  'showing', 'message', 'error', 'errors', 'exact', 'correct', 'proper', 'prevent', 'reject',
]);

/** Distinctive (non-generic, ≥3-char) tokens of a title/case — the words that actually identify it. */
function distinctiveTokens(s) {
  return [...new Set(normalizeText(s).split(' ').filter((w) => w.length >= 3 && !GENERIC_TOKENS.has(w)))];
}

/** Overlap fraction over DISTINCTIVE tokens only (filters generic filler that inflates false matches). */
function distinctiveOverlap(requested, have) {
  const want = distinctiveTokens(requested);
  if (!want.length) return 0;
  const set = new Set(distinctiveTokens(have));
  return want.filter((w) => set.has(w)).length / want.length;
}

/**
 * Strip the `TC_00N` id prefix and `@Tag` decorations from a title so only the human-readable
 * words remain. Manifest test titles are stored WITH tags/ids (e.g.
 * "TC_005 Locked User Login Attempt @Regression @Automation @Critical"); tokenizing those raw
 * pollutes the distinctive set with {005, regression, automation, …} and breaks matching.
 */
function titleCore(s) {
  return String(s || '')
    .replace(/@[^@]*/g, ' ')          // @Tags (a tag may contain spaces, e.g. "@Locked User Validation")
    .replace(/\bTC[_-]?\d+\b/gi, ' ')  // the TC id prefix
    .replace(/\s+/g, ' ')
    .trim();
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
 * Read the sharded reuse manifest (.ai-memory/capabilities.json, v2). Returns null
 * for a missing/legacy index so callers fall back to scanning spec files.
 */
function readManifest(fw) {
  try {
    const p = path.join(fw, '.ai-memory', 'capabilities.json');
    if (!fs.existsSync(p)) return null;
    const m = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return m && m.testIndex && /v2-sharded/.test(String(m.$schema || '')) ? m : null;
  } catch {
    return null;
  }
}

/** Canonicalize a TC id (TC1, tc-12, TC_007) to the manifest key form `TC_0NN`. */
function normId(id) {
  const m = String(id || '').match(/TC[_-]?0*(\d+)/i);
  return m ? 'TC_' + m[1].padStart(3, '0') : '';
}

/**
 * Compact cross-domain reuse API: every existing Page/Module class and its method NAMES
 * across ALL shards (bounded). The matched domain shard alone hides helpers from OTHER
 * domains — e.g. the add-to-cart method needed to set up a cart/checkout precondition lives
 * in the Inventory shard, not the Cart shard. Surfacing the whole API lets the model reuse a
 * real setup helper instead of re-implementing the interaction with a fragile locator.
 * Generic: works for ANY app ("to establish precondition X, is there already a method for it?").
 */
function crossDomainApi(fw, man, budget = 2500) {
  if (!man || !Array.isArray(man.domains)) return '';
  const modules = [];
  const pages = [];
  for (const d of man.domains) {
    let shard;
    try { shard = JSON.parse(fs.readFileSync(path.join(fw, d.shard), 'utf-8')); } catch { continue; }
    for (const m of (shard.modules || [])) {
      if (m && m.class && (m.methods || []).length) modules.push(`${m.class} (${m.file}): ${m.methods.join(', ')}`);
    }
    for (const p of (shard.pages || [])) {
      if (p && p.class && (p.methods || []).length) pages.push(`${p.class} (${p.file}): ${p.methods.join(', ')}`);
    }
  }
  if (!modules.length && !pages.length) return '';
  // Modules first — they hold the reusable WORKFLOWS that establish preconditions.
  const lines = ['Modules (reusable workflows — PREFER these to set up preconditions):', ...modules,
    'Pages (locators/getters):', ...pages];
  let text = lines.join('\n');
  if (text.length > budget) text = text.slice(0, budget) + '\n… (truncated)';
  return text;
}

/**
 * Grounding payload for the reuse index. With the v2 sharded manifest this injects a
 * lightweight OVERVIEW of every domain PLUS only the shard for the domain in play
 * (bounded tokens at thousands of tests). Falls back to the raw file for a legacy index.
 */
function groundingIndex(fw, job, budget) {
  const capsPath = path.join(fw, '.ai-memory', 'capabilities.json');
  const man = readManifest(fw);
  if (!man) return safeRead(capsPath, budget);
  const overview = {
    $schema: man.$schema,
    purpose: man.purpose,
    counts: man.counts,
    fixtures: man.fixtures,
    utils: man.utils,
    shardDir: man.shardDir,
    domains: man.domains,
  };
  let text = '### Reuse manifest (all domains — READ FIRST, reuse before creating)\n'
    + JSON.stringify(overview, null, 2);
  const api = crossDomainApi(fw, man, Math.min(2500, Math.max(1200, budget)));
  if (api) {
    text += '\n\n### Reusable API across ALL domains (existing Page/Module methods — REUSE these for setup/preconditions; do NOT re-implement an interaction that already has a method)\n' + api;
  }
  // Find the shard that owns the resolved spec/page/module (shards are grouped by domain,
  // so a spec may live in a shard named after its Page/Module, not its own basename).
  const dom = resolveDomain(fw, job);
  const owns = (man.domains || []).find((d) =>
    (d.specs || []).includes(dom.specRel) ||
    (d.pages || []).includes(dom.pageRel) ||
    (d.modules || []).includes(dom.moduleRel));
  const shardRel = owns ? owns.shard : `.ai-memory/domains/${String(dom.base || '').toLowerCase()}.json`;
  const shard = shardRel ? safeRead(path.join(fw, shardRel), Math.max(2000, budget)) : '';
  if (shard) {
    text += `\n\n### Domain shard "${owns ? owns.domain : dom.base}" (existing locators/methods/tests to REUSE or EXTEND — do NOT recreate)\n` + shard;
  }
  return text;
}

/**
 * Is this case already automated in ANY domain? Returns the spec rel path where it
 * lives, or '' if genuinely new. Uses the manifest's global testIndex (O(1), no
 * per-spec file reads) — title-first because TC ids are NOT globally unique, so a
 * bare id collision with a different title must NOT count. Falls back to scanning
 * spec files when the manifest is missing/legacy.
 */
/**
 * Title-based coverage match against a parsed manifest testIndex
 * ({ TC_id: [{domain,spec,title}] }). Returns the spec path where this case is already
 * automated, or '' if genuinely new. TC ids are NOT globally unique, so matching is
 * TITLE-first (never id-only): (1) normalized title-core substring either way, (2)
 * distinctive-token overlap ≥0.8 across any entry, (3) same-id entry whose distinctive
 * title overlaps ≥0.6. Exported and shared by BOTH the engine (caseCoveredAnywhere) and
 * the /coverage badge endpoint, so the UI status can never disagree with what the
 * generator actually does (an id collision with a different title is NOT "automated").
 */
function coveredSpecInIndex(testIndex, tc) {
  if (!testIndex) return '';
  // (1) title-core substring either way (across every entry — ids are not unique)
  const want = normalizeText(titleCore(tc && tc.title));
  if (want.length >= 6) {
    for (const arr of Object.values(testIndex)) {
      for (const e of (Array.isArray(arr) ? arr : [arr])) {
        const have = normalizeText(titleCore(e.title));
        if (have && (have.includes(want) || want.includes(have))) return e.spec;
      }
    }
  }
  // (2) distinctive-token overlap across EVERY entry (any id): catches a re-worded case
  // whose identifying words match an existing test even when the id/wording differ.
  const wantDist = distinctiveTokens(titleCore(tc && tc.title));
  if (wantDist.length) {
    for (const arr of Object.values(testIndex)) {
      for (const e of (Array.isArray(arr) ? arr : [arr])) {
        const haveDist = distinctiveTokens(titleCore(e.title));
        if (!haveDist.length) continue;
        const ov = distinctiveOverlap(titleCore(tc && tc.title), titleCore(e.title));
        if (ov >= 0.8 && (wantDist.length >= 2 || haveDist.length <= 2)) return e.spec;
      }
    }
  }
  // (3) same-id entry whose distinctive title substantially overlaps (wording drift)
  const rid = normId(tc && tc.id);
  const arr = rid ? testIndex[rid] : null;
  const list = arr ? (Array.isArray(arr) ? arr : [arr]) : [];
  let best = null;
  let bestScore = 0;
  for (const e of list) {
    const sc = distinctiveOverlap(titleCore(tc && tc.title), titleCore(e.title));
    if (sc > bestScore) { bestScore = sc; best = e; }
  }
  if (best && bestScore >= 0.6) return best.spec;
  return '';
}

function caseCoveredAnywhere(fw, tc) {
  if (!fw || !fs.existsSync(fw)) return '';
  const man = readManifest(fw);
  if (man && man.testIndex) return coveredSpecInIndex(man.testIndex, tc);
  for (const s of listSpecs(fw)) {
    if (caseCoveredInSpec(s.content, tc)) return s.rel;
  }
  return '';
}

/**
 * FEATURE-level coverage check for the Autopilot entry — is the requested FEATURE (a name like
 * "Logout" or "View Cart") already automated in the connected repo's gate, BEFORE any explore is
 * dispatched? Reuses coveredSpecInIndex (the SAME title/distinctive-token matcher the generator and
 * the /coverage badge use) by treating the feature name as a case title, then recovers the matching
 * test id + title for the UI. Returns { specPath, testId, title, domain } or null. Generic — no app rules.
 */
function featureCoverageInIndex(testIndex, feature) {
  const name = String(feature || '').trim();
  if (!testIndex || !name) return null;
  const specPath = coveredSpecInIndex(testIndex, { title: name });
  if (!specPath) return null;
  // Recover the id + title of the matching entry (best title overlap with the feature) for display.
  let match = null;
  let bestScore = -1;
  for (const [id, arr] of Object.entries(testIndex)) {
    for (const e of (Array.isArray(arr) ? arr : [arr])) {
      if (!e || e.spec !== specPath) continue;
      const sc = distinctiveOverlap(titleCore(name), titleCore(e.title));
      if (sc > bestScore) { bestScore = sc; match = { specPath, testId: id, title: e.title || '', domain: e.domain || '' }; }
    }
  }
  return match || { specPath, testId: '', title: '', domain: '' };
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
  const cases = job.testCases || [];
  // Tier 1 — a case TITLE appears verbatim in a spec: the same test is already present.
  let best = null;
  let bestCount = 0;
  for (const s of specs) {
    const count = cases.filter((tc) => idInText(s.content, tc)).length;
    if (count > bestCount) { best = s; bestCount = count; }
  }
  // Tier 2 — the coverage matcher maps the cases to an existing spec (re-worded duplicates
  // whose titles are NOT verbatim, e.g. a locked-user check that collapses onto login.spec.ts).
  if (!best) {
    const tally = new Map();
    for (const tc of cases) {
      const rel = caseCoveredAnywhere(fw, tc);
      if (rel) tally.set(rel, (tally.get(rel) || 0) + 1);
    }
    let topRel = null;
    let topN = 0;
    for (const [rel, n] of tally) { if (n > topN) { topRel = rel; topN = n; } }
    if (topRel) best = specs.find((s) => s.rel === topRel) || null;
  }
  // Tier 3 — distinctive-token affinity to an existing spec: route a genuinely-new case that
  // clearly belongs to an existing domain (a new locked-user edge case → login.spec.ts) into
  // that spec to EXTEND, instead of inventing a phantom domain from a tag. Strong signal only.
  if (!best && specs.length) {
    let topS = null;
    let topScore = 0;
    for (const s of specs) {
      const score = cases.reduce((a, tc) => a + distinctiveOverlap(tc.title, s.content), 0) / (cases.length || 1);
      if (score > topScore) { topScore = score; topS = s; }
    }
    if (topS && topScore >= 0.5) best = topS;
  }
  if (best) {
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
 *
 * opts.auth = { loginUrl, username, password } performs a heuristic form login BEFORE
 * snapshotting the target URL (Phase 3, auth-gated exploration). Credentials are passed to
 * the child ONLY via its process environment — never written to disk, the command line, or logs
 * — and the temp dir is purged after the run.
 */
function captureSnapshot(fw, url, opts = {}) {
  const auth = opts && opts.auth && opts.auth.username && opts.auth.password ? opts.auth : null;
  return new Promise((resolve) => {
    if (!url) return resolve('');
    const dir = path.join(fw, '.blast-tmp');
    const script = path.join(dir, 'capture.cjs');
    try {
      fs.mkdirSync(dir, { recursive: true });
      // The script reads creds from env (EXPLORE_USER/EXPLORE_PASS) so they never touch disk.
      fs.writeFileSync(script, [
        "const { chromium } = require('@playwright/test');",
        '(async () => {',
        '  const targetUrl = process.argv[2];',
        "  const loginUrl = process.argv[3] || '';",
        "  const user = process.env.EXPLORE_USER || '';",
        "  const pass = process.env.EXPLORE_PASS || '';",
        '  const browser = await chromium.launch();',
        '  try {',
        '    const page = await browser.newPage();',
        '    if (loginUrl && user && pass) {',
        "      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });",
        '      // Heuristic form login: first visible text-like input = username, first password input, then submit.',
        "      const userField = page.locator('input:not([type=password]):not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])').first();",
        "      const passField = page.locator('input[type=password]').first();",
        '      await userField.fill(user, { timeout: 10000 });',
        '      await passField.fill(pass, { timeout: 10000 });',
        '      // Prefer a REAL submit control (button/input[type=submit], or a Login/Sign in button); Enter as fallback.',
        '      const submitCandidates = [',
        "        page.locator('button[type=submit]').first(),",
        "        page.locator('input[type=submit]').first(),",
        "        page.getByRole('button', { name: /log ?in|sign ?in/i }).first(),",
        '      ];',
        '      let clicked = false;',
        '      for (const cand of submitCandidates) {',
        '        if (await cand.count().catch(() => 0)) { await cand.click({ timeout: 8000 }).catch(() => {}); clicked = true; break; }',
        '      }',
        "      if (!clicked) await passField.press('Enter').catch(() => {});",
        "      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});",
        '      await page.waitForTimeout(800);',
        '    }',
        '    let out = "";',
        '    if (loginUrl && user && pass) {',
        '      // Post-login landing (home/inventory) — evidence for setup steps like adding an item before the target page.',
        "      const landing = await page.locator('body').ariaSnapshot().catch(() => '');",
        '      if (landing) out += "### POST-LOGIN LANDING (" + page.url() + ") — use this to set up preconditions\\n" + landing.slice(0, 3500) + "\\n\\n";',
        '    }',
        "    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });",
        '    await page.waitForTimeout(1000);',
        "    const target = await page.locator('body').ariaSnapshot();",
        '    out += "### TARGET PAGE (" + targetUrl + ")\\n" + target;',
        '    process.stdout.write(out);',
        '  } finally { await browser.close(); }',
        '})().catch((e) => { process.stderr.write(String(e)); process.exit(1); });',
      ].join('\n'), 'utf8');
    } catch {
      return resolve('');
    }
    // Run via a relative path (cwd = framework) so a space-containing FRAMEWORK_PATH
    // isn't split when shell:true concatenates args.
    const args = ['.blast-tmp/capture.cjs', url, auth ? auth.loginUrl || '' : ''];
    // Creds go through the child ENV only (never argv/logs); env is copied so we don't mutate ours.
    const childEnv = { ...process.env };
    if (auth) { childEnv.EXPLORE_USER = auth.username; childEnv.EXPLORE_PASS = auth.password; }
    const child = spawn('node', args, { cwd: fw, env: childEnv, shell: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(''); }, auth ? 70000 : 45000);
    child.on('close', () => {
      clearTimeout(timer);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve(out.trim().slice(0, 9000));
    });
    child.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

// The child driver: one persistent session that logs in once, then WALKS the flow — after each
// page it optionally performs a bounded, non-destructive interaction pass (fill-valid → submit,
// empty → submit) so we capture the REAL post-action states (success + validation messages), not
// just static page loads. Config comes via env DRIVE_CFG (no secrets) + EXPLORE_USER/PASS.
const DRIVE_SCRIPT = [
  "const { chromium } = require('@playwright/test');",
  '(async () => {',
  "  const cfg = JSON.parse(process.env.DRIVE_CFG || '{}');",
  '  const urls = Array.isArray(cfg.urls) ? cfg.urls : [];',
  "  const loginUrl = cfg.loginUrl || '';",
  '  const allowSubmit = !!cfg.allowSubmit;',
  '  const autoDiscover = !!cfg.autoDiscover;',
  '  const maxDepth = Number(cfg.maxDepth) > 0 ? Number(cfg.maxDepth) : 8;',
  "  const stateFile = cfg.stateFile || '';",
  "  const user = process.env.EXPLORE_USER || '';",
  "  const pass = process.env.EXPLORE_PASS || '';",
  '  const states = [];',
  '  const observed = { errors: [], success: [] };',
  "  const diag = { loginRequested: false, loginStatus: 0, loginErr: '', authOk: false, landedUrl: '' };",
  '  const MAX_STATES = 14;',
  '  // Slow SPAs (e.g. OrangeHRM) may not have rendered when we first snapshot — retry on an empty tree.',
  '  const snap = async (page) => {',
  "    let s = await page.locator('body').ariaSnapshot().catch(() => '');",
  '    if (!s || s.trim().length < 20) {',
  "      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});",
  '      await page.waitForTimeout(2000);',
  "      s = await page.locator('body').ariaSnapshot().catch(() => '');",
  '    }',
  "    return String(s || '').slice(0, 4000);",
  '  };',
  '  // Generic, standards-based menu/dropdown reveal: open collapsed menus so items hidden until a',
  '  // click (Logout, About, submenus, tabs) become discoverable in ANY app — uses only ARIA/HTML',
  '  // semantics, never app-specific CSS, and never ACTIVATES destructive items (logout/delete).',
  '  const revealMenus = async (p) => {',
  '    const DESTRUCTIVE_R = /delete|remove|logout|sign ?out|reset|clear|cancel|discard|deactivate/i;',
  "    const sel = '[aria-haspopup], [aria-expanded=\"false\"], [data-toggle=\"dropdown\"], [data-bs-toggle=\"dropdown\"], [class*=\"caret\"], [class*=\"chevron\"], [class*=\"arrow-down\"], [class*=\"arrow_drop_down\"], [class*=\"dropdown-toggle\"], summary';",
  '    const extra = [];',
  '    try {',
  '      const trg = p.locator(sel);',
  '      const n = await trg.count().catch(() => 0);',
  '      const startUrl = p.url();',
  '      for (let i = 0; i < Math.min(n, 12); i++) {',
  '        const t = trg.nth(i);',
  '        if (!(await t.isVisible().catch(() => false))) continue;',
  "        const txt = ((await t.innerText().catch(() => '')) || '').trim();",
  '        if (DESTRUCTIVE_R.test(txt)) continue;',
  '        await t.click({ timeout: 2500 }).catch(() => {});',
  '        await p.waitForTimeout(250);',
  "        if (p.url() !== startUrl) { await p.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}); continue; }",
  "        const s = await p.locator('body').ariaSnapshot().catch(() => '');",
  "        for (const ln of String(s).split('\\n')) { if (/\\b(menuitem|menuitemcheckbox|menuitemradio|option|tab)\\b/.test(ln)) extra.push(ln.trim()); }",
  "        await p.keyboard.press('Escape').catch(() => {});",
  '        await p.waitForTimeout(120);',
  '      }',
  '    } catch (e) { /* best-effort */ }',
  "    return extra.length ? ('\\n' + [...new Set(extra)].slice(0, 60).join('\\n')) : '';",
  '  };',
  '  const addState = async (page, label) => { if (states.length < MAX_STATES) { const base = await snap(page); const menus = await revealMenus(page); states.push({ label, url: page.url(), snapshot: (base + menus).slice(0, 6000) }); } };',
  "  const primaryRe = /continue|finish|checkout|place order|submit|confirm|save|next|pay/i;",
  '  const primaryOf = (page) => page.getByRole(\'button\', { name: primaryRe }).first();',
  '  const grabMessages = async (page) => {',
  "    const sels = ['[data-test*=\"error\"]', '.error-message-container', '.error', '[role=\"alert\"]', '.complete-header', '.complete-text', '[data-test=\"complete-header\"]', '[data-test=\"complete-text\"]'];",
  '    for (const s of sels) {',
  '      const loc = page.locator(s);',
  '      const n = await loc.count().catch(() => 0);',
  '      for (let i = 0; i < Math.min(n, 4); i++) {',
  "        const t = (await loc.nth(i).innerText().catch(() => '')).trim();",
  '        if (!t) continue;',
  '        const success = /thank|success|complete|confirmed|your order/i.test(t) || /complete/.test(s);',
  '        (success ? observed.success : observed.errors).push(t.slice(0, 160));',
  '      }',
  '    }',
  '  };',
  '  const fillValid = async (page) => {',
  "    const fields = page.locator('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea');",
  '    const n = await fields.count().catch(() => 0);',
  '    for (let i = 0; i < Math.min(n, 8); i++) {',
  '      const f = fields.nth(i);',
  '      if (!(await f.isVisible().catch(() => false))) continue;',
  "      const nm = ((await f.getAttribute('name')) || (await f.getAttribute('placeholder')) || (await f.getAttribute('aria-label')) || '').toLowerCase();",
  "      const type = (await f.getAttribute('type')) || 'text';",
  "      let v = 'Test';",
  "      if (/mail/.test(nm)) v = 'user@example.com';",
  "      else if (/zip|postal|pin/.test(nm)) v = '12345';",
  "      else if (/phone|mobile|tel/.test(nm)) v = '5551234567';",
  "      else if (/first/.test(nm)) v = 'John';",
  "      else if (/last/.test(nm)) v = 'Doe';",
  "      else if (/pass/.test(nm)) v = 'Passw0rd!';",
  "      else if (/user/.test(nm)) v = 'standard_user';",
  "      if (type === 'number') v = '42';",
  '      await f.fill(String(v)).catch(() => {});',
  '    }',
  '  };',
  '  const browser = await chromium.launch();',
  '  try {',
  '    const page = await browser.newPage();',
  '    if (loginUrl && user && pass) {',
  '      diag.loginRequested = true;',
  '      let _resp = null;',
  "      try { _resp = await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) { diag.loginErr = 'nav:' + String((e && e.message) || e); }",
  '      diag.loginStatus = _resp ? _resp.status() : 0;',
  "      await page.locator('input:not([type=password]):not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])').first().fill(user, { timeout: 10000 }).catch(() => {});",
  "      await page.locator('input[type=password]').first().fill(pass, { timeout: 10000 }).catch(() => {});",
  '      const subs = [',
  "        page.locator('button[type=submit]').first(),",
  "        page.locator('input[type=submit]').first(),",
  "        page.getByRole('button', { name: /log ?in|sign ?in/i }).first(),",
  '      ];',
  '      let clicked = false;',
  '      for (const c of subs) { if (await c.count().catch(() => 0)) { await c.click({ timeout: 8000 }).catch(() => {}); clicked = true; break; } }',
  "      if (!clicked) await page.locator('input[type=password]').first().press('Enter').catch(() => {});",
  "      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});",
  "      const _errSel = '[data-test=error], .error-message-container, [role=alert], .error, .error-message';",
  "      if (!diag.loginErr) { diag.loginErr = ((await page.locator(_errSel).first().innerText().catch(() => '')) || '').trim().slice(0, 200); }",
  '      diag.landedUrl = page.url();',
  "      const _pwdVisible = await page.locator('input[type=password]').first().isVisible().catch(() => false);",
  '      diag.authOk = !diag.loginErr && !_pwdVisible;',
  '      // Hand off the authenticated storage state (cookies/tokens only — NO password) for @playwright/cli evidence.',
  '      if (stateFile) { try { await page.context().storageState({ path: stateFile }); } catch (e) { /* best-effort */ } }',
  '      await page.waitForTimeout(600);',
  '    }',
  '    const runFlow = async (page) => { for (const u of urls) {',
  "      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});",
  '      await page.waitForTimeout(700);',
  "      await addState(page, 'view');",
  '      if (!allowSubmit) continue;',
  '      const hasPrimary = await primaryOf(page).count().catch(() => 0);',
  '      if (!hasPrimary) continue;',
  "      const fields = page.locator('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea');",
  '      const nFields = await fields.count().catch(() => 0);',
  '      if (nFields > 0) {',
  '        await primaryOf(page).click({ timeout: 8000 }).catch(() => {});',
  '        await page.waitForTimeout(500);',
  '        await grabMessages(page);',
  "        await addState(page, 'after-empty-submit');",
  "        await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});",
  '        await page.waitForTimeout(500);',
  '        await fillValid(page);',
  '        await primaryOf(page).click({ timeout: 8000 }).catch(() => {});',
  '        await page.waitForTimeout(800);',
  '        await grabMessages(page);',
  "        await addState(page, 'after-valid-submit');",
  '      } else {',
  '        await primaryOf(page).click({ timeout: 8000 }).catch(() => {});',
  '        await page.waitForTimeout(800);',
  '        await grabMessages(page);',
  "        await addState(page, 'after-advance');",
  '      }',
  '    } };',
  '    const visited = new Set();',
  "    const DESTRUCTIVE = /delete|remove|logout|sign ?out|reset|clear|cancel|discard/i;",
  '    const pageLabel = (p) => { try { const uu = new URL(p.url()); return (uu.pathname.split(\'/\').pop() || uu.hostname).replace(/\\.html?$/, \'\') || \'page\'; } catch (e) { return \'page\'; } };',
  "    const hasForm = async (p) => await p.locator('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea').count().catch(() => 0);",
  '    const probeForm = async (p, backUrl) => {',
  '      if (!(await primaryOf(p).count().catch(() => 0))) return false;',
  '      await primaryOf(p).click({ timeout: 8000 }).catch(() => {});',
  "      await p.waitForTimeout(500); await grabMessages(p); await addState(p, 'after-empty-submit');",
  "      if (backUrl) { await p.goto(backUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}); } else { await p.goBack({ timeout: 8000 }).catch(() => {}); }",
  '      await p.waitForTimeout(400); await fillValid(p);',
  '      await primaryOf(p).click({ timeout: 8000 }).catch(() => {});',
  "      await p.waitForTimeout(900); await grabMessages(p); await addState(p, 'after-valid-submit');",
  '      return true;',
  '    };',
  '    const clickForward = async (p) => {',
  '      let acts = [];',
  "      try { acts = await p.$$eval('button, a, input[type=submit], [role=button], [data-test*=cart], [data-test*=checkout]', (els) => els.map((e) => ({ tag: e.tagName.toLowerCase(), text: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 40), href: e.getAttribute('href') || '', dt: e.getAttribute('data-test') || '' }))); } catch (e) { acts = []; }",
  '      const pri = [/checkout/i, /place order|finish/i, /continue|next|proceed/i, /go to cart|view cart|your cart/i, /add to cart/i];',
  '      for (const rx of pri) {',
  '        const cand = acts.find((a) => a.text && rx.test(a.text) && !DESTRUCTIVE.test(a.text) && !visited.has(a.text.toLowerCase()));',
  "        if (cand) { visited.add(cand.text.toLowerCase()); const role = cand.tag === 'a' ? 'link' : 'button'; await p.getByRole(role, { name: cand.text }).first().click({ timeout: 8000 }).catch(() => {}); await p.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => {}); await p.waitForTimeout(700); return true; }",
  '      }',
  '      const nav = acts.find((a) => (/cart|checkout/i.test(a.href) || /cart|checkout/i.test(a.dt)) && !visited.has(\'nav:\' + (a.href || a.dt)));',
  "      if (nav) { visited.add('nav:' + (nav.href || nav.dt)); const sel = nav.dt ? ('[data-test=' + JSON.stringify(nav.dt) + ']') : ('a[href=' + JSON.stringify(nav.href) + ']'); await p.locator(sel).first().click({ timeout: 8000 }).catch(() => {}); await p.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => {}); await p.waitForTimeout(700); return true; }",
  '      return false;',
  '    };',
  '    const walk = async (p) => {',
  '      let depth = 0;',
  '      while (depth < maxDepth && states.length < MAX_STATES) {',
  '        depth++;',
  "        await addState(p, pageLabel(p) + ' view');",
  '        if (/complete|success|thank|confirmation/i.test(p.url())) { await grabMessages(p); break; }',
  '        if (allowSubmit && (await hasForm(p)) > 0) { const back = p.url(); if (await probeForm(p, back)) continue; }',
  '        if (!allowSubmit) break;',
  '        if (!(await clickForward(p))) break;',
  '      }',
  '    };',
  '    if (autoDiscover) {',
  "      await page.goto(urls[0] || loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});",
  '      await page.waitForTimeout(600);',
  '      diag.landedUrl = page.url();',
  '      await walk(page);',
  '    } else {',
  '      await runFlow(page);',
  '    }',
  '    observed.errors = [...new Set(observed.errors)].slice(0, 10);',
  '    observed.success = [...new Set(observed.success)].slice(0, 6);',
  '    process.stdout.write(JSON.stringify({ states, observed, diag }));',
  '  } catch (e) {',
  '    process.stdout.write(JSON.stringify({ states, observed, diag, error: String((e && e.message) || e) }));',
  '  } finally { await browser.close(); }',
  "})().catch((e) => { process.stderr.write(String(e)); process.exit(1); });",
].join('\n');

function parseDrive(out) {
  try {
    const j = JSON.parse(String(out).trim());
    return { states: Array.isArray(j.states) ? j.states : [], observed: j.observed || { errors: [], success: [] }, diag: j.diag || {}, error: j.error };
  } catch {
    return { states: [], observed: { errors: [], success: [] }, diag: {} };
  }
}

/**
 * Stateful, action-aware exploration: one browser session that logs in once and walks every flow
 * URL, snapshotting the state AFTER each bounded interaction (fill-valid→submit to reach the next
 * state / success; empty→submit to surface validation errors). `allowSubmit` is gated to non-prod
 * by the caller. Returns { states:[{label,url,snapshot}], observed:{errors,success} }. Credentials
 * go through the child env only — never argv, disk, or logs.
 */
function driveFlow(fw, urls, opts = {}) {
  const auth = opts.auth && opts.auth.username && opts.auth.password ? opts.auth : null;
  const allowSubmit = !!opts.allowSubmit;
  return new Promise((resolve) => {
    const list = (urls || []).filter(Boolean);
    if (!list.length) return resolve({ states: [], observed: { errors: [], success: [] }, diag: {} });
    const dir = path.join(fw, '.blast-tmp');
    const script = path.join(dir, 'drive.cjs');
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(script, DRIVE_SCRIPT, 'utf8');
    } catch {
      return resolve({ states: [], observed: { errors: [], success: [] }, diag: {} });
    }
    const cfg = { urls: list, loginUrl: auth ? auth.loginUrl || '' : '', allowSubmit, autoDiscover: list.length <= 1, maxDepth: Number(opts.maxDepth) > 0 ? Number(opts.maxDepth) : 8, stateFile: opts.stateFile || '' };
    const childEnv = { ...process.env, DRIVE_CFG: JSON.stringify(cfg) };
    if (auth) { childEnv.EXPLORE_USER = auth.username; childEnv.EXPLORE_PASS = auth.password; }
    const child = spawn('node', ['.blast-tmp/drive.cjs'], { cwd: fw, env: childEnv, shell: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', () => { /* diagnostics only */ });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(parseDrive(out)); }, 150000);
    child.on('close', () => {
      clearTimeout(timer);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve(parseDrive(out));
    });
    child.on('error', () => { clearTimeout(timer); resolve({ states: [], observed: { errors: [], success: [] }, diag: {} }); });
  });
}

/** Run one @playwright/cli command in a named session; resolves stdout (best-effort). */
function runCli(fw, session, args, timeoutMs = 40000) {
  return new Promise((resolve) => {
    const child = spawn('playwright-cli', [`-s=${session}`, ...args], { cwd: fw, shell: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', () => { /* diagnostics only */ });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(out); }, timeoutMs);
    child.on('close', () => { clearTimeout(timer); resolve(out); });
    child.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

/**
 * Capture authoritative locator evidence via @playwright/cli (Microsoft-recommended path).
 * Auth is handed off as a saved storage state (cookies only — NO credentials in argv/logs).
 * Returns [{ url, snapshot }]; best-effort, never throws.
 */
async function captureCliEvidence(fw, urls, opts = {}) {
  const list = [...new Set((urls || []).filter(Boolean))];
  if (!list.length) return [];
  const session = `blast-${Date.now().toString(36)}`;
  const log = opts.log || (() => {});
  const evidence = [];
  try {
    await runCli(fw, session, ['open']);
    if (opts.stateFile && fs.existsSync(opts.stateFile)) {
      await runCli(fw, session, ['state-load', opts.stateFile]);
      log('[cli] Loaded authenticated storage state (no credentials exposed).');
    }
    for (const url of list) {
      await runCli(fw, session, ['goto', url]);
      // SPAs (OrangeHRM, Salesforce, most React/Angular apps) render AFTER navigation, so an
      // immediate snapshot returns an empty aria tree ("0 screens"). Retry until the tree has
      // real structure (or the budget runs out) so codegen gets PROVEN element refs.
      let snap = '';
      for (let attempt = 0; attempt < 6; attempt++) {
        const raw = await runCli(fw, session, ['snapshot']);
        const m = raw.match(/```yaml\n([\s\S]*?)```/);
        const s = (m ? m[1] : raw).trim();
        snap = s.slice(0, 4000);
        if (s.split('\n').filter((l) => /^\s*-\s+\w/.test(l)).length >= 3) break; // rendered
        await new Promise((r) => setTimeout(r, 800));
      }
      if (snap) { evidence.push({ url, snapshot: snap }); log(`[cli] Captured @playwright/cli snapshot for ${url} (${snap.length} chars).`); }
    }
  } catch { /* best-effort */ } finally {
    await runCli(fw, session, ['close']).catch(() => {});
  }
  return evidence;
}

/** Build the union feature model from a walked state sequence + attach the observed messages. */
function modelFromStates(states, feature, observed) {
  const stepModels = (states || []).map((s, i) => {
    const m = buildFeatureModel(s.snapshot, feature);
    m.url = s.url; m.label = s.label || `State ${i + 1}`; m.snapshot = s.snapshot;
    return m;
  });
  const model = mergeFeatureModels(stepModels, feature);
  model.observed = {
    errors: (observed && observed.errors) || [],
    success: (observed && observed.success) || [],
  };
  return model;
}

/* ──────────────────────────────────────────────────────────────────────────
 * LEVEL 3 — agentic live codegen evidence. The LLM DRIVES the real app via
 * @playwright/cli one action at a time (snapshot → pick a REAL ref → act →
 * verify the result), and each action that works yields the EXACT Playwright
 * locator the CLI actually executed. The ordered list of PROVEN locators is fed
 * to codegen as the highest-priority evidence, so the writer reuses locators
 * that provably exist instead of guessing — killing the invented-locator /
 * wrong-control failure class. Flag-gated (BLAST_LEVEL3=1); any failure or empty
 * result falls back cleanly to the existing static/live-walk evidence. Generic:
 * BASE_URL + creds are the only app-specific inputs.
 * ────────────────────────────────────────────────────────────────────────── */

/** Parse `- role "name" [ref=eNN]` rows from a @playwright/cli snapshot → interactable refs.
 * Returns standard controls FIRST (prio 0), then menu OPENERS (avatars/icons, prio 1), then named
 * non-standard containers (styled toggles, prio 2). Widening beyond the standard roles is what lets
 * the crawl open profile/kebab/dropdown menus (whose toggle is a nameless <p>/<span>+avatar) so it
 * can actually reach Logout/Settings and capture the REAL locator instead of the model guessing. */
function parseCliRefs(snapshot) {
  const out = [];
  // Refs may be plain (`e15`) or frame-scoped (`f3e3`) — accept any alphanumeric ref token.
  const re = /^\s*-?\s*([a-zA-Z]+)(?:\s+"([^"]*)")?[^\n]*\[ref=([a-z0-9]+)\]/;
  const interactable = new Set(['textbox', 'searchbox', 'spinbutton', 'button', 'link', 'checkbox',
    'combobox', 'radio', 'switch', 'slider', 'menuitem', 'menuitemcheckbox', 'tab', 'option', 'listitem']);
  // Menu openers: an avatar/icon that toggles a dropdown but carries a non-interactable role.
  const openerRoles = new Set(['img']);
  // Named styled containers that are frequently the clickable menu toggle itself.
  const namedContainerRoles = new Set(['generic', 'paragraph', 'group', 'menu', 'menubar', 'banner']);
  for (const line of String(snapshot || '').split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const role = m[1].toLowerCase();
    const name = (m[2] || '').trim();
    let prio;
    if (interactable.has(role)) prio = 0;
    else if (openerRoles.has(role)) prio = 1;
    else if (name && namedContainerRoles.has(role)) prio = 2;
    else continue;
    if (out.some((r) => r.ref === m[3])) continue;
    out.push({ role, name, ref: m[3], prio });
  }
  // Real controls first so the caller's ref cap never drops them; openers/containers fill the rest.
  out.sort((a, b) => a.prio - b.prio);
  return out.map(({ prio, ...r }) => r);
}

/** @playwright/cli echoes the REAL locator it ran inside a ```js …``` block — capture it. */
function extractRanLocator(cliOutput) {
  const m = String(cliOutput || '').match(/```js\n([\s\S]*?)```/);
  if (!m) return '';
  // Keep only the page.locator/getBy call line(s); drop the action (.click()/.fill()) so the
  // Page layer stores the LOCATOR, and strip any filled value so a secret can never leak.
  return m[1].trim();
}

/** Pull the current Page URL @playwright/cli reports after an action (to detect navigation). */
function extractPageUrl(cliOutput) {
  const m = String(cliOutput || '').match(/Page URL:\s*(\S+)/);
  return m ? m[1] : '';
}

/** Render a verified action trace as authoritative codegen evidence. */
function renderLiveTrace(trace) {
  if (!trace || !trace.length) return '';
  return trace.map((t, i) => {
    const loc = t.locator ? t.locator.replace(/\s*\n\s*/g, ' ').slice(0, 220) : '(locator not captured)';
    const bits = [`${i + 1}. ${t.intent}`, `   proven Playwright code: ${loc}`];
    if (t.value) bits.push(`   value used: "${t.value}"`);
    if (t.navigated) bits.push(`   → navigated to ${t.url}`);
    return bits.join('\n');
  }).join('\n');
}

/** Ask the LLM for the SINGLE next live action, constrained to refs that exist on the page NOW. */
async function llmNextAction(job, tc, trace, snapshotYaml, refs, preAuth = false) {
  const refList = refs.map((r) => `- ref=${r.ref} ${r.role} "${r.name}"`).join('\n');
  const done = trace.length
    ? trace.map((t, i) => `${i + 1}. ${t.action} "${t.name}"${t.value ? ` = "${t.value}"` : ''}${t.navigated ? ` → ${t.url}` : ''}`).join('\n')
    : '(none yet)';
  // tc.steps may be an array (authored) OR a single string (UI/job payload) — handle both.
  let steps = '';
  if (Array.isArray(tc.steps)) {
    steps = tc.steps.map((s, i) => {
      const txt = typeof s === 'string' ? s : (s.action || s.step || s.description || JSON.stringify(s));
      return `${i + 1}. ${txt}`;
    }).join('\n');
  } else if (tc.steps) {
    steps = String(tc.steps);
  }
  const expected = Array.isArray(tc.expectedResults) ? tc.expectedResults.join('; ') : (tc.expectedResults || '');
  // Credential rule depends on the mode: on the feature's own pre-auth screen (login/signup/search)
  // the agent SHOULD exercise the form with safe/invalid values; past login it must never type creds.
  const credRule = preAuth
    ? 'This is the feature\'s OWN target screen (for example a login, signup, or search form). You MAY fill fields with SAMPLE or intentionally INVALID values and submit them to observe the form\'s validation or success behaviour — but NEVER type a REAL account username or password; use obviously-fake values such as "invalid_user" / "wrong_pass".'
    : 'Login is ALREADY done — NEVER type a username or password.';
  const prompt = [
    'You are driving a REAL browser to reproduce ONE test case, choosing ONE next action at a time from the LIVE page.',
    `\n# Test case: ${tc.id || ''} ${tc.title || ''}`,
    steps ? `\n# Intended steps\n${steps}` : '',
    expected ? `\n# Expected result\n${expected}` : '',
    `\n# Steps already performed (verified live)\n${done}`,
    `\n# The LIVE page RIGHT NOW — interactable elements. Choose a ref from THIS list ONLY:\n${refList}`,
    `\n# Full page snapshot (context)\n${String(snapshotYaml || '').slice(0, 2500)}`,
    '\n# Return the SINGLE next action as STRICT JSON (no prose):',
    '{"action":"click|fill|select|check|done","ref":"eNN from the list above (empty when done)","value":"text for fill/select, else empty","note":"short human-readable intent"}',
    'Rules: pick ONLY a ref that appears in the list above (never invent one). Do the MINIMUM to advance this case toward its expected result. ' + credRule + ' When the case goal is reached or no useful action remains, return {"action":"done"}. Reply with JSON only.',
    'REVEAL HIDDEN ITEMS: if the control you need next (e.g. Logout, Sign out, Settings, Profile, a menu entry) is NOT in the list above, it is almost certainly hidden inside a menu that must be OPENED first. Click the control that opens it — a user avatar / "profile picture" image, a ⋮/kebab/hamburger/caret icon, or a user-name/menu toggle in the top bar (these appear as img or named container refs) — and the revealed items will show up in the NEXT snapshot for you to click. Do NOT answer "done" just because the final item is not yet visible; open the menu first, then pick the item.',
  ].filter(Boolean).join('\n');
  const raw = await llmGenerate(prompt, 'You are a precise browser-automation agent. Reply with STRICT JSON only.');
  try {
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

/**
 * Drive the PRIMARY journey of a feature LIVE via @playwright/cli and return a verified
 * action trace (proven locators, in order) as codegen evidence. Uses the representative case
 * to steer the walk. Secure auth: an env-cred library login saves a storage state which the CLI
 * `state-load`s — credentials NEVER touch the CLI argv/logs. Best-effort; returns '' on any issue.
 */
async function driveFeatureLive(fw, job, tc, auth, log, opts = {}) {
  if (process.env.BLAST_LEVEL3 !== '1') return '';
  if (!auth || !auth.username || !auth.password) return '';
  if (String(job.environment || '').toLowerCase().startsWith('prod')) return '';
  const ver = await runCli(fw, 'l3-probe', ['--version'], 8000).catch(() => '');
  if (!ver || !/\d/.test(ver)) { log('[L3] @playwright/cli not available on this runner — skipping Level 3 (using standard evidence).'); return ''; }

  const samePath = (a, b) => {
    try { return new URL(a).pathname.replace(/\/+$/, '') === new URL(b).pathname.replace(/\/+$/, ''); }
    catch { return false; }
  };
  const readSnap = async () => {
    const rawSnap = await runCli(fw, session, ['snapshot']);
    const yaml = (rawSnap.match(/```yaml\n([\s\S]*?)```/) || [, ''])[1] || rawSnap;
    return { rawSnap, yaml, refs: parseCliRefs(yaml).slice(0, 60) };
  };

  const stateFile = path.join(fw, '.blast-l3-state.json');
  try { fs.rmSync(stateFile, { force: true }); } catch { /* ignore */ }

  const targetUrl = job.url;                              // the feature's OWN screen
  const landingUrl = (opts && opts.startUrl) || job.url;  // authenticated landing (post-login)
  const session = `l3-${Date.now().toString(36)}`;
  const trace = [];
  const maxSteps = Number(process.env.BLAST_LEVEL3_STEPS) > 0 ? Number(process.env.BLAST_LEVEL3_STEPS) : 12;
  // Never let a REAL credential travel through the CLI (its output echoes filled values).
  const isCred = (v) => !!v && (v === auth.username || v === auth.password);
  let currentUrl = targetUrl;
  try {
    await runCli(fw, session, ['open']);

    // 1) PRE-AUTH PROBE — is the feature's OWN screen reachable WITHOUT logging in first?
    //    Login / signup / public-search forms live here. Level 3 used to always authenticate and
    //    start PAST this screen, so a login feature captured nothing and dropped to Level 2. If the
    //    target screen is reachable pre-auth and has controls, drive it LIVE with safe/invalid
    //    values only (never real creds) to capture its real form locators + validation. Generic.
    const probeOut = await runCli(fw, session, ['goto', targetUrl]);
    let { rawSnap, yaml, refs } = await readSnap();
    const probedUrl = extractPageUrl(probeOut) || extractPageUrl(rawSnap) || targetUrl;
    const preAuth = samePath(probedUrl, targetUrl) && refs.length > 0;

    if (preAuth) {
      currentUrl = probedUrl;
      log(`[L3] Feature screen ${targetUrl} is reachable pre-login — driving it LIVE (safe/invalid values only; real credentials are NEVER typed).`);
    } else {
      // 2) AUTHENTICATED FEATURE — the target needs a session. Capture a storage state via an
      //    env-cred library login (no secret through the CLI), load it, start on the in-app page.
      log('[L3] Feature requires a session — capturing a storage state (no credentials pass through the CLI)…');
      try { await driveFlow(fw, [job.loginUrl || job.url], { auth, allowSubmit: false, stateFile }); } catch { /* best-effort */ }
      const authed = fs.existsSync(stateFile);
      log(authed ? '[L3] Storage state captured ✓ — the CLI session is authenticated with no secrets in argv.' : '[L3] No storage state captured — continuing on public pages only.');
      if (authed) await runCli(fw, session, ['state-load', stateFile]);
      const gotoOut = await runCli(fw, session, ['goto', landingUrl]);
      currentUrl = extractPageUrl(gotoOut) || landingUrl;
      ({ rawSnap, yaml, refs } = await readSnap());
      if (!refs.length) {
        // First snapshot can be empty if the page has not settled — re-navigate + retry ONCE.
        log(`[L3] First snapshot had 0 interactable refs (url=${currentUrl}, ${yaml.length} chars) — settling and retrying once.`);
        await runCli(fw, session, ['goto', landingUrl]);
        ({ rawSnap, yaml, refs } = await readSnap());
      }
    }
    log(`[L3] Driving the live app for "${tc.title || tc.id || job.feature}" (${preAuth ? 'pre-auth target screen' : 'authenticated'}) — verifying up to ${maxSteps} action(s)…`);

    for (let step = 1; step <= maxSteps; step++) {
      if (step > 1) ({ rawSnap, yaml, refs } = await readSnap());
      if (!refs.length) {
        log(`[L3] No interactable elements in the live snapshot (${yaml.length} chars) — stopping the walk. Preview: ${yaml.slice(0, 200).replace(/\s+/g, ' ').trim()}`);
        break;
      }
      const decision = await llmNextAction(job, tc, trace, yaml, refs, preAuth);
      if (!decision || String(decision.action || '').toLowerCase() === 'done' || !decision.ref) {
        log(`[L3] Journey complete after ${trace.length} verified step(s).`);
        break;
      }
      const target = refs.find((r) => r.ref === decision.ref);
      if (!target) { log(`[L3] LLM picked ref ${decision.ref} not present live — stopping (anti-hallucination guard).`); break; }
      const act = String(decision.action || 'click').toLowerCase();
      const beforeUrl = extractPageUrl(rawSnap) || currentUrl;
      let cliOut = '';
      if (act === 'fill' || act === 'type') {
        const val = String(decision.value == null ? '' : decision.value);
        if (isCred(val)) { log('[L3] Refusing to type a real credential via the CLI — skipping this action.'); continue; }
        cliOut = await runCli(fw, session, ['fill', target.ref, val]);
      } else if (act === 'select') {
        cliOut = await runCli(fw, session, ['select', target.ref, String(decision.value == null ? '' : decision.value)]);
      } else if (act === 'check') {
        cliOut = await runCli(fw, session, ['check', target.ref]);
      } else {
        cliOut = await runCli(fw, session, ['click', target.ref]);
      }
      const locator = extractRanLocator(cliOut);
      const afterUrl = extractPageUrl(cliOut) || beforeUrl;
      currentUrl = afterUrl;
      trace.push({
        intent: decision.note || `${act} ${target.role} "${target.name}"`,
        action: act,
        role: target.role,
        name: target.name,
        value: (act === 'fill' || act === 'type' || act === 'select') ? String(decision.value == null ? '' : decision.value) : '',
        locator,
        url: afterUrl,
        navigated: !!(afterUrl && afterUrl !== beforeUrl),
      });
      log(`[L3] ✓ step ${trace.length}: ${act} "${target.name}"${afterUrl !== beforeUrl ? ` (→ ${afterUrl})` : ''}`);
    }
  } catch (e) {
    log(`[L3] Live drive stopped (${e.message}) — using ${trace.length} verified step(s) as evidence.`);
  } finally {
    await runCli(fw, session, ['close']).catch(() => {});
    try { fs.rmSync(stateFile, { force: true }); } catch { /* ignore */ }
  }
  if (trace.length) log(`[L3] Captured ${trace.length} PROVEN action(s) with real locators — feeding to codegen as top evidence.`);
  return renderLiveTrace(trace);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Autopilot (explore mode) engine — turn a URL + feature into authored cases.
 * Explore (@playwright/cli snapshot) → deterministic feature model → LLM authors
 * positive/negative cases grounded in that evidence → hand to the SAME
 * buildPlan/generateAndRun pipeline (reuse + behavioral dedup applied there).
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Parse a Playwright ariaSnapshot (a YAML-ish `- role "name"` tree) into a lightweight,
 * DETERMINISTIC feature model. This is code, not LLM, so authored cases can only reference
 * widgets that actually exist on the screen — the anti-hallucination guarantee.
 */
function buildFeatureModel(snapshot, feature) {
  const model = { feature: feature || '', inputs: [], buttons: [], links: [], controls: [], texts: [] };
  const re = /^\s*-\s+([a-zA-Z]+)(?:\s+"([^"]*)")?/;
  for (const line of String(snapshot || '').split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const role = m[1].toLowerCase();
    const name = (m[2] || '').trim();
    if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton') {
      model.inputs.push({ role, name });
    } else if ((role === 'button' || role === 'menuitem' || role === 'menuitemcheckbox' || role === 'menuitemradio' || role === 'tab') && name) {
      model.buttons.push(name);
    } else if (role === 'link' && name) {
      model.links.push(name);
    } else if (['checkbox', 'combobox', 'radio', 'switch', 'slider', 'option'].includes(role)) {
      model.controls.push({ role, name });
    } else if (['text', 'alert', 'heading'].includes(role) && name) {
      model.texts.push(name);
    }
  }
  model.buttons = [...new Set(model.buttons)];
  model.links = [...new Set(model.links)];
  return model;
}

/** Render one model's widget lines (shared by single- and multi-step evidence blocks). */
function widgetLines(m, prefix) {
  const p = prefix || '';
  const l = [];
  l.push(`${p}Inputs: ${m.inputs.length ? m.inputs.map((i) => `${i.name || '(unlabeled)'} [${i.role}]`).join(', ') : 'none detected'}`);
  l.push(`${p}Buttons: ${m.buttons.length ? m.buttons.join(', ') : 'none detected'}`);
  l.push(`${p}Links: ${m.links.length ? m.links.join(', ') : 'none detected'}`);
  if (m.controls && m.controls.length) l.push(`${p}Controls: ${m.controls.map((c) => `${c.name || '(unlabeled)'} [${c.role}]`).join(', ')}`);
  return l;
}

/** Human-readable evidence block fed to the case author so it designs against real widgets only. */
function featureModelSummary(model) {
  const l = [`Feature under test: ${model.feature || '(unnamed)'}`];
  if (model.steps && model.steps.length > 1) {
    l.push(`This feature spans ${model.steps.length} pages/steps:`);
    model.steps.forEach((s) => {
      l.push(`  • ${s.label} (${s.url}):`);
      widgetLines(s, '    ').forEach((x) => l.push(x));
    });
    l.push('Combined widgets across all steps:');
    widgetLines(model, '  ').forEach((x) => l.push(x));
  } else {
    widgetLines(model, '').forEach((x) => l.push(x));
  }
  if (model.texts && model.texts.length) l.push(`Visible text/labels: ${model.texts.slice(0, 12).join(' | ')}`);
  if (model.observed) {
    if (model.observed.errors && model.observed.errors.length) {
      l.push(`OBSERVED validation/error messages (assert these EXACT strings in negative cases — do NOT paraphrase): ${model.observed.errors.slice(0, 8).map((e) => `"${e}"`).join(' | ')}`);
    }
    if (model.observed.success && model.observed.success.length) {
      l.push(`OBSERVED success/confirmation (assert in the positive / end-to-end case): ${model.observed.success.slice(0, 4).map((s) => `"${s}"`).join(' | ')}`);
    }
  }
  return l.join('\n');
}

/**
 * Targeted, per-type test-design guidance. Only the guidance for the types the user actually
 * selected is injected, so Boundary/Security/Accessibility each produce genuinely distinct,
 * high-value cases instead of shallow re-wordings of positive/negative. Grounded in the evidence:
 * every rule is conditioned on widgets that exist (inputs/controls/buttons).
 */
function testTypeGuidance(types, model) {
  const norm = (t) => String(t).toLowerCase().replace(/[^a-z]/g, '');
  const set = new Set((types || []).map(norm)); // e.g. 'security-lite' -> 'securitylite'
  const has = (k) => [...set].some((s) => s.startsWith(k));
  const hasInputs = model.inputs.length > 0;
  const hasControls = model.controls.length > 0;
  const out = [];
  if (has('positive')) {
    out.push('- Positive: the primary happy-path success for this feature (valid data, expected end state). At least one, but do not pad with near-duplicate happy paths.');
  }
  if (has('negative')) {
    out.push('- Negative: invalid/missing/wrong-type data and wrong-state actions. One case per DISTINCT failure reason (e.g. missing required field vs wrong value vs unauthorized), each asserting the specific error/guard — never a generic "it fails".');
  }
  if (has('boundary') && hasInputs) {
    out.push('- Boundary: exercise edges of each constrained input — min-1/min/min+1 and max-1/max/max+1 length or value, empty vs single-char, and leading/trailing whitespace. Pick the highest-value edges; state the exact boundary value in testData.');
  }
  if (has('security')) {
    const t = ['- Security-lite (non-destructive, INPUT-level only — never attempt real exploitation): where inputs exist, try an XSS payload (<script>alert(1)</script>), an SQL-ish string (\' OR \'1\'=\'1), and an overlong string; assert the app SANITIZES/rejects and does NOT reflect/execute.'];
    t.push('  Also add an authorization/least-privilege check only if the evidence implies a protected action. Do NOT invent endpoints or credentials.');
    out.push(t.join('\n'));
  }
  if (has('accessibility')) {
    out.push('- Accessibility: assert against the ACCESSIBLE names already in the evidence — every actionable control has a discernible name/label, inputs have associated labels, and the primary flow is operable by keyboard (Tab to reach + Enter/Space to activate). Reference the real role+name from the evidence; do not assume ARIA that is not shown.');
  }
  if (has('boundary') && !hasInputs) {
    out.push('- Boundary: this screen exposes no free-text inputs — apply boundary thinking to any quantity/selection controls if present, otherwise skip rather than inventing an input.');
  }
  if (has('security') && !hasInputs && !hasControls) {
    out.push('- Security note: no inputs on this screen — prefer an authorization/navigation-guard check over input injection.');
  }
  return out;
}

/** Render @playwright/cli snapshots (real element refs) as an authoritative locator-evidence block. */
function cliEvidenceSummary(model) {
  const ev = model && Array.isArray(model.cliEvidence) ? model.cliEvidence : [];
  if (!ev.length) return '';
  const keep = /\b(textbox|button|link|checkbox|radio|combobox|listbox|option|heading|tab|menuitem|searchbox|switch|slider)\b/;
  const out = ['', '## Authoritative locators (@playwright/cli — real role+name; prefer getByRole/getByLabel from these):'];
  ev.forEach((e) => {
    const lines = String(e.snapshot).split('\n')
      .map((ln) => ln.replace(/\s*\[ref=[^\]]+\]/g, '').replace(/\s*\[cursor=[^\]]+\]/g, '').replace(/\s*\[level=\d+\]/g, '').trim())
      .filter((ln) => keep.test(ln))
      .slice(0, 20);
    if (lines.length) out.push(`### ${e.url}`, ...lines.map((x) => `- ${x.replace(/^-\s*/, '')}`));
  });
  return out.length > 2 ? out.join('\n') : '';
}

/** Prompt the LLM to design cases from the feature model + a per-type test-design checklist. */
function buildAuthorPrompt(job, model) {
  const selected = job.testTypes && job.testTypes.length ? job.testTypes : ['Positive', 'Negative'];
  const types = selected.join(', ');
  const max = Number(job.maxCases) > 0 ? Number(job.maxCases) : 8;
  const guidance = testTypeGuidance(selected, model);
  const multiStep = model.steps && model.steps.length > 1;
  return [
    `You are a senior QA architect (15+ years, manual + automation). Design up to ${max} high-value test cases for the "${job.feature}" feature of the web app at ${job.url}.`,
    'Use ONLY the widgets that actually exist in the evidence below — NEVER invent fields, buttons, or links that are not present.',
    `STAY SCOPED to "${job.feature}": design cases about the controls and outcomes of the feature's OWN screen (${job.url}). The evidence may include earlier pages (e.g. login) and pages further along the flow — those are only the PATH to reach the feature (setup/navigation), NOT extra test surface. Do NOT author a case whose primary purpose is validating a different page's form (e.g. a downstream address/checkout form) unless the feature under test IS that form.`,
    'VERBATIM control names: every button/link/field you name in steps, testData, or expectedResults MUST be an EXACT single observed label copied character-for-character from the evidence. NEVER merge, concatenate, or paraphrase two labels into one — e.g. do NOT combine a generic action word ("Go back", "Cancel") with a real label ("Continue Shopping") into "Go back Continue Shopping". If a case is about a secondary/back/cancel action, use that ONE control\'s exact observed label and nothing else. If no single observed control matches the behavior, do not write the case.',
    `Cover these test types: ${types}. Add a type ONLY if it appears in that list. Each case must map to exactly ONE type via its "type" field.`,
    'Prioritise by value: one strong positive, then the most likely real defects. Every case must be a DISTINCT behavior — no two cases with the same action + data. Do not pad to reach the max.',
    multiStep ? `The evidence spans ${model.steps.length} pages, but only the ones belonging to "${job.feature}" are the test target. Include ONE end-to-end positive that reaches the feature's real success/confirmation state, walking any earlier pages only as setup — do NOT turn each downstream page into its own case.` : '',
    'Coverage floor: always include one positive happy path; if Negative is selected, include one required-field negative for EACH input. (These are added automatically if you omit them — so spend your budget on higher-value cases.)',
    'When the evidence lists OBSERVED error/success messages, assert those EXACT strings verbatim — never invent message text the app did not produce.',
    '',
    '## Coverage charter — think like a senior architect and cover every applicable dimension (skip a dimension ONLY if the evidence has no widget for it; never invent widgets):',
    '1. Happy path: valid data end-to-end to the real success/confirmation state.',
    '2. Primary action: the main submit/continue advances only when input is valid.',
    '3. Secondary actions: EVERY Cancel / Back / Reset / secondary button present — assert it navigates correctly and leaves state untouched (e.g. Cancel returns to the previous screen and does NOT complete the action).',
    '4. Required-field validation: each required input empty individually, plus all-empty.',
    '5. Format/type validation: wrong format (email, numeric-only, etc.), special characters, and whitespace trimming where a matching input exists.',
    '6. Boundary/equivalence: min, max, over-max, and empty for each constrained input.',
    '7. Data integrity: values persist across steps; any totals/quantities/calculations shown are correct.',
    '8. Navigation & state: Back preserves entered data; direct/deep-link to a protected step when unauthenticated is guarded.',
    '9. Error handling & recovery: trigger a validation error, then correct it and confirm the flow proceeds.',
    '10. Security-lite (non-destructive, input-level): where inputs exist, a script/HTML payload stays literal (not executed/reflected).',
    '11. Accessibility: actionable controls have discernible names/labels; the primary flow is keyboard-operable (Tab + Enter/Space).',
    'Only emit a dimension as a case when its test type is in the selected list above AND the evidence supports it.',
    '',
    '## Test-design rules for the selected types (follow precisely)',
    ...guidance,
    job.notes ? `\nExtra intent from the user (weigh heavily): ${job.notes}` : '',
    '',
    '## Evidence — live feature model (from an accessibility snapshot)',
    featureModelSummary(model),
    cliEvidenceSummary(model),
    '',
    '## Output format — STRICT JSON ONLY (no prose, no markdown fences):',
    '{"cases":[{"title":"concise distinctive behavior, no TC id, no @tags","type":"Positive|Negative|Boundary|Security|Accessibility","steps":"1. ...\\n2. ...","testData":"exact values used, incl. the boundary/payload string","expectedResults":"the specific asserted outcome (exact message/state), not a generic pass/fail"}]}',
    'Each title must name a distinct behavior. Steps numbered and executable on THIS exact screen. testData and expectedResults must be concrete, never placeholders.',
  ].filter(Boolean).join('\n');
}

/** Extract the cases array from an LLM response that should be strict JSON (tolerant of fences/prose). */
function parseAuthoredCases(text) {
  if (!text) return [];
  let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const objStart = s.indexOf('{');
  const arrStart = s.indexOf('[');
  try {
    if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
      return JSON.parse(s.slice(arrStart, s.lastIndexOf(']') + 1));
    }
    if (objStart >= 0) {
      const obj = JSON.parse(s.slice(objStart, s.lastIndexOf('}') + 1));
      return Array.isArray(obj.cases) ? obj.cases : (Array.isArray(obj) ? obj : []);
    }
  } catch { /* unparseable → no cases */ }
  return [];
}

/** Canonicalize an LLM-supplied case type to one clean tag label (Security-lite -> Security, etc.). */
function canonicalCaseType(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (k.startsWith('boundary')) return 'Boundary';
  if (k.startsWith('security')) return 'Security';
  if (k.startsWith('access') || k.startsWith('a11y')) return 'Accessibility';
  if (k.startsWith('negative')) return 'Negative';
  return 'Positive';
}

/** Normalize a case shape (LLM- or floor-authored) into the job.testCases record. */
function shapeCase(raw, feature, floor) {
  const type = canonicalCaseType(raw.type);
  return {
    id: '',
    title: String(raw.title).trim(),
    tags: `${feature}, ${type}`,
    executionTags: '',
    complexity: 'Medium',
    description: '',
    preconditions: '',
    testData: String(raw.testData || ''),
    steps: String(raw.steps || ''),
    expectedResults: String(raw.expectedResults || ''),
    comments: floor ? 'Coverage-floor (deterministic scaffold).' : 'Authored by Autopilot (explore mode).',
  };
}

const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const caseType = (c) => String(c.tags || '').split(',').pop().trim();

/** Best-guess a valid value for an input from its accessible name (scaffold data for the floor). */
function validPlaceholder(name) {
  const n = String(name || '').toLowerCase();
  if (/e-?mail/.test(n)) return 'user@example.com';
  if (/zip|postal|pin\b/.test(n)) return '12345';
  if (/phone|mobile|tel/.test(n)) return '5551234567';
  if (/first ?name/.test(n)) return 'John';
  if (/last ?name/.test(n)) return 'Doe';
  if (/password/.test(n)) return 'Passw0rd!';
  if (/user/.test(n)) return 'standard_user';
  if (/name/.test(n)) return 'John Doe';
  return 'Valid value';
}

/** The most likely primary/submit control on the screen (for scaffolded flows). */
function primaryButton(model) {
  const re = /continue|submit|save|finish|checkout|log ?in|sign ?in|next|place|confirm|apply|add/i;
  return model.buttons.find((b) => re.test(b)) || model.buttons[0] || 'Submit';
}

/** Deterministic happy-path scaffold: fill every named input with valid data, click the primary control. */
function synthHappyPath(job, model) {
  const filled = model.inputs.filter((i) => i.name);
  const primary = primaryButton(model);
  const steps = [];
  let n = 1;
  filled.forEach((i) => steps.push(`${n++}. Enter a valid ${i.name} (e.g. "${validPlaceholder(i.name)}").`));
  steps.push(`${n++}. Click "${primary}".`);
  return {
    title: `Complete ${job.feature} successfully with valid data`,
    type: 'Positive',
    steps: steps.join('\n'),
    testData: filled.map((i) => `${i.name}: ${validPlaceholder(i.name)}`).join('; ') || 'valid inputs',
    expectedResults: `${job.feature} accepts the input and advances to the next step / shows the success (confirmation) state.`,
  };
}

/** Deterministic required-field negative: all inputs valid except one left blank; expect a field error. */
function synthRequiredNeg(job, model, input) {
  const others = model.inputs.filter((i) => i.name && i.name !== input.name);
  const primary = primaryButton(model);
  const steps = [];
  let n = 1;
  others.forEach((i) => steps.push(`${n++}. Enter a valid ${i.name}.`));
  steps.push(`${n++}. Leave "${input.name}" blank.`);
  steps.push(`${n++}. Click "${primary}".`);
  return {
    title: `${job.feature}: ${input.name} is required`,
    type: 'Negative',
    steps: steps.join('\n'),
    testData: `${input.name}: (blank); all other fields valid`,
    expectedResults: `A validation error indicates ${input.name} is required and the form does not submit.`,
  };
}

const coversRequiredNeg = (cases, name) => {
  const nn = normTitle(name);
  return cases.some((c) => caseType(c) === 'Negative' && normTitle(c.title).includes(nn) &&
    /(missing|blank|empty|required|without)/.test(normTitle(c.title)));
};

/** Deterministic boundary case: one constrained input at its edges (whitespace + overlong), others valid. */
function synthBoundary(job, model, input) {
  const others = model.inputs.filter((i) => i.name && i.name !== input.name);
  const primary = primaryButton(model);
  const steps = [];
  let n = 1;
  others.forEach((i) => steps.push(`${n++}. Enter a valid ${i.name}.`));
  steps.push(`${n++}. In "${input.name}", enter a boundary value: leading/trailing spaces around a 256-character string.`);
  steps.push(`${n++}. Click "${primary}".`);
  return {
    title: `${job.feature}: ${input.name} boundary (whitespace & max length)`,
    type: 'Boundary',
    steps: steps.join('\n'),
    testData: `${input.name}: "  ${'A'.repeat(256)}  " (leading/trailing spaces, 256 chars); all other fields valid`,
    expectedResults: `The app trims/limits ${input.name} and either accepts the normalized value or shows a clear validation message — it must not crash or enter an unhandled state.`,
  };
}

const coversBoundary = (cases, name) => {
  const nn = normTitle(name);
  return cases.some((c) => caseType(c) === 'Boundary' && normTitle(c.title).includes(nn));
};

/** The observed secondary/abort control on the screen (Cancel/Back/Reset), if any. */
function secondaryButton(model) {
  const re = /cancel|go back|^back$|reset|abort|discard/i;
  return model.buttons.find((b) => re.test(b)) || '';
}

/** Deterministic secondary-action case: exercise Cancel/Back and assert it aborts without side effects. */
function synthSecondaryAction(job, model, btn) {
  const filled = model.inputs.filter((i) => i.name);
  const steps = [];
  let n = 1;
  filled.forEach((i) => steps.push(`${n++}. Enter a valid ${i.name}.`));
  steps.push(`${n++}. Click "${btn}".`);
  return {
    title: `${job.feature}: "${btn}" aborts without completing the action`,
    type: 'Negative',
    steps: steps.join('\n'),
    testData: `Uses "${btn}"; no submission of the primary action`,
    expectedResults: `Clicking "${btn}" navigates back to the previous screen and does NOT complete ${job.feature} — no order/record is created and prior state (e.g. cart) is preserved.`,
  };
}

const coversSecondary = (cases, btn) => {
  const nn = normTitle(btn);
  return !!btn && cases.some((c) => normTitle(c.title).includes(nn));
};

/**
 * The feature's OWN screen — the walked step whose URL matches job.url — as a shallow model view
 * with that screen's inputs/buttons/links/controls. Keeps the deterministic coverage floor scoped
 * to the requested feature: pages reached only while navigating there are the PATH to the feature
 * (setup), not extra test surface. Falls back to the full union when there is no per-step data or no
 * URL match, so single-page explores keep their current behavior (no regression).
 */
function featureScreen(job, model) {
  const steps = Array.isArray(model.steps) ? model.steps : [];
  if (steps.length < 2) return model;
  const norm = (u) => { try { return new URL(u).pathname.replace(/\/+$/, '') || '/'; } catch { return String(u || '').trim(); } };
  const want = norm(job.url);
  const hit = steps.find((s) => norm(s.url) === want);
  if (!hit) return model;
  return {
    ...model,
    inputs: Array.isArray(hit.inputs) ? hit.inputs : [],
    buttons: Array.isArray(hit.buttons) ? hit.buttons : [],
    links: Array.isArray(hit.links) ? hit.links : [],
    controls: Array.isArray(hit.controls) ? hit.controls : [],
  };
}

/**
 * Guarantee a minimum coverage floor regardless of what the LLM returned: one positive happy path,
 * and (when Negative is selected) one required-field negative per named input. Floor cases are
 * grounded in real widgets and always survive the maxCases cap.
 */
function ensureCoverageFloor(cases, job, model, feature) {
  const max = Number(job.maxCases) > 0 ? Number(job.maxCases) : 8;
  const selected = new Set((job.testTypes && job.testTypes.length ? job.testTypes : ['Positive', 'Negative']).map(canonicalCaseType));
  // Scope the floor to the feature's own screen so a focused feature is not padded with form fields
  // or buttons discovered elsewhere on the multi-page walk (which are only the path to reach it).
  const fm = featureScreen(job, model);
  const named = fm.inputs.filter((i) => i.name);
  const additions = [];
  if (selected.has('Positive') && named.length && !cases.some((c) => caseType(c) === 'Positive')) {
    additions.push(shapeCase(synthHappyPath(job, fm), feature, true));
  }
  if (selected.has('Negative') && named.length) {
    for (const inp of named) {
      if (!coversRequiredNeg(cases, inp.name)) additions.push(shapeCase(synthRequiredNeg(job, fm, inp), feature, true));
    }
  }
  if (selected.has('Boundary') && named.length) {
    for (const inp of named) {
      if (!coversBoundary(cases, inp.name)) additions.push(shapeCase(synthBoundary(job, fm, inp), feature, true));
    }
  }
  // Secondary/abort action (Cancel/Back/Reset) — guaranteed when the control is actually on the
  // feature's OWN screen (not a downstream page reached only while navigating).
  const secondary = secondaryButton(fm);
  if ((selected.has('Negative') || selected.has('Positive')) && secondary && !coversSecondary(cases, secondary)) {
    additions.push(shapeCase(synthSecondaryAction(job, fm, secondary), feature, true));
  }
  // Merge + de-dup by normalized title (LLM cases win ties, keeping their richer wording).
  const seen = new Set();
  const merged = [];
  for (const c of [...cases, ...additions]) {
    const k = normTitle(c.title);
    if (seen.has(k)) continue;
    seen.add(k); merged.push(c);
  }
  if (merged.length > max) {
    const floorKeys = new Set(additions.map((a) => normTitle(a.title)));
    const floor = merged.filter((c) => floorKeys.has(normTitle(c.title)));
    const rest = merged.filter((c) => !floorKeys.has(normTitle(c.title)));
    return [...floor, ...rest].slice(0, Math.max(max, floor.length));
  }
  return merged;
}

/** Author cases from the feature model (retry once on empty) and apply the deterministic coverage floor. */
async function authorCases(job, model, onLog) {
  const log = (m) => { if (onLog) onLog(m); };
  const sys = 'You output ONLY strict JSON. No prose, no markdown fences.';
  let parsed = [];
  for (let attempt = 1; attempt <= 2 && parsed.length === 0; attempt++) {
    try {
      const base = buildAuthorPrompt(job, model);
      const prompt = attempt === 1 ? base
        : `${base}\n\nIMPORTANT: your previous reply was empty or unparseable. Reply with ONLY the JSON object now.`;
      const text = await llmGenerate(prompt, sys);
      parsed = parseAuthoredCases(text);
      if (parsed.length === 0) log(`[explore] Author attempt ${attempt} yielded 0 parseable case(s)${attempt < 2 ? ' — retrying…' : ''}.`);
    } catch (e) {
      log(`[explore] LLM authoring failed (attempt ${attempt}): ${e.message}`);
    }
  }
  const feature = pascal(job.feature);
  let cases = parsed.filter((c) => c && c.title).map((c) => shapeCase(c, feature, false));
  const before = cases.length;
  cases = ensureCoverageFloor(cases, job, model, feature);
  cases.forEach((c, i) => { c.id = `TC_${String(i + 1).padStart(3, '0')}`; });
  const added = cases.length - before;
  log(`[explore] Authored ${before} LLM case(s)${added > 0 ? ` + ${added} coverage-floor case(s)` : ''} → ${cases.length} total.`);
  return cases;
}

/** Merge per-step feature models (multi-page flows) into one model that also keeps a per-step breakdown. */
function mergeFeatureModels(steps, feature) {
  const m = { feature: feature || '', inputs: [], buttons: [], links: [], controls: [], texts: [], steps: [] };
  const seenIn = new Set(); const seenBtn = new Set(); const seenLink = new Set(); const seenCtrl = new Set();
  for (const s of steps) {
    m.steps.push({ label: s.label, url: s.url, inputs: s.inputs, buttons: s.buttons, links: s.links, controls: s.controls });
    for (const i of s.inputs) { const k = `${i.role}|${i.name}`; if (!seenIn.has(k)) { seenIn.add(k); m.inputs.push(i); } }
    for (const b of s.buttons) { if (!seenBtn.has(b)) { seenBtn.add(b); m.buttons.push(b); } }
    for (const l of s.links) { if (!seenLink.has(l)) { seenLink.add(l); m.links.push(l); } }
    for (const c of s.controls) { const k = `${c.role}|${c.name}`; if (!seenCtrl.has(k)) { seenCtrl.add(k); m.controls.push(c); } }
    for (const t of s.texts) { if (!m.texts.includes(t)) m.texts.push(t); }
  }
  return m;
}

/** Normalize a URL to origin+path (no trailing slash, lowercased) for cheap comparison. */
function diagUrlNorm(u) {
  try { const x = new URL(String(u)); return (x.origin + x.pathname).replace(/\/+$/, '').toLowerCase(); }
  catch { return String(u || '').trim().toLowerCase().replace(/\/+$/, ''); }
}

/** Path component of a URL ('/' when none). */
function diagUrlPath(u) {
  try { return (new URL(String(u)).pathname || '/').replace(/\/+$/, '') || '/'; }
  catch { return '/'; }
}

/** Heuristic: does the captured model look like a bare login/sign-in screen (auth gate)? */
function looksLikeLoginScreen(model) {
  const btns = model.buttons || []; const ins = model.inputs || []; const links = model.links || [];
  const hasLoginBtn = btns.some((b) => /log ?in|sign ?in/i.test(b));
  const hasPwdField = ins.some((i) => /pass(word)?/i.test(i.name || ''));
  const compact = ins.length <= 3 && btns.length <= 2 && links.length === 0;
  return (hasLoginBtn || hasPwdField) && compact;
}

/** Significant tokens (>=3 chars) of a feature name, used to check the page is actually related. */
function featureTokens(feature) {
  return String(feature || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}

/** Does the captured evidence mention the requested feature at all? (anti-hallucination gate) */
function featureMentioned(feature, model, states) {
  const toks = featureTokens(feature);
  if (!toks.length) return true; // name too short to judge — don't block
  const hay = [
    ...(states || []).map((s) => s.url || ''),
    ...(model.texts || []),
    ...(model.buttons || []),
    ...(model.links || []),
    ...(model.inputs || []).map((i) => i.name || ''),
    ...(model.controls || []).map((c) => c.name || ''),
  ].join(' ').toLowerCase();
  return toks.some((t) => hay.includes(t));
}

/**
 * Classify the health of an exploration in FAIL-FAST STAGES so the plan can show an honest,
 * actionable message instead of authoring cases from evidence that doesn't match the request:
 *   'login-url-bad'    — credentials given but the Login URL never loaded.
 *   'auth-failed'      — Login URL loaded but sign-in was rejected (wrong username/password).
 *   'unreachable'      — nothing loaded at all (bad Application URL / app down / network).
 *   'auth-required'    — a protected page was reached without credentials.
 *   'feature-not-found'— page loaded/authenticated but nothing matches the requested feature.
 *   'ok'               — real target evidence captured; author normally.
 */
function diagnoseExploration(job, drive, model, auth, effLoginUrl) {
  const states = (drive && drive.states) || [];
  const d = (drive && drive.diag) || {};
  // Stage 1 — login URL + credentials (only when credentials were supplied).
  if (auth) {
    const navFailed = /^nav:/.test(d.loginErr || '') || (Number(d.loginStatus) >= 400);
    if (navFailed) return { kind: 'login-url-bad' };
    if (d.loginRequested && !d.authOk) return { kind: 'auth-failed' };
  }
  // Stage 2 — did anything load at all?
  if (states.length === 0) return { kind: 'unreachable' };
  // Stage 3 — a protected page was reached without credentials.
  const target = job.url || (states[0] && states[0].url) || '';
  const deepTarget = diagUrlPath(target) !== '/' && diagUrlNorm(target) !== diagUrlNorm(effLoginUrl || '');
  if (!auth && deepTarget && looksLikeLoginScreen(model)) return { kind: 'auth-required' };
  // Stage 4 — the captured screen has nothing to do with the requested feature.
  if (!featureMentioned(job.feature, model, states)) return { kind: 'feature-not-found' };
  return { kind: 'ok' };
}

/**
 * Build a STRUCTURED blocker (NOT a test case — no TC id) that the UI renders as a precise message
 * and uses to DISABLE the "Proceed & Generate" button. The password is never included.
 */
function buildBlocked(kind, job, effLoginUrl, creds, drive) {
  const feature = job.feature || 'the target';
  const appUrl = job.url || '(not provided)';
  const login = effLoginUrl || (job.loginUrl && String(job.loginUrl).trim()) || '(same origin as the Application URL)';
  const user = (creds && creds.username) || '(none provided)';
  const rawErr = drive && drive.diag && drive.diag.loginErr;
  const errNote = rawErr && !/^nav:/.test(rawErr) ? ` The app reported: "${rawErr}".` : '';
  const map = {
    'login-url-bad': {
      title: 'Login URL is unreachable',
      message: `The Login URL "${login}" did not load, so sign-in could not be attempted and "${feature}" was never reached.`,
      checklist: [
        `Verify the Login URL is correct (path + https://): "${login}".`,
        'Confirm the app is running and reachable from this machine (network / VPN / firewall).',
        'Fix the Login URL, then run Explore again.',
      ],
    },
    'auth-failed': {
      title: 'Sign-in failed — username or password is incorrect',
      message: `The Login URL loaded, but sign-in was rejected, so "${feature}" was never reached.${errNote}`,
      checklist: [
        `Re-check the Username and Password for this environment (Username tried: "${user}").`,
        `Confirm the Login URL points at the real sign-in page: "${login}".`,
        'Fix the credentials, then run Explore again.',
      ],
    },
    'auth-required': {
      title: `"${feature}" is behind a login`,
      message: `The page at ${appUrl} is protected and no credentials were supplied, so only the login screen was captured.`,
      checklist: [
        'Enter a valid Username and Password.',
        `Set the Login URL to the sign-in page (currently: ${login}).`,
        'Run Explore again.',
      ],
    },
    unreachable: {
      title: 'The application page did not load',
      message: `Nothing was returned from ${appUrl}. The URL may be wrong, the app may be down, or the network may be blocked.`,
      checklist: [
        `Verify the Application URL is correct (path + https://): "${appUrl}".`,
        'Confirm the app is running and reachable from this machine.',
        'Fix the URL, then run Explore again.',
      ],
    },
    'feature-not-found': {
      title: `Could not find "${feature}" on that page`,
      message: `Sign-in worked and the page loaded, but nothing on it matches "${feature}". The feature name may be misspelled, or the Application URL points at a different screen. No test cases were invented.`,
      checklist: [
        `Check the spelling of the Feature / Widget name: "${feature}".`,
        `Point the Application URL at the screen that actually contains "${feature}" (currently: ${appUrl}).`,
        `If "${feature}" needs a pre-state (e.g. an item already in the cart), add a Flow Step URL or describe it in Notes.`,
        'Adjust the inputs, then run Explore again.',
      ],
    },
  };
  const m = map[kind] || map.unreachable;
  return {
    kind,
    title: m.title,
    message: m.message,
    checklist: m.checklist,
    inputsReviewed: 'Application URL, Feature, Username/Password, Login URL, Flow Step URLs, Test types, Max cases, Scope hint/Notes, Acceptance criteria, Evidence',
  };
}

/**
 * Autopilot entry: explore a feature headlessly (one or more flow URLs), build a deterministic
 * feature model, and have the LLM author cases grounded in that evidence — then apply the coverage
 * floor. Returns { testCases, featureModel, snapshot } so the EXISTING buildPlan/generateAndRun
 * pipeline runs unchanged (reuse-filter + behavioral dedup are applied there).
 *
 * Multi-step: job.flowUrls (optional) snapshots each page of a wizard and merges the models so the
 * author can design an end-to-end happy path. Exploration NEVER submits forms (no side effects).
 *
 * Auth-gated: when `creds` are supplied, a heuristic form login runs at job.loginUrl (or the origin
 * of the first URL) BEFORE each snapshot. Credentials are transient — passed only into the child
 * process env, never stored on the job, persisted, logged, or committed.
 */
async function exploreAndAuthor(job, onLog, creds) {
  const log = (m) => { if (onLog) onLog(m); };
  const fw = config().frameworkPath;
  const urls = (Array.isArray(job.flowUrls) && job.flowUrls.length ? job.flowUrls : [job.url])
    .map((u) => String(u || '').trim()).filter(Boolean);
  log(`[explore] Exploring "${job.feature}" across ${urls.length} URL(s) …`);
  let auth = null;
  let loginUrl = (job.loginUrl && String(job.loginUrl).trim()) || '';
  if (creds && creds.username && creds.password) {
    if (!loginUrl) { try { loginUrl = new URL(urls[0]).origin; } catch { loginUrl = urls[0]; } }
    auth = { username: creds.username, password: creds.password, loginUrl };
    log(`[explore] Authenticated exploration enabled — logging in at ${loginUrl} (credentials are transient, never stored).`);
  }
  // Action-aware walk: submit forms to observe real success/error states — but ONLY off Production
  // (safe on QA/UAT/demo) and only when authenticated (we know the app + creds). Anonymous or prod
  // exploration stays view-only (no side effects).
  const isProd = String(job.environment || '').toLowerCase().startsWith('prod');
  const allowSubmit = !!auth && !isProd;
  log(allowSubmit
    ? '[explore] Stateful mode: will fill + submit forms to capture success/validation states (non-Production).'
    : `[explore] View-only mode (${isProd ? 'Production — no form submission' : 'no credentials'}).`);
  // Opt-in: use @playwright/cli (Microsoft-recommended) for authoritative locator evidence.
  const useCli = String(job.exploreEvidence || process.env.EXPLORE_EVIDENCE || '').toLowerCase() === 'cli';
  const stateFile = useCli && auth ? path.join(fw, '.blast-cli-state.json') : '';
  const drive = await driveFlow(fw, urls, { auth, allowSubmit, stateFile });
  if (drive.states.length) {
    drive.states.forEach((s) => log(`[explore] State '${s.label}' @ ${s.url} captured (${s.snapshot.length} chars).`));
  } else {
    log('[explore] No live states captured (unreachable, login failed, or redirected).');
  }
  if (drive.error) log(`[explore] Driver note: ${drive.error}`);
  if (drive.observed.errors.length) log(`[explore] Observed validation message(s): ${drive.observed.errors.slice(0, 5).join(' | ')}`);
  if (drive.observed.success.length) log(`[explore] Observed success/confirmation: ${drive.observed.success.slice(0, 3).join(' | ')}`);
  const model = modelFromStates(drive.states, job.feature, drive.observed);
  log(`[explore] Feature model: ${model.inputs.length} input(s), ${model.buttons.length} button(s), ${model.links.length} link(s); ${model.observed.errors.length} error + ${model.observed.success.length} success message(s) observed.`);
  // Fail-fast diagnosis BEFORE the (slower) @playwright/cli evidence pass — if the intended screen
  // was not captured, return a structured blocker and author NOTHING (anti-hallucination).
  const diag = diagnoseExploration(job, drive, model, auth, loginUrl);
  if (diag.kind !== 'ok') {
    log(`[explore] Diagnosis: ${diag.kind} — returning a diagnostic message; no test cases authored.`);
    try { if (stateFile) fs.rmSync(stateFile, { force: true }); } catch { /* ignore */ }
    return { testCases: [], featureModel: model, snapshot: '', blocked: buildBlocked(diag.kind, job, loginUrl, creds, drive) };
  }
  if (useCli) {
    log('[explore] Capturing authoritative locator evidence via @playwright/cli …');
    try {
      model.cliEvidence = await captureCliEvidence(fw, urls, { stateFile, log });
      log(`[explore] @playwright/cli evidence: ${model.cliEvidence.length} screen(s) with real element refs.`);
    } catch (e) { log(`[explore] @playwright/cli evidence skipped: ${String((e && e.message) || e)}`); }
    finally { try { if (stateFile) fs.rmSync(stateFile, { force: true }); } catch { /* ignore */ } }
  }
  const testCases = await authorCases(job, model, log);
  return { testCases, featureModel: model, snapshot: drive.states.length ? drive.states[0].snapshot : '' };
}

/**
 * POST a payload to a remote B.L.A.S.T. worker route and resolve its JSON response. Adds bearer
 * auth, forwards any `logs[]` in the response to onLog, and rejects on non-200. Shared by the
 * explore/generate delegations so both use one HTTP client.
 */
function callWorker(pathname, payload, { url, token, timeoutMs }, onLog) {
  const log = (m) => { if (onLog) onLog(m); };
  return new Promise((resolve, reject) => {
    const base = String(url || '').trim().replace(/\/+$/, '');
    let u;
    try { u = new URL(`${base}${pathname}`); } catch { return reject(new Error(`invalid worker URL for ${pathname}`)); }
    const lib = u.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload || {});
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: Number(timeoutMs || 180000),
    }, (resp) => {
      let out = '';
      resp.on('data', (d) => { out += d; });
      resp.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(out || '{}'); } catch { /* non-JSON body */ }
        if (resp.statusCode !== 200) {
          return reject(new Error((parsed && parsed.error) || `worker responded ${resp.statusCode}`));
        }
        if (Array.isArray(parsed && parsed.logs)) parsed.logs.forEach((l) => log(l));
        resolve(parsed || {});
      });
    });
    req.on('timeout', () => req.destroy(new Error('worker request timed out')));
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

/**
 * Delegate exploration to a remote B.L.A.S.T. worker (a persistent host with Chromium +
 * @playwright/cli) instead of running it in-process. Same return shape as exploreAndAuthor
 * ({ testCases, featureModel }). Credentials travel ONLY in the request body over the worker's
 * bearer-auth channel — never logged or persisted here. Bearer token from EXPLORE_WORKER_TOKEN
 * (falls back to WORKER_TOKEN). Used when EXPLORE_WORKER_URL is set (e.g. B.L.A.S.T. on Render).
 */
async function exploreViaWorker(job, onLog, creds) {
  const opts = {
    url: process.env.EXPLORE_WORKER_URL,
    token: process.env.EXPLORE_WORKER_TOKEN || process.env.WORKER_TOKEN || '',
    timeoutMs: process.env.EXPLORE_WORKER_TIMEOUT_MS || 180000,
  };
  try {
    const r = await callWorker('/explore', { job, creds: creds || {} }, opts, onLog);
    return { testCases: r.testCases || [], featureModel: r.featureModel || null, snapshot: '' };
  } catch (e) {
    throw new Error(`remote explore failed: ${e.message}`);
  }
}

/**
 * Delegate the full generate → run → self-heal pipeline to a remote worker (which has Chromium +
 * the framework to actually execute the tests). Returns the same object generateAndRun produces.
 * Worker URL from GENERATE_WORKER_URL (falls back to EXPLORE_WORKER_URL so one VM can do both);
 * token from GENERATE_WORKER_TOKEN (falls back to WORKER_TOKEN). Longer default timeout since a
 * generation runs the browser and one heal round.
 */
async function generateViaWorker(job, onLog) {
  const opts = {
    url: process.env.GENERATE_WORKER_URL || process.env.EXPLORE_WORKER_URL,
    token: process.env.GENERATE_WORKER_TOKEN || process.env.WORKER_TOKEN || '',
    timeoutMs: process.env.GENERATE_WORKER_TIMEOUT_MS || 600000,
  };
  try {
    const r = await callWorker('/generate', { job }, opts, onLog);
    return r.result || r;
  } catch (e) {
    throw new Error(`remote generate failed: ${e.message}`);
  }
}

/**
 * Explore dispatcher: when EXPLORE_WORKER_URL is set, run the crawl + @playwright/cli evidence +
 * LLM authoring on the remote worker (no local Chromium/CLI needed); otherwise run in-process
 * exactly as before. Additive — the default path is unchanged when the flag is unset.
 */
async function explore(job, onLog, creds) {
  const workerUrl = String(process.env.EXPLORE_WORKER_URL || '').trim();
  if (workerUrl) {
    if (onLog) onLog(`[explore] Delegating to remote worker ${workerUrl}`);
    return exploreViaWorker(job, onLog, creds);
  }
  return exploreAndAuthor(job, onLog, creds);
}

function buildSystemPrompt() {
  return [
    'You are the AI Native Playwright Engineer. You output ONLY code files in the exact 3-layer architecture.',
    'Binding rules: pages = LOCATORS ONLY (semantic getByRole/getByLabel/getByPlaceholder as class properties) — a Page has NO methods with logic, NO this.actions/this.logger/this.waitHelper, NO collaborators; put ALL workflow logic in the module. modules = workflows that call the wrappers via the module\'s OWN constructor-declared collaborators (this.actions, this.workflowActions, its page object) and log via this.logger (created ONCE as `private readonly logger = Logger.create(\'<Module>\')`). specs = assertions/intent using the custom fixtures.',
    'Never put business logic or methods in pages. Never put assertions in modules. Never use raw Playwright in specs. No `any`. Reuse existing files where the capabilities index shows them.',
    'LOGGER: call step()/info() ONLY on the instance `this.logger`. NEVER call `Logger.step(...)`/`Logger.info(...)` statically (they are instance methods; the static side only has create()). When adding a method to an EXISTING module, use ONLY collaborators its constructor already declares — do NOT reference this.waitHelper (or any field) that the constructor does not create.',
    'LOCATOR STANDARD (Playwright official priority — follow EXACTLY; pick the HIGHEST-priority strategy the element ACTUALLY supports, fall back only when a higher one does not exist): (1) a dedicated TEST-ID attribute (data-test/data-testid/data-qa) is the TIER-1, most stable choice whenever the app tags the element with one — copy the PROVEN attribute selector VERBATIM as a config-free attribute locator, e.g. page.locator(\'[data-test="username"]\') (needs NO testIdAttribute config; resolves in any freshly-provisioned repo); use getByTestId() ONLY when the framework\'s playwright.config ALREADY declares a matching testIdAttribute — never assume it does or rely on adding it; (2) getByRole(role,{name}) for interactive elements (button/link/textbox/checkbox/radio/menuitem/option) — the primary strategy when the element has NO test-id; (3) getByLabel() for labelled form fields; (4) getByPlaceholder() only when no label/role/testid; (5) getByText({exact:true}) for static content/links; (6) getByAltText() for images; (7) CSS/XPath LAST RESORT and only SCOPED/chained (e.g. locator(".row",{hasText:"Admin"}).getByRole("textbox")) — NEVER a bare brittle class or auto-generated id (#react-select-3, .MuiButton-root-482, hash/numeric-suffix classes change every build; prefer role/label/text even if such an id is visible). Default to ONE semantic strategy per element; do NOT stack. DISAMBIGUATION: when a locator matches many elements (tables/repeated rows/unnamed form fields), SCOPE from a stable parent (row/section/dialog/labelled group) and chain — e.g. locator(".oxd-input-group",{hasText:"Username"}).getByRole("textbox"); NEVER add nth-child; use .nth() only as an absolute last resort with a `// reason:` note. DROPDOWNS: native <select> → Actions.selectOption; custom JS dropdown (React-select/MUI/PrimeNG/OXD) → click-open then getByRole("option",{name}); verify which from the live snapshot, never assume. IFRAMES/SHADOW DOM → frameLocator()/shadow-piercing, never wrong-scope fallback. WAITING → Playwright auto-waiting only; no fixed sleeps (waitFor(state) with a `// reason:` note only for genuinely async/animated UI). Add a SmartLocator.resolve fallback chain ONLY for a genuinely fragile element (max 3 strategies, `// reason:` note). Collections use plain Playwright locators, never SmartLocator. Every Page locator MUST be the EXACT one verified live during explore, never a re-guessed selector.',
    'LOCATOR DECLARATION (follow exactly — MATCH THE EXISTING PAGES IN THIS REPO): pick the ONE style the repo already uses and never mix them. (A) constructor-field style: `readonly <name>: Locator;` declared on the class AND assigned in the constructor `this.<name> = page.getByRole(...);` — EVERY declared field MUST be assigned in the constructor (strictPropertyInitialization: a declared `<name>: Locator;` with no `this.<name> = …` is a COMPILE ERROR). (B) arrow-getter style: `<name> = (): Locator => this.page.getByRole(...);` (store the page via `constructor(private readonly page: Page) {}`). NEVER leave a `Locator` field declared but uninitialized, and NEVER reference a `<page>.<name>` from a module/spec that the Page does not actually define.',
    'VALUE-INDEPENDENT LOCATORS (follow exactly): a locator must IDENTIFY an element, never encode the runtime VALUE it displays. NEVER bake a dynamic value (price, amount, total, count, date, name) into a getByText — e.g. do NOT write `getByText(\'<Label>: $12.34\')`; instead locate the element by its stable label/role/data-test (e.g. the `<label>`/row container) and ASSERT the value in the spec with `toHaveText`/`toContainText`. Baking the value into the locator makes a wrong value fail as "element not found" (unclear) and turns the spec assertion into a tautology.',
    'CALCULATED ASSERTIONS: when a value is DERIVED from others (e.g. total = subtotal + tax), do NOT assert three independently hardcoded strings. Read the parts from the page, parse the numbers, and assert the RELATIONSHIP in the spec (e.g. expect(total).toBeCloseTo(subtotal + tax)) so the test proves the computation, not a fixed snapshot. Keep any literal expected numbers in testData.json, never in a locator.',
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

/**
 * Compact the rich crawl featureModel.steps into a BOUNDED, names-only journey
 * that is safe to carry inside the workflow_dispatch payload. Names only, capped
 * per page and overall, so codegen sees the real per-page controls without bloat.
 */
function compactJourney(featureModel) {
  if (!featureModel || !Array.isArray(featureModel.steps) || !featureModel.steps.length) return [];
  const cap = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);
  const nm = (x) => String(typeof x === 'string' ? x : (x && x.name) || '').trim().slice(0, 60);
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  return featureModel.steps.slice(0, 8).map((s) => ({
    label: String(s.label || '').slice(0, 60),
    url: String(s.url || '').slice(0, 200),
    inputs: uniq(cap(s.inputs, 12).map(nm)),
    buttons: uniq(cap(s.buttons, 12).map(nm)),
    links: uniq(cap(s.links, 12).map(nm)),
    controls: uniq(cap(s.controls, 8).map(nm)),
  }));
}

/** Render the compact journey as ordered per-page evidence for the generate prompt. */
function renderJourney(journey) {
  if (!Array.isArray(journey) || !journey.length) return '';
  return journey.map((s, i) => {
    const parts = [`  ${i + 1}. ${s.label || 'Page'}${s.url ? ` (${s.url})` : ''}`];
    if (s.inputs && s.inputs.length) parts.push(`     Inputs: ${s.inputs.join(', ')}`);
    if (s.buttons && s.buttons.length) parts.push(`     Buttons: ${s.buttons.join(', ')}`);
    if (s.links && s.links.length) parts.push(`     Links: ${s.links.join(', ')}`);
    if (s.controls && s.controls.length) parts.push(`     Controls: ${s.controls.join(', ')}`);
    return parts.join('\n');
  }).join('\n');
}

function buildGeneratePrompt(job, g, snapshot, existing, liveWalk, liveTrace) {
  const existingBlock = (existing && existing.length)
    ? existing.map((f) => `===FILE:${f.rel}|${f.layer}===\n${f.content}\n===ENDFILE===`).join('\n')
    : '';
  const journeyBlock = renderJourney(job.journey);
  return [
    `# Task: automate the following test case(s) for URL ${job.url || '(unknown)'} (env ${job.environment}).`,
    testCaseBlock(job),
    job.comments ? `\nExtra notes: ${job.comments}` : '',
    '\n## Agent persona (follow this role & workflow)\n' + (g.persona || g.agent),
    '\n## Framework rules (AGENT.md excerpt)\n' + g.agent,
    g.skillActive ? `\n## Active skill: ${g.activeSkill ? g.activeSkill.tag : 'pw-new-automation'} (selected in the UI — follow this skill's workflow)\n` + g.skillActive : '',
    g.skillHeal && (!g.activeSkill || g.activeSkill.key !== 'heal') ? '\n## Skill: pw-self-healing (SmartLocator fallback chain — apply only to genuinely fragile locators)\n' + g.skillHeal : '',
    skillModeDirective(job),
    '\n## Reuse index — READ FIRST (sharded manifest + the relevant domain shard). Every asset listed here ALREADY EXISTS — reuse locators/methods/tests; do NOT recreate them.\n' + g.capabilities,
    liveTrace
      ? '\n## Verified live actions (LEVEL 3 — HIGHEST-PRIORITY EVIDENCE. The runner JUST performed these exact actions on the REAL app, IN ORDER, and each "proven Playwright code" line is the ACTUAL locator that executed SUCCESSFULLY against the live page. Build the Page objects from these EXACT locators (copy them verbatim), and reproduce this journey in this order. Do NOT invent, guess, or alter any locator that appears here — these are ground truth.)\n' + liveTrace
      : '',
    snapshot ? '\n## Live page snapshot (EVIDENCE — derive real locators from these roles/names)\n' + snapshot : '',
    liveWalk
      ? '\n## Verified live walk (AUTHORITATIVE — the runner JUST drove the real app through this journey. These are the REAL controls per page, IN ORDER, that actually worked, plus the real success/validation messages. Write the spec to REPRODUCE this exact walk: same page order, same control labels copied verbatim, assert these exact messages. Prefer these locators/messages over any guess or static snapshot.)\n' + liveWalk
      : '',
    journeyBlock
      ? '\n## Discovered journey (EVIDENCE from the crawl — each page IN ORDER with its REAL controls). Reach the target page by walking THESE pages through the app UI, and establish every precondition the earlier pages create (add an item, create a record, open a sub-page). Do NOT deep-link to a later page and assume its fields exist — the earlier pages produce the state that makes them appear.\n' + journeyBlock
      : '',
    existingBlock
      ? '\n## Existing domain files — EXTEND these (return full content, keep every existing test/locator/method, ADD the new cases)\n' + existingBlock
      : '\n## Style exemplar — Page (locators only, single semantic strategy)\n' + g.pageEx
        + '\n## Style exemplar — Module (Actions wrappers + Logger.step, no assertions)\n' + g.moduleEx
        + '\n## Style exemplar — Spec (custom fixtures, credentials(), testData)\n' + g.specEx,
    '\n## Test data (src/testdata/testData.json — reuse keys; extend, never shrink)\n' + (g.testData || '{}'),
    '\n## Fixtures (src/fixtures/index.ts — register any NEW Page/Module here)\n' + (g.fixtures || ''),
    g.wrapperApi ? '\n## Wrapper API contract (AUTHORITATIVE — the shared wrappers expose ONLY these methods. Call them with these EXACT signatures and argument types. NEVER invent a wrapper method (e.g. there is NO waitForURL — use waitForUrlContains/waitForUrlMatch, or `await this.page.waitForURL(...)`). Respect argument types (e.g. press(key) takes a STRING; to press a key ON an element use pressOn(target, key)). For anything not covered here, use the framework `page` object directly.)\n' + g.wrapperApi : '',
    g.smartLocator ? '\n## SmartLocator API (use only for a justified fallback)\n' + g.smartLocator : '',
    '\n## Requirements',
    '- Reuse existing pages/modules/locators/fixtures from the index and exemplars before adding anything new.',
    '- MULTI-SCREEN DECOMPOSITION (reuse-first — one Page+Module PER SCREEN, never a monolith): when the journey crosses SEVERAL distinct app screens (e.g. login → products → cart → checkout), do NOT pack every screen\'s locators and steps into a single "<Journey>Page"/"<Journey>Module". FIRST reuse any existing per-screen Page/Module from the reuse index; for each screen with no existing asset, author a SEPARATE screen-named Page + Module pair (e.g. LoginPage/LoginModule, InventoryPage/InventoryModule, CartPage/CartModule, CheckoutPage/CheckoutModule) holding ONLY that screen\'s locators and workflow, so each stays reusable by future flows. The journey spec then COMPOSES these per-screen modules in order (each module self-initializes its own Page + wrappers in its constructor). A single Page/Module is correct ONLY when the whole flow genuinely lives on ONE screen.',
    '- DYNAMIC / PARAMETERIZED LOCATORS (one getter, not N hardcoded twins): when sibling controls differ ONLY by an id/value embedded in the SAME stable attribute (add-to-cart-<sku>, row-<id>, tab-<name>), emit ONE parameterized getter that takes the varying part — e.g. `addToCartButton = (itemId: string): Locator => this.page.locator(`[data-test="add-to-cart-${itemId}"]`)` — instead of a separate hardcoded getter per item. Derive the pattern from the PROVEN live locator (the captured value becomes the argument); never invent ids the evidence did not show. Keep it a SINGLE strategy.',
    '- ZERO hardcoded URLs anywhere — Pages, Modules AND specs. Navigate and assert through the framework\'s CENTRAL URL config: if src/config exposes a routes map + urlFor(path)/urlRegex(path) helpers, use urlFor(routes.X) for every goto() and urlRegex(routes.X) for every toHaveURL() assertion, and ADD a new key to the routes map for a new screen instead of writing a literal. If no such helper exists, use a RELATIVE path resolved by Playwright\'s configured baseURL — NEVER embed a full "https://host/..." string in a module or spec. A Module goto() builds its URL from the central base/route config, never a hardcoded host.',
    '- Reuse SHARED METHODS/HELPERS, not just locators (the reuse-first rule applies to BEHAVIOR too). Before writing ANY interaction code, scan the Wrapper API + Reusable API for an existing helper and CALL it. Use the shared WorkflowActions/Actions helpers for EVERY common interaction family instead of bespoke open-then-click code: custom dropdown -> WorkflowActions.selectDropdownOption(trigger, optionText); searchable/autocomplete ("type for hints") -> searchAndSelectOption(input, text, optionText?); native <select> -> Actions.selectOption; checkbox -> setCheckbox(target, checked); radio -> selectRadioOption(label); date field -> selectDate(input, value); table cell read -> readTableCell(table, rowText, colIndex); table row action -> clickInRow(table, rowText, controlName); table row checkbox -> setRowCheckbox(table, rowText, checked); search box -> searchWithOptionalSubmit. If NONE of the existing helpers fits a new interaction, implement it as a parameterized METHOD ON THE NEW MODULE (workflow logic belongs in the Module) — NEVER inline interaction logic in a spec, and NEVER call or invent a WorkflowActions/Actions method that is not already in the Wrapper API contract (the shared utils are a FIXED API here; this JSON output cannot emit a modified util file). Same for repeated flows (login/logout/"returned to login page" checks).',
    '- TAGS — industry standard, stacked in the test() title: give every test (a) a feature/module tag in PascalCase matching the domain (e.g. @AdminAddUser, @Login) AND (b) suite tags — @Smoke on the primary critical happy-path case and @Regression on ALL cases (edge/negative cases get @Regression only). Do NOT use @Positive/@Negative as the taxonomy. Keep titles specific and consistent with the domain naming already used in the repo.',
    '- TEST INDEPENDENCE: every test() must run STANDALONE (a case may be executed individually via a grep filter). Each test performs its OWN setup — its own login + navigation — and never depends on state left behind by a sibling test in the same file. Use test.beforeEach for shared setup so each test starts from a clean, authenticated session; never chain one test\'s side effects into another.',
    '- CLEAN CODE: consistent indentation matching the exemplars, no unused imports, no dead code, no duplicated boilerplate that belongs in a shared helper. Do not over-comment obvious lines or restate code.',
    '- DOC COMMENTS (neat, not noisy): put a ONE-LINE /** ... */ header on each Page and Module class stating its role, a ONE-LINE /** ... */ on each public Module method stating its intent, and a ONE-LINE // comment above each test() stating the scenario and expected outcome. One short intent line per class/method/test is the ceiling — never comment individual statements.',
    '- Group ALL cases into ONE domain spec (one test() per case). If an existing domain spec is shown above, ADD the new cases to it — do NOT create a parallel spec.',
    '- NEVER emit two test() blocks with the same test-case id. Each TC id appears exactly once. If a case id already exists in the shown spec, keep that one test as-is — do not add a second test for the same id, even with a different title.',
    '- APPEND-ONLY: NEVER renumber, reorder, or change the id or title of any EXISTING test. Add the new case using EXACTLY the TC id given in the task, appended AFTER the existing tests. Every existing test keeps its exact id and title verbatim.',
    '- Locators: ONE strategy per element by default — when the app exposes a dedicated test-id attribute (data-test/data-testid), copy the PROVEN selector VERBATIM as a config-free attribute locator (e.g. page.locator(\'[data-test="username"]\')) which needs NO testIdAttribute config, use getByTestId only if playwright.config already declares a matching testIdAttribute, otherwise getByRole/getByLabel/getByPlaceholder. A SmartLocator fallback chain is allowed ONLY for a fragile element and MUST carry a `// reason:` note (max 3 strategies). No stacked speculative locators.',
    '- Data: use credentials(\'app\') for valid login and src/testdata/testData.json for other data. If new data is needed, emit an EXTENDED testData.json (config layer) preserving all existing keys.',
    '- Authenticated flows: if the target page is only reachable AFTER login (anything past the login screen), the spec MUST authenticate FIRST — in a test.beforeEach that calls the framework login module (navigate to the login page, e.g. loginModule.goto(), THEN loginModule.login(credentials(\'app\').username, credentials(\'app\').password)) and asserts the post-login landing — BEFORE any page-specific steps, exactly like the spec exemplar. NEVER call login() without navigating to the login page first, and never assume an already-authenticated session.',
    '- Preconditions/state: NEVER assume the target page is already in the required state (e.g. an item already in the cart, a record already selected). Establish every precondition through the app UI FIRST. Search the "Reusable API across ALL domains" list above for a method that performs that setup — even if it lives in a DIFFERENT domain (e.g. an add-to-cart / create-record / login method) — and CALL it; only write new interaction code when NO existing method covers the need. Reach the target page by the real user journey in the case steps above; do NOT deep-link to a page whose content depends on prior actions and then assert that content exists. A Module navigation helper (goto) must wait only for a STABLE page landmark (title/header/container) that exists regardless of data — never for data-dependent content like a specific row.',
    '- Ambiguous controls: when several identical controls exist (e.g. N identical "Add"/"Remove"/"Delete" buttons in a list), NEVER use a bare text/role locator that matches many — Playwright strict mode WILL fail. Prefer an existing Module method that already resolves the right element (e.g. a product-detail add method), or scope to a unique parent/row (by the record/product name), or use an explicit .filter()/.nth() with a `// reason:` note. One unambiguous target per action.',
    '- Reveal-then-click (dropdown / profile / kebab / overflow / flyout menus): when a control (e.g. a menu item, a sign-out/settings/logout entry) is only visible AFTER opening a menu, the opening step MUST click the menu\'s INTERACTIVE TOGGLE — the clickable button/link/menu tab that OWNS the menu — NEVER a decorative avatar image or icon inside it (clicking a decorative `img`/icon frequently does NOT open the menu, so the item never appears and the test times out). Locate the toggle by role+name when it has one (getByRole(\'button\'|\'link\', { name })); if the toggle has NO accessible name, scope to the smallest STABLE interactive container observed in the snapshot/journey (the menu/user-area toggle itself), NOT the avatar image. After clicking the toggle, WAIT for the revealed item to be visible before clicking it.',
    '- NEVER truncate, abbreviate, or elide any file. Do not emit placeholders like `/* …trimmed… */`, `// ...`, or `…`. Every emitted file (especially JSON) MUST be its COMPLETE, valid content. JSON must parse (no comments) and keep every existing top-level key.',
    '- If you create a NEW Page/Module, also emit an updated src/fixtures/index.ts (fixture layer) that keeps existing fixtures and registers the new ones.',
    '- Modules use Actions/WaitHelper/WorkflowActions and Logger.step(); specs hold all expect() assertions and import { test, expect } from ../fixtures.',
    '- Module wiring (prevents "Cannot read properties of undefined"): a Module MUST create EVERY collaborator it calls in its CONSTRUCTOR from the injected `page` — its own Page object, its Actions/WaitHelper/WorkflowActions, AND any OTHER Module it delegates to (assign `this.<collaborator> = new <CollaboratorClass>(page)`). NEVER call `this.<x>.method()` unless `this.<x> = new <Class>(page)` is assigned in that class constructor. Do NOT rely on dependency injection between modules — each module self-initializes what it uses.',
    '- Methods you call MUST EXIST (prevents "TypeError: <obj>.<method> is not a function"). TWO cases: (a) the shared UTIL WRAPPERS (Actions/WaitHelper/WorkflowActions) have a FIXED API — call ONLY the exact methods/signatures in the Wrapper API contract above, NEVER add a method to a wrapper, and NEVER pass the wrong argument type (e.g. an object to `press(key: string)`); for browser navigation use the `page` object directly (`await this.page.goBack()`, `await this.page.waitForURL(...)`). (b) DOMAIN Pages/Modules MAY gain NEW methods — but if your spec calls a Page/Module method that is NOT already in the existing files or the Reusable API, you MUST emit the FULL extended Page/Module file that DEFINES that method in THIS SAME response. NEVER emit a spec that calls a Page/Module method you neither found in the existing API nor defined in a file you return now. Prefer ONE parameterized method (e.g. `sortBy(optionLabel)`) that every similar case reuses over several near-duplicate methods (sortByNameAsc/sortByNameDesc/sortByPriceAsc/…).',
    '- Pass every REQUIRED argument a method declares (prevents "expected string, got undefined"). If an existing Page/Module method requires a parameter (e.g. `goto(url: string)`), pass a CONCRETE value — never call it with no argument or an undefined variable. If you have no real value, use the navigation/method that needs none (e.g. click the on-page link) instead.',
    '- Match the ARGUMENT COUNT of every wrapper call to its signature in the Wrapper API contract (prevents "TS2554: Expected N arguments, but got M"). A wrapper that declares `(target, value)` MUST be called with BOTH — e.g. always pass the value to fill/type/select; never call a two-argument wrapper with one argument.',
    '- NEVER modify the body or signature of an EXISTING Page/Module method — existing tests depend on it verbatim, and changing it (e.g. adding a wait/navigation to an existing navigate method) will BREAK already-passing tests. Only ADD new methods/locators. If a new case needs different behavior, write a NEW method; leave every existing method exactly as-is.',
    '- Test-data keys: every key the spec reads from testData.json MUST exist in the testData.json you emit — read `testData.<a>.<b>` ONLY if you also add `<a>.<b>` with a concrete valid value (a missing key throws "Cannot read properties of undefined"). Keep every existing key. CONVERSELY, every NEW key you ADD MUST be READ by the spec — never seed `testData.checkout.firstName` and then pass a duplicated literal like \'Jordan\'; the spec MUST consume `testData.<a>.<b>`. Test data written but never consumed is a defect.',
    snapshot ? '- Base locators on the live snapshot above; do not invent selectors it does not support.' : '',
    '- If a file you emit already exists, return its FULL content — keep ALL existing tests/locators/methods and ADD the new ones. Never delete existing functionality.',
  ].filter(Boolean).join('\n');
}

/**
 * Compile-gate prompt. The generated code failed `tsc --noEmit` BEFORE running Playwright.
 * The compiler is the authoritative API contract, so it lists EVERY method/argument violation at
 * once — fix them all in one shot instead of discovering them one runtime crash at a time. Generic.
 */
function buildCompilePrompt(job, files, tscErrors, g) {
  const current = files.map((f) => `===FILE:${f.rel}|${f.layer}===\n${f.content}\n===ENDFILE===`).join('\n');
  return [
    'The generated TypeScript/Playwright code does NOT COMPILE. Fix EVERY error below and return the corrected files in the same ===FILE=== format. The TypeScript compiler is AUTHORITATIVE — it knows the exact real API of every wrapper/Page/Module, so these errors are the ground truth.',
    'Fix ALL errors at once (do not fix one and leave the rest). Keep the 3-layer split (pages = locators, modules = workflows, specs = assertions) and change only what each error requires. Return the FULL content of every file you touch.',
    'Error → fix mapping:',
    '- "Property \'<m>\' does not exist on type \'<T>\'": you called a method/property that does not exist. If <T> is a UTIL WRAPPER (Actions/WaitHelper/WorkflowActions), replace it with a REAL method from the Wrapper API contract below, or use the `page` object. If <T> is a DOMAIN Page/Module, either call an existing method OR DEFINE <m> on that class and emit its FULL extended file. Never keep an invented call.',
    '- "Expected N arguments, but got M": pass every REQUIRED argument with a concrete value (e.g. `goto(url)` needs a real url); never call with a missing/undefined argument.',
    '- "Argument of type \'X\' is not assignable to parameter of type \'Y\'": pass the correct type (e.g. a string key to `press(key: string)`, not an object; a Locator where a Locator is expected).',
    '- IF THE SAME CALL FLIP-FLOPS between "Expected 2 arguments, but got 1" and "type \'string\' is not assignable to parameter of type \'number\'" (adding an argument then triggers a number error): one of the parameters is a NUMBER and you are omitting it or putting a string in its slot. Look up the EXACT signature in the Wrapper API contract and pass the arguments in the RIGHT ORDER with the RIGHT types — do NOT toggle blindly. Two common cases: (a) LOGGER — `logger.step(stepNumber: number, description: string)` needs the step NUMBER FIRST, e.g. `this.logger.step(1, \'Open the login page\')`; if you have no step number, call `this.logger.info(\'Open the login page\')` instead (it takes ONE string). NEVER call `this.logger.step(\'...\')` with only a message. (b) TEXT ENTRY — to type into a field use the fill/type method with a `(target, value: string)` signature and pass the string once. Never keep oscillating.',
    '- "Cannot find name \'<n>\'" / "Cannot find module": add the missing import from the SAME path the exemplars use; do not invent a module path.',
    '- Property error on testData (e.g. testData.<a>.<b>): add `<a>.<b>` to the emitted testData.json with a concrete valid value; keep every existing key.',
    '- Type/return mismatches: make the signature and its usage agree; never use `any` or `// @ts-ignore` to silence an error — fix the real cause.',
    g && g.wrapperApi ? '\n## Wrapper API contract (the ONLY methods on the shared wrappers — use these EXACT signatures)\n' + g.wrapperApi : '',
    g && g.capabilities ? '\n## Reusable API across ALL domains (existing Page/Module methods to reuse or extend)\n' + g.capabilities : '',
    '\n## TypeScript errors (fix EVERY one)\n' + String(tscErrors || '').slice(-6000),
    '\n## Current files\n' + current,
  ].filter(Boolean).join('\n');
}

function buildHealPrompt(job, files, runOutput, errorContext, g) {
  const current = files.map((f) => `===FILE:${f.rel}|${f.layer}===\n${f.content}\n===ENDFILE===`).join('\n');
  const journeyBlock = renderJourney(job.journey);
  return [    'The generated Playwright test FAILED. Fix the ROOT cause and return the corrected files in the same ===FILE=== format.',
    'Only change what is needed to make the test pass. Keep the 3-layer split (pages = locators, modules = workflows, specs = assertions).',
    'READ THE STACK TRACE FIRST to find WHICH file to fix. It names the exact frame of the failure as `<Class>.<method> (<File>.ts:<line>)` (e.g. `InventoryModule.openCart (src/modules/InventoryModule.ts:73)`). When the failing frame is inside a Page/Module method, the bug lives IN THAT METHOD — return the FULL corrected Page/Module file, and do NOT edit only the spec (editing the spec cannot fix a wrong locator/logic inside a module method). A `waitFor` "to be visible" timeout on a control used INSIDE a module method — when the browser is already on the right page — almost always means THAT METHOD\'S LOCATOR IS WRONG (the control exists but the name/role differs): replace it with the real control from the error-context.md snapshot / Discovered journey, or reuse an existing Page/Module method that already navigates there, instead of guessing a name.',
    'DIAGNOSE THE PAGE FIRST (most important). The error-context.md below is a snapshot of the page AT THE MOMENT OF FAILURE. Before editing ANY locator, compare that snapshot to the page the failing step expected. If it shows a DIFFERENT page — e.g. the step waited for a form field / detail element but the snapshot shows a list, landing, cart, or login page — then the test SKIPPED A PRECONDITION and never navigated there. The correct fix is to ADD the missing setup/navigation steps to REACH that page (follow the Discovered journey below IN ORDER and CALL existing setup methods from the Reusable API), NOT to change the locator or extend the Page object. A "waiting for X to be visible" timeout is almost NEVER a locator problem when X\'s page was never reached. Only treat it as a locator problem when the snapshot shows the CORRECT page but the element name/role differs.',
    'INVENTED CONTROL (hallucinated locator). If the failing step waits for a control whose exact name appears NOWHERE — not in the error-context.md snapshot, not in the Discovered journey, not on the real page — then that name was fabricated (often two labels merged, e.g. "Go back Continue Shopping"). Do NOT keep waiting for it and do NOT add it to the Page object. Replace it with the SINGLE closest REAL control that actually exists in the evidence (e.g. the real "Continue Shopping" button). If no real control matches the step\'s intent, the step is invalid — remove that step/assertion rather than waiting for a control that cannot appear.',
    'MENU/DROPDOWN THAT NEVER OPENED (reveal-then-click). If the failing step waits for a control that a PRIOR step tried to REVEAL by opening a menu/dropdown/profile/kebab menu (the immediately preceding action is an "open menu / open profile / open dropdown" click) and that item is "not found"/not visible WHILE the browser is already on the correct page, then the OPENING click hit the WRONG element — typically a decorative avatar image or icon instead of the interactive menu toggle — so the menu never opened. Fix the TOGGLE locator, NOT the item\'s locator (the item locator is usually already correct): point the toggle at the clickable menu control that OWNS the menu (a button/link/menu tab) — by role+name when it has a name, else the smallest stable interactive container visible in the error-context.md snapshot — never a decorative `img`/icon. Then wait for the revealed item before interacting with it.',
    resolveSkill(job).key === 'debug'
      ? 'DEBUG MODE: first classify the failure (Locator Change / Script Issue / UI/App Bug / Environment / Unknown) as a top-of-file `// [DEBUG] <category>: <reason>` comment. If it is a genuine UI/App Bug, DO NOT mask it — keep the assertion honest and annotate `// [DEBUG] APP BUG:`. Never weaken an assertion just to go green.'
      : '',
    'If the error is a ReferenceError (e.g. "beforeAll is not defined") or "No tests found", the code used a bare test-runner global. Replace bare beforeAll/afterAll/beforeEach/afterEach with test.beforeAll/test.afterAll/test.beforeEach/test.afterEach and ensure test/expect are imported from the same fixture the exemplar spec uses.',
    'If the error is "TypeError: Cannot read properties of undefined (reading \'<x>\')", a collaborator or data key was used but never initialized — fix the ROOT cause, never silence it with optional chaining. When <x> is a METHOD, a Module called `this.<obj>.<x>()` but never assigned `this.<obj> = new <Class>(page)` in its constructor — add that assignment in the constructor of the class that owns the call. When <x> is a string/array op (e.g. repeat, length, split) on testData, the spec reads a testData.json key that is missing — add that key with a concrete valid value and return the full testData.json.',
    'If the error is "TypeError: <obj>.<method> is not a function", the method does NOT exist on that object. If <obj> is a shared UTIL WRAPPER (this.actions/this.waitHelper/this.workflowActions), do NOT add the method — replace the call with a real wrapper method from the Wrapper API contract below, an existing Page/Module method, or the `page` object (`await this.page.goBack()`, `await this.page.waitForURL(...)`). If <obj> is a DOMAIN Page/Module (e.g. this.<x>Page / this.<x>Module, or `<x>Module.<method>` in the spec), the fix is to DEFINE the missing method: emit the FULL extended Page/Module file that adds it (built from the wrapper API + real locators) — do NOT keep editing only the spec — or switch the call to an existing method that already does the job. When several cases need the same kind of action, add ONE parameterized method and have every case reuse it.',
    'If the error is "expected string, got undefined" (e.g. `page.goto: url: expected string, got undefined`), a method that REQUIRES an argument was called without a real value. Pass a concrete value (e.g. the real URL or base URL), or replace the call with the navigation that needs no argument (click the on-page link/button). Never call the method with an undefined variable, and never silence it with `?.`.',
    'If the error is an argument-type error like "keyboard.press: key: expected string, got object" (or any "expected string, got object"), a string-only wrapper method was called with an object/locator. Fix the CALL to match the Wrapper API contract: pass a plain string key to `press(key)`; to press a key ON a specific element use `pressOn(target, key)` (or the locator\'s own `.press(key)`). Never wrap the argument to silence it — pass the correct type.',
    journeyBlock ? '\n## Discovered journey (the REAL page order + controls — use this to add any missing precondition steps to reach the target page)\n' + journeyBlock : '',
    g && g.capabilities ? '\n## Reusable API across ALL domains — CALL an existing setup/navigation method instead of re-implementing it\n' + g.capabilities : '',
    g && g.wrapperApi ? '\n## Wrapper API contract (the ONLY methods on the shared wrappers — replace any invented/mis-typed wrapper call with one of these EXACT signatures; use the `page` object for anything not listed)\n' + g.wrapperApi : '',
    '\n## Current files\n' + current,
    '\n## Test run output (tail)\n' + runOutput.slice(-6000),
    errorContext ? '\n## error-context.md (page snapshot AT FAILURE — diagnose which page the browser is actually on from this)\n' + errorContext.slice(-3000) : '',
  ].filter(Boolean).join('\n');
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

/** Cache of the Logger contract per framework: does step() need a numeric first arg, and is info() present? */
const _loggerContractCache = new Map();
function loggerContract(fw) {
  if (!fw) return { stepNumeric: false, hasInfo: false };
  if (_loggerContractCache.has(fw)) return _loggerContractCache.get(fw);
  let res = { stepNumeric: false, hasInfo: false };
  try {
    const src = fs.readFileSync(path.join(fw, 'src', 'utils', 'Logger.ts'), 'utf-8');
    res = {
      // step(<first>: number, …) — a leading numeric step index the LLM keeps omitting.
      stepNumeric: /\bstep\s*\(\s*\w+\s*:\s*number\b/.test(src),
      hasInfo: /\binfo\s*\(\s*\w+\s*:\s*string\b/.test(src),
    };
  } catch { /* no Logger — leave defaults */ }
  _loggerContractCache.set(fw, res);
  return res;
}

/** Deterministically fix common LLM mistakes: bare test-runner hooks in specs, and misuse of
 * Logger.step (called with a message string but no leading step NUMBER — never compiles). When the
 * framework's step() needs a number and info(message) exists, downgrade `.step('msg')` → `.info('msg')`
 * (info takes exactly that one string). Framework-universal (Logger), no app specifics; can't oscillate. */
function sanitizeFiles(files, fw) {
  const BARE_HOOK = /(^|[^.\w])(beforeAll|afterAll|beforeEach|afterEach)\s*\(/g;
  const { stepNumeric, hasInfo } = loggerContract(fw);
  // Only rewrite INSTANCE `.step('msg')` (e.g. this.logger.step) — a leading NUMBER was omitted.
  // Exclude the static class name (`Logger.step`), which is a different mistake and would still be
  // wrong as `Logger.info` (info is instance-only). info() takes exactly the one message string.
  const stepMisuse = stepNumeric && hasInfo ? /(?<!Logger)\.step\(\s*(['"`])/g : null;
  return files.map((f) => {
    let c = f.content;
    if (f.layer === 'spec') c = c.replace(BARE_HOOK, (_m, pre, hook) => `${pre}test.${hook}(`);
    if (stepMisuse) c = c.replace(stepMisuse, '.info($1');
    return c === f.content ? f : { ...f, content: c };
  });
}

/** Extract the test-case ids (TC_001, TC-2, …) each test() block is titled with. */
function specTestIds(content) {
  const ids = [];
  // Tolerate both plain "TC_001 ..." and bracketed "[TC_001] ..." title styles.
  const re = /\btest\s*(?:\.\w+)?\s*\(\s*[`'"]\s*\[?\s*(TC[_-]?\d+[A-Za-z_]*)/g;
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
 * Split a spec into its test blocks: [{ id, title, body }]. Braces are matched so
 * nested object/arrow/template braces inside a test don't end the block early.
 */
function specTestBlocks(content) {
  const text = content || '';
  const blocks = [];
  const head = /\btest\s*(?:\.\w+)?\s*\(\s*([`'"])([\s\S]*?)\1\s*,/g;
  let m;
  while ((m = head.exec(text)) !== null) {
    const title = m[2];
    // The body brace is the `{` AFTER the callback's `=>`, not the first `{` (which
    // would be the `({ loginModule, page })` parameter-destructuring brace).
    const arrow = text.indexOf('=>', head.lastIndex);
    const braceStart = text.indexOf('{', arrow === -1 ? head.lastIndex : arrow);
    if (braceStart === -1) continue;
    let depth = 0;
    let i = braceStart;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { i++; break; }
    }
    const idm = title.match(/TC[_-]?\d+/i);
    blocks.push({ id: idm ? normId(idm[0]) : '', title, body: text.slice(braceStart + 1, i - 1) });
  }
  return blocks;
}

/**
 * Like specTestBlocks but returns the FULL source span of each test() block
 * (head + body + trailing `);`). describe/hook wrappers are skipped so nested
 * test() blocks inside a describe are captured individually.
 */
function specTestFullBlocks(content) {
  const text = content || '';
  const blocks = [];
  const head = /\btest\s*(\.\w+)?\s*\(\s*([`'"])([\s\S]*?)\2\s*,/g;
  const SKIP = new Set(['describe', 'beforeAll', 'afterAll', 'beforeEach', 'afterEach', 'step', 'use']);
  let m;
  while ((m = head.exec(text)) !== null) {
    const method = (m[1] || '').replace('.', '');
    if (SKIP.has(method)) continue;
    const start = m.index;
    const title = m[3];
    const arrow = text.indexOf('=>', head.lastIndex);
    const braceStart = text.indexOf('{', arrow === -1 ? head.lastIndex : arrow);
    if (braceStart === -1) continue;
    let depth = 0;
    let i = braceStart;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) { i++; break; }
    }
    let j = i;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] === ')') j++;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] === ';') j++;
    const idm = title.match(/TC[_-]?\d+/i);
    blocks.push({ id: idm ? normId(idm[0]) : '', title, source: text.slice(start, j), end: j });
  }
  return blocks;
}

/**
 * Recovery for terse LLMs that emit ONLY the new test() (dropping existing tests):
 * keep `prior` verbatim and append the genuinely-new test block(s) from `llmContent`,
 * inserted right after the last existing test (stays inside any describe wrapper).
 * Returns merged content, or null if nothing safe to merge.
 */
function mergeNewTestsIntoSpec(prior, llmContent, wantId) {
  const priorIds = new Set(specTestIds(prior));
  const llmBlocks = specTestFullBlocks(llmContent);
  const picked = [];
  const seen = new Set();
  for (const b of llmBlocks) {
    const id = b.id ? normId(b.id) : '';
    const isNew = (id && id === wantId) || (id && !priorIds.has(id));
    if (!isNew || seen.has(id)) continue;
    seen.add(id);
    picked.push(b);
  }
  if (!picked.length) return null;
  const priorSpans = specTestFullBlocks(prior);
  if (!priorSpans.length) return null;
  const lastEnd = priorSpans[priorSpans.length - 1].end;
  const insertion = '\n\n' + picked.map((b) => '  ' + b.source.trim()).join('\n\n');
  return prior.slice(0, lastEnd) + insertion + prior.slice(lastEnd);
}

/**
 * FEATURE ISOLATION recovery. Each feature owns its OWN spec with its OWN TC_001, TC_002…
 * sequence (login.spec.ts has its TC_001; logout/dashboard.spec.ts restarts at TC_001). Terse
 * models sometimes write a genuinely-new feature's test into a DIFFERENT feature's existing spec
 * (e.g. a Logout case dumped into login.spec.ts) and even reproduce that spec's tests, colliding
 * ids. This keeps ONLY the genuinely-new block(s) — the ones that do NOT reproduce a test already
 * in the invaded spec — and renumbers them to a fresh per-file TC_001… sequence so they can live
 * in the feature's own spec. Returns the isolated spec content, or null if nothing new to move.
 * Generic: pure id/block bookkeeping, no app-specific values.
 */
function isolateNewTestsToOwnSpec(emitted, invaded, ownSpecPrior) {
  const blocks = specTestFullBlocks(emitted);
  if (!blocks.length) return null;
  const invadedTitles = specIdTitleMap(invaded);
  const stripId = (t) => normalizeText(String(t).replace(/^\s*\[?\s*TC[_-]?\d+[A-Za-z_]*\]?\s*/i, ''));
  // Drop blocks that merely reproduce a test already living in the invaded spec.
  let content = emitted;
  let kept = 0;
  for (const b of blocks) {
    const id = b.id ? normId(b.id) : '';
    const reproduces = id && invadedTitles.has(id) && titleOverlap(stripId(b.title), invadedTitles.get(id)) >= 0.5;
    if (reproduces) content = content.replace(b.source, () => '');
    else kept++;
  }
  if (!kept) return null;
  // Renumber the surviving tests to a fresh per-file sequence, continuing after any tests
  // already present in the feature's own spec (append-only within its own file).
  const used = new Set(specTestIds(ownSpecPrior || ''));
  for (const b of specTestFullBlocks(content)) {
    const free = nextFreeTcId(used);
    used.add(free);
    const nextSource = b.source.replace(/TC[_-]?\d+[A-Za-z_]*/i, () => free);
    if (nextSource !== b.source) content = content.replace(b.source, () => nextSource);
  }
  return content.replace(/\n{3,}/g, '\n\n');
}

/**
 * DETERMINISTIC SCENARIO-ID PRESERVATION. The approved job assigns each new case an AUTHORITATIVE TC id
 * (wantId). LLMs sometimes label the emitted test() with a reset id (e.g. TC_001) regardless of the
 * requested id — which then trips the append-only / duplicate / integrity gates and makes TC_003…TC_005
 * "disappear". This finds the genuinely-NEW test block (matched by the requested TITLE, else the first
 * block that does NOT reproduce an existing prior test) and rewrites ONLY that block's id to wantId.
 * A block that reproduces an existing prior test is NEVER touched, so existing tests stay verbatim.
 * Returns { content, changed, from }. Pure, deterministic — no second LLM call. Generic.
 */
function forceRequestedScenarioId(emitted, priorSpec, wantId, wantTitle) {
  const want = normId(wantId);
  if (!want) return { content: emitted, changed: false, from: '' };
  const priorTitles = specIdTitleMap(priorSpec || ''); // existing id -> normalized title
  const blocks = specTestFullBlocks(emitted);
  if (!blocks.length) return { content: emitted, changed: false, from: '' };
  const stripId = (t) => normalizeText(String(t).replace(/^\s*\[?\s*TC[_-]?\d+[A-Za-z_]*\]?\s*/i, ''));
  const wantTitleNorm = stripId(wantTitle || '');
  // A block "reproduces" an existing prior test when it shares that id AND the SAME (verbatim) title.
  // Exact equality — NOT token overlap — because behaviorally-opposite scenarios can share tokens
  // (e.g. "name A to Z" vs "name Z to A"): overlap would wrongly treat the new Z-A block as a copy.
  const reproducesPrior = (b) => {
    const id = b.id ? normId(b.id) : '';
    return !!id && priorTitles.has(id) && stripId(b.title) === priorTitles.get(id);
  };
  // Already correct: some block carries wantId and is not a mislabeled reproduction of an existing test.
  if (blocks.some((b) => normId(b.id) === want && !reproducesPrior(b))) return { content: emitted, changed: false, from: '' };
  // Pick the NEW block: (1) best title match to the requested scenario, else (2) first non-reproducing block.
  let target = null;
  if (wantTitleNorm) {
    let best = 0;
    for (const b of blocks) {
      if (reproducesPrior(b)) continue;
      const sc = titleOverlap(stripId(b.title), wantTitleNorm);
      if (sc > best) { best = sc; target = b; }
    }
    if (best < 0.34) target = null; // weak match — don't guess
  }
  if (!target) target = blocks.find((b) => !reproducesPrior(b)) || null;
  if (!target) return { content: emitted, changed: false, from: '' };
  const fromId = target.id ? normId(target.id) : '';
  if (fromId === want) return { content: emitted, changed: false, from: '' };
  const newTitle = /TC[_-]?\d+[A-Za-z_]*/i.test(target.title)
    ? target.title.replace(/TC[_-]?\d+[A-Za-z_]*/i, want)
    : `${want} ${target.title}`;
  const newSource = target.source.replace(target.title, () => newTitle);
  if (newSource === target.source) return { content: emitted, changed: false, from: '' };
  return { content: emitted.replace(target.source, () => newSource), changed: true, from: fromId };
}

/**
 * Canonicalize a data-source expression to a stable key so two variables that point at
 * the SAME underlying record collapse to one identity. This is what lets a locked-user
 * case written as `testData.invalidLogins.find(l => l.username === 'locked_out_user')`
 * and another written as `.find(l => l.description === 'Locked out user')` be recognized
 * as the same data (both resolve to invalidLogins[0]). Returns '' when unresolvable.
 */
function canonicalDataKey(expr, testData) {
  const e = String(expr || '').trim();
  let m = e.match(/credentials\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
  if (m) return `CRED#${m[1]}`;
  // testData.<coll>.find((x) => x.<field> === '<literal>') → resolve to the array index
  m = e.match(/testData\.(\w+)\s*\.\s*find\s*\(\s*\(?[\w$]+\)?\s*=>\s*[\w$]+\.(\w+)\s*===\s*['"`]([^'"`]+)['"`]/);
  if (m && testData) {
    const [, coll, field, lit] = m;
    const arr = testData[coll];
    if (Array.isArray(arr)) {
      const idx = arr.findIndex((r) => r && String(r[field]) === lit);
      if (idx >= 0) return `${coll}#${idx}`;
    }
  }
  m = e.match(/testData\.(\w+)\s*\[\s*(\d+)\s*\]/);       // testData.<coll>[<i>]
  if (m) return `${m[1]}#${m[2]}`;
  m = e.match(/testData\.([\w.]+)/);                      // testData.<path> (scalar)
  if (m) return `DATA#${m[1]}`;
  return '';
}

/**
 * Map every `const/let X = <data-expr>` declaration in a spec (describe-scope AND
 * inside test bodies) to its canonical data key, so behavioral signatures compare by
 * WHICH data a test drives, not by the local variable name a given generation happened
 * to pick.
 */
function dataVarMap(fileContent, testData) {
  const map = new Map();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+?)!?\s*;/g;
  let m;
  while ((m = re.exec(fileContent || '')) !== null) {
    const key = canonicalDataKey(m[2], testData);
    if (key) map.set(m[1], key);
  }
  return map;
}

/**
 * Map a local `const/let/var X = <literal>` to its STABLE literal value (string / number /
 * boolean / array-of-literals), quote- and whitespace-normalized. Lets the behavioral signature
 * resolve a value held in a named variable (e.g. `const sortValue = 'za'`) to the value itself,
 * so two scenarios that differ ONLY by that value (Name A-Z vs Name Z-A) never collapse merely
 * because both generations happened to pick the same variable name.
 */
function localLiteralMap(fileContent) {
  const map = new Map();
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+?)\s*;/g;
  let m;
  while ((m = re.exec(fileContent || '')) !== null) {
    const rhs = m[2].trim();
    const isLiteral = /^(['"`])[\s\S]*\1$/.test(rhs) || /^\[[\s\S]*\]$/.test(rhs)
      || /^-?\d[\d_.]*$/.test(rhs) || /^(true|false)$/.test(rhs);
    if (isLiteral) map.set(m[1], rhs.replace(/\s+/g, '').replace(/['"`]/g, '"'));
  }
  return map;
}

/**
 * Combined resolver for the behavioral signature: testData-record identity (dataVarMap) PLUS
 * inline literal values (localLiteralMap). A testData key wins when a variable is both.
 */
function signatureVarMap(fileContent, testData) {
  const map = localLiteralMap(fileContent);
  for (const [k, v] of dataVarMap(fileContent, testData)) map.set(k, v);
  return map;
}

/**
 * Behavioral signature of a test body — captures WHAT the test does, independent of its
 * id/title/wording/variable-names/whitespace/quote-style/ordering. Two cases collapse ONLY when
 * they perform the SAME actions with the SAME meaningful values AND assert the SAME expected
 * results. The signature INCLUDES, so distinct scenarios never falsely merge:
 *   • workflow (*Module) calls with resolved args
 *   • Page-level / this.page actions (click, fill, selectOption, check, press, reload, goBack, data-nav)
 *   • dropdown/select and input VALUES (the arg literals — e.g. 'az' vs 'za')
 *   • assertions: matcher chain + expected value/target (ascending vs descending never collapse)
 * and IGNORES unstable noise: variable names, whitespace, quote style, token ordering, and
 * zero-arg navigation plumbing. `varMap` (signatureVarMap) resolves variables to their underlying
 * testData record or inline literal so a rename can neither dodge nor force a match.
 */
function testSignature(body, varMap) {
  const raw = body || '';
  const resolve = (s) => s.replace(/[A-Za-z_$][\w$]*/g, (id) => (varMap && varMap.get(id)) || id);
  const norm = (s) => s.replace(/\s+/g, '').replace(/['"`]/g, '"');
  // Zero-arg navigation/arrival calls (goto(), navigateToLoginPage(), openHomePage()…) are
  // page-setup plumbing, not behavior. Data-carrying nav (openProtectedPage('/x')) is kept.
  const isNavNoop = (name, args) => args === '' && /^(goto|navigate\w*|open\w*page|visit|load|browse\w*)$/i.test(name);
  const tokens = [];
  // 1) Assertions first — full expect(...) + matcher chain + expected value. Remove each matched
  //    span from the text so its inner calls aren't double-counted as plain actions.
  const assertRe = /expect\(\s*([^;]*?)\s*\)((?:\s*\.\s*\w+\s*(?:\([^;]*?\))?)+)/g;
  const actionText = raw.replace(assertRe, (full, target, chain) => {
    tokens.push(`E:${norm(resolve(target))}${norm(resolve(chain))}`);
    return ' ';
  });
  // 2) Behavioral calls in what remains — walk each `receiver.method(args).method(args)…` CHAIN so
  //    a value carried on a chained call (e.g. dropdown().selectOption('za')) is never lost. Keep
  //    each method name + resolved args (the VALUES that differentiate scenarios); tag the chain's
  //    first call with the receiver KIND (Module / Page / this / other) so a Module-vs-Page
  //    distinction survives while a variable rename does not. Skip nav-noops and framework statics.
  const chainRe = /\b([A-Za-z_$][\w$]*)((?:\s*\.\s*\w+\s*\([^;]*?\))+)/g;
  const callRe = /\.\s*(\w+)\s*\(([^;]*?)\)/g;
  let m;
  while ((m = chainRe.exec(actionText)) !== null) {
    const recv = m[1];
    if (recv === 'expect' || recv === 'Promise' || recv === 'Math' || recv === 'JSON' || recv === 'Array' || recv === 'Object') continue;
    const kind = /Module$/.test(recv) ? 'M' : /Page$/.test(recv) ? 'P' : recv === 'this' ? 'T' : 'x';
    let first = true;
    let c;
    callRe.lastIndex = 0;
    while ((c = callRe.exec(m[2])) !== null) {
      const method = c[1];
      const args = norm(resolve(c[2]));
      if (isNavNoop(method, args)) { first = false; continue; }
      tokens.push(`A:${first ? kind : '.'}.${method}(${args})`);
      first = false;
    }
  }
  return [...new Set(tokens)].sort().join('&') || 'EMPTY';
}

/**
 * FIX 3 — generation integrity: which genuinely-new selected scenarios ended up neither WRITTEN
 * this run nor legitimately REUSED (equivalent to a pre-existing test). Any such id is a hard
 * failure (a requested scenario was silently dropped). Pure + deterministic for testability.
 */
function generationIntegrity(selectedNewIds, writtenNewIds, reusedNewIds) {
  const written = writtenNewIds instanceof Set ? writtenNewIds : new Set(writtenNewIds || []);
  const reused = reusedNewIds instanceof Set ? reusedNewIds : new Set(reusedNewIds || []);
  const missing = (selectedNewIds || []).filter((id) => !written.has(id) && !reused.has(id));
  return { complete: missing.length === 0, missing };
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
 * DEEP-MERGE two JSON data files (e.g. src/testdata/testData.json). The LLM usually re-emits
 * testData.json with only the SUBSET of keys the new case needs; the old guard treated the
 * omitted keys as "dropped" and protected the file wholesale — so the genuinely-NEW keys the
 * case reads were lost (→ `undefined` at runtime, e.g. missing `messages.lastNameRequired`).
 * Instead, UNION the two objects: keep every existing key/value VERBATIM (existing tests depend
 * on them), recurse into nested objects, and ADD only keys that are new in `next`. Purely
 * additive — never drops or overrides an existing value. Returns the merged JSON string, or
 * null when either side isn't a parseable JSON object (caller should protect the file then).
 */
function mergeJsonData(current, next) {
  let cur; let nxt;
  try { cur = JSON.parse(current); } catch { return null; } // current isn't strict JSON — nothing to merge into
  try { nxt = JSON.parse(next); } catch { return null; }    // next truncated/placeholder — protect the working file
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(cur) || !isObj(nxt)) return null;
  const merge = (a, b) => {
    const out = { ...a };
    for (const k of Object.keys(b)) {
      if (!(k in out)) out[k] = b[k];                                  // new key → add
      else if (isObj(out[k]) && isObj(b[k])) out[k] = merge(out[k], b[k]); // both objects → recurse
      // else: existing scalar/array — keep existing (reuse-first; never override live data)
    }
    return out;
  };
  return JSON.stringify(merge(cur, nxt), null, 2);
}

/** Body text between a class constructor's braces (brace-balanced), or '' when there is none. */
function constructorBody(src) {
  const m = /\bconstructor\s*\([^)]*\)\s*\{/.exec(src || '');
  if (!m) return '';
  const open = m.index + m[0].length - 1; // the '{'
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(open + 1, j); }
  }
  return '';
}

/** Framework-dependency members a class WIRES in its constructor — the `this.X = …` assignments
 * (e.g. `this.actions = new Actions(page)`, `this.loginPage = new LoginPage(page)`). Dropping one
 * while the class still calls `this.X.<method>()` is the exact corruption behind the runtime
 * `Cannot read properties of undefined`. Returns the Set of assigned member names. */
function constructorWiredDeps(src) {
  const deps = new Set();
  const re = /\bthis\.([A-Za-z_]\w*)\s*=/g;
  let m;
  const body = constructorBody(src);
  while ((m = re.exec(body))) deps.add(m[1]);
  return deps;
}

/** Every `this.X` a source assigns ANYWHERE (constructor, method, or field initializer) — used to
 * tell whether a regeneration still initializes a dependency it references. */
function assignedThisProps(src) {
  const out = new Set();
  const text = src || '';
  let m;
  const assignRe = /\bthis\.([A-Za-z_]\w*)\s*=/g;
  while ((m = assignRe.exec(text))) out.add(m[1]);
  const fieldRe = /\n[ \t]*(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+)*([A-Za-z_]\w*)\s*(?::[^=;\n]+)?=\s*[^=;]/g;
  while ((m = fieldRe.exec(text))) out.add(m[1]);
  return out;
}

/** DETERMINISTIC constructor-wiring guard. Returns the dependency members an EXISTING reusable
 * class (`current`) initializes in its constructor that the regeneration (`next`) still CALLS
 * (`this.X.…`) but no longer initializes anywhere — i.e. writing `next` would strip the wiring and
 * crash at runtime with `Cannot read properties of undefined`. Empty array => safe to write. */
function droppedConstructorWiring(current, next) {
  const wired = constructorWiredDeps(current);
  if (!wired.size) return [];
  const nextAssigned = assignedThisProps(next);
  const dropped = [];
  for (const dep of wired) {
    if (nextAssigned.has(dep)) continue;                        // next still wires it — fine
    if (new RegExp(`\\bthis\\.${dep}\\s*\\.`).test(next)) dropped.push(dep); // used but unwired → corruption
  }
  return dropped;
}

/**
 * Would writing `next` over an existing `current` file DELETE existing coverage?
 * True when the new content drops tests/locators/methods, shrinks by >40%, OR strips a
 * constructor dependency the class still uses (the LoginModule `this.actions` regression).
 * Used to protect canonical files: reuse-first, never clobber working code.
 */
function isDestructiveOverwrite(current, next, layer) {
  if ((layer === 'module' || layer === 'page') && droppedConstructorWiring(current, next).length > 0) return true;
  const oldMembers = countMembers(current, layer);
  const newMembers = countMembers(next, layer);
  if (oldMembers > 0 && newMembers < oldMembers) return true;
  return next.trim().length < current.trim().length * 0.6;
}

/** Extract class-body member blocks {name, text} from TS source: real methods/getters AND the
 * arrow-function property locators this framework's Page objects use (`name = (): Locator => …`). */
function memberBlocks(src) {
  const out = [];
  const seen = new Set();
  const SKIP = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'const', 'let', 'var', 'this']);
  const re = /\n([ \t]+)(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|async\s+|get\s+|set\s+)*([a-zA-Z_]\w*)\s*(?::\s*[\w.<>\[\],| ]+?)?\s*(\(|=)/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[2];
    const kind = m[3];
    if (SKIP.has(name) || seen.has(name)) continue;
    const lineStart = m.index + 1; // char after the matched '\n' (keeps indentation)
    let text = null;
    if (kind === '(') {
      // Real method/getter: balance the parameter parens, then the body braces.
      let i = re.lastIndex - 1, depth = 0;
      for (; i < src.length; i++) { const ch = src[i]; if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth === 0) { i++; break; } } }
      const bm = src.slice(i).match(/^\s*(?::[^\n{;]+)?\{/); // optional ': ReturnType' then body '{'
      if (!bm) continue;
      let j = i + bm[0].length - 1, bd = 0;
      for (; j < src.length; j++) { const ch = src[j]; if (ch === '{') bd++; else if (ch === '}') { bd--; if (bd === 0) { j++; break; } } }
      text = src.slice(lineStart, j);
    } else {
      // Property assignment — only accept arrow-function locators (`= (…) => …;`) to avoid
      // mistaking an object-literal key inside a method body for a member. Balance ()[]{} and
      // stop at the statement-terminating ';' at depth 0.
      let i = re.lastIndex, p = 0, b = 0, c = 0, end = -1;
      for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '(') p++; else if (ch === ')') p--;
        else if (ch === '{') b++; else if (ch === '}') b--;
        else if (ch === '[') c++; else if (ch === ']') c--;
        else if (ch === ';' && p <= 0 && b <= 0 && c <= 0) { end = i + 1; break; }
      }
      if (end < 0) continue;
      const seg = src.slice(lineStart, end);
      // Accept arrow-function locators (`= (…) => …`) AND plain/typed property locators
      // (`name = this.page.locator(...)` / `getBy...`); skip other plain fields (scalars/object keys)
      // to avoid mistaking an object-literal key inside a method body for a member.
      if (!seg.includes('=>') && !/getBy[A-Za-z]+\s*\(|\.locator\s*\(|this\.page\b/.test(seg)) continue;
      text = seg;
    }
    if (text) { out.push({ name, text }); seen.add(name); }
  }
  const locatorFieldRe = /\n([ \t]+)(?:public\s+|private\s+|protected\s+|readonly\s+)*([a-zA-Z_]\w*)\s*:\s*Locator\s*;/g;
  while ((m = locatorFieldRe.exec(src))) {
    const name = m[2];
    if (seen.has(name)) continue;
    out.push({ name, text: src.slice(m.index + 1, locatorFieldRe.lastIndex) });
    seen.add(name);
  }
  return out;
}

/** Extract each top-level test() block from a spec as {name: title, text: full block}. Lets a spec
 * be merged the SAME baseline-aware way as Page/Module members: keep baseline tests verbatim, let
 * compile-fix/heal correct this-run tests, append genuinely-new ones. Balances the test(...) call
 * parens while skipping strings and comments so a brace inside the body never ends the block early. */
function specBlocks(src) {
  const out = [];
  const seen = new Set();
  // Only real test() calls (and test.only/skip/fixme/fail) — NOT test.describe or hooks, whose
  // body would otherwise swallow every inner test into one block.
  const re = /\btest\s*(?:\.(?:only|skip|fixme|fail))?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const title = m[2];
    const open = src.indexOf('(', m.index);
    if (open < 0) continue;
    let depth = 0; let str = null; let end = -1;
    for (let j = open; j < src.length; j++) {
      const ch = src[j];
      if (str) { if (ch === str && src[j - 1] !== '\\') str = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { str = ch; continue; }
      if (ch === '/' && src[j + 1] === '/') { const nl = src.indexOf('\n', j); j = nl < 0 ? src.length : nl; continue; }
      if (ch === '/' && src[j + 1] === '*') { const ce = src.indexOf('*/', j + 2); j = ce < 0 ? src.length : ce + 1; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    let tail = end + 1;
    while (tail < src.length && /\s/.test(src[tail])) tail++;
    if (src[tail] === ';') end = tail;
    if (seen.has(title)) continue;
    seen.add(title);
    out.push({ name: title, text: src.slice(m.index, end + 1) });
  }
  return out;
}

/**
 * Best-effort ADDITIVE merge for a code file (page/module). When the regenerated file would DROP
 * existing members (so the reuse guard would protect it) but also ADDS new methods/getters, keep the
 * current file intact and APPEND only the genuinely-new members before the class's closing brace.
 * Preserves existing coverage AND lands the new method — e.g. a new Page locator getter the module
 * calls (`productSortDropdown`) that would otherwise be lost. Returns merged text, or null when it
 * can't merge safely (the caller then protects the file as before). Generic.
 */
function additiveMerge(current, next, layer) {
  if (layer !== 'page' && layer !== 'module') return null;
  const have = new Set(memberBlocks(current).map((b) => b.name));
  if (!have.size) return null; // couldn't parse current's members — bail so we never duplicate them
  const additions = memberBlocks(next).filter((b) => !have.has(b.name));
  if (!additions.length) return null;
  const idx = current.lastIndexOf('}'); // the class body's closing brace
  if (idx < 0) return null;
  const inject = '\n' + additions.map((b) => b.text.replace(/\s+$/, '')).join('\n\n') + '\n';
  return current.slice(0, idx) + inject + current.slice(idx);
}

/** Member names of every existing Page/Module at JOB START — the immutable baseline. Members not
 * in this set were added DURING the job and may still be corrected by compile-fix/heal. */
function captureBaselines(fw) {
  const map = {};
  for (const sub of ['src/pages', 'src/modules']) {
    const dir = path.join(fw, sub);
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const f of names) {
      if (!f.endsWith('.ts')) continue;
      try { map[`${sub}/${f}`] = new Set(memberBlocks(fs.readFileSync(path.join(dir, f), 'utf8')).map((b) => b.name)); } catch { /* skip unreadable */ }
    }
  }
  // Specs: baseline = the test TITLES that existed at job start (immutable). This-run tests may be
  // corrected by compile-fix/heal; new tests appended. Prevents the destructive guard from
  // protecting the whole spec and trapping a partial compile-fix that never lands its fixes.
  const tdir = path.join(fw, 'src/tests');
  let specs;
  try { specs = fs.readdirSync(tdir); } catch { specs = []; }
  for (const f of specs) {
    if (!f.endsWith('.spec.ts')) continue;
    try { map[`src/tests/${f}`] = new Set(specBlocks(fs.readFileSync(path.join(tdir, f), 'utf8')).map((b) => b.name)); } catch { /* skip unreadable */ }
  }
  return map;
}

/**
 * Baseline-aware merge for an existing Page/Module. PRE-EXISTING members (in `baseNames`, captured
 * at job start) are IMMUTABLE — existing tests depend on them, so a new-case regen can never rewrite
 * a constructor or method. But members ADDED during this job are still correctable: if `next` re-emits
 * one (a compile-fix/heal), its block is swapped in; brand-new members are appended. This keeps the
 * regression protection AND lets the compile gate actually fix a broken new member. Returns merged
 * text, or null when nothing changed / can't parse. Generic.
 */
function mergeExisting(current, next, layer, baseNames) {
  if (layer !== 'page' && layer !== 'module' && layer !== 'spec') return null;
  const blocksOf = layer === 'spec' ? specBlocks : memberBlocks;
  const curBlocks = blocksOf(current);
  if (!curBlocks.length) return null;
  const curNames = new Set(curBlocks.map((b) => b.name));
  const curByName = new Map(curBlocks.map((b) => [b.name, b]));
  const base = baseNames || curNames; // no baseline → pure append-only (immutable = all current)
  let out = current;
  let changed = false;
  // 1) Correct members that were ADDED this run (not in the baseline) when `next` re-emits them.
  for (const nb of blocksOf(next)) {
    if (base.has(nb.name)) continue; // baseline member — never touch
    const cb = curByName.get(nb.name);
    if (cb && cb.text !== nb.text) { out = out.replace(cb.text, nb.text); changed = true; }
  }
  // 1b) PAGES (constructor-field style): the locator VALUE lives in the constructor (`this.X = …`),
  // NOT in the `readonly X: Locator;` field block — so a heal/compile-fix that corrects a locator
  // changes the constructor assignment, which the member-block diff in step 1 cannot see (the field
  // block is byte-identical). Without this, a corrected locator is silently discarded ("🛡 kept") and
  // the fix can NEVER land. Reconcile this-run assignments (baseline assignments stay immutable).
  if (layer === 'page') {
    const asgRe = /\n[ \t]*this\.(\w+)\s*=\s*[^;]+;/g;
    const nextAsg = new Map();
    let am;
    while ((am = asgRe.exec(next)) !== null) if (!nextAsg.has(am[1])) nextAsg.set(am[1], am[0]);
    asgRe.lastIndex = 0;
    const curAsg = [];
    while ((am = asgRe.exec(current)) !== null) curAsg.push({ name: am[1], text: am[0] });
    for (const ca of curAsg) {
      if (base.has(ca.name)) continue; // baseline locator — immutable
      const na = nextAsg.get(ca.name);
      if (na && na !== ca.text && out.includes(ca.text)) { out = out.replace(ca.text, na); changed = true; }
    }
  }
  // 2) Append genuinely-new members (present in next, absent from current and baseline).
  const additions = blocksOf(next).filter((b) => !curNames.has(b.name) && !base.has(b.name));
  if (additions.length) {
    const idx = out.lastIndexOf('}');
    if (idx >= 0) { out = out.slice(0, idx) + '\n' + additions.map((b) => b.text.replace(/\s+$/, '')).join('\n\n') + '\n' + out.slice(idx); changed = true; }
  }
  return changed ? out : null;
}

/**
 * DETERMINISTIC fixture registrar — guarantees every newly-created Page/Module gets a
 * fixture entry in src/fixtures/index.ts, WITHOUT trusting the LLM to regenerate that
 * file. The reuse guard (isDestructiveOverwrite) legitimately protects fixtures/index.ts
 * from an LLM emit that SHRINKS it (drops existing fixtures) — but that protection used
 * to leave brand-new Page/Module classes unregistered, so the generated spec referenced
 * fixtures Playwright didn't know ("Test has unknown parameter 'checkoutModule'"). This
 * merges each new fixture in additively via targeted string injection: it NEVER rewrites
 * or drops existing content, so it's safe to run every generation and is fully idempotent
 * (a fixture that's already registered is skipped).
 *
 * For a created `src/pages/CheckoutPage.ts` it injects, if missing:
 *   import { CheckoutPage } from '../pages/CheckoutPage';
 *   type member:  checkoutPage: CheckoutPage;
 *   fixture:      checkoutPage: async ({ page }, use) => { await use(new CheckoutPage(page)); },
 *
 * Returns { changed, added:[fixtureName…], backup:relPath|null }.
 */
function ensureFixturesRegistered(fw, written) {
  const rel = 'src/fixtures/index.ts';
  const abs = path.join(fw, rel);
  if (!fs.existsSync(abs)) return { changed: false, added: [], backup: null };
  let src = fs.readFileSync(abs, 'utf8');

  // Collect the Page/Module classes touched this run (created OR extended).
  const seen = new Set();
  const candidates = [];
  for (const w of written) {
    if (w.layer !== 'page' && w.layer !== 'module') continue;
    const className = path.basename(w.path).replace(/\.ts$/, '');
    if (!/^[A-Z]\w*(Page|Module)$/.test(className)) continue;
    const fixtureName = className.charAt(0).toLowerCase() + className.slice(1);
    if (seen.has(fixtureName)) continue;
    seen.add(fixtureName);
    const dir = w.layer === 'page' ? 'pages' : 'modules';
    candidates.push({ className, fixtureName, importPath: `../${dir}/${className}` });
  }
  if (candidates.length === 0) return { changed: false, added: [], backup: null };

  const added = [];
  for (const c of candidates) {
    // Already wired up (type member OR fixture entry present) → nothing to do.
    if (new RegExp(`\\b${c.fixtureName}\\s*:`).test(src)) continue;

    // 1) import — append after the last existing import statement.
    if (!new RegExp(`import\\s*\\{[^}]*\\b${c.className}\\b[^}]*\\}`).test(src)) {
      const importLine = `import { ${c.className} } from '${c.importPath}';`;
      const importRe = /^import .*;$/gm;
      let lastEnd = -1;
      let mm;
      while ((mm = importRe.exec(src)) !== null) lastEnd = mm.index + mm[0].length;
      src = lastEnd >= 0
        ? src.slice(0, lastEnd) + '\n' + importLine + src.slice(lastEnd)
        : importLine + '\n' + src;
    }

    // 2) type member — inject at the top of the `TestFixtures` type block.
    const typeAnchor = src.match(/export type TestFixtures\s*=\s*\{/);
    if (typeAnchor) {
      const at = typeAnchor.index + typeAnchor[0].length;
      src = src.slice(0, at) + `\n    ${c.fixtureName}: ${c.className};` + src.slice(at);
    }

    // 3) fixture function — inject at the top of the `.extend<TestFixtures>({ … })` object.
    const extAnchor = src.match(/\.extend<TestFixtures>\(\{/);
    if (extAnchor) {
      const at = extAnchor.index + extAnchor[0].length;
      const fn = `\n    ${c.fixtureName}: async ({ page }, use) => {\n        await use(new ${c.className}(page));\n    },`;
      src = src.slice(0, at) + fn + src.slice(at);
    }

    added.push(c.fixtureName);
  }

  if (added.length === 0) return { changed: false, added: [], backup: null };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bakRel = path.join('.blast-backups', `fixtures-index.ts.bak-${ts}`);
  const bakAbs = path.join(fw, bakRel);
  fs.mkdirSync(path.dirname(bakAbs), { recursive: true });
  fs.copyFileSync(abs, bakAbs);
  fs.writeFileSync(abs, src, 'utf8');
  return { changed: true, added, backup: bakRel };
}

/** Humanize a locator member name into a likely accessible name + role. `logoutButton` →
 * {role:'button', name:'Logout'}; `usernameInput` → {role:'textbox', name:'Username'};
 * `profileMenuTab` → {role:'tab', name:'Profile Menu'}. Generic — drives the stub selector below. */
function inferLocatorTarget(member) {
  const ROLE_SUFFIX = [
    [/link$/i, 'link'], [/button$/i, 'button'], [/tab$/i, 'tab'],
    [/menu ?item$|menuitem$/i, 'menuitem'], [/checkbox$/i, 'checkbox'], [/radio$/i, 'radio'],
    [/(dropdown|combobox|select)$/i, 'combobox'], [/(textbox|input|field)$/i, 'textbox'],
    [/(heading|title)$/i, 'heading'], [/option$/i, 'option'], [/(menu|icon|toggle)$/i, 'button'],
  ];
  let role = null;
  let stripped = member;
  for (const [re, r] of ROLE_SUFFIX) {
    if (re.test(member)) { role = r; stripped = member.replace(re, ''); break; }
  }
  const words = stripped.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { role, name };
}

/** Parse {role, name} pairs from aria-snapshot text (the crawler's reveal-aware snapshots and the
 * live walk both emit this). Used to ground backfilled locators in REAL observed elements. */
function parseAriaElements(text) {
  const out = [];
  if (!text) return out;
  const seen = new Set();
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*-\s+([a-zA-Z]+)(?:\s+"([^"]*)")?/);
    if (!m || !m[2]) continue;
    const key = `${m[1]}|${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role: m[1], name: m[2] });
  }
  return out;
}

/** Find the observed element whose accessible name best matches a page-getter name. `logoutButton`
 * → the real `menuitem "Logout"` (so the backfill uses the PROVEN role+name, not a guess). */
function bestEvidenceMatch(member, evidence) {
  if (!evidence || !evidence.length) return null;
  const target = inferLocatorTarget(member).name.toLowerCase().replace(/\s+/g, '');
  if (!target) return null;
  let contains = null;
  for (const e of evidence) {
    if (!e.name) continue;
    const en = e.name.toLowerCase().replace(/\s+/g, '');
    if (en === target) return e;                                   // exact accessible-name match wins
    if (!contains && (en.includes(target) || target.includes(en))) contains = e;
  }
  return contains;
}

/**
 * DETERMINISTIC locator backfill — closes the LLM gap where a generated Module/Spec references a
 * Page getter that the Page class never defined (TS2339 "Property 'X' does not exist on type
 * 'YPage'" → runtime "Cannot read properties of undefined"). Scans every written Module/Spec for
 * `<var>.<member>(` / `this.<var>.<member>(` accesses on a `*Page` object, resolves the Page class
 * (from the module's `private readonly <var>: <Class>;` decl or the `<var>Page`→`<Class>Page`
 * fixture convention), and — for any referenced member missing from that Page — APPENDS a locator
 * getter. When `evidence` (observed {role,name} from the crawl) contains a matching element the
 * selector uses its PROVEN role+name; otherwise it falls back to name-suffix inference. Purely
 * additive: never rewrites existing members, so it bypasses the protect-guard safely and is
 * idempotent. Generic. Returns { changed, added:[{page,member,proven}], backups:[relPath…] }.
 */
function ensureReferencedLocators(fw, written, evidence = []) {
  const root = path.resolve(fw);
  const pagesDir = path.join(root, 'src', 'pages');
  const added = [];
  const backups = [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  // Page members referenced this run, grouped by Page class name and access style.
  const wanted = new Map(); // className -> Map(member -> { called, property })
  for (const w of written) {
    if (w.layer !== 'module' && w.layer !== 'spec') continue;
    const abs = path.join(root, w.path);
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    // var -> Class from `readonly headerPage: HeaderPage;` and `new HeaderPage(`.
    const varToClass = new Map();
    let d;
    const declRe = /(?:private|protected|public|readonly|\s)*\b(\w+)\s*:\s*([A-Z]\w*Page)\b/g;
    while ((d = declRe.exec(src))) varToClass.set(d[1], d[2]);
    const newRe = /\b(\w+)\s*=\s*new\s+([A-Z]\w*Page)\s*\(/g;
    while ((d = newRe.exec(src))) varToClass.set(d[1], d[2]);
    const refRe = /(?:this\.)?(\w+)\.([a-zA-Z_]\w*)\b/g;
    let r;
    while ((r = refRe.exec(src))) {
      const [, varName, member] = r;
      let cls = varToClass.get(varName);
      if (!cls && /Page$/.test(varName)) cls = varName.charAt(0).toUpperCase() + varName.slice(1); // fixture convention
      if (!cls || !/Page$/.test(cls)) continue;
      if (!wanted.has(cls)) wanted.set(cls, new Map());
      const usage = wanted.get(cls).get(member) || { called: false, property: false };
      if (/^\s*\(/.test(src.slice(refRe.lastIndex))) usage.called = true;
      else usage.property = true;
      wanted.get(cls).set(member, usage);
    }
  }
  if (!wanted.size) return { changed: false, added, backups };

  for (const [cls, members] of wanted) {
    const abs = path.join(pagesDir, `${cls}.ts`);
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; } // page not on disk — skip
    const have = new Set(memberBlocks(src).map((b) => b.name));
    const missing = [...members.entries()].filter(([member]) => !have.has(member));
    if (!missing.length) continue;
    const constructor = /constructor\s*\(\s*(?:(?:public|private|protected|readonly)\s+)*(\w+)\s*:\s*Page\b[^)]*\)\s*\{/.exec(src);
    if (!constructor) continue;
    const pageParam = constructor[1];
    const constructorParam = constructor[0].match(/\(\s*([^:)]+)\s*:\s*Page\b/);
    const storesPage = constructorParam && /\b(?:public|private|protected|readonly)\b/.test(constructorParam[1]);
    const properties = missing.filter(([, usage]) => usage.property);
    const getters = missing.filter(([, usage]) => usage.called && !usage.property);
    const selector = (member, pageRef) => {
      const ev = bestEvidenceMatch(member, evidence);
      const role = ev ? ev.role : inferLocatorTarget(member).role;
      const name = ev ? ev.name : inferLocatorTarget(member).name;
      const esc = (s) => String(s).replace(/'/g, "\\'");
      return role
        ? `${pageRef}.getByRole('${role}', { name: '${esc(name)}' })`
        : `${pageRef}.getByText('${esc(name)}')`;
    };
    let out = src;
    if (getters.length) {
      if (!storesPage) {
        const pageParamRe = new RegExp(`(constructor\\s*\\(\\s*)(?:(?:public|private|protected|readonly)\\s+)*${pageParam}\\s*:\\s*Page\\b`);
        out = out.replace(pageParamRe, `$1private readonly ${pageParam}: Page`);
      }
      const idx = out.lastIndexOf('}');
      if (idx < 0) continue;
      const stubs = getters.map(([member]) => `    ${member} = (): Locator => ${selector(member, `this.${pageParam}`)};`);
      out = out.slice(0, idx) + '\n' + stubs.join('\n\n') + '\n' + out.slice(idx);
    }
    if (properties.length) {
      const currentConstructor = /constructor\s*\([^)]*\)\s*\{/.exec(out);
      if (!currentConstructor) continue;
      const bodyStart = out.indexOf('{', currentConstructor.index);
      let depth = 0;
      let bodyEnd = -1;
      for (let index = bodyStart; index < out.length; index++) {
        if (out[index] === '{') depth++;
        if (out[index] === '}') {
          depth--;
          if (depth === 0) { bodyEnd = index; break; }
        }
      }
      if (bodyEnd < 0) continue;
      const fields = properties.map(([member]) => `    readonly ${member}: Locator;`);
      const assignments = properties.map(([member]) => `        this.${member} = ${selector(member, pageParam)};`);
      out = out.slice(0, bodyEnd) + '\n' + assignments.join('\n') + '\n    ' + out.slice(bodyEnd);
      const classEnd = out.lastIndexOf('}');
      if (classEnd < 0) continue;
      out = out.slice(0, classEnd) + '\n' + fields.join('\n') + '\n' + out.slice(classEnd);
    }
    for (const [member] of missing) {
      const ev = bestEvidenceMatch(member, evidence);
      added.push({ page: `src/pages/${cls}.ts`, member, proven: !!ev });
    }
    if (!/\bLocator\b/.test(out.slice(0, out.indexOf('export')))) {
      out = /import\s*\{[^}]*\bPage\b[^}]*\}\s*from\s*'@playwright\/test'/.test(out)
        ? out.replace(/(import\s*\{)([^}]*\bPage\b[^}]*)(\}\s*from\s*'@playwright\/test')/, (mm, a, b, c) => `${a}${/\bLocator\b/.test(b) ? b : ` Locator,${b}`}${c}`)
        : `import { Locator } from '@playwright/test';\n${out}`;
    }
    const bakRel = path.join('.blast-backups', `${cls}.ts.bak-${ts}`);
    const bakAbs = path.join(root, bakRel);
    fs.mkdirSync(path.dirname(bakAbs), { recursive: true });
    fs.copyFileSync(abs, bakAbs);
    fs.writeFileSync(abs, out.endsWith('\n') ? out : out + '\n', 'utf8');
    backups.push(bakRel.replace(/\\/g, '/'));
  }
  return { changed: added.length > 0, added, backups };
}

/**
 * DETERMINISTIC TS2564 guarantee. Under strictPropertyInitialization every declared
 * `X: Locator;` field MUST be assigned in the constructor. Terse models often DECLARE the field
 * but forget `this.X = …` (and because a bare field reads as "already defined", the reference
 * backfill skips it). This scans every written Page and, for any Locator field with no
 * `this.X =` assignment, injects one into the constructor body — PROVEN role+name from crawl
 * evidence when available, else name-inferred. The raw page param is in scope inside the body, so
 * the assignment matches the page's own style. Additive to the constructor only (never rewrites a
 * member), so it bypasses the protect-guard and the compile-fix LLM never sees the error. Generic.
 * Returns { changed, fixed:[{page,field,proven}], backups:[relPath…] }.
 */
function ensurePageFieldsInitialized(fw, written, evidence = []) {
  const root = path.resolve(fw);
  const fixed = [];
  const backups = [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const esc = (s) => String(s).replace(/'/g, "\\'");
  const pageRels = [...new Set(written.filter((w) => w.layer === 'page').map((w) => w.path))];
  for (const rel of pageRels) {
    const abs = path.join(root, rel);
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const ctor = /constructor\s*\(\s*(?:(?:public|private|protected|readonly)\s+)*(\w+)\s*:\s*Page\b[^)]*\)\s*\{/.exec(src);
    if (!ctor) continue;
    const pageParam = ctor[1];
    const fieldRe = /\n[ \t]*(?:public\s+|private\s+|protected\s+|readonly\s+)*([a-zA-Z_]\w*)\s*:\s*Locator\s*;/g;
    const fields = [];
    let fm;
    while ((fm = fieldRe.exec(src))) fields.push(fm[1]);
    const uninit = fields.filter((f) => !new RegExp(`\\bthis\\.${f}\\s*=`).test(src));
    if (!uninit.length) continue;
    const bodyStart = src.indexOf('{', ctor.index);
    let depth = 0;
    let bodyEnd = -1;
    for (let i = bodyStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) { bodyEnd = i; break; }
    }
    if (bodyEnd < 0) continue;
    const sel = (member) => {
      const ev = bestEvidenceMatch(member, evidence);
      const role = ev ? ev.role : inferLocatorTarget(member).role;
      const name = ev ? ev.name : inferLocatorTarget(member).name;
      return role
        ? `${pageParam}.getByRole('${role}', { name: '${esc(name)}' })`
        : `${pageParam}.getByText('${esc(name)}')`;
    };
    const inject = uninit.map((f) => `    this.${f} = ${sel(f)};`).join('\n');
    const out = src.slice(0, bodyEnd) + '\n' + inject + '\n  ' + src.slice(bodyEnd);
    const bakRel = path.join('.blast-backups', `${path.basename(rel)}.bak-${ts}`);
    const bakAbs = path.join(root, bakRel);
    fs.mkdirSync(path.dirname(bakAbs), { recursive: true });
    fs.copyFileSync(abs, bakAbs);
    fs.writeFileSync(abs, out.endsWith('\n') ? out : out + '\n', 'utf8');
    backups.push(bakRel.replace(/\\/g, '/'));
    for (const f of uninit) fixed.push({ page: rel, field: f, proven: !!bestEvidenceMatch(f, evidence) });
  }
  return { changed: fixed.length > 0, fixed, backups };
}

/** Run the deterministic field-initializer and fold its result into the run's write log/backups. */
function applyFieldInit(fw, written, evidence, allBackups, recordWrite, log) {
  const res = ensurePageFieldsInitialized(fw, written, evidence);
  if (!res.changed) return;
  allBackups.push(...res.backups);
  const provenN = res.fixed.filter((a) => a.proven).length;
  log(`[local]   ＋ initialized ${res.fixed.length} uninitialized Locator field(s) (${provenN} from live evidence): ${res.fixed.map((a) => `${a.field}→${a.page.split('/').pop()}`).join(', ')}`);
  for (const page of new Set(res.fixed.map((a) => a.page))) {
    recordWrite({ path: page, layer: 'page', reused: false, action: 'merged' });
  }
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
function writeFiles(fw, files, baselines = null) {
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
      // DEEP-MERGE for an existing JSON data file (e.g. testData.json): the LLM re-emits only
      // the keys the new case needs, so a whole-file overwrite would drop existing keys and a
      // whole-file protect would drop the NEW keys the case reads. Union both — keep every
      // existing key/value, add only the new ones — so new cases get their data AND existing
      // tests keep theirs. Handled BEFORE the length guard so a shorter subset never trips it.
      if (relFromRoot.endsWith('.json')) {
        const merged = mergeJsonData(current, next);
        if (merged === null) {
          // next isn't a parseable JSON object (truncated/placeholder) — keep the working file.
          report.protected += 1;
          written.push({ path: relFromRoot, layer: f.layer, reused: true, action: 'protected', reason: 'new content is not valid JSON' });
          continue;
        }
        const mergedOut = merged.endsWith('\n') ? merged : merged + '\n';
        if (mergedOut.trim() === current.trim()) {
          report.reused += 1;
          written.push({ path: relFromRoot, layer: f.layer, reused: true, action: 'protected' });
          continue;
        }
        const bak = path.join(root, '.blast-backups', `${relFromRoot}.bak-${ts}`);
        fs.mkdirSync(path.dirname(bak), { recursive: true });
        fs.copyFileSync(abs, bak);
        backups.push(path.relative(root, bak).replace(/\\/g, '/'));
        fs.writeFileSync(abs, mergedOut, 'utf8');
        report.overwritten += 1;
        written.push({ path: relFromRoot, layer: f.layer, reused: false, action: 'merged' });
        continue;
      }
      // Files CREATED this run (no baseline entry) have NO cross-run coverage to protect. If the
      // LLM's regeneration is non-destructive (keeps at least the existing members), OVERWRITE it
      // verbatim so a compile-fix/heal ALWAYS lands — independent of which member format our parser
      // recognizes (a fragile parser must never silently drop a real fix). The compile gate
      // re-validates, so a bad overwrite is caught next round. Pre-existing files (baseline) still
      // go through the surgical immutable merge below so already-passing tests can never regress.
      if ((f.layer === 'page' || f.layer === 'module' || f.layer === 'spec')
          && !(baselines && baselines[relFromRoot])
          && !isDestructiveOverwrite(current, next, f.layer)) {
        const bak = path.join(root, '.blast-backups', `${relFromRoot}.bak-${ts}`);
        fs.mkdirSync(path.dirname(bak), { recursive: true });
        fs.copyFileSync(abs, bak);
        backups.push(path.relative(root, bak).replace(/\\/g, '/'));
        fs.writeFileSync(abs, next, 'utf8');
        report.overwritten += 1;
        written.push({ path: relFromRoot, layer: f.layer, reused: false, action: 'rewritten' });
        continue;
      }
      // APPEND-ONLY for an existing Page/Module: the LLM must NEVER rewrite an existing
      // method/getter/constructor — existing tests depend on them. A new-case regen that
      // rewrote InventoryModule dropped its constructor wiring and broke 5 passing tests
      // (`Cannot read properties of undefined`). So keep every PRE-EXISTING member (from the
      // job-start baseline) VERBATIM; members ADDED this run stay correctable so the compile
      // gate / heal can fix a broken new method. If nothing changed, reuse untouched. Generic.
      if (f.layer === 'page' || f.layer === 'module') {
        // A file with no baseline entry was CREATED this run → its members are all correctable
        // (empty baseline), so compile-fix/heal can land fixes instead of protecting a broken file.
        const baseNames = baselines ? (baselines[relFromRoot] || new Set()) : null;
        // Deterministic wiring guard: if the regen/heal strips a constructor dependency the class
        // still uses (e.g. `this.actions`), report WHY so the run log shows the rejected replacement.
        const droppedWiring = droppedConstructorWiring(current, next);
        const wiringReason = droppedWiring.length
          ? `preserved existing reusable — rejected replacement that dropped constructor wiring (this.${droppedWiring.join(', this.')})`
          : undefined;
        const merged = mergeExisting(current, next, f.layer, baseNames);
        if (merged && merged.trim() !== current.trim()) {
          const bak = path.join(root, '.blast-backups', `${relFromRoot}.bak-${ts}`);
          fs.mkdirSync(path.dirname(bak), { recursive: true });
          fs.copyFileSync(abs, bak);
          backups.push(path.relative(root, bak).replace(/\\/g, '/'));
          fs.writeFileSync(abs, merged.endsWith('\n') ? merged : merged + '\n', 'utf8');
          report.overwritten += 1;
          written.push({ path: relFromRoot, layer: f.layer, reused: false, action: 'merged', reason: wiringReason });
        } else {
          report.reused += 1;
          written.push({ path: relFromRoot, layer: f.layer, reused: true, action: 'protected', reason: wiringReason });
        }
        continue;
      }
      if (isDestructiveOverwrite(current, next, f.layer)) {
        // The regenerated file would drop existing coverage. Before protecting it wholesale,
        // try an ADDITIVE merge: keep the working file and append only the genuinely-new
        // methods/getters (e.g. a new Page locator the module needs). This preserves existing
        // coverage AND lands the new member. Only when merge isn't possible do we protect.
        // SPECS: a partial compile-fix/heal re-emits only the CASES it corrected, so a whole-file
        // overwrite is destructive and the guard would `🛡 keep` the spec — trapping the fix so it
        // never lands (this is why compile errors like `boundaryX is not defined` / `<mod>.<method>
        // is not a function` couldn't be corrected). Merge test-block-wise: keep baseline (job-start)
        // tests VERBATIM, swap in the corrected version of this-run tests, append any new tests.
        if (f.layer === 'spec') {
          // No baseline entry → spec created this run → all its tests are correctable (empty baseline).
          const baseTitles = baselines ? (baselines[relFromRoot] || new Set()) : null;
          const specMerged = mergeExisting(current, next, 'spec', baseTitles);
          if (specMerged && specMerged.trim() !== current.trim()) {
            const bak = path.join(root, '.blast-backups', `${relFromRoot}.bak-${ts}`);
            fs.mkdirSync(path.dirname(bak), { recursive: true });
            fs.copyFileSync(abs, bak);
            backups.push(path.relative(root, bak).replace(/\\/g, '/'));
            fs.writeFileSync(abs, specMerged.endsWith('\n') ? specMerged : specMerged + '\n', 'utf8');
            report.overwritten += 1;
            written.push({ path: relFromRoot, layer: f.layer, reused: false, action: 'merged' });
            continue;
          }
        }
        const merged = additiveMerge(current, next, f.layer);
        if (merged && merged !== current && merged.trim() !== current.trim()) {
          const bak = path.join(root, '.blast-backups', `${relFromRoot}.bak-${ts}`);
          fs.mkdirSync(path.dirname(bak), { recursive: true });
          fs.copyFileSync(abs, bak);
          backups.push(path.relative(root, bak).replace(/\\/g, '/'));
          fs.writeFileSync(abs, merged.endsWith('\n') ? merged : merged + '\n', 'utf8');
          report.overwritten += 1;
          written.push({ path: relFromRoot, layer: f.layer, reused: false, action: 'merged' });
          continue;
        }
        // Reuse-first guard: nothing new to add — keep the working file untouched instead of clobbering it.
        report.protected += 1;
        written.push({ path: relFromRoot, layer: f.layer, reused: true, action: 'protected' });
        continue;
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
    // Parallelism: default to MAX practical parallel for fast feedback — one worker per selected
    // case, capped (BLAST_MAX_WORKERS, default 8), which overrides the framework's conservative CI
    // default. 'Serial' forces one worker; a numeric job.parallel is honored verbatim.
    if (job && job.parallel === 'Serial') {
      args.push('--workers=1');
    } else {
      const cap = parseInt(process.env.BLAST_MAX_WORKERS, 10) || 8;
      const explicit = parseInt(job && job.parallel, 10);
      const caseCount = job && Array.isArray(job.testCases) ? job.testCases.length : 0;
      const workers = Number.isFinite(explicit) && explicit > 0
        ? explicit
        : Math.min(Math.max(caseCount, 2), cap);
      args.push(`--workers=${workers}`);
    }
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

/** True when the framework is a TypeScript project with a compiler available (else the gate is skipped). */
function hasTypeScript(fw) {
  try {
    return fs.existsSync(path.join(fw, 'tsconfig.json'))
      && (fs.existsSync(path.join(fw, 'node_modules', 'typescript'))
        || fs.existsSync(path.join(fw, 'node_modules', '.bin', 'tsc'))
        || fs.existsSync(path.join(fw, 'node_modules', '.bin', 'tsc.cmd')));
  } catch { return false; }
}

/** Type-check the whole project (no emit). Returns { ok, output }. The compiler is the authoritative API contract. */
function typeCheck(fw) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], { cwd: fw, env: process.env, shell: true });
    let output = '';
    const onData = (d) => { output += d.toString(); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { child.kill('SIGKILL'); output += '\n[local] tsc timed out.'; }, TSC_TIMEOUT_MS);
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, output: output + `\ntsc spawn error: ${err.message}` }); });
  });
}

/**
 * Filter tsc output to only the compile errors in files WE generated/changed this run. A clean
 * framework `main` compiles, so any error here is from our code; filtering also prevents a stray
 * pre-existing project error from blocking the gate.
 */
function tscErrorsForFiles(output, relPaths) {
  const wants = relPaths.map((p) => String(p).replace(/\\/g, '/'));
  return String(output || '').split('\n').filter((line) => {
    const m = line.match(/^\s*(.+?\.tsx?)[(:]/);
    if (!m) return false;
    const f = m[1].replace(/\\/g, '/').replace(/^\.\//, '');
    return wants.some((w) => f === w || f.endsWith('/' + w) || f.endsWith(w));
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
/** Human wording for the plan header/run-steps based on the execution provider. */
function planExecutionCopy(providerName) {
  const p = (providerName || 'local').toLowerCase();
  if (p === 'github-actions') {
    return {
      runLine: 'Runs on the **B.L.A.S.T. cloud runner (GitHub Actions)** via Playwright (`desktop-chrome`, headless), then opens a **Pull Request** (the review gate).',
      providerLine: 'cloud (GitHub Actions)',
      where: 'on a GitHub-hosted runner',
      lastStep: 'Open a **Pull Request** with the generated tests for review (existing tests protected); the HTML/Allure report is attached as a CI artifact.',
      reuseLastStep: 'Attach the fresh report as a CI artifact (no PR \u2014 nothing changed).',
    };
  }
  if (p === 'runner') {
    return {
      runLine: 'Runs on a **pull-based runner** (self-hosted worker) via Playwright (`desktop-chrome`, headless).',
      providerLine: 'runner (self-hosted worker)',
      where: 'on the worker',
      lastStep: 'Refresh the capabilities index and report results back to the B.L.A.S.T. UI.',
      reuseLastStep: 'Report the fresh report back to the B.L.A.S.T. UI.',
    };
  }
  return {
    runLine: 'Runs **locally** via Playwright in the AI Native framework (`desktop-chrome`, headless).',
    providerLine: 'local',
    where: 'locally',
    lastStep: 'Refresh the capabilities index (npm run index) and show the HTML report in the UI.',
    reuseLastStep: 'Show the fresh HTML report in the UI.',
  };
}

/**
 * Render a new case's authored steps for the plan so the user (and reviewer)
 * can SEE exactly what the LLM will build from. If a case has no steps, we flag
 * it explicitly — a title-only case means the LLM has to guess the journey.
 */
function renderCaseSteps(c) {
  const out = [];
  const stepsRaw = String(c.steps || '').trim();
  if (stepsRaw) {
    const stepLines = stepsRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    out.push('    - Steps:');
    stepLines.forEach((s) => out.push(`      ${/^\d/.test(s) ? '' : '- '}${s}`));
  } else {
    out.push('    - ⚠ No steps authored — the LLM will infer the journey from the title only (lower confidence).');
  }
  const testData = String(c.testData || '').trim();
  if (testData) out.push(`    - Test data: ${testData.replace(/\s*\r?\n\s*/g, '; ')}`);
  const expected = String(c.expectedResults || c.expected || '').trim();
  if (expected) out.push(`    - Expected: ${expected.replace(/\s*\r?\n\s*/g, '; ')}`);
  return out;
}

function buildPlan(job, fwOverride, providerName) {
  const { frameworkPath, platform, model } = config();
  const fw = fwOverride || frameworkPath;
  const copy = planExecutionCopy(providerName);
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

  const cases = (job.testCases || []).map((tc) => {
    const coveredIn = caseCoveredAnywhere(fw, tc);
    return { ...tc, exists: !!coveredIn, coveredIn };
  });
  const already = cases.filter((c) => c.exists);
  const toAdd = cases.filter((c) => !c.exists);
  log(`[plan] Reuse analysis (all specs): ${cases.length} selected → ${already.length} already automated (reuse), ${toAdd.length} new (generate).`);
  already.forEach((c) => log(`[plan]   ✅ ${c.id} already in ${c.coveredIn} → reuse`));
  toAdd.forEach((c) => log(`[plan]   🆕 ${c.id} not found in any spec → will generate`));
  if (specTestCount > cases.length && !toAdd.length) {
    log(`[plan] Note: the spec file holds ${specTestCount} test(s) total (a superset of your ${cases.length} selected). Running the spec executes ALL ${specTestCount}.`);
  }

  const reusedFiles = existing.map((e) => e.rel);
  ['src/config/index.ts', 'src/utils/constants.ts'].forEach((p) => {
    if (fw && fs.existsSync(path.join(fw, p))) reusedFiles.push(p);
  });
  log(`[plan] Implementation plan ready — review & approve to run ${copy.where}.`);

  const fileLine = (rel, layer) => {
    const ex = byLayer[layer];
    if (!ex) return `- **CREATE** \`${rel}\` (no existing ${layer} for “${F}”)`;
    if (!toAdd.length) return `- **REUSE** \`${rel}\` (exists — reused as-is, no changes written)`;
    return `- **EXTEND** \`${rel}\` (exists — kept & only added to; never regenerated smaller)`;
  };

  const lines = [
    `# Implementation Plan — ${job.skill || 'New Automation'} (${job.environment || 'QA'})`,
    '',
    copy.runLine,
    `Provider: ${copy.providerLine} · LLM: ${platform}/${model || 'default'}`,
    `Target URL: ${job.url || '(missing)'}`,
    `Reuse index (.ai-memory/capabilities.json): ${hasCaps ? 'found ✓' : 'built at run time'}`,
    '',
    '## Test-case reuse analysis',
  ];

  if (already.length) {
    lines.push(`> 🛡 ${already.length} of ${cases.length} selected case(s) are **already automated** (in any spec) — these will be **REUSED as-is**, not regenerated:`);
    already.forEach((c) => lines.push(`  - ✅ ${c.id} ${c.title || ''} — already in \`${c.coveredIn || specRel}\` → reuse`));
  }
  if (toAdd.length) {
    lines.push(`> ＋ ${toAdd.length} case(s) are **new** and will be added:`);
    toAdd.forEach((c) => {
      lines.push(`  - 🆕 ${c.id} ${c.title || ''} — new → generate`);
      renderCaseSteps(c).forEach((l) => lines.push(l));
    });
    lines.push('  - ↺ A final **behavioral de-duplication** runs at generation: any case above that turns out to drive the SAME actions + test-data as an existing test is auto-skipped (reused as-is), never duplicated — even when its id/title differ (e.g. a re-worded locked-user check collapses onto the existing one). Only genuinely-new behavior is written and PR-gated.');
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
      `2. Re-run the existing spec ${copy.where} with Playwright (\`--project=desktop-chrome\`): \`${specRel}\`.`,
      '3. Verify the capabilities index (no changes expected — pure reuse).',
      `4. ${copy.reuseLastStep}`,
    );
  } else {
    lines.push(
      '',
      '## How it will run (on Approve)',
      '1. Write a JSON job brief + capture a live locator snapshot of the URL (evidence-based).',
      `2. Ask the LLM ONLY for the ${toAdd.length} new case(s) (${toAdd.map((c) => c.id).join(', ')}); existing tests are preserved (append-only — never renumbered or shrunk). A case already present in ANY spec is reused, not re-added.`,
      `3. Run the spec ${copy.where} with Playwright (\`--project=desktop-chrome\`), one self-heal round on failure.`,
      `4. ${copy.lastStep}`,
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
  // When a remote worker is configured, run the whole generate → run → self-heal there (it has
  // Chromium + the framework). Falls back to EXPLORE_WORKER_URL so one VM can serve both routes.
  const workerUrl = String(process.env.GENERATE_WORKER_URL || process.env.EXPLORE_WORKER_URL || '').trim();
  if (workerUrl) {
    if (typeof onLog === 'function') onLog(`[generate] Delegating to remote worker ${workerUrl}`);
    return generateViaWorker(job, onLog);
  }
  const { frameworkPath: fw } = config();
  const logs = [];
  const log = (m) => {
    logs.push(m);
    if (typeof onLog === 'function') { try { onLog(m); } catch { /* streaming best-effort */ } }
  };
  log(`[local] Provider active — framework at ${fw}.`);
  const requested = (job.testCases || []).map((tc) => normId(tc.id)).filter(Boolean);
  // In CI (GitHub Actions) the WORKFLOW owns the branch + PR: it checks out a clean tree and its
  // create-pull-request step commits the working-tree changes. Running the local git transaction
  // here would commit to a side branch and then RESTORE the tree — wiping the very changes the PR
  // step needs. So in CI we generate directly in the working tree; locally we keep the isolate-
  // on-a-branch transaction that protects the dev tree.
  const keepWorktree = process.env.GITHUB_ACTIONS === 'true' || process.env.BLAST_KEEP_WORKTREE === '1';
  if (keepWorktree) {
    log('[local] CI mode — generating in the working tree; the pipeline opens the PR from these changes (no local branch/restore).');
    return await coreGenerate(fw, job, log, logs);
  }
  // Phase 1: run the WHOLE generation inside a git transaction so dev is never mutated in place.
  const txn = await beginGenerationTxn(fw, job, log);
  if (!txn.ok) {
    log(`[local] ⛔ Cannot start a clean generation: ${txn.reason}`);
    return {
      generatedFiles: [], reusedFiles: [], executionStatus: 'FAILED', reportUrl: '',
      requestedCases: requested, missingCases: requested, verified: false, error: txn.reason, logs,
    };
  }
  let result;
  try {
    result = await coreGenerate(fw, job, log, logs);
  } catch (e) {
    // Any crash mid-generation → roll the tree back and drop the branch, then surface the error.
    await restoreBaselineTxn(fw, txn.baseline, txn.branch, { discardBranch: true }, log);
    throw e;
  }
  return finalizeGenerationTxn(fw, job, txn, result, log);
}

/**
 * The generation body. Runs entirely on the transaction branch created by generateAndRun, so
 * every file write and index refresh is isolated from the baseline until finalize decides whether
 * to keep the branch (push-eligible) or discard it.
 */
async function coreGenerate(fw, job, log, logs) {
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
  const snapAuth = snapshotAuth(job);
  const snapshot = await captureSnapshot(fw, job.url, snapAuth ? { auth: snapAuth } : {});
  log(snapshot ? `[local] Snapshot captured (${snapshot.length} chars${snapAuth ? ', authenticated' : ''}).` : '[local] Snapshot unavailable — falling back to exemplars.');
  // The authenticated landing URL captureSnapshot reached after login — Level 3 starts HERE (not the
  // login root) so the live drive begins on a real in-app page with actionable controls.
  const landingM = String(snapshot || '').match(/POST-LOGIN LANDING \(([^)]+)\)/);
  const l3StartUrl = landingM ? landingM[1].trim() : '';
  // LEVEL 2 — verified live walk: drive the REAL app on the runner (login → auto-discover the
  // journey → capture the real controls + success/validation messages at each state) so codegen
  // writes from a PROVEN walk instead of guessing. Non-prod only; safe fallback to the static snapshot.
  let liveWalk = '';
  const isProdEnv = String(job.environment || '').toLowerCase().startsWith('prod');
  const level3Enabled = process.env.BLAST_LEVEL3 === '1';
  const canLiveWalk = snapAuth && !isProdEnv && process.env.BLAST_LIVE_WALK !== '0';
  const runLevel2Walk = async () => {
    log('[local] Level 2: driving the live app to VERIFY the journey (login → walk → capture real states)…');
    try {
      const drive = await driveFlow(fw, [job.url], { auth: snapAuth, allowSubmit: true, maxDepth: 10 });
      if (drive && Array.isArray(drive.states) && drive.states.length) {
        const liveModel = modelFromStates(drive.states, job.feature || job.url, drive.observed);
        liveWalk = featureModelSummary(liveModel);
        log(`[local] Level 2: verified ${drive.states.length} live state(s) — codegen will write from the proven walk.`);
      } else {
        log('[local] Level 2: live walk captured no states — using the static snapshot evidence.');
      }
    } catch (e) {
      log(`[local] Level 2: live walk skipped (${e.message}) — using the static snapshot evidence.`);
    }
  };
  // When Level 3 will run it captures equal-or-better live evidence, so skip the Level 2 walk here
  // to avoid driving the app twice. If Level 3 later yields nothing, we run this as a fallback below.
  if (canLiveWalk && !level3Enabled) {
    await runLevel2Walk();
  } else if (canLiveWalk && level3Enabled) {
    log('[local] Level 2: skipping the deterministic walk — Level 3 live drive will capture proven evidence (avoids driving the app twice).');
  }
  const existing = findDomainFiles(fw, job);
  if (existing.length) log(`[local] Extending existing domain files: ${existing.map((e) => e.rel).join(', ')}`);
  // Pre-existing Page/Module members captured NOW (job start) are immutable for the whole run —
  // only members ADDED this run may be corrected by compile-fix/heal. Guards against a new-case
  // regen breaking an existing test's method/constructor.
  const baselines = captureBaselines(fw);

  // 0b) Duplicate guard — decide what is genuinely NEW before touching the LLM.
  // Check EVERY spec (cross-file), not just the resolved domain spec, so a case that
  // already lives in another spec (e.g. TC_011 in login.spec.ts) is reused, not re-added.
  const domSpec = existing.find((e) => e.layer === 'spec');
  const selected = job.testCases || [];
  const coverageOf = (tc) => caseCoveredAnywhere(fw, tc);
  const dupCases = selected.filter((tc) => coverageOf(tc));
  const newCases = selected.filter((tc) => !coverageOf(tc));
  dupCases.forEach((tc) => log(`[local] ⏭ Duplicate detected: ${tc.id} "${tc.title || ''}" already automated in ${coverageOf(tc)} → reusing existing test, will NOT re-add it.`));

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
  const collapsedSpecs = new Set(); // specs that requested cases turned out to duplicate (reuse targets)
  if (newCases.length) log(`[local] ${newCases.length} new case(s) to add: ${newCases.map((c) => c.id).join(', ')} (existing tests are preserved).`);

  // LEVEL 3 — agentic live drive: let the LLM drive the REAL app one action at a time via
  // @playwright/cli (snapshot → pick a real ref → act → verify), capturing the EXACT locators
  // that provably worked. Fed to codegen as top evidence so the writer reuses proven locators
  // instead of guessing. Flag-gated (BLAST_LEVEL3=1); '' on any issue → existing path unchanged.
  let liveTrace = '';
  if (level3Enabled && snapAuth && !isProdEnv && newCases.length) {
    try {
      liveTrace = await driveFeatureLive(fw, job, newCases[0], snapAuth, log, { startUrl: l3StartUrl });
    } catch (e) {
      log(`[local] Level 3: live drive skipped (${e.message}) — using standard evidence.`);
    }
  }
  // Fallback: Level 3 produced no proven actions — run the Level 2 walk now (we skipped it above to
  // avoid driving the app twice) so codegen still writes from live evidence instead of guessing.
  if (level3Enabled && canLiveWalk && !liveTrace && !liveWalk) {
    log('[local] Level 3 captured no live actions — falling back to the Level 2 deterministic walk.');
    await runLevel2Walk();
  }

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
      : w.action === 'merged' ? '➕ merged (existing kept + new members added)'
      : w.action === 'overwritten' ? '⚠ extended '
      : '＋ created  ';
    log(`[local]   ${tag} ${w.path}${w.reason ? ` — ${w.reason}` : ''}`);
  };
  // PER-SPEC ID LEDGER: TC ids are numbered INDEPENDENTLY within each spec file — login.spec.ts
  // keeps its own TC_001… sequence, cart.spec.ts restarts at TC_001, etc. A new case only needs
  // an id that is free in the SPEC IT WILL BE WRITTEN TO; the same id living in a DIFFERENT spec
  // is fine (the manifest already stores ids as arrays for exactly this reason). So the collision
  // check + next-free id are scoped to the TARGET spec, giving a clean per-file sequence
  // (append to login.spec's TC_001..TC_015 → TC_016) instead of a confusing repo-wide jump.
  const targetSpecRel = (resolveDomain(fw, job) || {}).specRel || '';
  const specIds = (() => {
    if (!targetSpecRel) return new Set();
    try { return new Set(specTestIds(safeRead(path.join(fw, targetSpecRel), 200000))); } catch { return new Set(); }
  })();
  // FIX 2/3 accounting. baselineSpecContent snapshots every spec's content at JOB START so the
  // semantic dedup below compares a NEW case ONLY against pre-existing tests — never against a
  // sibling generated earlier in THIS run (so one new scenario can't eliminate another). The id
  // sets track that every genuinely-new selected scenario is written or legitimately reused.
  const selectedNewIds = newCases.map((c) => normId(String(c.id || ''))).filter(Boolean);
  const writtenNewIds = new Set();
  const reusedNewIds = new Set();
  const idAlias = new Map(); // original selected id → id it was actually written under (collision reassign)
  const baselineSpecContent = {};
  for (const s of listSpecs(fw)) baselineSpecContent[s.rel] = safeRead(path.join(fw, s.rel), 200000);
  for (let i = 0; i < newCases.length; i++) {
    const tc = { ...newCases[i] };
    const origId = normId(String(newCases[i].id || ''));
    const existNow = findDomainFiles(fw, job); // reflects writes from earlier cases this run
    // COLLISION GUARD (root cause of the ugly renumber): if the requested id already labels a
    // DIFFERENT existing test IN THE TARGET SPEC, keeping it would force the LLM to renumber or
    // duplicate an existing test. Deterministically reassign to the next id free WITHIN that spec
    // (TC_016), not a repo-wide max. Ids in other specs are irrelevant and never cause a jump.
    const wantId = String(tc.id || '').toUpperCase().replace(/-/g, '_');
    if (wantId && specIds.has(wantId)) {
      const freeId = nextFreeTcId(specIds);
      log(`[local] ⚠ Requested id ${wantId} already exists in ${targetSpecRel || 'this spec'} as a different test — reassigning the new case to ${freeId} (per-spec numbering; existing tests are NEVER renumbered).`);
      tc.id = freeId;
      specIds.add(freeId);
      idAlias.set(origId, normId(freeId));
    } else if (wantId) {
      tc.id = wantId;
      specIds.add(wantId);
    }
    if (tc.id) requestedIds.push(String(tc.id).toUpperCase().replace(/-/g, '_'));
    log(`[local] Generating ${tc.id} "${tc.title || ''}" (${i + 1}/${newCases.length})…`);
    // RETRY on unparseable output: LLMs occasionally answer with prose (no ===FILE=== block),
    // most often when a case overlaps existing coverage. Retry with a stricter "code only"
    // directive so the behavioral dedup below gets real code to judge instead of a false miss.
    const basePrompt = buildGeneratePrompt({ ...job, testCases: [tc] }, grounding, snapshot, existNow, liveWalk, liveTrace);
    let batch = [];
    for (let attempt = 1; attempt <= GEN_ATTEMPTS; attempt++) {
      const prompt = attempt === 1 ? basePrompt : basePrompt
        + '\n\n## STRICT OUTPUT (retry — your previous reply had no ===FILE=== block)\n'
        + 'Output ONLY the file(s) in the exact ===FILE:<path>|<layer>=== / ===ENDFILE=== format — no prose, no markdown, no explanation. '
        + 'Even if this case looks already covered, STILL emit the single spec test() for it so it can be de-duplicated automatically.';
      const genText = await llmGenerate(prompt, buildSystemPrompt());
      batch = sanitizeFiles(parseFiles(genText), fw);
      if (batch.length) break;
      log(`[local] ⚠ ${tc.id}: LLM returned no parseable files (attempt ${attempt}/${GEN_ATTEMPTS})${attempt < GEN_ATTEMPTS ? ' — retrying…' : '.'}`);
    }
    if (batch.length === 0) {
      // Still nothing parseable after retries. If this case is ALREADY covered by an existing
      // test, treat it as reuse (skip) — LLMs often refuse to emit a known duplicate. Only a
      // genuinely-uncovered case is a real miss (kept in requestedIds → honest FAILED, no PR).
      const already = caseCoveredAnywhere(fw, tc);
      const pushed = String(tc.id).toUpperCase().replace(/-/g, '_');
      if (already) {
        log(`[local] ⏭ ${tc.id} "${tc.title || ''}" already covered by an existing test in ${already} — skipping (LLM emitted no new code; existing coverage reused).`);
        collapsedSpecs.add(already);
        reusedNewIds.add(origId);
        const ri = requestedIds.lastIndexOf(pushed);
        if (ri >= 0) requestedIds.splice(ri, 1);
      } else {
        log(`[local] ⚠ ${tc.id}: LLM returned no parseable files after ${GEN_ATTEMPTS} attempts — not automated (counts as a miss).`);
      }
      continue;
    }
    batch = batch.filter((f) => {
      if (f.layer !== 'spec') return true;
      // FEATURE ISOLATION: each feature owns its own spec with its own TC_001, TC_002… sequence.
      // If the LLM wrote the new case into ANOTHER feature's existing spec (e.g. a Logout case
      // dumped into login.spec.ts) instead of this feature's own spec, move ONLY the new test(s)
      // to the feature's own spec (targetSpecRel) with fresh per-file numbering and leave the
      // invaded spec completely untouched — never override or renumber another feature's tests.
      if (targetSpecRel && f.rel !== targetSpecRel) {
        const invaded = safeRead(path.join(fw, f.rel), 200000);
        if (invaded) {
          const ownPrior = safeRead(path.join(fw, targetSpecRel), 200000);
          const isolated = isolateNewTestsToOwnSpec(f.content, invaded, ownPrior);
          if (isolated) {
            log(`[local] ↪ ${tc.id}: LLM wrote into ${f.rel} (another feature's spec) — moved the new case to its own spec ${targetSpecRel}; ${path.basename(f.rel)} left untouched.`);
            f.rel = targetSpecRel;
            f.content = isolated;
          }
        }
      }
      const priorForFile = safeRead(path.join(fw, f.rel), 200000);
      // DETERMINISTIC SCENARIO-ID PRESERVATION: the approved job id is authoritative. If the LLM
      // labeled the NEW test with a reset id (e.g. TC_001) instead of the requested one, rewrite
      // ONLY the new block's id to normId(tc.id). Existing tests (reproductions) are never touched.
      const forcedId = forceRequestedScenarioId(f.content, priorForFile, normId(tc.id), tc.title);
      if (forcedId.changed) {
        log(`[local] 🔢 ${tc.id}: LLM emitted id ${forcedId.from || '(none)'} for the new test — deterministically normalized it to the approved scenario id ${normId(tc.id)} (existing tests untouched).`);
        f.content = forcedId.content;
      }
      const dups = duplicateSpecIds(f.content);
      if (dups.length) { log(`[local] ⚠ ${tc.id}: rejected spec ${f.rel} — duplicate id(s) ${dups.join(', ')}.`); return false; }
      // APPEND-ONLY GUARD: compare against the CURRENT content of THIS SAME spec file, not
      // the resolved-domain spec. The LLM may legitimately target a different, correct spec
      // (e.g. login security cases → login.spec.ts even when the job's anchor domain is
      // InventoryAccess); comparing across files falsely flags unrelated tests as "removed".
      const renamed = renumberedTests(priorForFile, f.content);
      if (renamed.length) {
        // RECOVERY: terse models (e.g. GPT-5.x) sometimes emit ONLY the new test,
        // dropping the existing ones. Rather than reject, keep the existing file
        // verbatim and deterministically append just the new case.
        const merged = mergeNewTestsIntoSpec(priorForFile, f.content, normId(tc.id));
        if (merged && renumberedTests(priorForFile, merged).length === 0 && specTestIds(merged).includes(normId(tc.id))) {
          log(`[local] ↺ ${tc.id}: LLM dropped existing tests — recovered by appending the new case to ${f.rel} (existing tests preserved verbatim).`);
          f.content = merged;
          return true;
        }
        log(`[local] ⚠ ${tc.id}: rejected spec ${f.rel} — it altered existing test(s): ${renamed.join('; ')}. Existing tests must be preserved verbatim.`); return false;
      }
      return true;
    });
    if (batch.length === 0) continue;
    // SEMANTIC (behavioral) DEDUP: a new case whose id/title differ but which drives the
    // SAME workflow actions (same module method + same test-data record + same field) as an
    // existing test adds no coverage. Title matching alone misses these (e.g. "Prevent
    // locked user login" vs "Locked User Login Attempt"), and so does a raw signature when
    // the two generations pick different variable names for the same data — so args are
    // resolved to their underlying testData record before comparing. Drop the case if the
    // spec already covers it — verbatim.
    let testData = null;
    try { testData = JSON.parse(safeRead(path.join(fw, 'src', 'testdata', 'testData.json'), 200000) || '{}'); } catch { testData = null; }
    let dupHit = null;
    for (const f of batch.filter((b) => b.layer === 'spec')) {
      // BASELINE-ONLY DEDUP (FIX 2): compare a NEW case ONLY against tests that already existed at
      // JOB START — never against a sibling generated earlier in THIS run. Legitimate reuse (a new
      // case an existing test already covers) still skips, but one newly-requested scenario can
      // NEVER eliminate another newly-requested scenario. On an empty framework there is no
      // baseline, so every distinct selected scenario survives.
      const prior = baselineSpecContent[f.rel] || '';
      if (!prior.trim()) continue;
      const priorMap = signatureVarMap(prior, testData);
      const newMap = signatureVarMap(f.content, testData);
      const priorBlocks = specTestBlocks(prior);
      const priorSigs = new Map(priorBlocks.map((b) => [testSignature(b.body, priorMap), b]));
      const newBlocks = specTestBlocks(f.content);
      const mine = newBlocks.find((b) => b.id === normId(tc.id))
        || newBlocks.find((b) => !priorBlocks.some((p) => p.id === b.id));
      if (!mine) continue;
      const hit = priorSigs.get(testSignature(mine.body, newMap));
      if (hit) { dupHit = { spec: f.rel, hit }; break; }
    }
    if (dupHit) {
      log(`[local] ⏭ Reuse (existing coverage): ${tc.id} "${tc.title || ''}" matches pre-existing ${dupHit.hit.id || dupHit.hit.title} in ${dupHit.spec} — reusing it (no new coverage added).`);
      collapsedSpecs.add(dupHit.spec);
      reusedNewIds.add(origId);
      const pushed = String(tc.id).toUpperCase().replace(/-/g, '_');
      const ri = requestedIds.lastIndexOf(pushed);
      if (ri >= 0) requestedIds.splice(ri, 1);
      continue;
    }
    const wr = writeFiles(fw, batch, baselines);
    if (batch.some((b) => b.layer === 'spec')) writtenNewIds.add(origId);
    allBackups.push(...wr.backups);
    wr.written.forEach((w) => { recordWrite(w); logWrite(w); });
    files = batch;
  }
  if (written.length === 0) {
    // All requested cases collapsed to existing coverage (semantic duplicates) — nothing new
    // to add. This is a REUSE SUCCESS, not a failure: re-run the spec(s) the cases collapsed
    // onto (or the resolved domain spec) and report PASS. Open no PR (no file changed).
    if (requestedIds.length === 0) {
      const reuseTargets = [...new Set([...(domSpec ? [domSpec.rel] : []), ...collapsedSpecs])];
      if (reuseTargets.length) {
        log(`[local] All requested case(s) already covered by existing tests (semantic duplicates) — nothing new to generate. Reusing: ${reuseTargets.join(', ')}.`);
        log(`[local] Running (reuse-only): ${reuseTargets.join(', ')}`);
        const reuseRun = await runPlaywright(fw, reuseTargets, job, { applyScope: true });
        log(reuseRun.passed ? '[local] Run PASSED.' : '[local] Run FAILED.');
        await refreshIndex(fw);
        const reused = (existing.length ? existing.map((e) => e.rel) : reuseTargets);
        return {
          generatedFiles: reused.map((rel) => ({ path: rel, layer: rel.includes('/tests/') ? 'spec' : 'other', reused: true, action: 'reused' })),
          reusedFiles: reused,
          backups: allBackups,
          executionStatus: reuseRun.passed ? 'PASSED' : 'FAILED',
          reportUrl: 'playwright-report/index.html',
          reportSummary: reuseRun.summary || null,
          requestedCases: [],
          missingCases: [],
          verified: true,
          logs,
        };
      }
    }
    log('[local] Nothing written after generation — requested case(s) not automated. No PR.');
    return { generatedFiles: [], reusedFiles: [], executionStatus: 'FAILED', reportUrl: '', requestedCases: requestedIds, missingCases: requestedIds, verified: false, logs };
  }
  if (allBackups.length) log(`[local] Backups saved: ${allBackups.join(', ')}`);

  // Deterministically register any NEW Page/Module as a fixture so the generated spec can
  // resolve it — even if the LLM's fixtures/index.ts emit was rejected by the reuse guard.
  // Additive merge only (never rewrites existing fixtures); idempotent; prevents the
  // "Test has unknown parameter '<fixture>'" failure at run time.
  const fxReg = ensureFixturesRegistered(fw, written);
  if (fxReg.changed) {
    if (fxReg.backup) allBackups.push(fxReg.backup);
    log(`[local]   ＋ registered ${fxReg.added.length} new fixture(s) in src/fixtures/index.ts: ${fxReg.added.join(', ')}`);
    recordWrite({ path: 'src/fixtures/index.ts', layer: 'fixture', reused: false, action: 'overwritten' });
  }

  // Deterministically backfill any Page locator that a generated Module/Spec references but the
  // Page class never defined (LLM page/module drift) — prevents the TS2339 + runtime "undefined"
  // crash that the protect-guard can't fix. Grounded in the crawl's observed elements (reveal-aware
  // snapshot + live walk/trace) so the selector uses the PROVEN role+name; additive only.
  const referencedEvidence = parseAriaElements([snapshot, liveWalk, liveTrace].filter(Boolean).join('\n'));
  const locReg = ensureReferencedLocators(fw, written, referencedEvidence);
  if (locReg.changed) {
    allBackups.push(...locReg.backups);
    const provenN = locReg.added.filter((a) => a.proven).length;
    log(`[local]   ＋ backfilled ${locReg.added.length} referenced-but-missing locator(s) (${provenN} from live evidence): ${locReg.added.map((a) => `${a.member}→${a.page.split('/').pop()}`).join(', ')}`);
    for (const page of new Set(locReg.added.map((a) => a.page))) {
      recordWrite({ path: page, layer: 'page', reused: false, action: 'merged' });
    }
  }
  applyFieldInit(fw, written, referencedEvidence, allBackups, recordWrite, log);

  const specPaths = () => written.filter((w) => w.layer === 'spec').map((w) => w.path);
  if (specPaths().length === 0) {
    log('[local] No spec file generated (LLM output likely truncated) — requested case(s) NOT automated. Verification FAILED; no PR will be opened.');
    return { generatedFiles: written, reusedFiles: [], executionStatus: 'FAILED', reportUrl: '', requestedCases: requestedIds, missingCases: requestedIds, verified: false, logs };
  }

  // 1.5) Type-check gate — compile the generated code BEFORE the slow Playwright run. The compiler
  // encodes the WHOLE framework API, so invented/missing methods, wrong argument types/counts and
  // missing keys ALL surface at once with exact file:line, and one heal fixes them together —
  // instead of discovering them one runtime crash at a time. Generic; skipped when TS is absent.
  if (hasTypeScript(fw)) {
    const MAX_TS_ROUNDS = 3;
    const seenErrorSigs = new Set(); // fingerprints of prior error sets — detect no-progress/oscillation
    let unresolvedCompileErrors = [];
    for (let tsr = 0; tsr <= MAX_TS_ROUNDS; tsr++) {
      const tsc = await typeCheck(fw);
      const ourErrors = tscErrorsForFiles(tsc.output, written.map((w) => w.path));
      if (tsc.ok || ourErrors.length === 0) {
        if (tsr > 0) log('[local] Type-check clean ✓ — generated code compiles against the real framework API.');
        break;
      }
      // Early-exit on no progress: if this exact error set was seen before, the compile-fix is
      // stuck (identical repeat or an arity↔type oscillation) — more rounds only burn LLM time and
      // suite re-runs without converging. Stop now and let Playwright surface the runtime detail.
      const sig = ourErrors.map((e) => e.trim()).sort().join('\n');
      if (seenErrorSigs.has(sig)) {
        log(`[local] Compile-fix made no progress (same ${ourErrors.length} error(s) recurring — stuck/oscillating) — stopping early to save time and proceeding to run.`);
        unresolvedCompileErrors = ourErrors;
        break;
      }
      seenErrorSigs.add(sig);
      if (tsr === MAX_TS_ROUNDS) {
        log(`[local] Type-check still failing after ${MAX_TS_ROUNDS} compile-fix round(s).`);
        unresolvedCompileErrors = ourErrors;
        break;
      }
      log(`[local] ✗ Type-check found ${ourErrors.length} compile error(s) in generated code — fixing ALL before running:`);
      ourErrors.slice(0, 12).forEach((e) => log('    ' + e.trim()));
      const tsInput = findDomainFiles(fw, job);
      const fixText = await llmGenerate(buildCompilePrompt(job, tsInput.length ? tsInput : files, ourErrors.join('\n'), grounding), buildSystemPrompt());
      const fixed = sanitizeFiles(parseFiles(fixText), fw);
      if (!fixed.length) {
        log('[local] Compile-fix produced no parseable files.');
        unresolvedCompileErrors = ourErrors;
        break;
      }
      const cr = writeFiles(fw, fixed, baselines);
      cr.written.forEach((w) => { recordWrite(w); logWrite(w); });
      allBackups.push(...cr.backups);
      files = fixed;
      const fxC = ensureFixturesRegistered(fw, cr.written);
      if (fxC.changed) {
        if (fxC.backup) allBackups.push(fxC.backup);
        log(`[local]   ＋ registered ${fxC.added.length} new fixture(s) during compile-fix: ${fxC.added.join(', ')}`);
        recordWrite({ path: 'src/fixtures/index.ts', layer: 'fixture', reused: false, action: 'overwritten' });
      }
      const locC = ensureReferencedLocators(fw, written, referencedEvidence);
      if (locC.changed) {
        allBackups.push(...locC.backups);
        log(`[local]   ＋ backfilled ${locC.added.length} referenced-but-missing locator(s) during compile-fix: ${locC.added.map((a) => a.member).join(', ')}`);
        for (const page of new Set(locC.added.map((a) => a.page))) {
          recordWrite({ path: page, layer: 'page', reused: false, action: 'merged' });
        }
      }
      applyFieldInit(fw, written, referencedEvidence, allBackups, recordWrite, log);
      log(`[local] Applied compile-fix ${tsr + 1}/${MAX_TS_ROUNDS} to ${cr.written.length} file(s). Re-checking…`);
    }
    if (unresolvedCompileErrors.length) {
      log(`[local] Type-check remains invalid — skipping Playwright and self-heal: ${unresolvedCompileErrors.length} generated error(s).`);
      return {
        generatedFiles: written,
        reusedFiles: [],
        backups: allBackups,
        executionStatus: 'FAILED',
        reportUrl: '',
        reportSummary: null,
        requestedCases: requestedIds,
        missingCases: requestedIds,
        verified: false,
        logs,
      };
    }
  }

  // 2) Run
  log(`[local] Running: ${specPaths().join(', ')}`);
  let run = await runPlaywright(fw, specPaths(), job, { applyScope: true });
  log(run.passed ? '[local] Run PASSED.' : '[local] Run FAILED — attempting one self-heal round.');

  // 3) Self-heal up to MAX_HEAL_ROUNDS times — each round re-reads the failure and re-runs.
  // Capped at 2: each round re-runs the full Playwright suite (slow), and beyond 2 rounds the
  // LLM rarely converges — better to open a partial PR for what passes and defer the rest.
  const MAX_HEAL_ROUNDS = 3;
  const seenFailSigs = new Set(); // fingerprints of prior failure sets — detect no-progress heals
  for (let heal = 1; !run.passed && heal <= MAX_HEAL_ROUNDS; heal++) {
    const errorContext = readErrorContext(fw);
    // The exact per-test error from the JSON report — guarantees the heal sees the real
    // message (TimeoutError / strict-mode / assertion) even when error-context.md is absent.
    const failText = ((run.summary && run.summary.tests) || [])
      .filter((t) => t.status !== 'passed' && t.status !== 'skipped')
      .map((t) => `### ${t.title}\n${String(t.error || '').trim()}`)
      .filter((s) => s.trim())
      .join('\n\n');
    // Early-exit on no progress: if the same tests fail with the same errors as a prior round,
    // the heal is stuck — re-running the full suite again just wastes time. Stop and open a
    // partial PR for what already passes.
    const failSig = failText.replace(/:\d+:\d+/g, '').replace(/\s+/g, ' ').trim();
    if (failSig && seenFailSigs.has(failSig)) {
      log('[local] Heal made no progress (same failure(s) recurring) — stopping early to save time.');
      break;
    }
    if (failSig) seenFailSigs.add(failSig);
    const healContext = [failText, errorContext].filter(Boolean).join('\n\n');

    const healInput = findDomainFiles(fw, job); // heal against the full spec on disk
    const healText = await llmGenerate(buildHealPrompt(job, healInput.length ? healInput : files, run.output, healContext, grounding), buildSystemPrompt());
    const healed = sanitizeFiles(parseFiles(healText), fw);
    if (!healed.length) { log('[local] Heal produced no parseable files.'); break; }
    const hr = writeFiles(fw, healed, baselines);
    hr.written.forEach((w) => { recordWrite(w); logWrite(w); });
    allBackups.push(...hr.backups);
    files = healed;
    // Register any Page/Module the heal introduced, same additive guarantee as the first pass.
    const fxHeal = ensureFixturesRegistered(fw, hr.written);
    if (fxHeal.changed) {
      if (fxHeal.backup) allBackups.push(fxHeal.backup);
      log(`[local]   ＋ registered ${fxHeal.added.length} new fixture(s) during heal: ${fxHeal.added.join(', ')}`);
      recordWrite({ path: 'src/fixtures/index.ts', layer: 'fixture', reused: false, action: 'overwritten' });
    }
    const locHeal = ensureReferencedLocators(fw, written, referencedEvidence);
    if (locHeal.changed) {
      allBackups.push(...locHeal.backups);
      log(`[local]   ＋ backfilled ${locHeal.added.length} referenced-but-missing locator(s) during heal: ${locHeal.added.map((a) => a.member).join(', ')}`);
      for (const page of new Set(locHeal.added.map((a) => a.page))) {
        recordWrite({ path: page, layer: 'page', reused: false, action: 'merged' });
      }
    }
    applyFieldInit(fw, written, referencedEvidence, allBackups, recordWrite, log);
    log(`[local] Applied heal ${heal}/${MAX_HEAL_ROUNDS} to ${hr.written.length} file(s). Re-running…`);
    run = await runPlaywright(fw, specPaths(), job, { applyScope: true });
    log(run.passed ? `[local] Re-run PASSED after heal ${heal}.` : `[local] Re-run ${heal} still FAILED.`);
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

  // Phase 3 — per-case pass/fail from the Playwright JSON. A case counts as automated only
  // when EVERY test carrying its id passed; a present-but-failing case is pruned so the PR
  // ships only green work, and its id rejoins "missing" to be regenerated on the next run.
  const statusById = {};
  for (const t of (run.summary && run.summary.tests) || []) {
    const ok = t.status === 'passed';
    for (const id of idsInTitle(t.title)) {
      if (!(id in statusById)) statusById[id] = ok;
      else statusById[id] = statusById[id] && ok;
    }
  }
  const automatedCases = requestedIds.filter((id) => presentIds.has(id) && statusById[id] === true);
  let failedCases = requestedIds.filter((id) => presentIds.has(id) && statusById[id] === false);
  const partial = automatedCases.length > 0 && failedCases.length > 0;
  if (partial) {
    log(`[local] ⚑ Partial success — automated (passing): ${automatedCases.join(', ')}; NOT automated (failing, will retry next run): ${failedCases.join(', ')}.`);
    let prunedAny = false;
    for (const rel of specPaths()) {
      const abs = path.join(fw, rel);
      const before = safeRead(abs, 200000);
      if (!before) continue;
      const after = pruneFailingTests(before, failedCases);
      if (after && after !== before) {
        fs.writeFileSync(abs, after, 'utf8');
        prunedAny = true;
        log(`[local]   ✂ Removed failing case(s) from ${rel} — only passing cases will be committed.`);
      }
    }
    if (prunedAny) {
      const reidx = await refreshIndex(fw);
      log(reidx.ok ? '[local] Re-indexed after pruning failing cases ✓.' : '[local] Re-index after prune skipped/failed (non-fatal).');
    }
  }

  const executionStatus = run.passed ? 'PASSED' : (partial ? 'PARTIAL' : 'FAILED');

  // Surface WHY it failed — the exact Playwright error per failing test. Meets the product
  // requirement ("tell me why it failed") and ends blind heal loops: the log/report now carries
  // the real message (TimeoutError / strict-mode violation / assertion), not just a stack trace.
  const failureReasons = ((run.summary && run.summary.tests) || [])
    .filter((t) => t.status !== 'passed' && t.status !== 'skipped')
    .map((t) => ({ title: t.title, error: String(t.error || '').trim() }));
  if (!run.passed) {
    if (failureReasons.length) {
      log('[local] ✖ FAILURE REASON(S) — exact Playwright error per failing test:');
      failureReasons.forEach((f) => {
        log(`[local]   • ${f.title}`);
        (f.error ? f.error.split('\n') : ['(no error text captured)'])
          .forEach((l) => log(`[local]       ${l}`));
      });
    } else {
      log('[local] ✖ Tests failed but no per-test error was captured (JSON report missing) — see raw output tail above.');
    }
  }

  // FIX 3 — GENERATION INTEGRITY GATE. Every genuinely-new selected scenario must have been WRITTEN
  // this run or legitimately REUSED (equivalent to a pre-existing test). A silent partial (e.g.
  // 5 selected, 3 written) is a HARD failure: report the missing ids and open NO PR. Execution
  // failures are handled separately (green-before-PR prune) — this gate is about GENERATION only.
  const { complete: generationComplete, missing: integrityMissing } = generationIntegrity(selectedNewIds, writtenNewIds, reusedNewIds);
  if (!generationComplete) {
    log(`[local] ✖ GENERATION INTEGRITY FAILURE — ${selectedNewIds.length} scenario(s) requested, only ${selectedNewIds.length - integrityMissing.length} generated/reused. Missing: ${integrityMissing.join(', ')}. No PR will be opened.`);
  } else if (selectedNewIds.length) {
    log(`[local] ✅ Generation integrity OK — all ${selectedNewIds.length} requested scenario(s) written or reused (written: ${[...writtenNewIds].join(', ') || 'none'}${reusedNewIds.size ? `; reused: ${[...reusedNewIds].join(', ')}` : ''}).`);
  }

  return {
    generatedFiles: written,
    reusedFiles: written.filter((w) => w.reused).map((w) => w.path),
    backups: allBackups,
    executionStatus: generationComplete ? executionStatus : 'FAILED',
    reportUrl: 'playwright-report/index.html',
    reportSummary: run.summary || null,
    failureReasons: generationComplete ? failureReasons : [...failureReasons, { title: 'Generation integrity failure', error: `${selectedNewIds.length} scenario(s) requested, only ${selectedNewIds.length - integrityMissing.length} generated. Missing: ${integrityMissing.join(', ')}` }],
    requestedCases: requestedIds,
    automatedCases,
    failedCases,
    integrityMissing,
    missingCases: [...new Set([...missingCases, ...failedCases, ...integrityMissing])],
    // A PR opens only when at least one requested case was automated AND passed AND generation was
    // COMPLETE (no requested scenario silently dropped). Present-but-failing cases were pruned above
    // and deferred to the next run; a GENERATION gap hard-fails the whole run (verified=false → no PR).
    verified: (requestedIds.length === 0 ? true : automatedCases.length > 0) && generationComplete,
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

// Paths a generation transaction is allowed to create/modify/clean. Everything a run writes
// (source, reuse index, backups) lives under one of these — never the user's other files.
const TXN_PATHS = ['src', '.ai-memory', '.blast-backups'];

async function gitCurrentBranch(fw) {
  const r = await git(fw, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.code === 0 ? r.output.trim() : '';
}

/** The repo's default branch (origin/HEAD target), falling back to 'dev'. */
async function gitDefaultBranch(fw) {
  const r = await git(fw, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (r.code === 0 && r.output.trim()) return r.output.trim().replace(/^origin\//, '');
  return 'dev';
}

/** Extract the file path from a `git status --porcelain` line (handles renames + quotes). */
function porcelainPath(line) {
  const p = String(line).slice(2).trim();
  const parts = p.split(' -> ');
  return (parts[1] || parts[0] || '').replace(/^"|"$/g, '');
}

const isTxnOwnedPath = (p) =>
  TXN_PATHS.some((b) => p === b || p.startsWith(`${b}/`) || p.startsWith(`${b}\\`));

/**
 * Begin a generation transaction (Phase 1 + Phase 4 guard).
 *  - Refuses to run from a detached HEAD.
 *  - Refuses to run when the tree has uncommitted NON-generation edits (protects the user's
 *    in-progress work — nothing is ever wiped without consent).
 *  - Auto-cleans leftover generation artifacts from an earlier aborted run so we start pristine.
 *  - Creates the isolated job branch from the baseline so EVERY write happens on the branch,
 *    never on dev — the local reuse index therefore only ever reflects MERGED coverage.
 * Returns { ok, baseline, branch, reason }.
 */
async function beginGenerationTxn(fw, job, log) {
  const baseline = await gitCurrentBranch(fw);
  if (!baseline || baseline === 'HEAD') {
    return { ok: false, reason: 'Framework repo is in a detached-HEAD state — check out a branch first.' };
  }
  const dirtyR = await git(fw, ['status', '--porcelain']);
  const dirty = dirtyR.code === 0 ? dirtyR.output.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean) : [];
  const foreign = dirty.map(porcelainPath).filter((p) => p && !isTxnOwnedPath(p));
  if (foreign.length) {
    return {
      ok: false,
      reason: `Framework working tree has uncommitted non-generation changes (${foreign.slice(0, 5).join(', ')}${foreign.length > 5 ? '…' : ''}). Commit or stash them, then retry — B.L.A.S.T. will not touch your work.`,
    };
  }
  if (dirty.length) {
    if (log) log('[txn] Clearing leftover generation artifacts from a prior run…');
    await git(fw, ['checkout', '-f', '--', ...TXN_PATHS]);
    await git(fw, ['clean', '-fd', '--', ...TXN_PATHS]);
  }
  const branch = `blast/auto-${String(job.jobId).toLowerCase()}`;
  const co = await git(fw, ['checkout', '-B', branch]);
  if (co.code !== 0) return { ok: false, reason: `git checkout -B ${branch} failed: ${co.output.slice(-200)}` };
  if (log) log(`[txn] Generating on isolated branch ${branch} (baseline: ${baseline}).`);
  return { ok: true, baseline, branch };
}

/** Commit the generation output (src + reuse index) to the job branch. Returns the sha or ''. */
async function commitGenerationTxn(fw, job, log) {
  await git(fw, ['add', '--', ...TXN_PATHS]);
  const ids = (job.testCases || []).map((tc) => tc.id).filter(Boolean).join(', ');
  const msg = `test(automation): ${job.jobId} — ${job.project || job.feature || 'suite'} (${ids || 'cases'})`;
  // Inline identity so the commit never fails on a bare runner with no global git user set.
  const commit = await git(fw, [
    '-c', 'user.name=BLAST Automation',
    '-c', 'user.email=blast-automation@users.noreply.github.com',
    'commit', '-m', `"${msg.replace(/"/g, "'")}"`,
  ]);
  if (commit.code !== 0 && !/nothing to commit/i.test(commit.output)) {
    if (log) log(`[txn] commit warning: ${commit.output.slice(-160)}`);
    return '';
  }
  const sha = await git(fw, ['rev-parse', 'HEAD']);
  return sha.code === 0 ? sha.output.trim() : '';
}

/**
 * Restore the baseline working tree after a transaction. On success the job branch is KEPT
 * (its commit is ready for Push to Gate) while dev returns to a pristine state; on failure the
 * branch is also deleted so a failed/closed attempt leaves ZERO local residue.
 */
async function restoreBaselineTxn(fw, baseline, branch, opts, log) {
  const co = await git(fw, ['checkout', '-f', baseline]);
  if (co.code !== 0) { if (log) log(`[txn] restore checkout failed: ${co.output.slice(-160)}`); return; }
  await git(fw, ['clean', '-fd', '--', ...TXN_PATHS]);
  if (opts && opts.discardBranch && branch) {
    const del = await git(fw, ['branch', '-D', branch]);
    if (del.code === 0 && log) log(`[txn] Discarded branch ${branch}.`);
  }
}

/**
 * Finalize a transaction: commit + keep the branch when there is push-eligible work (a new case
 * whose test passed), otherwise discard it. Always leaves the baseline tree pristine.
 */
async function finalizeGenerationTxn(fw, job, txn, result, log) {
  const wroteNew = (result.generatedFiles || []).some(
    (f) => !f.reused && (f.action === 'created' || f.action === 'overwritten'),
  );
  const automated = (result.automatedCases || []).length;
  const eligible = wroteNew && (result.executionStatus === 'PASSED' || automated > 0);
  if (eligible) {
    const sha = await commitGenerationTxn(fw, job, log);
    result.branch = txn.branch;
    if (sha) result.commit = sha;
    await restoreBaselineTxn(fw, txn.baseline, txn.branch, { discardBranch: false }, log);
    if (log) log(`[txn] Work committed to ${txn.branch}; ${txn.baseline} restored clean — ready for Push to Gate.`);
  } else {
    await restoreBaselineTxn(fw, txn.baseline, txn.branch, { discardBranch: true }, log);
    if (log) log(`[txn] Nothing push-eligible — discarded ${txn.branch}; ${txn.baseline} left pristine (no residue).`);
  }
  return result;
}

/** All TC ids embedded in a test title (a title may carry more than one). */
function idsInTitle(title) {
  const out = [];
  const re = /TC[_-]?\d+[A-Za-z_]*/gi;
  let m;
  while ((m = re.exec(String(title || ''))) !== null) out.push(normId(m[0]));
  return out;
}

/**
 * Remove the test() blocks whose TC id is in `failedIds` so only PASSING cases are committed
 * (Phase 3). Returns unchanged content when nothing matches or when pruning would empty the
 * spec (caller then treats the whole run as FAILED rather than shipping an empty file).
 */
function pruneFailingTests(content, failedIds) {
  const fail = new Set((failedIds || []).map(normId));
  if (!fail.size) return content;
  const blocks = specTestFullBlocks(content);
  const remove = blocks.filter((b) => b.id && fail.has(normId(b.id)));
  if (!remove.length) return content;
  const remaining = blocks.filter((b) => !(b.id && fail.has(normId(b.id))));
  if (!remaining.length) return content; // would empty the spec — keep as-is
  let out = content;
  for (const b of remove) {
    const at = out.indexOf(b.source);
    if (at !== -1) out = out.slice(0, at) + out.slice(at + b.source.length);
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

/**
 * Discard a generation attempt (Phase 2): delete the local job branch (and optionally the remote
 * one) after a failed/closed PR. The working tree is already pristine from the transaction, so
 * this only removes the orphan branch. Returns { branch, localDeleted, remoteDeleted, logs }.
 */
async function discardBranch(job, opts, onLog) {
  const { frameworkPath: fw } = config();
  const logs = [];
  const log = (m) => { logs.push(m); if (typeof onLog === 'function') { try { onLog(m); } catch { /* best-effort */ } } };
  const branch = `blast/auto-${String(job.jobId).toLowerCase()}`;
  const cur = await gitCurrentBranch(fw);
  if (cur === branch) {
    const base = await gitDefaultBranch(fw);
    await git(fw, ['checkout', '-f', base]);
    await git(fw, ['clean', '-fd', '--', ...TXN_PATHS]);
    log(`[discard] Switched off ${branch} to ${base}.`);
  }
  const localDel = await git(fw, ['branch', '-D', branch]);
  log(localDel.code === 0 ? `[discard] Deleted local branch ${branch}.` : `[discard] No local branch ${branch} to delete.`);
  let remoteDeleted = false;
  if (opts && opts.deleteRemote) {
    const rd = await git(fw, ['push', 'origin', '--delete', branch]);
    remoteDeleted = rd.code === 0;
    log(remoteDeleted ? `[discard] Deleted remote branch origin/${branch}.` : '[discard] Remote branch delete skipped/failed (may not exist).');
  }
  return { branch, localDeleted: localDel.code === 0, remoteDeleted, logs };
}

/**
 * Doctor (Phase 4): force the framework repo back to a pristine baseline and remove every orphan
 * blast/* branch left behind by interrupted runs. Only ever touches TXN_PATHS + blast/* branches,
 * never the user's other files or branches. Returns { logs, base, deletedBranches }.
 */
async function resetFramework(onLog) {
  const { frameworkPath: fw } = config();
  const logs = [];
  const log = (m) => { logs.push(m); if (typeof onLog === 'function') { try { onLog(m); } catch { /* best-effort */ } } };
  const base = await gitDefaultBranch(fw);
  const cur = await gitCurrentBranch(fw);
  if (cur && cur.startsWith('blast/')) {
    await git(fw, ['checkout', '-f', base]);
    log(`[reset] Switched off ${cur} to ${base}.`);
  }
  await git(fw, ['checkout', '-f', '--', ...TXN_PATHS]);
  await git(fw, ['clean', '-fd', '--', ...TXN_PATHS]);
  log(`[reset] Restored ${TXN_PATHS.join(', ')} to ${base} HEAD.`);
  const branches = await git(fw, ['branch', '--list', 'blast/*']);
  const orphans = (branches.output || '')
    .split('\n')
    .map((l) => l.replace(/^\*?\s*/, '').trim())
    .filter((b) => b.startsWith('blast/'));
  const deletedBranches = [];
  for (const b of orphans) {
    const del = await git(fw, ['branch', '-D', b]);
    if (del.code === 0) { deletedBranches.push(b); log(`[reset] Deleted orphan branch ${b}.`); }
  }
  if (!deletedBranches.length) log('[reset] No orphan blast/* branches to delete.');
  log('[reset] Framework repo is pristine.');
  return { logs, base, deletedBranches };
}

/**
 * Publish the generated tests: push the transaction branch already created during generation
 * and return the PR-compare URL. Returns { branch, pushed, compareUrl, logs }.
 */
async function pushBranch(job, onLog) {
  const { frameworkPath: fw } = config();
  const logs = [];
  const log = (m) => { logs.push(m); if (typeof onLog === 'function') { try { onLog(m); } catch { /* best-effort */ } } };

  // Phase 1: generation already committed the work to job.branch inside its transaction.
  // Push-to-gate now only publishes that existing branch — it never re-checkouts, re-adds, or
  // re-commits (the dev tree is pristine at this point, so a fresh commit would be empty).
  const branch = (job.branch || `blast/auto-${job.jobId}`).toLowerCase();
  const verify = await git(fw, ['rev-parse', '--verify', branch]);
  if (verify.code !== 0) {
    throw new Error(`Branch ${branch} not found locally — the generation branch was discarded or never created (no push-eligible work). Re-generate before pushing.`);
  }

  log(`[push] Pushing ${branch} to origin…`);
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

/**
 * Derive a short, human-readable branch slug from the job's feature (falls back to project /
 * first case title / jobId). Kebab-cased, ascii-only, capped so branch names stay sane.
 */
function featureSlug(job) {
  const raw = String(
    job.feature || job.project || (job.testCases && job.testCases[0] && job.testCases[0].title) || job.jobId || 'automation',
  );
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || String(job.jobId || 'automation').toLowerCase();
}

/**
 * Commit-and-push for the COPILOT/runner path. Unlike pushBranch (which only publishes an
 * ALREADY-committed generation branch), the Copilot agent writes files directly on the working
 * tree without committing — so here we capture those changes onto a fresh, feature-named branch,
 * commit them with a bot identity, and push. Only ever runs after a PASSED run.
 * Returns { branch, pushed, compareUrl, logs }.
 */
async function commitAndPushBranch(job, onLog) {
  const { frameworkPath: fw } = config();
  const logs = [];
  const log = (m) => { logs.push(m); if (typeof onLog === 'function') { try { onLog(m); } catch { /* best-effort */ } } };
  if (!fw || !fs.existsSync(fw)) throw new Error('FRAMEWORK_PATH is not set or does not exist on this machine.');

  // Nothing to publish? Bail clearly rather than pushing an empty branch.
  const dirty = await git(fw, ['status', '--porcelain']);
  if (dirty.code === 0 && !dirty.output.trim()) {
    throw new Error('No changes in the framework working tree to publish — nothing to commit for this run.');
  }

  const branch = (job.branch && String(job.branch).trim()) || `blast/${featureSlug(job)}`;
  log(`[push] Capturing generated files onto ${branch}…`);
  const baseline = await gitCurrentBranch(fw);
  const co = await git(fw, ['checkout', '-B', branch]);
  if (co.code !== 0) throw new Error(`git checkout -B ${branch} failed: ${co.output.slice(-200)}`);

  const add = await git(fw, ['add', '-A']);
  if (add.code !== 0) throw new Error(`git add failed: ${add.output.slice(-200)}`);

  const feature = job.feature || job.project || job.jobId;
  const msg = `test(automation): ${feature} (${job.jobId})`.replace(/"/g, "'");
  const commit = await git(fw, [
    '-c', '"user.name=BLAST Automation"',
    '-c', '"user.email=blast-automation@users.noreply.github.com"',
    'commit', '-m', `"${msg}"`,
  ]);
  if (commit.code !== 0 && !/nothing to commit/i.test(commit.output)) {
    throw new Error(`git commit failed: ${commit.output.slice(-200)}`);
  }
  log('[push] Committed generated files.');

  const push = await git(fw, ['push', '--no-verify', '-u', 'origin', branch]);
  if (push.code !== 0) throw new Error(`git push failed: ${push.output.slice(-300)}`);
  log('[push] Pushed to origin.');

  // Return the framework to its baseline branch so the next job starts from a pristine tree.
  if (baseline && baseline !== 'HEAD' && baseline !== branch) {
    const back = await git(fw, ['checkout', baseline]);
    if (back.code === 0) log(`[push] Restored baseline branch ${baseline}.`);
  }

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
  // Human-readable label so Copilot (and the PR) see the FEATURE, not just a job id.
  const feature = fmt(job.feature) || fmt(job.project) || fmt(job.testCases && job.testCases[0] && job.testCases[0].title) || job.jobId;
  // reason: the full rulebook lives in the ATTACHED AGENT.md + pw-new-automation skill; repeating it
  //   here just burns tokens (a real risk on limited Copilot plans). Keep the inline brief minimal —
  //   identity, the job, the approved plan, the cases, and the log markers the worker keys off.
  return [
    `# B.L.A.S.T. automation job — ${feature}`,
    '',
    'You are the **AI Native Playwright Engineer**. Follow the attached **AGENT.md** and the',
    '**pw-new-automation** skill EXACTLY: reuse-first (check `.ai-memory/capabilities.json` +',
    'existing pages/modules/specs first), evidence-based locators via `@playwright/cli` (never guess),',
    'strict 3-layer, no duplicate tests. Extend the existing domain spec — do not create parallel files.',
    '',
    `## Job: ${feature} (${job.jobId}) — ${job.environment || 'QA'}`,
    `Target URL: ${job.url || '(see attached brief)'}`,
    '',
    ...(String(job.plan || '').trim()
      ? ['## Approved plan (follow it — the user reviewed this)', '', String(job.plan).trim(), '']
      : []),
    '### Test cases',
    cases || '(see the attached brief)',
    '',
    '## Work quietly — save tokens',
    'Do the task and nothing else. Do NOT narrate steps, explain your reasoning, summarise, or restate the',
    'plan in chat. No preamble, no recap. Just build it, run it, and emit only the log markers below.',
    '',
    '## Logging — REQUIRED (B.L.A.S.T. tails this file live)',
    `Append to \`${paths.logRel}\` ONLY these lines — nothing more:`,
    '- ONE start line: `[copilot] START ' + `${job.jobId} — ${feature}\``,
    '- the final result line (exactly one):',
    '  - success (spec passes, lint 0, tsc 0): `[copilot] DONE PASSED`',
    '  - failed/blocked you could not fix: `[copilot] DONE FAILED <one-line reason>`',
    '  - aborted (cannot proceed): `[copilot] ERROR <one-line reason>`',
    `Need input mid-run? Append \`[copilot] NEEDS-INPUT <question>\` to the log, then read \`${paths.inboxRel}\``,
    'for a `[user]` reply and continue. Do NOT log per-step progress — start + final marker only.',
    '',
    '## Definition of done',
    'Spec passes on `--project=desktop-chrome`, `npm run lint` → 0, `npx tsc --noEmit` → 0, `npm run index` refreshed.',
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
  const inline = `Follow the attached ${path.basename(paths.promptAbs)} exactly and implement this automation NOW: reuse-first, evidence-based locators via @playwright/cli, strict 3-layer, run the spec. Work quietly — do NOT narrate or summarise; append ONLY the start line and the final [copilot] marker to ${paths.logRel}. Start immediately.`;
  const codeCli = resolveCodeCli();
  // reason: `code chat --reuse-window` targets the LAST-ACTIVE VS Code window, which may be an
  //   unrelated workspace. Open (or focus) THIS framework's folder first and let it settle so the
  //   chat is guaranteed to land in the correct repo, not whatever window happened to be active.
  const bat = [
    '@echo off',
    'setlocal',
    `cd /d "${fw}"`,
    'echo [blast] Opening the target framework workspace...',
    `call "${codeCli}" --new-window "${fw}"`,
    'echo [blast] Waiting for the workspace window to focus...',
    'timeout /t 6 /nobreak >nul',
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
  coveredSpecInIndex,
  featureCoverageInIndex,
  exploreAndAuthor,
  explore,
  exploreViaWorker,
  generateViaWorker,
  buildFeatureModel,
  compactJourney,
  ensureFixturesRegistered,
  ensureReferencedLocators,
  inferLocatorTarget,
  parseAriaElements,
  ensurePageFieldsInitialized,
  parseCliRefs,
  mergeExisting,
  isDestructiveOverwrite,
  droppedConstructorWiring,
  constructorWiredDeps,
  writeFiles,
  captureBaselines,
  testSignature,
  signatureVarMap,
  localLiteralMap,
  dataVarMap,
  specTestBlocks,
  generationIntegrity,
  forceRequestedScenarioId,
  renumberedTests,
  mergeNewTestsIntoSpec,
  specTestIds,
  pushBranch,
  commitAndPushBranch,
  discardBranch,
  resetFramework,
  config,
  resolveSkill,
  skillModeDirective,
  writeCopilotHandoff,
  launchCopilotHandoff,
  readCopilotLog,
  appendCopilotInput,
  requestCopilotStop,
};
