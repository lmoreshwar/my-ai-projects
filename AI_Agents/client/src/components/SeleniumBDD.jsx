import { useState } from 'react';

const GHERKIN_SYSTEM_PROMPT = `# BDD + AUTOMATION SCRIPT GENERATION PROMPT

## Objective
You are a **Senior QA Automation Engineer / QA Lead**.
Your task is to generate **BDD (Gherkin) scenarios and executable automation scripts** based strictly on the provided input.

## Input
You will receive one or more of the following:
- JIRA User Story / JIRA ID
- Requirement Document
- Test Plan
- Existing Test Cases

## Configuration
- Automation Framework: Selenium
- Language: Java (Cucumber BDD)
- BDD Required: Yes

## CRITICAL OUTPUT FORMAT RULES
- Output ONLY plain text code — NO HTML tags, NO CSS classes, NO syntax highlighting markup
- Do NOT include patterns like: "text-[#...]">  or <span class="..."> or any HTML/CSS artifacts
- Do NOT wrap code in HTML elements or include any Tailwind/CSS class names in the output
- Output must be raw, executable .java/.feature code that can compile and run directly
- The output should be copy-paste ready — no cleanup required by the user

## Strict Rules (MANDATORY)
- Do NOT assume functionality not present in input
- Do NOT add extra features
- Do NOT generate pseudo code
- Do NOT leave incomplete steps
- Generate runnable, production-ready code
- Use real selectors (generic but valid)
- Follow framework best practices
- Keep scripts clean and modular

## Instructions
1. Analyze the input carefully
2. Identify key user flows
3. Convert flows into:
   - BDD Scenarios (Gherkin .feature files)
   - Step Definition stubs (Selenium + Cucumber)
4. Ensure:
   - Positive scenarios
   - Negative scenarios (only if applicable)

## Output Structure

### 1. Feature File (BDD - Gherkin)
Follow standard Gherkin syntax: Feature, Scenario, Scenario Outline, Given/When/Then/And/But
Use clear, business-readable language.
Include Scenario Outlines with Examples where applicable.
Add tags like @TC-ID, @smoke, @regression where appropriate.
Cover: happy path, negative scenarios, edge cases, validation.
If info is missing, note it as a comment: # [NOT SPECIFIED]

### 2. Step Definitions (Selenium + Cucumber Java)
Provide corresponding step definition methods for each Given/When/Then step.
Use Selenium WebDriver API with Page Object pattern.

Return the .feature file content followed by the step definitions. Use proper code blocks.`;

