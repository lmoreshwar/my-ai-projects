import { useState, useMemo, useCallback } from 'react';
import { saveArtifact, checkExistingArtifact, updateArtifact } from '../utils/artifactService';

/* ═══════════════════════════════════════════════════════════════════════
   SYSTEM PROMPT — Playwright TypeScript + BDD (Gherkin) Generation
   ═══════════════════════════════════════════════════════════════════════ */
const PLAYWRIGHT_TS_BDD_PROMPT = `# PLAYWRIGHT TYPESCRIPT + BDD GENERATION PROMPT

## Role
You are a Senior QA Automation Architect specializing in Playwright with TypeScript and BDD (Gherkin).
You operate under STRICT anti-hallucination rules.
Convert the provided structured test cases into executable Playwright TypeScript test scripts and BDD Feature files.

## Configuration
- Framework: Playwright
- Language: TypeScript
- BDD: Yes (Gherkin .feature files)
- Runner: Playwright Test Runner (\`npx playwright test\`)

## CRITICAL OUTPUT FORMAT RULES
- Output ONLY plain text code — NO HTML tags, NO CSS classes, NO syntax highlighting markup
- Do NOT include patterns like: "text-[#...]">  or <span class="..."> or any HTML/CSS artifacts
- Do NOT wrap code in HTML elements or include any Tailwind/CSS class names in the output
- Output must be raw, executable .ts/.feature code that can run directly with npx playwright test

## STRICT ANTI-HALLUCINATION RULES (MANDATORY)
1. ONLY use information explicitly present in the provided test case data.
2. DO NOT invent URLs, endpoints, page routes, product names, prices, or user data not in the test case.
3. DO NOT fabricate CSS selectors or XPaths — use Playwright role-based/text-based locators.
4. DO NOT assume application behavior, navigation flows, or page structure not in test steps.
5. DO NOT add extra test scenarios beyond what the test case specifies.
6. DO NOT skip ANY provided test case.
7. If a URL is NOT specified, use: // TODO: [URL NOT SPECIFIED - Update with actual application URL]
8. If a selector/locator is NOT determinable, use: page.getByRole('generic') // TODO: [LOCATOR NOT SPECIFIED - Update with actual locator]
9. If test data is NOT specified, use: // TODO: [TEST DATA NOT SPECIFIED]
10. Map test steps exactly 1:1 — do NOT expand, compress, or reinterpret.
11. Every test case MUST map 1:1 to a Gherkin Scenario AND a Playwright test() block.
12. Preconditions from the test case → Given steps / test.beforeEach
13. Test Steps from the test case → When/And steps / sequential await statements (use EXACT wording)
14. Expected Results from the test case → Then steps / expect() assertions (use EXACT wording)

## Playwright TypeScript Conventions
- Use: import { test, expect } from '@playwright/test';
- Locator priority: getByRole > getByText > getByLabel > getByPlaceholder > getByTestId > locator (last resort)
- Use async/await properly throughout
- Use test.describe() for grouping by feature/tag
- Use expect() for all assertions

## Output Structure
For each feature group, return output using this EXACT delimiter format:

=== FILE: tests/features/{tag}.feature ===
(Gherkin feature file with @tags, Scenario blocks mapping Given/When/Then from test case data)

=== FILE: tests/specs/{tag}.spec.ts ===
(TypeScript spec file with test.describe, test blocks, assertions)

=== FILE: playwright.config.ts ===
(TypeScript config file. MUST include:
- baseURL: '// TODO: [URL NOT SPECIFIED]'
- projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
- reporter: [['html', { open: 'never' }], ['list']]
- use.screenshot: 'on'
- use.video: 'retain-on-failure'
- use.trace: 'retain-on-failure'
- outputDir: 'test-results'
- retries: 1)

## Mapping Rules
- SRL No → @tag in .feature, test name prefix in .spec.ts
- Pre-conditions → Given steps / test.beforeEach
- Test Steps → When/And steps / sequential await statements
- Expected Results → Then steps / expect() assertions
- Test Case Type → @Functional, @Negative, etc. tags

## SELF-CHECK BEFORE OUTPUT
Before returning, verify:
- No URLs were invented (must come from test data or use TODO)
- No locators were fabricated (must use role/text-based or TODO)
- No extra scenarios were added beyond the provided test cases
- No product names/prices/data were assumed
- Every TODO is properly marked

Generate complete, runnable files. Do not truncate or summarize.`;

