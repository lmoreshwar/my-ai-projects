import { useState, useMemo, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   SYSTEM PROMPT — Playwright Page Object Model (JS + TS)
   ═══════════════════════════════════════════════════════════════════════ */
const POM_PROMPT = `# PLAYWRIGHT PAGE OBJECT MODEL GENERATION PROMPT

## Objective
You are a Senior QA Automation Architect specializing in Playwright with the Page Object Model (POM) design pattern.
Convert the provided structured test cases into executable Playwright scripts using the POM pattern.
Generate BOTH JavaScript (.js) AND TypeScript (.ts) versions of every file.

## Configuration
- Framework: Playwright
- Languages: JavaScript AND TypeScript (generate both)
- Design Pattern: Page Object Model (POM)
- Runner: Playwright Test Runner (\`npx playwright test\`)

## CRITICAL OUTPUT FORMAT RULES
- Output ONLY plain text code — NO HTML tags, NO CSS classes, NO syntax highlighting markup
- Do NOT include patterns like: "text-[#...]">  or <span class="..."> or any HTML/CSS artifacts
- Do NOT wrap code in HTML elements or include any Tailwind/CSS class names in the output
- Output must be raw, executable .js/.ts code that can run directly with npx playwright test
- If you see examples with syntax highlighting in your training, STRIP all HTML/CSS when generating

## STRICT ANTI-HALLUCINATION RULES
- Do NOT invent URLs, endpoints, or page routes not present in the test case data
- Do NOT fabricate CSS selectors or XPaths — use role-based or text-based locators
- Do NOT assume application behavior not described in test steps
- Do NOT generate pseudo-code or placeholder functions
- Do NOT add extra test scenarios beyond what is provided
- Do NOT skip ANY provided test case
- If a URL is NOT specified, use: // TODO: [URL NOT SPECIFIED]
- If a selector is NOT clear, use page.getByRole() or page.getByText() with // TODO: Verify selector
- If test data is missing, add: // TODO: [TEST DATA NOT SPECIFIED]
- Every test case MUST map 1:1 to a test() block in a spec file

## Page Object Model Conventions
- Each feature/page gets its own Page Object class
- Page Objects encapsulate locators and actions (no assertions in PO)
- Spec files import Page Objects and contain test logic + assertions
- Use constructor(page) pattern
- Locators defined as class properties using this.page.getByRole(), etc.
- Methods are async and return this for chaining where applicable

### JavaScript POM Example:
\`\`\`javascript
// pages/LoginPage.js
class LoginPage {
  constructor(page) {
    this.page = page;
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.loginButton = page.getByRole('button', { name: 'Login' });
    this.errorMessage = page.getByRole('alert');
  }
  async navigate() { await this.page.goto('/login'); }
  async login(email, password) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }
}
module.exports = { LoginPage };
\`\`\`

### TypeScript POM Example:
\`\`\`typescript
// pages/LoginPage.ts
import { Page, Locator } from '@playwright/test';
export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;
  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.loginButton = page.getByRole('button', { name: 'Login' });
    this.errorMessage = page.getByRole('alert');
  }
  async navigate(): Promise<void> { await this.page.goto('/login'); }
  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }
}
\`\`\`

## Playwright Locator Priority
getByRole > getByText > getByLabel > getByPlaceholder > getByTestId > locator (last resort)

## Output Structure
For each feature group, return output using this EXACT delimiter format:

=== FILE: tests/pages/{Feature}Page.js ===
(JavaScript Page Object class)

=== FILE: tests/pages/{Feature}Page.ts ===
(TypeScript Page Object class with type annotations)

=== FILE: tests/specs/{feature}.spec.js ===
(JavaScript spec file using POM)

=== FILE: tests/specs/{feature}.spec.ts ===
(TypeScript spec file using POM)

=== FILE: playwright.config.ts ===
(Single TypeScript config file — works for both JS and TS)

IMPORTANT: Generate ONLY ONE config file (playwright.config.ts). Do NOT generate playwright.config.js separately.
The config MUST include:
- baseURL: '// TODO: [URL NOT SPECIFIED]'
- projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
- reporter: [['html', { open: 'never' }], ['list']]
- use.screenshot: 'on' (capture screenshots for every test)
- use.video: 'retain-on-failure' (record video but only keep for failed tests)
- use.trace: 'retain-on-failure' (capture trace but only keep for failed tests)
- outputDir: 'test-results'
- retries: 1

## Mapping Rules
- SRL No → test name prefix
- Pre-conditions → beforeEach / Page Object navigate()
- Test Steps → Page Object method calls in sequence
- Expected Results → expect() assertions in spec files (NOT in Page Objects)
- Tags → test.describe() grouping
- Test Case Type → @tag annotations

## CRITICAL RULES
- Page Objects must NEVER contain assertions (expect). Assertions belong ONLY in spec files.
- Each Page Object method should do ONE logical action
- Use descriptive method names that match the test step language
- Generate COMPLETE, runnable files for BOTH JS and TS — no truncation

Generate complete, runnable files. Do not truncate or summarize.`;

/* ═══════════════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS (same as PlaywrightJS)
   ═══════════════════════════════════════════════════════════════════════ */
function parseTestCasesFromMarkdown(raw) {
  if (!raw) return [];
  const lines = raw.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return [];
  const headerCols = lines[0].split('|').map((c) => c.trim()).filter(Boolean);
  const dataLines = lines.slice(2);
  return dataLines.map((line) => {
    const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
    const obj = {};
    headerCols.forEach((h, i) => { obj[h] = cols[i] || ''; });
    return obj;
  }).filter((r) => r['SRL No.'] && /^TC[_-]/i.test(r['SRL No.']));
}

function groupByTag(testCases) {
  const groups = {};
  testCases.forEach((tc) => {
    const tags = (tc['Tags'] || 'General').split(',').map((t) => t.trim()).filter(Boolean);
    const primary = tags[0] || 'General';
    const key = primary.toLowerCase().replace(/\s+/g, '-');
    if (!groups[key]) groups[key] = { label: primary, cases: [] };
    groups[key].cases.push(tc);
  });
  return groups;
}

/* Clean up any accidental CSS class patterns from LLM output or copy/paste issues */
function cleanCodeContent(content) {
  if (!content) return '';
  
  let cleaned = content;
  
  // AGGRESSIVE pattern removal - catch ALL variations of CSS class patterns
  // These patterns appear when LLM mimics syntax-highlighted code from training data
  
  // Pattern 1: The exact pattern seen: "text-[#hexcode]"> followed by content
  // e.g., "text-[#569cd6]">const becomes const
  cleaned = cleaned.replace(/"text-\[#[a-fA-F0-9]{3,8}\]">/g, '');
  
  // Pattern 2: Variations with single quotes
  cleaned = cleaned.replace(/'text-\[#[a-fA-F0-9]{3,8}\]'>/g, '');
  
  // Pattern 3: Full span tags with these classes
  cleaned = cleaned.replace(/<span\s+class=["']text-\[#[a-fA-F0-9]{3,8}\]["']>/gi, '');
  cleaned = cleaned.replace(/<\/span>/gi, '');
  
  // Pattern 4: Any text-[#...] pattern (Tailwind-style CSS class in wrong context)  
  cleaned = cleaned.replace(/["']text-\[#[a-fA-F0-9]{3,8}\]["']>/g, '');
  
  // Pattern 5: Remove orphaned class="..." attributes that might slip through
  cleaned = cleaned.replace(/\s*class=["'][^"']*["']/gi, '');
  
  // Pattern 6: Remove any remaining <span> or </span> tags
  cleaned = cleaned.replace(/<\/?span[^>]*>/gi, '');
  
  // Final cleanup: fix any double quotes/quotes that got mangled
  // Fix patterns like const"" or const'' that might result
  cleaned = cleaned.replace(/([a-zA-Z_$])["']{2,}([^"'\s])/g, '$1 $2');
  cleaned = cleaned.replace(/["']{2,}/g, match => match.charAt(0));
  
  // Trim whitespace
  cleaned = cleaned.split('\n')
    .map(line => line.trimEnd())
    .filter((line, idx, arr) => {
      if (line === '' && idx > 0 && arr[idx - 1] === '') return false;
      return true;
    })
    .join('\n')
    .trim();
  
  return cleaned;
}

function parseFileBlocks(output) {
  const files = [];
  const pattern = /===\s*FILE:\s*(.+?)\s*===\s*\n([\s\S]*?)(?=\n===\s*FILE:|$)/gi;
  let match;
  while ((match = pattern.exec(output)) !== null) {
    let content = match[2].trim();
    content = content.replace(/^```(?:typescript|ts|javascript|js)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    // Clean up any CSS class patterns that might have slipped in
    content = cleanCodeContent(content);
    files.push({ path: match[1].trim(), content });
  }
  if (files.length === 0 && output.trim()) {
    files.push({ path: 'tests/specs/generated.spec.ts', content: cleanCodeContent(output.trim()) });
  }
  return files;
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */
export default function PlaywrightPOM({ connections, apiBase, generatedTestCases, generatedFiles, setGeneratedFiles, activeFileIdx, setActiveFileIdx, selectedGroups, setSelectedGroups, langFilter, setLangFilter }) {
  const [busy, setBusy] = useState('');
  const [pushStatus, setPushStatus] = useState('');
  const [pushBranch, setPushBranch] = useState('');
  const [pushPath, setPushPath] = useState('tests');
  const [showPushModal, setShowPushModal] = useState(false);
  const [genProgress, setGenProgress] = useState('');

  // ── Parse & filter automation-tagged test cases ──
  const allParsed = useMemo(() => parseTestCasesFromMarkdown(generatedTestCases), [generatedTestCases]);
  const automationCases = useMemo(
    () => allParsed.filter((tc) => (tc['Execution Tags'] || '').toLowerCase().includes('automation')),
    [allParsed]
  );
  const grouped = useMemo(() => groupByTag(automationCases), [automationCases]);
  const groupKeys = Object.keys(grouped);

  const toggleGroup = useCallback((key) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const selectAll = () => setSelectedGroups(new Set(groupKeys));
  const deselectAll = () => setSelectedGroups(new Set());

  const selectedCaseCount = useMemo(
    () => [...selectedGroups].reduce((sum, k) => sum + (grouped[k]?.cases.length || 0), 0),
    [selectedGroups, grouped]
  );

  // Filter displayed files by language and clean code content
  const displayedFiles = useMemo(() => {
    let files = generatedFiles;
    if (langFilter === 'js') files = generatedFiles.filter(f => f.path.endsWith('.js'));
    else if (langFilter === 'ts') files = generatedFiles.filter(f => f.path.endsWith('.ts'));
    // Apply cleanCodeContent to all file contents
    return files.map(f => ({ ...f, content: cleanCodeContent(f.content) }));
  }, [generatedFiles, langFilter]);

  /* ────────────────────────────────────────────────────────────────────
     GENERATE
     ──────────────────────────────────────────────────────────────────── */
  const handleGenerate = async () => {
    if (selectedGroups.size === 0) return alert('Select at least one feature group');
    if (connections.llm.status !== 'connected') return alert('Connect to LLM first in Connection Settings');
    setBusy('generate');
    setGeneratedFiles([]);
    setActiveFileIdx(0);

    try {
      const header = '| SRL No. | Test Case Title | Description | Pre-conditions | Test Data | Test Steps | Expected Results | Test Case Type | Tags | Execution Tags |';
      const sep = '|---|---|---|---|---|---|---|---|---|---|';
      let allRows = [];
      const groupNames = [];

      for (const key of selectedGroups) {
        const g = grouped[key];
        if (!g) continue;
        groupNames.push(g.label);
        g.cases.forEach((tc) => {
          allRows.push(
            `| ${tc['SRL No.']} | ${tc['Test Case Title']} | ${tc['Description'] || ''} | ${tc['Pre-conditions'] || ''} | ${tc['Test Data'] || ''} | ${tc['Test Steps'] || ''} | ${tc['Expected Results'] || ''} | ${tc['Test Case Type'] || ''} | ${tc['Tags'] || ''} | ${tc['Execution Tags'] || ''} |`
          );
        });
      }

      const tcTable = [header, sep, ...allRows].join('\n');
      const description = `Convert the following Automation-tagged test cases into Playwright Page Object Model (POM) scripts.
Generate BOTH JavaScript (.js) AND TypeScript (.ts) versions of every file.

FEATURE GROUPS: ${groupNames.join(', ')}
TOTAL TEST CASES: ${allRows.length}

TEST CASE TABLE:
${tcTable}

IMPORTANT:
- For each feature, generate: pages/{Feature}Page.js + pages/{Feature}Page.ts + specs/{feature}.spec.js + specs/{feature}.spec.ts
- Also generate playwright.config.js AND playwright.config.ts
- Page Objects: encapsulate locators + actions, NO assertions
- Spec files: import Page Objects, use expect() for assertions
- Use the exact === FILE: path === delimiter format specified in your instructions`;

      setGenProgress(`Sending ${allRows.length} test cases across ${groupNames.length} groups to LLM...`);

      const r = await fetch(`${apiBase}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueData: {
            product: 'Playwright Automation',
            id: 'POM-BATCH',
            summary: `Playwright POM (JS+TS) for: ${groupNames.join(', ')}`,
            description,
            additional_context: POM_PROMPT,
          },
          llm: connections.llm,
          continuation: { type: 'code', maxRounds: 5 },
        }),
      });

      if (!r.ok) throw new Error((await r.json()).detail || 'Generation failed');
      const data = await r.json();
      const raw = typeof data.plan === 'string' ? data.plan : JSON.stringify(data.plan);
      const files = parseFileBlocks(raw);
      setGeneratedFiles(files);
      setActiveFileIdx(0);
      setGenProgress(`Generated ${files.length} files successfully.`);
    } catch (e) {
      alert(`Generation failed: ${e.message}`);
      setGenProgress('');
    }
    setBusy('');
  };

  /* ────────────────────────────────────────────────────────────────────
     DOWNLOAD ZIP
     ──────────────────────────────────────────────────────────────────── */
  const handleDownload = async () => {
    if (displayedFiles.length === 0) return;
    setBusy('download');
    try {
      if (typeof window !== 'undefined') {
        let JSZip = window.JSZip;
        if (!JSZip) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
          });
          JSZip = window.JSZip;
        }
        const zip = new JSZip();
        // Use displayedFiles (filtered by language + cleaned) instead of all generatedFiles
        displayedFiles.forEach((f) => zip.file(f.path, cleanCodeContent(f.content)));
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'playwright-pom-tests.zip';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      const f = generatedFiles[activeFileIdx];
      if (f) {
        const blob = new Blob([f.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = f.path.split('/').pop();
        a.click();
        URL.revokeObjectURL(url);
      }
    }
    setBusy('');
  };

  /* ────────────────────────────────────────────────────────────────────
     GITHUB PUSH
     ──────────────────────────────────────────────────────────────────── */
  const handlePush = async () => {
    if (!connections.github || connections.github.status !== 'connected') return alert('Connect GitHub first in Connection Settings');
    if (!connections.github.selectedRepo) return alert('Select a repository in Connection Settings');
    setShowPushModal(true);
    setPushBranch(connections.github.selectedBranch || 'main');
  };

  const executePush = async () => {
    setPushStatus('pushing');
    try {
      const token = connections.github.token;
      const repo = connections.github.selectedRepo;
      const branch = pushBranch || 'main';
      const apiUrl = connections.github.apiUrl || 'https://api.github.com';

      // Use displayedFiles (filtered by language + cleaned) instead of all generatedFiles
      for (const file of displayedFiles) {
        const cleanContent = cleanCodeContent(file.content);
        const filePath = pushPath ? `${pushPath.replace(/\/+$/, '')}/${file.path}` : file.path;
        const content = btoa(unescape(encodeURIComponent(cleanContent)));
        let sha;
        try {
          const existing = await fetch(`${apiUrl}/repos/${repo}/contents/${filePath}?ref=${branch}`, {
            headers: { Authorization: `token ${token}` },
          });
          if (existing.ok) { sha = (await existing.json()).sha; }
        } catch { /* file doesn't exist */ }

        const body = { message: `chore: add Playwright POM test — ${file.path}`, content, branch };
        if (sha) body.sha = sha;

        const resp = await fetch(`${apiUrl}/repos/${repo}/contents/${filePath}`, {
          method: 'PUT',
          headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`Failed to push ${filePath}: ${(await resp.json()).message}`);
      }
      setPushStatus('success');
      setTimeout(() => { setShowPushModal(false); setPushStatus(''); }, 2000);
    } catch (e) {
      setPushStatus(`error: ${e.message}`);
    }
  };

  /* ────────────────────────────────────────────────────────────────────
     COPY + DOWNLOAD SINGLE FILE + SYNTAX HIGHLIGHT
     ──────────────────────────────────────────────────────────────────── */
  const [copyFeedback, setCopyFeedback] = useState('');
  
  const copyActiveFile = () => {
    const f = displayedFiles[activeFileIdx];
    if (f) {
      // Apply cleanCodeContent to ensure no CSS patterns in copied code
      const cleanContent = cleanCodeContent(f.content);
      navigator.clipboard.writeText(cleanContent);
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback(''), 2000);
    }
  };

  const downloadSingleFile = () => {
    const f = displayedFiles[activeFileIdx];
    if (f) {
      // Apply cleanCodeContent to ensure no CSS patterns in downloaded file
      const cleanContent = cleanCodeContent(f.content);
      const blob = new Blob([cleanContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.path.split('/').pop();
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const highlightCode = (code, isJS) => {
    return code.split('\n').map((line, i) => {
      // FIRST: Strip any LLM-generated CSS class patterns BEFORE HTML escaping
      let cleanLine = line.replace(/"text-\[#[a-fA-F0-9]{3,8}\]">/g, '');
      cleanLine = cleanLine.replace(/'text-\[#[a-fA-F0-9]{3,8}\]'>/g, '');
      cleanLine = cleanLine.replace(/<\/?span[^>]*>/gi, '');
      let html = cleanLine.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html = html
        .replace(/\b(import|from|export|const|let|var|async|await|function|return|if|else|new|throw|type|class|extends|constructor|readonly|module|require|this)\b/g, '<span class="text-[#569cd6]">$1</span>')
        .replace(/\b(test|expect|describe|it|beforeAll|afterAll|beforeEach|afterEach|defineConfig|devices)\b/g, '<span class="text-[#dcdcaa]">$1</span>')
        .replace(/'([^']*)'/g, '<span class="text-[#ce9178]">\'$1\'</span>')
        .replace(/"([^"]*)"/g, '<span class="text-[#ce9178]">"$1"</span>')
        .replace(/`([^`]*)`/g, '<span class="text-[#ce9178]">`$1`</span>')
        .replace(/(\/\/.*)$/g, '<span class="text-[#6a9955]">$1</span>');
      return (
        <div key={i} className="flex">
          <span className="w-10 text-right pr-3 text-white/20 select-none text-xs">{i + 1}</span>
          <span dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      );
    });
  };

  const fileIcon = (path) => {
    if (path.endsWith('.ts')) return { icon: 'code', color: 'text-blue-400', badge: 'TS' };
    if (path.endsWith('.js')) return { icon: 'javascript', color: 'text-yellow-400', badge: 'JS' };
    if (path.includes('Page')) return { icon: 'account_tree', color: 'text-purple-400', badge: 'PO' };
    if (path.includes('config')) return { icon: 'settings', color: 'text-yellow-400', badge: 'CFG' };
    return { icon: 'draft', color: 'text-white/60', badge: '' };
  };

  const activeFile = displayedFiles[activeFileIdx];

  /* ═══════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════ */
  return (
    <div className="max-w-7xl mx-auto space-y-8 px-6 pt-8 pb-16">
      {/* ── Header ── */}
      <header className="space-y-2">
        <span className="text-secondary font-bold text-xs tracking-widest uppercase block font-label">
          Automation Conversion Engine
        </span>
        <h1 className="text-3xl lg:text-4xl font-black text-app-red tracking-tight mb-2">
          Playwright JS/TS + POM Architect
        </h1>
        <p className="text-on-surface-variant max-w-3xl font-medium leading-relaxed">
          Auto-filter <strong>Automation</strong>-tagged test cases, group by feature, and generate
          production-ready <strong>Playwright Page Object Model</strong> scripts in both <strong>JavaScript</strong> and <strong>TypeScript</strong>,
          compatible with <code className="bg-surface-container-highest px-1.5 py-0.5 rounded text-xs font-mono font-bold">npx playwright test</code>.
        </p>
      </header>

      {/* ── No automation TCs banner ── */}
      {automationCases.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 flex items-start gap-4">
          <span className="material-symbols-outlined text-amber-600 text-2xl mt-0.5">warning</span>
          <div>
            <h3 className="font-bold text-amber-800 mb-1">No Automation-Tagged Test Cases Found</h3>
            <p className="text-sm text-amber-700">
              Generate test cases from the <strong>Create Test Cases</strong> page first. Only test cases with
              <code className="bg-amber-100 px-1 py-0.5 text-xs rounded font-mono">Execution Tags: Automation</code> will appear here for conversion.
            </p>
          </div>
        </div>
      )}

      {/* ── Main Grid ── */}
      {automationCases.length > 0 && (
        <div className="grid grid-cols-12 gap-6">
          {/* ═══════════ LEFT: Feature Groups + Controls ═══════════ */}
          <div className="col-span-12 lg:col-span-4 space-y-6">

            {/* ── Stats Bar ── */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface-container-low rounded-xl p-4 text-center">
                <div className="text-2xl font-black text-app-red">{allParsed.length}</div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Total TCs</div>
              </div>
              <div className="bg-surface-container-low rounded-xl p-4 text-center">
                <div className="text-2xl font-black text-green-600">{automationCases.length}</div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Automation</div>
              </div>
              <div className="bg-surface-container-low rounded-xl p-4 text-center">
                <div className="text-2xl font-black text-secondary">{groupKeys.length}</div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Groups</div>
              </div>
            </div>

            {/* ── Feature Group Selection ── */}
            <section className="bg-white dark:bg-slate-900 rounded-xl border border-outline-variant/20 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-outline-variant/10 bg-surface-container-low flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-app-red text-xl">account_tree</span>
                  <h3 className="font-bold text-on-surface text-sm">Feature Groups</h3>
                  <span className="text-[10px] bg-app-red/10 text-app-red font-bold px-2 py-0.5 rounded-full">
                    {selectedGroups.size}/{groupKeys.length}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={selectAll} className="text-[10px] font-bold text-secondary hover:underline uppercase">All</button>
                  <button onClick={deselectAll} className="text-[10px] font-bold text-on-surface-variant hover:underline uppercase">None</button>
                </div>
              </div>
              <div className="divide-y divide-outline-variant/10 max-h-[300px] overflow-y-auto">
                {groupKeys.map((key) => {
                  const g = grouped[key];
                  const selected = selectedGroups.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleGroup(key)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all ${
                        selected ? 'bg-app-red/5 border-l-4 border-app-red' : 'hover:bg-surface-container-highest border-l-4 border-transparent'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-lg ${selected ? 'text-app-red' : 'text-on-surface-variant'}`}>
                        {selected ? 'check_box' : 'check_box_outline_blank'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-on-surface truncate">{g.label}</div>
                        <div className="text-[10px] text-on-surface-variant">{g.cases.length} test case{g.cases.length > 1 ? 's' : ''}</div>
                      </div>
                      <span className="text-xs font-mono text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded">
                        {g.cases.map((c) => c['SRL No.']).join(', ')}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* ── Summary + Generate Button ── */}
              <div className="p-4 border-t border-outline-variant/10 bg-surface-container-low space-y-3">
                {selectedGroups.size > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-xs text-red-800">
                      <strong>{selectedCaseCount}</strong> TCs across <strong>{selectedGroups.size}</strong> groups
                      → {selectedGroups.size * 2} Page Objects + {selectedGroups.size * 2} Specs + 2 Configs (JS + TS)
                    </p>
                  </div>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={busy === 'generate' || selectedGroups.size === 0}
                  className="w-full py-3.5 bg-app-red text-white font-bold rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-app-red/20 hover:bg-app-dark-red transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
                  {busy === 'generate' ? 'Generating POM...' : `Generate POM (${selectedCaseCount} TCs)`}
                </button>
                {genProgress && (
                  <p className="text-xs text-on-surface-variant italic text-center">{genProgress}</p>
                )}
              </div>
            </section>

            {/* ── Output Actions ── */}
            {generatedFiles.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleDownload}
                  disabled={busy === 'download'}
                  className="py-3 bg-surface-container-highest text-on-surface font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-surface-container-high transition-all text-sm"
                >
                  <span className="material-symbols-outlined text-base">download</span>
                  {busy === 'download' ? 'Zipping...' : 'Download ZIP'}
                </button>
                <button
                  onClick={handlePush}
                  className="py-3 bg-secondary text-white font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-secondary/80 transition-all text-sm"
                >
                  <span className="material-symbols-outlined text-base">cloud_upload</span>
                  Push to GitHub
                </button>
              </div>
            )}
          </div>

          {/* ═══════════ RIGHT: Code Editor / Preview ═══════════ */}
          <div className="col-span-12 lg:col-span-8">
            <div className="bg-[#1e1e1e] rounded-xl overflow-hidden flex flex-col shadow-2xl ring-1 ring-white/10 min-h-[600px]">

              {/* ── Language Filter Tabs ── */}
              {generatedFiles.length > 0 && (
                <div className="bg-[#252526] flex items-center gap-1 px-4 py-2 border-b border-white/5">
                  <span className="text-[10px] text-white/30 font-bold uppercase mr-2">Filter:</span>
                  {[
                    { key: 'all', label: 'All Files', icon: 'folder' },
                    { key: 'js', label: 'JavaScript', icon: 'javascript' },
                    { key: 'ts', label: 'TypeScript', icon: 'code' },
                  ].map((f) => (
                    <button
                      key={f.key}
                      onClick={() => { setLangFilter(f.key); setActiveFileIdx(0); }}
                      className={`px-3 py-1.5 text-xs font-bold rounded transition-all flex items-center gap-1.5 ${
                        langFilter === f.key
                          ? 'bg-app-red text-white'
                          : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">{f.icon}</span>
                      {f.label}
                      <span className="text-[10px] opacity-70">
                        ({f.key === 'all' ? generatedFiles.length : generatedFiles.filter(fl => fl.path.endsWith(`.${f.key}`)).length})
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* ── File Tabs ── */}
              <div className="bg-[#2d2d2d] flex items-center overflow-x-auto">
                <div className="flex gap-1.5 px-4 py-2.5 mr-3">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                  <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
                </div>
                {displayedFiles.length > 0 ? (
                  displayedFiles.map((f, idx) => {
                    const fi = fileIcon(f.path);
                    const active = idx === activeFileIdx;
                    return (
                      <button
                        key={idx}
                        onClick={() => setActiveFileIdx(idx)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-all ${
                          active
                            ? 'bg-[#1e1e1e] text-white border-b-2 border-app-red'
                            : 'text-white/50 hover:text-white/70 hover:bg-white/5'
                        }`}
                      >
                        <span className={`material-symbols-outlined text-sm ${fi.color}`}>{fi.icon}</span>
                        {f.path.split('/').pop()}
                        {fi.badge && <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                          fi.badge === 'TS' ? 'bg-blue-500/20 text-blue-400' :
                          fi.badge === 'JS' ? 'bg-yellow-500/20 text-yellow-400' :
                          fi.badge === 'PO' ? 'bg-purple-500/20 text-purple-400' :
                          'bg-white/10 text-white/50'
                        }`}>{fi.badge}</span>}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-4 py-2.5 text-xs text-white/30">No files generated yet</div>
                )}
                {displayedFiles.length > 0 && (
                  <div className="ml-auto mr-4 flex items-center gap-2">
                    {copyFeedback && <span className="text-xs text-green-400 font-medium animate-pulse">{copyFeedback}</span>}
                    <button onClick={copyActiveFile} className="flex items-center gap-1 px-2 py-1 text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors text-xs" title="Copy clean code to clipboard">
                      <span className="material-symbols-outlined text-sm">content_copy</span>
                      <span className="hidden sm:inline">Copy</span>
                    </button>
                    <button onClick={downloadSingleFile} className="flex items-center gap-1 px-2 py-1 text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors text-xs" title="Download this file">
                      <span className="material-symbols-outlined text-sm">download</span>
                      <span className="hidden sm:inline">Download</span>
                    </button>
                  </div>
                )}
              </div>

              {/* ── Editor Body ── */}
              <div className="flex-1 p-6 overflow-auto font-mono text-sm leading-relaxed text-[#d4d4d4] min-h-[500px]">
                {busy === 'generate' ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <div className="w-10 h-10 border-3 border-white/20 border-t-app-red rounded-full animate-spin" />
                    <span className="text-xs text-white/50 font-semibold">Generating Page Object Model scripts...</span>
                    <span className="text-[10px] text-white/30">{genProgress}</span>
                  </div>
                ) : activeFile ? (
                  highlightCode(activeFile.content, activeFile.path.endsWith('.js'))
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20">
                    <span className="material-symbols-outlined text-6xl">account_tree</span>
                    <p className="text-xs font-medium">Select feature groups and generate to see POM output</p>
                    <div className="flex gap-4 mt-4 text-[10px] text-white/15">
                      <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400/30" /> .js Page Objects</div>
                      <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400/30" /> .ts Page Objects</div>
                      <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400/30" /> .spec.js</div>
                      <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400/30" /> .spec.ts</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── File Explorer (when files generated) ── */}
            {generatedFiles.length > 0 && (
              <div className="mt-4 bg-white dark:bg-slate-900 rounded-xl border border-outline-variant/20 overflow-hidden">
                <div className="p-3 bg-surface-container-low border-b border-outline-variant/10 flex items-center gap-2">
                  <span className="material-symbols-outlined text-app-red text-lg">folder_open</span>
                  <h4 className="font-bold text-on-surface text-xs uppercase tracking-wider">Generated Files ({generatedFiles.length})</h4>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-1 p-2">
                  {generatedFiles.map((f, idx) => {
                    const fi = fileIcon(f.path);
                    const isPage = f.path.includes('Page');
                    const isSpec = f.path.includes('spec');
                    const isConfig = f.path.includes('config');
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          setLangFilter('all');
                          setActiveFileIdx(idx);
                        }}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-all border ${
                          'border-outline-variant/20 hover:bg-surface-container-highest'
                        }`}
                      >
                        <span className={`material-symbols-outlined text-sm ${fi.color}`}>{fi.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-on-surface truncate">{f.path.split('/').pop()}</div>
                          <div className="text-[10px] text-on-surface-variant">
                            {isPage ? 'Page Object' : isSpec ? 'Spec File' : isConfig ? 'Config' : 'File'}
                            {' · '}{f.content.split('\n').length} lines
                          </div>
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          f.path.endsWith('.ts') ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {f.path.endsWith('.ts') ? 'TS' : 'JS'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── GitHub Push Modal ── */}
      {showPushModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-on-surface">Push to GitHub</h3>
              <button onClick={() => { setShowPushModal(false); setPushStatus(''); }} className="p-1 hover:bg-surface-container-highest rounded-full">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-secondary uppercase block mb-1">Repository</label>
                <div className="text-sm font-mono bg-surface-container-low rounded-lg px-3 py-2">{connections.github.selectedRepo}</div>
              </div>
              <div>
                <label className="text-xs font-bold text-secondary uppercase block mb-1">Branch</label>
                <input
                  value={pushBranch}
                  onChange={(e) => setPushBranch(e.target.value)}
                  className="w-full bg-white dark:bg-slate-800 border border-outline-variant rounded-lg px-3 py-2 text-sm focus:border-app-red focus:ring-1 focus:ring-app-red outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-secondary uppercase block mb-1">Base Path</label>
                <input
                  value={pushPath}
                  onChange={(e) => setPushPath(e.target.value)}
                  className="w-full bg-white dark:bg-slate-800 border border-outline-variant rounded-lg px-3 py-2 text-sm focus:border-app-red focus:ring-1 focus:ring-app-red outline-none font-mono"
                  placeholder="tests"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowPushModal(false); setPushStatus(''); }}
                className="flex-1 py-2.5 border border-outline-variant rounded-lg font-bold text-sm hover:bg-surface-container-highest transition-all"
              >
                Cancel
              </button>
              <button
                onClick={executePush}
                disabled={pushStatus === 'pushing'}
                className="flex-1 py-2.5 bg-app-red text-white rounded-lg font-bold text-sm hover:bg-app-dark-red transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {pushStatus === 'pushing' ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Pushing...</>
                ) : pushStatus === 'success' ? (
                  <><span className="material-symbols-outlined text-sm">check_circle</span> Done!</>
                ) : (
                  <><span className="material-symbols-outlined text-sm">cloud_upload</span> Push {generatedFiles.length} Files</>
                )}
              </button>
            </div>
            {pushStatus && pushStatus.startsWith('error') && (
              <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{pushStatus}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