export default function SeleniumBDD({ connections, apiBase, generatedTestCases, seleniumOutput, setSeleniumOutput }) {
  const [ticketId, setTicketId] = useState('');
  const [manualReq, setManualReq] = useState('');
  const [selectedImported, setSelectedImported] = useState('');
  const gherkinOutput = seleniumOutput || '';
  const setGherkinOutput = setSeleniumOutput;
  const [busy, setBusy] = useState('');
  const [issueData, setIssueData] = useState(null);

  /* ── Parse generated test cases from Create Test Cases page ── */
  const getTestCaseOptions = () => {
    if (!generatedTestCases) return [];
    const lines = generatedTestCases.split('\n').filter(l => l.trim().startsWith('|'));
    const options = [];
    lines.forEach(line => {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 2 && /^TC[_-]\d+/i.test(cols[0])) {
        options.push({ id: cols[0], title: cols[1] });
      }
    });
    return options;
  };

  /* ── When user selects an imported test case, pre-populate manual req ── */
  const handleImportedSelect = (val) => {
    setSelectedImported(val);
    if (val) {
      setManualReq(prev => prev ? prev + '\n\n' + val : val);
    }
  };

  /* ── Fetch from JIRA ── */
  const fetchJira = async () => {
    if (!ticketId.trim()) return;
    if (connections.jira.status !== 'connected') return alert('Connect to JIRA first in Connection Settings');
    setBusy('fetch');
    try {
      const r = await fetch(`${apiBase}/fetch-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jira: connections.jira,
          productName: ticketId,
          projectKey: ticketId.split('-')[0],
          sprint: ticketId,
          context: '',
        }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || 'Fetch failed');
      const data = await r.json();
      setIssueData(data);
      setManualReq(data.description || '');
    } catch (e) { alert(e.message); }
    setBusy('');
  };

  /* ── Generate Gherkin via LLM ── */
  const generateGherkin = async () => {
    const input = manualReq.trim();
    if (!input && !issueData && !selectedImported) return alert('Provide a requirement, fetch from JIRA, or select a test case');
    if (connections.llm.status !== 'connected') return alert('Connect to LLM first in Connection Settings');
    setBusy('generate');
    try {
      let ctx = '';
      if (issueData) ctx += `JIRA ID: ${issueData.id}\nSummary: ${issueData.summary}\n\n`;
      if (selectedImported) ctx += `Selected Test Case: ${selectedImported}\n\n`;
      if (input) ctx += input;

      const r = await fetch(`${apiBase}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueData: {
            product: 'Selenium BDD',
            id: issueData?.id || 'Manual',
            summary: issueData?.summary || 'Manual',
            description: ctx,
            additional_context: GHERKIN_SYSTEM_PROMPT,
          },
          llm: connections.llm,
          continuation: { type: 'code', maxRounds: 3 },
        }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || 'Generation failed');
      const data = await r.json();
      setGherkinOutput(data.plan);
    } catch (e) { alert(e.message); }
    setBusy('');
  };

  /* ── Download .feature file ── */
  const downloadFeature = () => {
    if (!gherkinOutput) return;
    const blob = new Blob([gherkinOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${issueData?.id || 'feature'}.feature`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyOutput = () => { if (gherkinOutput) navigator.clipboard.writeText(gherkinOutput); };

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

  const hasInput = !!issueData || manualReq.trim().length > 0 || !!selectedImported;
  const tcOptions = getTestCaseOptions();

  return (
    <div className="max-w-6xl mx-auto space-y-8 px-6 pt-8 pb-16">
      {/* ── Header ── */}
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-secondary font-semibold text-sm uppercase tracking-wider">
          <span className="material-symbols-outlined text-sm">auto_awesome</span>
          AI-POWERED ARCHITECT
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Selenium BDD Generator</h1>
        <p className="text-on-surface-variant dark:text-slate-400 max-w-2xl font-medium leading-relaxed">
          Accelerate your quality engineering workflow by automatically generating Gherkin feature files from JIRA requirements or manual input.
        </p>
      </header>

      <div className="grid grid-cols-12 gap-8">
        {/* ══════════════ Left Column: Inputs ══════════════ */}
        <div className="col-span-12 lg:col-span-7 space-y-6">

          {/* ── Card 1: Select Imported Test Cases ── */}
          <section className="bg-surface-container-low dark:bg-slate-900 rounded-xl p-6 border border-transparent shadow-sm">
            <h3 className="text-on-surface dark:text-white font-bold mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">history</span>
              Select Imported Test Cases
            </h3>
            <div className="relative">
              <select
                className="w-full bg-surface-container-highest dark:bg-slate-800 border-b-2 border-app-red focus:ring-0 focus:border-app-dark-red px-4 py-3 rounded-t-md text-on-surface dark:text-white font-medium appearance-none cursor-pointer"
                value={selectedImported}
                onChange={(e) => handleImportedSelect(e.target.value)}
              >
                <option value="">Choose a previously imported test case...</option>
                {tcOptions.map((tc) => (
                  <option key={tc.id} value={`${tc.id}: ${tc.title}`}>
                    {tc.id}: {tc.title}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-on-surface-variant">expand_more</span>
              </div>
              <label className="absolute -top-2 left-2 px-1 bg-surface-container-low dark:bg-slate-900 text-[10px] uppercase tracking-widest text-app-red font-bold">
                Existing Test Cases
              </label>
            </div>
            {selectedImported && (
              <div className="mt-3 p-2.5 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <p className="text-xs text-green-700 dark:text-green-400 font-semibold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  Selected: {selectedImported}
                </p>
              </div>
            )}
            {tcOptions.length === 0 && (
              <p className="mt-2 text-[10px] text-on-surface-variant/70 italic px-1">
                No test cases imported yet. Generate test cases from the "Create Test Cases" page first.
              </p>
            )}
          </section>

          {/* ── Card 2: Import from JIRA ── */}
          <section className="bg-surface-container-low dark:bg-slate-900 p-6 rounded-xl border border-transparent shadow-sm">
            <h3 className="text-on-surface dark:text-white font-bold mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">confirmation_number</span>
              Import from JIRA
            </h3>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <input
                  className="w-full bg-surface-container-highest dark:bg-slate-800 border-b-2 border-app-red focus:ring-0 focus:border-app-dark-red px-4 py-3 rounded-t-md text-on-surface dark:text-white font-medium placeholder-on-surface-variant/50"
                  placeholder="e.g. QA-1234"
                  type="text"
                  value={ticketId}
                  onChange={(e) => setTicketId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchJira()}
                />
                <label className="absolute -top-2 left-2 px-1 bg-surface-container-low dark:bg-slate-900 text-[10px] uppercase tracking-widest text-app-red font-bold">
                  JIRA Ticket ID
                </label>
              </div>
              <button
                onClick={fetchJira}
                disabled={busy === 'fetch'}
                className="bg-secondary text-white px-6 py-3 rounded-lg font-bold hover:bg-secondary/80 transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-sm">download</span>
                {busy === 'fetch' ? 'Fetching...' : 'Fetch & Parse'}
              </button>
            </div>
            {issueData && (
              <div className="mt-3 p-2.5 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                <p className="text-xs text-green-700 dark:text-green-400 font-semibold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  {issueData.id} — {issueData.summary}
                </p>
              </div>
            )}
          </section>

          {/* ── Card 3: Manual Requirement Text ── */}
          <section className="bg-surface-container-low dark:bg-slate-900 p-6 rounded-xl border border-transparent shadow-sm">
            <h3 className="text-on-surface dark:text-white font-bold mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">description</span>
              Manual Requirement Text
            </h3>
            <div className="relative">
              <textarea
                className="w-full bg-surface-container-highest dark:bg-slate-800 border-b-2 border-app-red focus:ring-0 focus:border-app-dark-red px-4 py-3 rounded-t-md text-on-surface dark:text-white font-medium placeholder-on-surface-variant/50 resize-none"
                placeholder="Enter feature requirements, user stories, or acceptance criteria here..."
                rows={8}
                value={manualReq}
                onChange={(e) => setManualReq(e.target.value)}
              />
              <label className="absolute -top-2 left-2 px-1 bg-surface-container-low dark:bg-slate-900 text-[10px] uppercase tracking-widest text-app-red font-bold">
                Requirement Specification
              </label>
            </div>
          </section>

          {/* ── Generate Button ── */}
          <div className="pt-4">
            <button
              onClick={generateGherkin}
              disabled={busy === 'generate' || !hasInput}
              className="w-full bg-gradient-to-r from-app-red to-app-dark-red text-white py-4 rounded-xl font-black text-lg shadow-lg hover:shadow-app-red/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-50"
            >
              <span className="material-symbols-outlined">auto_awesome</span>
              {busy === 'generate' ? 'Generating...' : 'Generate Gherkin Feature File'}
            </button>
          </div>
        </div>

        {/* ══════════════ Right Column: Gherkin Preview ══════════════ */}
        <div className="col-span-12 lg:col-span-5">
          <div className="sticky top-24 bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant/10 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden flex flex-col h-[calc(100vh-250px)] min-h-[500px]">
            {/* Preview Header */}
            <div className="bg-surface-container-highest dark:bg-slate-800 px-4 py-3 flex justify-between items-center border-b border-outline-variant/20">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5 mr-4">
                  <span className="w-3 h-3 rounded-full bg-red-400" />
                  <span className="w-3 h-3 rounded-full bg-yellow-400" />
                  <span className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <span className="text-xs font-bold text-tertiary-container dark:text-slate-400 uppercase tracking-widest">Gherkin Preview</span>
              </div>
              <button onClick={copyOutput} className="text-secondary hover:text-app-red transition-colors" title="Copy">
                <span className="material-symbols-outlined text-lg">content_copy</span>
              </button>
            </div>

            {/* Preview Content */}
            <div className="flex-1 p-6 overflow-auto bg-[#fafafa] dark:bg-slate-950 font-mono text-sm leading-relaxed">
              {busy === 'generate' ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-secondary">
                  <div className="w-8 h-8 border-3 border-app-red/30 border-t-app-red rounded-full animate-spin" />
                  <span className="text-xs font-semibold">Generating Gherkin...</span>
                </div>
              ) : gherkinOutput ? (
                <pre className="whitespace-pre-wrap">{highlightGherkin(gherkinOutput)}</pre>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-secondary/50">
                  <span className="material-symbols-outlined text-4xl">code</span>
                  <p className="text-xs font-medium">Gherkin output will appear here</p>
                </div>
              )}
            </div>

            {/* Preview Footer */}
            <div className="bg-surface-container-high dark:bg-slate-800 p-4 flex justify-between items-center border-t border-outline-variant/20">
              <span className="text-[10px] text-tertiary dark:text-slate-500 font-bold uppercase tracking-widest">v2.4 Engine Active</span>
              <div className="flex gap-2">
                <button onClick={downloadFeature} disabled={!gherkinOutput} className="px-3 py-1.5 bg-surface-container-lowest dark:bg-slate-700 text-on-surface dark:text-white border border-outline-variant/30 dark:border-slate-600 rounded text-xs font-bold hover:bg-surface-variant transition-colors disabled:opacity-40">
                  Download .feature
                </button>
                <button disabled={!gherkinOutput} className="px-3 py-1.5 bg-secondary text-white rounded text-xs font-bold hover:bg-on-secondary-container transition-colors disabled:opacity-40" onClick={() => alert('Export to Selenium runner — coming soon!')}>
                  Export to Selenium
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
