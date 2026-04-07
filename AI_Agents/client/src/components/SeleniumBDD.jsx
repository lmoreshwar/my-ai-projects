import { useState, useMemo, useCallback } from 'react';

const GHERKIN_SYSTEM_PROMPT = `# SELENIUM BDD AUTOMATION GENERATION PROMPT

## Role
You are a **Senior QA Automation Engineer** operating under STRICT anti-hallucination rules.
Your task: Convert provided test cases into BDD Gherkin feature files AND Java step definition skeletons.

## Configuration
- Automation Framework: Selenium WebDriver
- Language: Java (Cucumber BDD)
- BDD Syntax: Gherkin (.feature files)

## STRICT ANTI-HALLUCINATION RULES (MANDATORY)
1. ONLY use information explicitly present in the provided test case data.
2. DO NOT invent product names, prices, URLs, page routes, or UI element details not in the input.
3. DO NOT fabricate CSS selectors, XPaths, IDs, or class names. Use placeholder comments instead.
4. DO NOT assume application behavior, navigation flows, or page structure not described in test steps.
5. DO NOT add extra scenarios beyond what the test case specifies (no empty cart, no edge cases unless explicitly in input).
6. If a URL is NOT specified, use: // TODO: [URL NOT SPECIFIED - Update with actual application URL]
7. If a locator/selector is NOT determinable from test steps, use: // TODO: [LOCATOR NOT SPECIFIED - Update with actual selector]
8. If test data (values, usernames, passwords) is NOT specified, use: // TODO: [TEST DATA NOT SPECIFIED]
9. Map test steps exactly 1:1 — do NOT expand, compress, or reinterpret steps.
10. Product names, quantities, prices MUST come from the test case data only. DO NOT substitute or invent.

## PROCESS
Step 1: Extract ONLY verifiable facts from the test case (steps, preconditions, expected results).
Step 2: Map each test step to a Gherkin Given/When/Then statement using the EXACT wording from test steps.
Step 3: Create step definition skeletons with TODO markers for unknown selectors/URLs.
Step 4: Self-check — remove any assumed/invented content.

## OUTPUT FORMAT (MANDATORY — use these EXACT delimiters)
You MUST separate Feature file and Step Definitions using these exact markers:

=== FILE: feature ===
(Gherkin .feature file content here)

=== FILE: steps ===
(Java step definition class content here)

## Feature File Rules
- Use standard Gherkin: Feature, Scenario, Given/When/Then/And/But
- Add tags from test case data: @TC_ID, and execution tags from the test case
- Given steps = Pre-conditions from test case
- When/And steps = Test Steps from test case (map each step exactly)
- Then steps = Expected Results from test case (map each result exactly)
- Use Scenario Outline with Examples ONLY if the test case itself provides tabular data
- DO NOT create extra Scenarios beyond what is in the test case
- If information is missing, add as Gherkin comment: # [NOT SPECIFIED IN TEST CASE]

## Step Definition Rules
- Create a Java class with Cucumber annotations (@Given, @When, @Then)
- Use Selenium WebDriver API
- For ALL locators: add // TODO: [LOCATOR NOT SPECIFIED] unless the test case describes the exact UI element
- For ALL URLs: add // TODO: [URL NOT SPECIFIED]
- For ALL test data: add // TODO: [TEST DATA NOT SPECIFIED] if not in the test case
- Method bodies should contain the SKELETON structure (driver.findElement, click, sendKeys)
  but with TODO comments for actual selectors
- Include proper imports and class structure
- DO NOT instantiate WebDriver in steps — use a shared hooks class pattern
- DO NOT hardcode product prices, names, or any data not from the test case

Generate ONLY what the test case data supports. Nothing more.`;