/* ═══════════════════════════════════════════════════════════════════════
   UTILITY: Parse markdown table test cases from the generator output
   ═══════════════════════════════════════════════════════════════════════ */
function parseTestCasesFromMarkdown(raw) {
  if (!raw) return [];
  const lines = raw.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return [];

  // Parse header
  const headerCols = lines[0].split('|').map((c) => c.trim()).filter(Boolean);
  const dataLines = lines.slice(2); // skip header + separator

  return dataLines.map((line) => {
    const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
    const obj = {};
    headerCols.forEach((h, i) => { obj[h] = cols[i] || ''; });
    return obj;
  }).filter((r) => r['SRL No.'] && /^TC[_-]/i.test(r['SRL No.']));
}

/* ═══════════════════════════════════════════════════════════════════════
   UTILITY: Group test cases by their Tags column
   ═══════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════
   UTILITY: Clean up any accidental CSS class patterns from LLM output
   ═══════════════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════════════
   UTILITY: Parse generated output into file blocks
   ═══════════════════════════════════════════════════════════════════════ */
function parseFileBlocks(output) {
  const files = [];
  // Match === FILE: path === ... until next === FILE or end
  const pattern = /===\s*FILE:\s*(.+?)\s*===\s*\n([\s\S]*?)(?=\n===\s*FILE:|$)/gi;
  let match;
  while ((match = pattern.exec(output)) !== null) {
    let content = match[2].trim();
    // Strip wrapping code fences if present
    content = content.replace(/^```(?:typescript|ts|gherkin|javascript|js)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    // Clean up any CSS class patterns that might have slipped in
    content = cleanCodeContent(content);
    files.push({ path: match[1].trim(), content });
  }
  // Fallback: if no FILE markers found, treat entire output as a single spec
  if (files.length === 0 && output.trim()) {
    files.push({ path: 'tests/specs/generated.spec.ts', content: cleanCodeContent(output.trim()) });
  }
  return files;
}

/* ═══════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */
export default function PlaywrightJS({ connections, apiBase, generatedTestCases, generatedFiles, setGeneratedFiles, activeFileIdx, setActiveFileIdx, selectedGroups, setSelectedGroups, onClearTestCases }) {
  // ── State ──
  const [busy, setBusy] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
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

  // ── Toggle group selection ──
  const toggleGroup = useCallback((key) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const selectAll = () => setSelectedGroups(new Set(groupKeys));
  const deselectAll = () => setSelectedGroups(new Set());

  // ── Count selected test cases ──
  const selectedCaseCount = useMemo(
    () => [...selectedGroups].reduce((sum, k) => sum + (grouped[k]?.cases.length || 0), 0),
    [selectedGroups, grouped]
  );

  /* ────────────────────────────────────────────────────────────────────
     GENERATE: Send selected groups to LLM
     ──────────────────────────────────────────────────────────────────── */
  const handleGenerate = async () => {
    if (selectedGroups.size === 0) return alert('Select at least one feature group');
    if (connections.llm.status !== 'connected') return alert('Connect to LLM first in Connection Settings');
    setBusy('generate');
    setGeneratedFiles([]);
    setActiveFileIdx(0);

    try {
      // Build a combined test case table for selected groups
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
      const description = `Convert the following Automation-tagged test cases into Playwright TypeScript + BDD format.

FEATURE GROUPS: ${groupNames.join(', ')}
TOTAL TEST CASES: ${allRows.length}

TEST CASE TABLE:
${tcTable}

IMPORTANT:
- Group output files by feature tag (${groupNames.join(', ')})
- Each group must have: tests/features/{tag}.feature + tests/specs/{tag}.spec.ts
- Also generate a single playwright.config.ts
- Use the exact === FILE: path === delimiter format specified in your instructions`;

      setGenProgress(`Sending ${allRows.length} test cases across ${groupNames.length} groups to LLM...`);

      const r = await fetch(`${apiBase}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueData: {
            product: 'Playwright Automation',
            id: 'BATCH',
            summary: `Playwright TS + BDD for: ${groupNames.join(', ')}`,
            description,
            additional_context: PLAYWRIGHT_TS_BDD_PROMPT,
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
     DOWNLOAD: Package files as ZIP
     ──────────────────────────────────────────────────────────────────── */
  const handleDownload = async () => {
    if (generatedFiles.length === 0) return;
    setBusy('download');

    try {
      if (typeof window !== 'undefined') {
        // Load JSZip from CDN
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
        // Apply cleanCodeContent to all files before zipping
        // Skip non-essential files: .md, .txt, .log, .yml (keep .js, .ts, .json, .config.*)
        const ZIP_SKIP = /\.(md|txt|log|yml|yaml)$/i;
        generatedFiles.filter(f => !ZIP_SKIP.test(f.path)).forEach((f) => {
          zip.file(f.path, cleanCodeContent(f.content));
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'playwright-tests.zip';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      // Fallback: download active file only
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
     GITHUB PUSH: Push files to connected repo
     ──────────────────────────────────────────────────────────────────── */
  const handlePush = async () => {
    if (!connections.github || connections.github.status !== 'connected') {
      return alert('Connect GitHub first in Connection Settings');
    }
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

      for (const file of generatedFiles) {
        const cleanContent = cleanCodeContent(file.content);
        const filePath = pushPath ? `${pushPath.replace(/\/+$/, '')}/${file.path}` : file.path;
        const content = btoa(unescape(encodeURIComponent(cleanContent)));

        // Check if file exists (to get SHA for update)
        let sha;
        try {
          const existing = await fetch(`${apiUrl}/repos/${repo}/contents/${filePath}?ref=${branch}`, {
            headers: { Authorization: `token ${token}` },
          });
          if (existing.ok) {
            const data = await existing.json();
            sha = data.sha;
          }
        } catch { /* file doesn't exist, OK */ }

        const body = {
          message: `chore: add Playwright TS test — ${file.path}`,
          content,
          branch,
        };
        if (sha) body.sha = sha;

        const resp = await fetch(`${apiUrl}/repos/${repo}/contents/${filePath}`, {
          method: 'PUT',
          headers: {
            Authorization: `token ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(`Failed to push ${filePath}: ${err.message}`);
        }
      }

      setPushStatus('success');
      setTimeout(() => { setShowPushModal(false); setPushStatus(''); }, 2000);
    } catch (e) {
      setPushStatus(`error: ${e.message}`);
    }
  };

  /* ────────────────────────────────────────────────────────────────────
     COPY + DOWNLOAD SINGLE FILE
     ──────────────────────────────────────────────────────────────────── */
  const [copyFeedback, setCopyFeedback] = useState('');
  
  const copyActiveFile = () => {
    if (generatedFiles[activeFileIdx]) {
      // Apply cleanCodeContent to ensure no CSS patterns in copied code
      const cleanContent = cleanCodeContent(generatedFiles[activeFileIdx].content);
      navigator.clipboard.writeText(cleanContent);
      setCopyFeedback('Copied!');
      setTimeout(() => setCopyFeedback(''), 2000);
    }
  };

  const downloadSingleFile = () => {
    const f = generatedFiles[activeFileIdx];
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

  /* ────────────────────────────────────────────────────────────────────
     SYNTAX HIGHLIGHTING (TypeScript + Gherkin)
     ──────────────────────────────────────────────────────────────────── */
  const highlightCode = (code, isGherkin) => {
    return code.split('\n').map((line, i) => {
      // FIRST: Strip any LLM-generated CSS class patterns BEFORE HTML escaping
      let cleanLine = line.replace(/"text-\[#[a-fA-F0-9]{3,8}\]">/g, '');
      cleanLine = cleanLine.replace(/'text-\[#[a-fA-F0-9]{3,8}\]'>/g, '');
      cleanLine = cleanLine.replace(/<\/?span[^>]*>/gi, '');
      let html = cleanLine
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (isGherkin) {
        html = html
          .replace(/^(\s*)(Feature:|Scenario Outline:|Scenario:|Background:|Examples:)/g, '$1<span class="text-[#c586c0]">$2</span>')
          .replace(/^(\s*)(Given|When|Then|And|But)\b/g, '$1<span class="text-[#569cd6]">$2</span>')
          .replace(/@[\w-]+/g, '<span class="text-[#dcdcaa]">$&</span>')
          .replace(/(#.*)$/g, '<span class="text-[#6a9955]">$1</span>')
          .replace(/"([^"]*)"/g, '<span class="text-[#ce9178]">"$1"</span>');
      } else {
        html = html
          .replace(/\b(import|from|export|const|let|var|async|await|function|return|if|else|new|throw|type)\b/g, '<span class="text-[#569cd6]">$1</span>')
          .replace(/\b(test|expect|describe|it|beforeAll|afterAll|beforeEach|afterEach|defineConfig|devices)\b/g, '<span class="text-[#dcdcaa]">$1</span>')
          .replace(/'([^']*)'/g, '<span class="text-[#ce9178]">\'$1\'</span>')
          .replace(/"([^"]*)"/g, '<span class="text-[#ce9178]">"$1"</span>')
          .replace(/`([^`]*)`/g, '<span class="text-[#ce9178]">`$1`</span>')
          .replace(/(\/\/.*)$/g, '<span class="text-[#6a9955]">$1</span>');
      }
      return (
        <div key={i} className="flex">
          <span className="w-10 text-right pr-3 text-white/20 select-none text-xs">{i + 1}</span>
          <span dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      );
    });
  };

  // ── Derive file icon / badge ──
  const fileIcon = (path) => {
    if (path.endsWith('.feature')) return { icon: 'description', color: 'text-green-400', badge: 'BDD' };
    if (path.endsWith('.spec.ts')) return { icon: 'code', color: 'text-blue-400', badge: 'TS' };
    if (path.includes('config')) return { icon: 'settings', color: 'text-yellow-400', badge: 'CFG' };
    return { icon: 'draft', color: 'text-white/60', badge: '' };
  };

  const activeFile = generatedFiles[activeFileIdx];
  const isGherkin = activeFile?.path.endsWith('.feature');

  /* ═══════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════ */
  return (
    <div className="max-w-7xl mx-auto space-y-8 px-3 sm:px-6 pt-8 pb-16">
      {/* ── Header ── */}
      <header className="space-y-2">
        <span className="text-secondary font-bold text-xs tracking-widest uppercase block font-label">
          Automation Conversion Engine
        </span>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl lg:text-4xl font-black text-app-red tracking-tight mb-2">
            Playwright TS + BDD Architect
          </h1>
          {automationCases.length > 0 && onClearTestCases && (
            <button onClick={() => { if (confirm('Clear all imported test cases? You can regenerate them from the Test Cases page.')) { onClearTestCases(); setGeneratedFiles([]); setActiveFileIdx(0); setSelectedGroups(new Set()); } }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-red-50 hover:text-red-600 hover:border-red-300 dark:hover:bg-red-900/20 dark:hover:text-red-400 border border-slate-200 dark:border-slate-700 transition-colors shrink-0">
              <span className="material-symbols-outlined text-sm">delete_sweep</span> Clear Test Cases
            </button>
          )}
        </div>
        <p className="text-on-surface-variant max-w-3xl font-medium leading-relaxed">
          Auto-filter <strong>Automation</strong>-tagged test cases, group by feature, and generate
          production-ready <strong>Playwright TypeScript + BDD (Gherkin)</strong> scripts compatible with <code className="bg-surface-container-highest px-1.5 py-0.5 rounded text-xs font-mono font-bold">npx playwright test</code>.
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
                <div className="text-2xl font-black text-primary">{allParsed.length}</div>
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
            <section className="bg-white rounded-xl border border-outline-variant/20 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-outline-variant/10 bg-surface-container-low flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-xl">category</span>
                  <h3 className="font-bold text-on-surface text-sm">Feature Groups</h3>
                  <span className="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">
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
                        selected ? 'bg-primary/5 border-l-4 border-primary' : 'hover:bg-surface-container-highest border-l-4 border-transparent'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-lg ${selected ? 'text-primary' : 'text-on-surface-variant'}`}>
                        {selected ? 'check_box' : 'check_box_outline_blank'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-on-surface truncate">{g.label}</span>
                          <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            {g.cases.length} TC{g.cases.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {g.cases.map((c) => (
                            <span key={c['SRL No.']} className="text-[10px] font-mono text-on-surface-variant bg-surface-container-highest px-1.5 py-0.5 rounded">
                              {c['SRL No.']}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* ── Selected Summary + Generate Button (inside card footer) ── */}
              <div className="p-4 border-t border-outline-variant/10 bg-surface-container-low space-y-3">
                {selectedGroups.size > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-xs text-red-800">
                      <strong>{selectedCaseCount}</strong> test cases across <strong>{selectedGroups.size}</strong> groups selected
                      → {selectedGroups.size} .feature + {selectedGroups.size} .spec.ts + 1 config
                    </p>
                  </div>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={busy === 'generate' || selectedGroups.size === 0}
                  className="w-full py-3.5 bg-app-red text-white font-bold rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-app-red/20 hover:bg-app-dark-red transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
                  {busy === 'generate' ? 'Generating...' : `Generate BDD Scripts (${selectedCaseCount} TCs)`}
                </button>
                {genProgress && (
                  <p className="text-xs text-on-surface-variant italic text-center">{genProgress}</p>
                )}
              </div>
            </section>

            {/* ── Output Actions ── */}
            {generatedFiles.length > 0 && (
              <div className="space-y-3">
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
                <button
                  onClick={() => { if (confirm('Clear all generated scripts? You can re-select groups and generate again.')) { setGeneratedFiles([]); setActiveFileIdx(0); } }}
                  className="w-full py-2.5 bg-slate-100 dark:bg-slate-800 text-on-surface dark:text-white font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-sm active:scale-[0.98]"
                >
                  <span className="material-symbols-outlined text-base">restart_alt</span>
                  Clear All Scripts
                </button>
                <button
                  onClick={async () => {
                    setSaveStatus('saving');
                    try {
                      const check = await checkExistingArtifact(apiBase, 'playwright-js');
                      const existingVersion = check.versionCount || 0;
                      if (check.exists) {
                        const choice = confirm(
                          `⚠️ Playwright BDD Scripts already saved (${existingVersion} version${existingVersion > 1 ? 's' : ''})\n\n` +
                          `Latest: v${check.artifact.metadata?.version || 1} — ${new Date(check.artifact.createdAt).toLocaleString()}\n\n` +
                          `Click OK to UPDATE the latest version.\nClick Cancel to save as NEW version (v${existingVersion + 1}).`
                        );
                        const title = `Playwright BDD — ${new Date().toLocaleDateString()}`;
                        if (choice) {
                          await updateArtifact(apiBase, check.artifact._id, { title, files: generatedFiles, metadata: { fileCount: generatedFiles.length, selectedGroups: [...selectedGroups], version: check.artifact.metadata?.version || 1 } });
                        } else {
                          const nv = existingVersion + 1;
                          await saveArtifact(apiBase, { type: 'playwright-js', title: `${title} (v${nv})`, files: generatedFiles, metadata: { fileCount: generatedFiles.length, selectedGroups: [...selectedGroups], version: nv } });
                        }
                        setSaveStatus('saved'); setTimeout(() => setSaveStatus(''), 3000);
                        return;
                      }
                      await saveArtifact(apiBase, { type: 'playwright-js', title: `Playwright BDD — ${new Date().toLocaleDateString()}`, files: generatedFiles, metadata: { fileCount: generatedFiles.length, selectedGroups: [...selectedGroups], version: 1 } });
                      setSaveStatus('saved'); setTimeout(() => setSaveStatus(''), 3000);
                    } catch (e) { setSaveStatus('error'); alert('Save failed: ' + e.message); setTimeout(() => setSaveStatus(''), 3000); }
                  }}
                  disabled={saveStatus === 'saving'}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-all text-sm active:scale-[0.98] shadow-lg shadow-emerald-600/20"
                >
                  <span className="material-symbols-outlined text-base">{saveStatus === 'saved' ? 'check_circle' : 'save'}</span>
                  {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved to Library!' : 'Save to Library'}
                </button>
              </div>
            )}
          </div>

          {/* ═══════════ RIGHT: Code Editor / Preview ═══════════ */}
          <div className="col-span-12 lg:col-span-8">
            <div className="bg-[#1e1e1e] rounded-xl overflow-hidden flex flex-col shadow-2xl ring-1 ring-white/10 min-h-[600px]">
              {/* ── File Tabs ── */}
              <div className="bg-[#2d2d2d] flex items-center overflow-x-auto">
                <div className="flex gap-1.5 px-4 py-2.5 mr-3">
                  <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                  <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                  <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
                </div>
                {generatedFiles.length > 0 ? (
                  generatedFiles.map((f, idx) => {
                    const fi = fileIcon(f.path);
                    const active = idx === activeFileIdx;
                    return (
                      <button
                        key={idx}
                        onClick={() => setActiveFileIdx(idx)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-all ${
                          active
                            ? 'bg-[#1e1e1e] text-white border-b-2 border-primary'
                            : 'text-white/50 hover:text-white/70 hover:bg-white/5'
                        }`}
                      >
                        <span className={`material-symbols-outlined text-sm ${fi.color}`}>{fi.icon}</span>
                        {f.path.split('/').pop()}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-4 py-2.5 text-xs text-white/30">No files generated yet</div>
                )}
                {/* Copy & Download buttons on far right */}
                {generatedFiles.length > 0 && (
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
                    <div className="w-10 h-10 border-3 border-white/20 border-t-primary rounded-full animate-spin" />
                    <span className="text-xs text-white/50 font-semibold">Generating Playwright TypeScript + BDD scripts...</span>
                    <span className="text-[10px] text-white/30">{genProgress}</span>
                  </div>
                ) : activeFile ? (
                  highlightCode(cleanCodeContent(activeFile.content), isGherkin)
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20">
                    <span className="material-symbols-outlined text-6xl">code</span>
                    <p className="text-xs font-medium">Select feature groups and generate to see BDD scripts</p>
                    <p className="text-[10px] text-white/15">Files will appear as tabs: .feature / .spec.ts / playwright.config.ts</p>
                  </div>
                )}
              </div>

              {/* ── Editor Status Bar ── */}
              <div className="bg-[#007acc] px-4 py-1 flex items-center justify-between text-[10px] text-white/80 font-medium">
                <div className="flex items-center gap-4">
                  <span>TypeScript + Gherkin</span>
                  {activeFile && <span>{activeFile.content.split('\n').length} lines</span>}
                </div>
                <div className="flex items-center gap-4">
                  <span>Playwright CLI Ready</span>
                  <span>UTF-8</span>
                  {generatedFiles.length > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      {generatedFiles.length} files
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Generated File Tree (when files exist) ── */}
      {generatedFiles.length > 0 && (
        <section className="bg-white rounded-xl border border-outline-variant/20 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-outline-variant/10 bg-surface-container-low flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">folder_open</span>
            <h3 className="font-bold text-on-surface text-sm">Generated File Structure</h3>
            <span className="ml-auto text-xs text-on-surface-variant">{generatedFiles.length} files</span>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {generatedFiles.map((f, idx) => {
              const fi = fileIcon(f.path);
              return (
                <button
                  key={idx}
                  onClick={() => setActiveFileIdx(idx)}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                    idx === activeFileIdx ? 'border-primary bg-primary/5' : 'border-outline-variant/20 hover:bg-surface-container-highest'
                  }`}
                >
                  <span className={`material-symbols-outlined ${fi.color}`}>{fi.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-on-surface truncate">{f.path}</div>
                    <div className="text-[10px] text-on-surface-variant">{f.content.split('\n').length} lines</div>
                  </div>
                  {fi.badge && (
                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 bg-surface-container-highest rounded">{fi.badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Trust Banner ── */}
      <div className="bg-[#f8f9ff] border border-blue-100 rounded-xl p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-secondary">
          <span className="material-symbols-outlined">verified_user</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-on-surface">
            <span className="font-bold text-secondary">Anti-Hallucination Shield</span> — Scripts are grounded in your verified test cases only.
            No invented URLs, selectors, or behavior. Missing details are flagged with <code className="bg-surface-container-highest px-1 py-0.5 rounded text-xs font-mono">// TODO</code> markers.
          </p>
        </div>
      </div>

      {/* ── GitHub Push Modal ── */}
      {showPushModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => { if (pushStatus !== 'pushing') setShowPushModal(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-2xl text-secondary">cloud_upload</span>
              <h2 className="text-xl font-black text-on-surface">Push to GitHub</h2>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-secondary uppercase tracking-wider mb-1">Repository</label>
                <div className="bg-surface-container-highest rounded-lg px-3 py-2 text-sm font-mono text-on-surface">{connections.github.selectedRepo}</div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-secondary uppercase tracking-wider mb-1">Branch</label>
                <input
                  className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  value={pushBranch}
                  onChange={(e) => setPushBranch(e.target.value)}
                  placeholder="main"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-secondary uppercase tracking-wider mb-1">Base Path</label>
                <input
                  className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none font-mono"
                  value={pushPath}
                  onChange={(e) => setPushPath(e.target.value)}
                  placeholder="tests"
                />
                <p className="text-[10px] text-on-surface-variant mt-1">Files will be pushed under this folder in the repo</p>
              </div>
              <div className="bg-surface-container-low rounded-lg p-3">
                <p className="text-xs font-bold text-on-surface-variant mb-1">{generatedFiles.length} files to push:</p>
                <ul className="text-[10px] text-on-surface-variant space-y-0.5 font-mono">
                  {generatedFiles.map((f, i) => (
                    <li key={i}>📄 {pushPath ? `${pushPath}/${f.path}` : f.path}</li>
                  ))}
                </ul>
              </div>
            </div>

            {pushStatus === 'success' && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm font-medium">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                Successfully pushed all files!
              </div>
            )}
            {pushStatus.startsWith('error') && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                <span className="material-symbols-outlined text-sm">error</span>
                {pushStatus.replace('error: ', '')}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => { setShowPushModal(false); setPushStatus(''); }}
                disabled={pushStatus === 'pushing'}
                className="px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant font-medium text-sm hover:bg-surface-container-highest transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={executePush}
                disabled={pushStatus === 'pushing' || pushStatus === 'success'}
                className="px-6 py-2 rounded-lg bg-secondary text-white font-bold text-sm shadow-md hover:bg-secondary/80 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {pushStatus === 'pushing' ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Pushing...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">rocket_launch</span>
                    Push Files
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
