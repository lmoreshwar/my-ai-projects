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
function caseCoveredAnywhere(fw, tc) {
  if (!fw || !fs.existsSync(fw)) return '';
  const man = readManifest(fw);
  if (man && man.testIndex) {
    // testIndex values are ARRAYS ({domain,spec,title}[]) because TC ids are not globally
    // unique. Match title-first (across every entry), then fall back to id + title overlap.
    // Titles are stored WITH id-prefix + @tags — compare their CORE words only.
    const want = normalizeText(titleCore(tc && tc.title));
    if (want.length >= 6) {
      for (const arr of Object.values(man.testIndex)) {
        for (const e of (Array.isArray(arr) ? arr : [arr])) {
          const have = normalizeText(titleCore(e.title));
          if (have && (have.includes(want) || want.includes(have))) return e.spec;
        }
      }
    }
    // Distinctive-token match across EVERY entry (any id): catches a re-worded case whose
    // identifying words match an existing test even when the id/wording differ — e.g.
    // "Display exact locked-user error message" ↔ "Locked User Login Attempt" (both → {locked}).
    // High threshold + a small-set guard keeps this precise: a genuinely-different case that
    // merely shares one distinctive word with a rich unrelated title will NOT match.
    const wantDist = distinctiveTokens(titleCore(tc && tc.title));
    if (wantDist.length) {
      for (const arr of Object.values(man.testIndex)) {
        for (const e of (Array.isArray(arr) ? arr : [arr])) {
          const haveDist = distinctiveTokens(titleCore(e.title));
          if (!haveDist.length) continue;
          const ov = distinctiveOverlap(titleCore(tc && tc.title), titleCore(e.title));
          if (ov >= 0.8 && (wantDist.length >= 2 || haveDist.length <= 2)) return e.spec;
        }
      }
    }
    const rid = normId(tc && tc.id);
    const arr = rid ? man.testIndex[rid] : null;
    const list = arr ? (Array.isArray(arr) ? arr : [arr]) : [];
    let best = null;
    let bestScore = 0;
    for (const e of list) {
      // Distinctive overlap (not raw titleOverlap) so a shared id with only generic words
      // in common ("…user login valid credentials") is NOT falsely reported as covered.
      const sc = distinctiveOverlap(titleCore(tc && tc.title), titleCore(e.title));
      if (sc > bestScore) { bestScore = sc; best = e; }
    }
    if (best && bestScore >= 0.6) return best.spec;
    return '';
  }
  for (const s of listSpecs(fw)) {
    if (caseCoveredInSpec(s.content, tc)) return s.rel;
  }
  return '';
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
  "  const snap = async (page) => (await page.locator('body').ariaSnapshot()).slice(0, 4000);",
  '  const addState = async (page, label) => { if (states.length < MAX_STATES) states.push({ label, url: page.url(), snapshot: await snap(page) }); };',
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
      const raw = await runCli(fw, session, ['snapshot']);
      const m = raw.match(/```yaml\n([\s\S]*?)```/);
      const snap = (m ? m[1] : raw).trim().slice(0, 4000);
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
    } else if (role === 'button' && name) {
      model.buttons.push(name);
    } else if (role === 'link' && name) {
      model.links.push(name);
    } else if (['checkbox', 'combobox', 'radio', 'switch', 'slider'].includes(role)) {
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
    'VERBATIM control names: every button/link/field you name in steps, testData, or expectedResults MUST be an EXACT single observed label copied character-for-character from the evidence. NEVER merge, concatenate, or paraphrase two labels into one — e.g. do NOT combine a generic action word ("Go back", "Cancel") with a real label ("Continue Shopping") into "Go back Continue Shopping". If a case is about a secondary/back/cancel action, use that ONE control\'s exact observed label and nothing else. If no single observed control matches the behavior, do not write the case.',
    `Cover these test types: ${types}. Add a type ONLY if it appears in that list. Each case must map to exactly ONE type via its "type" field.`,
    'Prioritise by value: one strong positive, then the most likely real defects. Every case must be a DISTINCT behavior — no two cases with the same action + data. Do not pad to reach the max.',
    multiStep ? `This feature spans ${model.steps.length} pages/steps — include at least ONE end-to-end positive that traverses every step in order to the final success/confirmation state.` : '',
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
 * Guarantee a minimum coverage floor regardless of what the LLM returned: one positive happy path,
 * and (when Negative is selected) one required-field negative per named input. Floor cases are
 * grounded in real widgets and always survive the maxCases cap.
 */
function ensureCoverageFloor(cases, job, model, feature) {
  const max = Number(job.maxCases) > 0 ? Number(job.maxCases) : 8;
  const selected = new Set((job.testTypes && job.testTypes.length ? job.testTypes : ['Positive', 'Negative']).map(canonicalCaseType));
  const named = model.inputs.filter((i) => i.name);
  const additions = [];
  if (selected.has('Positive') && named.length && !cases.some((c) => caseType(c) === 'Positive')) {
    additions.push(shapeCase(synthHappyPath(job, model), feature, true));
  }
  if (selected.has('Negative') && named.length) {
    for (const inp of named) {
      if (!coversRequiredNeg(cases, inp.name)) additions.push(shapeCase(synthRequiredNeg(job, model, inp), feature, true));
    }
  }
  if (selected.has('Boundary') && named.length) {
    for (const inp of named) {
      if (!coversBoundary(cases, inp.name)) additions.push(shapeCase(synthBoundary(job, model, inp), feature, true));
    }
  }
  // Secondary/abort action (Cancel/Back/Reset) — guaranteed when the control is actually on screen.
  const secondary = secondaryButton(model);
  if ((selected.has('Negative') || selected.has('Positive')) && secondary && !coversSecondary(cases, secondary)) {
    additions.push(shapeCase(synthSecondaryAction(job, model, secondary), feature, true));
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

function buildGeneratePrompt(job, g, snapshot, existing, liveWalk) {
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
    g.smartLocator ? '\n## SmartLocator API (use only for a justified fallback)\n' + g.smartLocator : '',
    '\n## Requirements',
    '- Reuse existing pages/modules/locators/fixtures from the index and exemplars before adding anything new.',
    '- Group ALL cases into ONE domain spec (one test() per case). If an existing domain spec is shown above, ADD the new cases to it — do NOT create a parallel spec.',
    '- NEVER emit two test() blocks with the same test-case id. Each TC id appears exactly once. If a case id already exists in the shown spec, keep that one test as-is — do not add a second test for the same id, even with a different title.',
    '- APPEND-ONLY: NEVER renumber, reorder, or change the id or title of any EXISTING test. Add the new case using EXACTLY the TC id given in the task, appended AFTER the existing tests. Every existing test keeps its exact id and title verbatim.',
    '- Locators: ONE semantic strategy per element by default (getByRole/getByLabel/getByPlaceholder; data-test only when no role/label). A SmartLocator fallback chain is allowed ONLY for a fragile element and MUST carry a `// reason:` note (max 3 strategies). No stacked speculative locators.',
    '- Data: use credentials(\'app\') for valid login and src/testdata/testData.json for other data. If new data is needed, emit an EXTENDED testData.json (config layer) preserving all existing keys.',
    '- Authenticated flows: if the target page is only reachable AFTER login (anything past the login screen), the spec MUST authenticate FIRST — in a test.beforeEach that calls the framework login module (navigate to the login page, e.g. loginModule.goto(), THEN loginModule.login(credentials(\'app\').username, credentials(\'app\').password)) and asserts the post-login landing — BEFORE any page-specific steps, exactly like the spec exemplar. NEVER call login() without navigating to the login page first, and never assume an already-authenticated session.',
    '- Preconditions/state: NEVER assume the target page is already in the required state (e.g. an item already in the cart, a record already selected). Establish every precondition through the app UI FIRST. Search the "Reusable API across ALL domains" list above for a method that performs that setup — even if it lives in a DIFFERENT domain (e.g. an add-to-cart / create-record / login method) — and CALL it; only write new interaction code when NO existing method covers the need. Reach the target page by the real user journey in the case steps above; do NOT deep-link to a page whose content depends on prior actions and then assert that content exists. A Module navigation helper (goto) must wait only for a STABLE page landmark (title/header/container) that exists regardless of data — never for data-dependent content like a specific row.',
    '- Ambiguous controls: when several identical controls exist (e.g. N identical "Add"/"Remove"/"Delete" buttons in a list), NEVER use a bare text/role locator that matches many — Playwright strict mode WILL fail. Prefer an existing Module method that already resolves the right element (e.g. a product-detail add method), or scope to a unique parent/row (by the record/product name), or use an explicit .filter()/.nth() with a `// reason:` note. One unambiguous target per action.',
    '- NEVER truncate, abbreviate, or elide any file. Do not emit placeholders like `/* …trimmed… */`, `// ...`, or `…`. Every emitted file (especially JSON) MUST be its COMPLETE, valid content. JSON must parse (no comments) and keep every existing top-level key.',
    '- If you create a NEW Page/Module, also emit an updated src/fixtures/index.ts (fixture layer) that keeps existing fixtures and registers the new ones.',
    '- Modules use Actions/WaitHelper/WorkflowActions and Logger.step(); specs hold all expect() assertions and import { test, expect } from ../fixtures.',
    '- Module wiring (prevents "Cannot read properties of undefined"): a Module MUST create EVERY collaborator it calls in its CONSTRUCTOR from the injected `page` — its own Page object, its Actions/WaitHelper/WorkflowActions, AND any OTHER Module it delegates to (assign `this.<collaborator> = new <CollaboratorClass>(page)`). NEVER call `this.<x>.method()` unless `this.<x> = new <Class>(page)` is assigned in that class constructor. Do NOT rely on dependency injection between modules — each module self-initializes what it uses.',
    '- Test-data keys: every key the spec reads from testData.json MUST exist in the testData.json you emit — read `testData.<a>.<b>` ONLY if you also add `<a>.<b>` with a concrete valid value (a missing key throws "Cannot read properties of undefined"). Keep every existing key.',
    snapshot ? '- Base locators on the live snapshot above; do not invent selectors it does not support.' : '',
    '- If a file you emit already exists, return its FULL content — keep ALL existing tests/locators/methods and ADD the new ones. Never delete existing functionality.',
  ].filter(Boolean).join('\n');
}

function buildHealPrompt(job, files, runOutput, errorContext, g) {
  const current = files.map((f) => `===FILE:${f.rel}|${f.layer}===\n${f.content}\n===ENDFILE===`).join('\n');
  const journeyBlock = renderJourney(job.journey);
  return [
    'The generated Playwright test FAILED. Fix the ROOT cause and return the corrected files in the same ===FILE=== format.',
    'Only change what is needed to make the test pass. Keep the 3-layer split (pages = locators, modules = workflows, specs = assertions).',
    'DIAGNOSE THE PAGE FIRST (most important). The error-context.md below is a snapshot of the page AT THE MOMENT OF FAILURE. Before editing ANY locator, compare that snapshot to the page the failing step expected. If it shows a DIFFERENT page — e.g. the step waited for a form field / detail element but the snapshot shows a list, landing, cart, or login page — then the test SKIPPED A PRECONDITION and never navigated there. The correct fix is to ADD the missing setup/navigation steps to REACH that page (follow the Discovered journey below IN ORDER and CALL existing setup methods from the Reusable API), NOT to change the locator or extend the Page object. A "waiting for X to be visible" timeout is almost NEVER a locator problem when X\'s page was never reached. Only treat it as a locator problem when the snapshot shows the CORRECT page but the element name/role differs.',
    'INVENTED CONTROL (hallucinated locator). If the failing step waits for a control whose exact name appears NOWHERE — not in the error-context.md snapshot, not in the Discovered journey, not on the real page — then that name was fabricated (often two labels merged, e.g. "Go back Continue Shopping"). Do NOT keep waiting for it and do NOT add it to the Page object. Replace it with the SINGLE closest REAL control that actually exists in the evidence (e.g. the real "Continue Shopping" button). If no real control matches the step\'s intent, the step is invalid — remove that step/assertion rather than waiting for a control that cannot appear.',
    resolveSkill(job).key === 'debug'
      ? 'DEBUG MODE: first classify the failure (Locator Change / Script Issue / UI/App Bug / Environment / Unknown) as a top-of-file `// [DEBUG] <category>: <reason>` comment. If it is a genuine UI/App Bug, DO NOT mask it — keep the assertion honest and annotate `// [DEBUG] APP BUG:`. Never weaken an assertion just to go green.'
      : '',
    'If the error is a ReferenceError (e.g. "beforeAll is not defined") or "No tests found", the code used a bare test-runner global. Replace bare beforeAll/afterAll/beforeEach/afterEach with test.beforeAll/test.afterAll/test.beforeEach/test.afterEach and ensure test/expect are imported from the same fixture the exemplar spec uses.',
    'If the error is "TypeError: Cannot read properties of undefined (reading \'<x>\')", a collaborator or data key was used but never initialized — fix the ROOT cause, never silence it with optional chaining. When <x> is a METHOD, a Module called `this.<obj>.<x>()` but never assigned `this.<obj> = new <Class>(page)` in its constructor — add that assignment in the constructor of the class that owns the call. When <x> is a string/array op (e.g. repeat, length, split) on testData, the spec reads a testData.json key that is missing — add that key with a concrete valid value and return the full testData.json.',
    journeyBlock ? '\n## Discovered journey (the REAL page order + controls — use this to add any missing precondition steps to reach the target page)\n' + journeyBlock : '',
    g && g.capabilities ? '\n## Reusable API across ALL domains — CALL an existing setup/navigation method instead of re-implementing it\n' + g.capabilities : '',
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
 * Behavioral signature of a test body — captures WHAT the test does, independent of
 * its id/title/wording, so two cases that drive the same workflow collapse to the
 * same key. Primary key = the ordered workflow-layer (*Module) calls with normalized
 * args (same method + same RESOLVED test-data record + same field ⇒ same signature).
 * `varMap` (from dataVarMap) resolves argument variables to their underlying data so a
 * case doesn't dodge the dedup just by renaming its data variable. Pure UI-state tests
 * have no module action, so they fall back to their sorted assertion targets to avoid
 * colliding two unrelated page-only checks.
 */
function testSignature(body, varMap) {
  const text = body || '';
  const resolve = (args) => args.replace(/([A-Za-z_$][\w$]*)(?=\.)/g, (id) => (varMap && varMap.get(id)) || id);
  // Zero-arg navigation/arrival calls (goto(), navigateToLoginPage(), openHomePage()…) are
  // page-setup plumbing, not test behavior. Strip them so an extra navigate step can't hide
  // that two tests exercise the same action+data. Data-carrying nav (openProtectedPage('/x'))
  // is kept — its argument makes it a meaningful, differentiating step.
  const isNavNoop = (name, args) => args === '' && /^(goto|navigate\w*|open\w*page|visit|load|browse\w*)$/i.test(name);
  const actions = [];
  const aRe = /\b\w+Module\.(\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = aRe.exec(text)) !== null) {
    const args = m[2].replace(/\s+/g, '').replace(/['"`]/g, '"');
    if (isNavNoop(m[1], args)) continue;
    actions.push(`${m[1]}(${resolve(args)})`);
  }
  if (actions.length) return 'ACT:' + actions.join('>');
  const asserts = new Set();
  const eRe = /expect\(\s*([\w.]+(?:\([^)]*\))?)\s*\)\s*\.\s*(not\s*\.\s*)?(\w+)/g;
  while ((m = eRe.exec(text)) !== null) {
    asserts.add(`${resolve(m[1].replace(/\s+/g, ''))}|${m[2] ? 'not.' : ''}${m[3]}`);
  }
  return 'ASRT:' + [...asserts].sort().join('&');
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
  // LEVEL 2 — verified live walk: drive the REAL app on the runner (login → auto-discover the
  // journey → capture the real controls + success/validation messages at each state) so codegen
  // writes from a PROVEN walk instead of guessing. Non-prod only; safe fallback to the static snapshot.
  let liveWalk = '';
  const isProdEnv = String(job.environment || '').toLowerCase().startsWith('prod');
  if (snapAuth && !isProdEnv && process.env.BLAST_LIVE_WALK !== '0') {
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
  }
  const existing = findDomainFiles(fw, job);
  if (existing.length) log(`[local] Extending existing domain files: ${existing.map((e) => e.rel).join(', ')}`);

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
  // REPO-WIDE ID LEDGER: a NEW auto-added case must not reuse an id that already labels a
  // DIFFERENT test in ANY spec — not just the resolved-domain spec. A cross-domain job
  // (e.g. an InventoryAccess case reused alongside NEW Login cases) makes the LLM target a
  // different, correct spec (login.spec.ts); a colliding id there would force it to either
  // duplicate or renumber an existing test — both are rejected below and block the run.
  const allSpecIds = new Set();
  try {
    const tdir = path.join(fw, 'src', 'tests');
    for (const f of fs.readdirSync(tdir).filter((n) => n.endsWith('.spec.ts'))) {
      specTestIds(safeRead(path.join(tdir, f), 200000)).forEach((id) => allSpecIds.add(id));
    }
  } catch { /* no specs yet — first automation in this repo */ }
  for (let i = 0; i < newCases.length; i++) {
    const tc = { ...newCases[i] };
    const existNow = findDomainFiles(fw, job); // reflects writes from earlier cases this run
    // COLLISION GUARD (root cause of renumbering): if the requested id already labels a
    // DIFFERENT existing test ANYWHERE in the suite, the LLM would be forced to renumber or
    // duplicate an existing test to keep ids unique. Deterministically reassign this new
    // case to the next repo-wide-free id instead.
    const wantId = String(tc.id || '').toUpperCase().replace(/-/g, '_');
    if (wantId && allSpecIds.has(wantId)) {
      const freeId = nextFreeTcId(allSpecIds);
      log(`[local] ⚠ Requested id ${wantId} already exists as a different test — reassigning the new case to ${freeId} (existing tests are NEVER renumbered).`);
      tc.id = freeId;
      allSpecIds.add(freeId);
    } else if (wantId) {
      tc.id = wantId;
      allSpecIds.add(wantId);
    }
    if (tc.id) requestedIds.push(String(tc.id).toUpperCase().replace(/-/g, '_'));
    log(`[local] Generating ${tc.id} "${tc.title || ''}" (${i + 1}/${newCases.length})…`);
    // RETRY on unparseable output: LLMs occasionally answer with prose (no ===FILE=== block),
    // most often when a case overlaps existing coverage. Retry with a stricter "code only"
    // directive so the behavioral dedup below gets real code to judge instead of a false miss.
    const basePrompt = buildGeneratePrompt({ ...job, testCases: [tc] }, grounding, snapshot, existNow, liveWalk);
    let batch = [];
    for (let attempt = 1; attempt <= GEN_ATTEMPTS; attempt++) {
      const prompt = attempt === 1 ? basePrompt : basePrompt
        + '\n\n## STRICT OUTPUT (retry — your previous reply had no ===FILE=== block)\n'
        + 'Output ONLY the file(s) in the exact ===FILE:<path>|<layer>=== / ===ENDFILE=== format — no prose, no markdown, no explanation. '
        + 'Even if this case looks already covered, STILL emit the single spec test() for it so it can be de-duplicated automatically.';
      const genText = await llmGenerate(prompt, buildSystemPrompt());
      batch = sanitizeFiles(parseFiles(genText));
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
        const ri = requestedIds.lastIndexOf(pushed);
        if (ri >= 0) requestedIds.splice(ri, 1);
      } else {
        log(`[local] ⚠ ${tc.id}: LLM returned no parseable files after ${GEN_ATTEMPTS} attempts — not automated (counts as a miss).`);
      }
      continue;
    }
    batch = batch.filter((f) => {
      if (f.layer !== 'spec') return true;
      const dups = duplicateSpecIds(f.content);
      if (dups.length) { log(`[local] ⚠ ${tc.id}: rejected spec ${f.rel} — duplicate id(s) ${dups.join(', ')}.`); return false; }
      // APPEND-ONLY GUARD: compare against the CURRENT content of THIS SAME spec file, not
      // the resolved-domain spec. The LLM may legitimately target a different, correct spec
      // (e.g. login security cases → login.spec.ts even when the job's anchor domain is
      // InventoryAccess); comparing across files falsely flags unrelated tests as "removed".
      const priorForFile = safeRead(path.join(fw, f.rel), 200000);
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
      const prior = safeRead(path.join(fw, f.rel), 200000);
      const priorMap = dataVarMap(prior, testData);
      const newMap = dataVarMap(f.content, testData);
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
      log(`[local] ⏭ Semantic duplicate: ${tc.id} "${tc.title || ''}" performs the same actions as existing ${dupHit.hit.id || dupHit.hit.title} in ${dupHit.spec} — skipping (no new coverage; existing tests unchanged).`);
      collapsedSpecs.add(dupHit.spec);
      const pushed = String(tc.id).toUpperCase().replace(/-/g, '_');
      const ri = requestedIds.lastIndexOf(pushed);
      if (ri >= 0) requestedIds.splice(ri, 1);
      continue;
    }
    const wr = writeFiles(fw, batch);
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

  const specPaths = () => written.filter((w) => w.layer === 'spec').map((w) => w.path);
  if (specPaths().length === 0) {
    log('[local] No spec file generated (LLM output likely truncated) — requested case(s) NOT automated. Verification FAILED; no PR will be opened.');
    return { generatedFiles: written, reusedFiles: [], executionStatus: 'FAILED', reportUrl: '', requestedCases: requestedIds, missingCases: requestedIds, verified: false, logs };
  }

  // 2) Run
  log(`[local] Running: ${specPaths().join(', ')}`);
  let run = await runPlaywright(fw, specPaths(), job, { applyScope: true });
  log(run.passed ? '[local] Run PASSED.' : '[local] Run FAILED — attempting one self-heal round.');

  // 3) Self-heal up to MAX_HEAL_ROUNDS times — each round re-reads the failure and re-runs.
  const MAX_HEAL_ROUNDS = 3;
  for (let heal = 1; !run.passed && heal <= MAX_HEAL_ROUNDS; heal++) {
    const errorContext = readErrorContext(fw);
    // The exact per-test error from the JSON report — guarantees the heal sees the real
    // message (TimeoutError / strict-mode / assertion) even when error-context.md is absent.
    const failText = ((run.summary && run.summary.tests) || [])
      .filter((t) => t.status !== 'passed' && t.status !== 'skipped')
      .map((t) => `### ${t.title}\n${String(t.error || '').trim()}`)
      .filter((s) => s.trim())
      .join('\n\n');
    const healContext = [failText, errorContext].filter(Boolean).join('\n\n');
    const healInput = findDomainFiles(fw, job); // heal against the full spec on disk
    const healText = await llmGenerate(buildHealPrompt(job, healInput.length ? healInput : files, run.output, healContext, grounding), buildSystemPrompt());
    const healed = sanitizeFiles(parseFiles(healText));
    if (!healed.length) { log('[local] Heal produced no parseable files.'); break; }
    const hr = writeFiles(fw, healed);
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

  return {
    generatedFiles: written,
    reusedFiles: written.filter((w) => w.reused).map((w) => w.path),
    backups: allBackups,
    executionStatus,
    reportUrl: 'playwright-report/index.html',
    reportSummary: run.summary || null,
    failureReasons,
    requestedCases: requestedIds,
    automatedCases,
    failedCases,
    missingCases: [...new Set([...missingCases, ...failedCases])],
    // Ship green work: a PR opens when at least one requested case was automated AND passed.
    // Present-but-failing cases were pruned above and are deferred to the next run, so the
    // committed spec is always all-green; only a total miss (zero automated) suppresses the PR.
    verified: requestedIds.length === 0 ? true : automatedCases.length > 0,
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
  exploreAndAuthor,
  explore,
  exploreViaWorker,
  generateViaWorker,
  buildFeatureModel,
  compactJourney,
  ensureFixturesRegistered,
  pushBranch,
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