/* ═══════════════════════════════════════════════════════════════════════
   UTILITY: Parse markdown table test cases from the generator output
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

export default function SeleniumBDD({ connections, apiBase, generatedTestCases, seleniumOutput, setSeleniumOutput, selectedGroups, setSelectedGroups }) {
  const gherkinOutput = seleniumOutput || '';
  const setGherkinOutput = setSeleniumOutput;
  const [busy, setBusy] = useState('');
  const [activeTab, setActiveTab] = useState('feature'); // 'feature' | 'steps'

  // ── Parse & filter automation-tagged test cases into groups ──
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

  /* ── Parse output into separate files ── */
  const parsedFiles = (() => {
    if (!gherkinOutput) return { feature: '', steps: '' };
    // Try to parse via === FILE: feature === and === FILE: steps === markers
    const featureMatch = gherkinOutput.match(/===\s*FILE:\s*feature\s*===\s*\n([\s\S]*?)(?=\n===\s*FILE:|$)/i);
    const stepsMatch = gherkinOutput.match(/===\s*FILE:\s*steps\s*===\s*\n([\s\S]*?)(?=\n===\s*FILE:|$)/i);
    if (featureMatch || stepsMatch) {
      let feature = (featureMatch ? featureMatch[1] : '').trim();
      let steps = (stepsMatch ? stepsMatch[1] : '').trim();
      // Strip wrapping code fences
      feature = feature.replace(/^```(?:gherkin)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      steps = steps.replace(/^```(?:java)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      return { feature, steps };
    }
    // Fallback: split by ```java or ```gherkin markers
    const gherkinBlock = gherkinOutput.match(/```gherkin\s*\n([\s\S]*?)```/);
    const javaBlock = gherkinOutput.match(/```java\s*\n([\s\S]*?)```/);
    if (gherkinBlock || javaBlock) {
      return { feature: gherkinBlock ? gherkinBlock[1].trim() : '', steps: javaBlock ? javaBlock[1].trim() : '' };
    }
    // Last fallback: if output has 'import io.cucumber' or 'import org.openqa', split there
    const importIdx = gherkinOutput.search(/\nimport\s+(io\.cucumber|org\.openqa)/);
    if (importIdx > 0) {
      return { feature: gherkinOutput.substring(0, importIdx).trim(), steps: gherkinOutput.substring(importIdx).trim() };
    }
    return { feature: gherkinOutput, steps: '' };
  })();

  /* ── Generate Gherkin via LLM (group-based) ── */
  const generateGherkin = async () => {
    if (selectedGroups.size === 0) return alert('Select at least one feature group');
    if (connections.llm.status !== 'connected') return alert('Connect to LLM first in Connection Settings');
    setBusy('generate');
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
      const description = `Convert the following Automation-tagged test cases into Selenium BDD (Gherkin + Java Step Definitions) format.

FEATURE GROUPS: ${groupNames.join(', ')}
TOTAL TEST CASES: ${allRows.length}

TEST CASE TABLE:
${tcTable}

IMPORTANT:
- Group scenarios by feature tag (${groupNames.join(', ')})
- Use the exact === FILE: feature === and === FILE: steps === delimiter format`;

      const r = await fetch(`${apiBase}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueData: {
            product: 'Selenium BDD',
            id: 'BATCH',
            summary: `Selenium Cucumber for: ${groupNames.join(', ')}`,
            description,
            additional_context: GHERKIN_SYSTEM_PROMPT,
          },
          llm: connections.llm,
          continuation: { type: 'code', maxRounds: 5 },
        }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || 'Generation failed');
      const data = await r.json();
      setGherkinOutput(data.plan);
    } catch (e) { alert(e.message); }
    setBusy('');
  };

  /* ── Download file based on active tab ── */
  const downloadFile = () => {
    const content = activeTab === 'feature' ? parsedFiles.feature : parsedFiles.steps;
    if (!content) return;
    const ext = activeTab === 'feature' ? '.feature' : '.java';
    const name = activeTab === 'feature' ? `selenium-bdd${ext}` : `StepDefs${ext}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyOutput = () => {
    const content = activeTab === 'feature' ? parsedFiles.feature : parsedFiles.steps;
    if (content) navigator.clipboard.writeText(content);
  };

  /* ── Syntax highlight Gherkin ── */
  const highlightGherkin = (text) => {
    return text.split('\n').map((line, i) => {
      let cls = 'text-on-surface-variant dark:text-slate-400';
      const trimmed = line.trimStart();
      if (/^(Feature:|Scenario:|Scenario Outline:|Background:|Rule:)/.test(trimmed)) cls = 'text-app-red font-bold';
      else if (/^(Given|When|Then|And|But)\b/.test(trimmed)) cls = 'text-app-red font-bold';
      else if (/^(Examples:|Scenarios:)/.test(trimmed)) cls = 'text-app-red font-bold';
      else if (/^#/.test(trimmed)) cls = 'text-tertiary-container italic';
      else if (/^@/.test(trimmed)) cls = 'text-secondary font-semibold';
      const highlighted = line.replace(/"([^"]*)"/g, '<span class="text-secondary">"$1"</span>');
      return <div key={i} className={cls} dangerouslySetInnerHTML={{ __html: highlighted }} />;
    });
  };

  /* ── Syntax highlight Java ── */
  const highlightJava = (text) => {
    return text.split('\n').map((line, i) => {
      let cls = 'text-on-surface-variant dark:text-slate-400';
      const trimmed = line.trimStart();
      if (/^(import|package)\b/.test(trimmed)) cls = 'text-secondary';
      else if (/^(public|private|protected|class|void|static|final)\b/.test(trimmed)) cls = 'text-app-red font-bold';
      else if (/^\s*@(Given|When|Then|And|But|Before|After)\b/.test(trimmed)) cls = 'text-app-red font-bold';
      else if (/^\s*\/\/\s*TODO/.test(trimmed)) cls = 'text-amber-600 dark:text-amber-400 font-bold';
      else if (/^\s*\/\//.test(trimmed)) cls = 'text-tertiary-container italic';
      const highlighted = line.replace(/"([^"]*)"/g, '<span class="text-secondary">"$1"</span>');
      return <div key={i} className={cls} dangerouslySetInnerHTML={{ __html: highlighted }} />;
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 px-6 pt-8 pb-16">
      {/* ── Header ── */}
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-secondary font-semibold text-sm uppercase tracking-wider">
          <span className="material-symbols-outlined text-sm">auto_awesome</span>
          AI-POWERED ARCHITECT
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Selenium · Cucumber Generator</h1>
        </div>
        <p className="text-on-surface-variant dark:text-slate-400 max-w-2xl font-medium leading-relaxed">
          Generate Gherkin feature files and Java step definitions from your automation-tagged test cases.
        </p>
      </header>

      <div className="grid grid-cols-12 gap-8">
        {/* ══════════════ Left Column: Inputs ══════════════ */}
        <div className="col-span-12 lg:col-span-7 space-y-6">

          {/* ── Stats Bar (shown when test cases exist) ── */}
          {groupKeys.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface-container-low dark:bg-slate-900 rounded-xl p-4 text-center border border-outline-variant/10 dark:border-slate-800">
                <div className="text-2xl font-black text-primary dark:text-app-red">{allParsed.length}</div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Total TCs</div>
              </div>
              <div className="bg-surface-container-low dark:bg-slate-900 rounded-xl p-4 text-center border border-outline-variant/10 dark:border-slate-800">
                <div className="text-2xl font-black text-green-600">{automationCases.length}</div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Automation</div>
              </div>
              <div className="bg-surface-container-low dark:bg-slate-900 rounded-xl p-4 text-center border border-outline-variant/10 dark:border-slate-800">
                <div className="text-2xl font-black text-secondary">{groupKeys.length}</div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Groups</div>
              </div>
            </div>
          )}

          {/* ── Feature Group Selection (shown when test cases exist) ── */}
          {groupKeys.length > 0 && (
            <section className="bg-white dark:bg-slate-900 rounded-xl border border-outline-variant/20 dark:border-slate-800 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-outline-variant/10 bg-surface-container-low dark:bg-slate-800/50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary dark:text-app-red text-xl">category</span>
                  <h3 className="font-bold text-on-surface dark:text-white text-sm">Feature Groups</h3>
                  <span className="text-[10px] bg-primary/10 dark:bg-app-red/10 text-primary dark:text-app-red font-bold px-2 py-0.5 rounded-full">
                    {selectedGroups.size}/{groupKeys.length}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button onClick={selectAll} className="text-[10px] font-bold text-secondary hover:underline uppercase">All</button>
                  <button onClick={deselectAll} className="text-[10px] font-bold text-on-surface-variant hover:underline uppercase">None</button>
                </div>
              </div>
              <div className="divide-y divide-outline-variant/10 dark:divide-slate-800 max-h-[300px] overflow-y-auto">
                {groupKeys.map((key) => {
                  const g = grouped[key];
                  const selected = selectedGroups.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleGroup(key)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all ${
                        selected ? 'bg-primary/5 dark:bg-app-red/5 border-l-4 border-primary dark:border-app-red' : 'hover:bg-surface-container-highest dark:hover:bg-slate-800 border-l-4 border-transparent'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-lg ${selected ? 'text-primary dark:text-app-red' : 'text-on-surface-variant'}`}>
                        {selected ? 'check_box' : 'check_box_outline_blank'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-on-surface dark:text-white truncate">{g.label}</span>
                          <span className="text-[10px] font-bold bg-primary/10 dark:bg-app-red/10 text-primary dark:text-app-red px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            {g.cases.length} TC{g.cases.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {g.cases.map((c) => (
                            <span key={c['SRL No.']} className="text-[10px] font-mono text-on-surface-variant bg-surface-container-highest dark:bg-slate-800 px-1.5 py-0.5 rounded">
                              {c['SRL No.']}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* ── Summary + Generate Button (inside card) ── */}
              <div className="p-4 border-t border-outline-variant/10 dark:border-slate-800 bg-surface-container-low dark:bg-slate-800/50 space-y-3">
                {selectedGroups.size > 0 && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <p className="text-xs text-red-800 dark:text-red-300">
                      <strong>{selectedCaseCount}</strong> test cases across <strong>{selectedGroups.size}</strong> groups selected
                      → .feature + Step Definitions
                    </p>
                  </div>
                )}
                <button
                  onClick={generateGherkin}
                  disabled={busy === 'generate' || selectedGroups.size === 0}
                  className="w-full py-3.5 bg-app-red text-white font-bold rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-app-red/20 hover:bg-app-dark-red transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
                  {busy === 'generate' ? 'Generating...' : `Generate Cucumber Scripts (${selectedCaseCount} TCs)`}
                </button>
              </div>
            </section>
          )}

          {/* ── No automation TCs banner ── */}
          {automationCases.length === 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-6 flex items-start gap-4">
              <span className="material-symbols-outlined text-amber-600 text-2xl mt-0.5">warning</span>
              <div>
                <h3 className="font-bold text-amber-800 dark:text-amber-300 mb-1">No Automation-Tagged Test Cases Found</h3>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Generate test cases from the <strong>Create Test Cases</strong> page first. Only test cases with
                  <code className="bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 text-xs rounded font-mono">Execution Tags: Automation</code> will appear here for conversion.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ══════════════ Right Column: Tabbed Preview ══════════════ */}
        <div className="col-span-12 lg:col-span-5">
          <div className="sticky top-24 bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant/10 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden flex flex-col h-[calc(100vh-250px)] min-h-[500px]">
            {/* Tab Header */}
            <div className="bg-surface-container-highest dark:bg-slate-800 border-b border-outline-variant/20">
              <div className="flex items-center justify-between px-4 py-2">
                <div className="flex gap-1.5 mr-4">
                  <span className="w-3 h-3 rounded-full bg-red-400" />
                  <span className="w-3 h-3 rounded-full bg-yellow-400" />
                  <span className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <button onClick={copyOutput} className="text-secondary hover:text-app-red transition-colors" title="Copy current tab">
                  <span className="material-symbols-outlined text-lg">content_copy</span>
                </button>
              </div>
              {/* Tabs */}
              <div className="flex border-t border-outline-variant/10">
                <button
                  onClick={() => setActiveTab('feature')}
                  className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all border-b-2 ${activeTab === 'feature' ? 'border-app-red text-app-red bg-surface-container-lowest dark:bg-slate-900' : 'border-transparent text-tertiary-container hover:text-on-surface dark:text-slate-500'}`}
                >
                  <span className="material-symbols-outlined text-sm">description</span>
                  Feature File
                  {parsedFiles.feature && <span className="w-1.5 h-1.5 rounded-full bg-green-500 ml-1" />}
                </button>
                <button
                  onClick={() => setActiveTab('steps')}
                  className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all border-b-2 ${activeTab === 'steps' ? 'border-app-red text-app-red bg-surface-container-lowest dark:bg-slate-900' : 'border-transparent text-tertiary-container hover:text-on-surface dark:text-slate-500'}`}
                >
                  <span className="material-symbols-outlined text-sm">code</span>
                  Step Definitions
                  {parsedFiles.steps && <span className="w-1.5 h-1.5 rounded-full bg-green-500 ml-1" />}
                </button>
              </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 p-6 overflow-auto bg-[#fafafa] dark:bg-slate-950 font-mono text-sm leading-relaxed">
              {busy === 'generate' ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-secondary">
                  <div className="w-8 h-8 border-3 border-app-red/30 border-t-app-red rounded-full animate-spin" />
                  <span className="text-xs font-semibold">Generating BDD scripts...</span>
                </div>
              ) : activeTab === 'feature' ? (
                parsedFiles.feature ? (
                  <pre className="whitespace-pre-wrap">{highlightGherkin(parsedFiles.feature)}</pre>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-secondary/50">
                    <span className="material-symbols-outlined text-4xl">description</span>
                    <p className="text-xs font-medium">Gherkin .feature file will appear here</p>
                  </div>
                )
              ) : (
                parsedFiles.steps ? (
                  <pre className="whitespace-pre-wrap">{highlightJava(parsedFiles.steps)}</pre>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-secondary/50">
                    <span className="material-symbols-outlined text-4xl">code</span>
                    <p className="text-xs font-medium">Java step definitions will appear here</p>
                  </div>
                )
              )}
            </div>

            {/* Preview Footer */}
            <div className="bg-surface-container-high dark:bg-slate-800 p-4 flex justify-between items-center border-t border-outline-variant/20">
              <span className="text-[10px] text-tertiary dark:text-slate-500 font-bold uppercase tracking-widest">
                {activeTab === 'feature' ? '.feature' : '.java'} — Selenium BDD Engine
              </span>
              <div className="flex gap-2">
                <button onClick={downloadFile} disabled={!(activeTab === 'feature' ? parsedFiles.feature : parsedFiles.steps)} className="px-3 py-1.5 bg-surface-container-lowest dark:bg-slate-700 text-on-surface dark:text-white border border-outline-variant/30 dark:border-slate-600 rounded text-xs font-bold hover:bg-surface-variant transition-colors disabled:opacity-40">
                  Download {activeTab === 'feature' ? '.feature' : '.java'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer Status Bar ── */}
      <footer className="mt-12 py-8 border-t border-outline-variant/20 flex flex-col md:flex-row justify-between items-center text-sm">
        <div className="flex items-center gap-6 mb-4 md:mb-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connections.jira.status === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
            <span className="text-tertiary font-medium">{connections.jira.status === 'connected' ? 'JIRA API Connected' : 'JIRA Not Connected'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connections.llm.status === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
            <span className="text-tertiary font-medium">{connections.llm.status === 'connected' ? 'Automation Engine Ready' : 'LLM Not Connected'}</span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-secondary font-bold text-sm">
          <span className="hover:underline cursor-pointer">Documentation</span>
          <span className="hover:underline cursor-pointer">Best Practices</span>
          <span className="hover:underline cursor-pointer">Support</span>
        </div>
      </footer>
    </div>
  );
}
