import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

/* ── Test Scenario Generation System Prompt (from testcases_scenarios.md) ── */
const SCENARIO_SYSTEM_PROMPT = `You are an experienced QA Engineer. Your task is to generate test scenarios ONLY based strictly on the provided input.

## Input
You will receive ONE or MORE of the following:
- JIRA User Story / JIRA ID details
- Requirement Document
- Test Plan
- Custom Requirement Description

## Strict Rules (MANDATORY)
- Do NOT generate test cases (no steps, no expected results)
- Do NOT assume or invent features not mentioned in input
- Do NOT go outside the provided scope
- Do NOT include implementation details
- Do NOT add generic or unrelated scenarios
- ONLY use the given information
- Stay strictly aligned to requirements
- If something is unclear or missing → highlight it instead of assuming

## Instructions
1. Carefully analyze the input
2. Identify all functional flows mentioned
3. Break down into logical user scenarios
4. Include:
   - Positive scenarios
   - Negative scenarios (only if implied in requirement)
   - Boundary scenarios (only if data constraints are given)

## Output Format

### Feature / Story Name:
<Extracted from input>

---

### Test Scenarios List

1. Verify that user can <action>
2. Verify that system behaves correctly when <condition>
3. Verify error handling for <invalid condition>
4. Verify boundary behavior for <limit condition>

---

## Missing or Ambiguous Requirements

- List any unclear or missing details:
  - Missing validation rules
  - Missing edge cases
  - Missing constraints

## Guidelines
- Keep scenarios clear, concise, and functional
- Each scenario should represent one validation point
- Avoid duplication
- Maintain QA standard wording ("Verify that...")

## Expected Output
A clean, requirement-aligned list of test scenarios that:
- Covers all defined functionality
- Does NOT go beyond input scope
- Can be directly used for test case creation`;

const TS_STORAGE = 'ai_test_scenario_state';

export default function TestScenarioGenerator({ connections, apiBase }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(TS_STORAGE) || '{}'); } catch { return {}; } })();
  const [ticketId, setTicketId] = useState(saved.ticketId || '');
  const [issueData, setIssueData] = useState(saved.issueData || null);
  const [manualReq, setManualReq] = useState(saved.manualReq || '');
  const [scenarios, setScenarios] = useState(saved.scenarios || '');
  const [loading, setLoading] = useState('');
  const [context, setContext] = useState(saved.context || '');

  useEffect(() => {
    try { localStorage.setItem(TS_STORAGE, JSON.stringify({ ticketId, issueData, manualReq, scenarios, context })); } catch {}
  }, [ticketId, issueData, manualReq, scenarios, context]);

  const fetchPreview = async () => {
    if (!ticketId.trim()) return alert('Enter a JIRA Ticket ID');
    if (connections.jira.status !== 'connected') return alert('Connect to JIRA first in Settings');
    setLoading('fetch');
    try {
      const res = await fetch(`${apiBase}/fetch-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jira: connections.jira,
          productName: '',
          projectKey: ticketId.split('-')[0],
          sprint: ticketId,
          context,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Fetch failed');
      }
      setIssueData(await res.json());
    } catch (e) {
      alert(e.message);
    }
    setLoading('');
  };

  const hasInput = !!issueData || manualReq.trim().length > 0;

  const generateScenarios = async () => {
    if (!hasInput) return alert('Fetch a JIRA ticket or provide a manual requirement first');
    if (connections.llm.status !== 'connected') return alert('Connect LLM first in Settings');
    setLoading('generate');
    try {
      // Build requirement context
      let reqDescription = '';
      if (issueData) {
        reqDescription += `## JIRA User Story\n- ID: ${issueData.id}\n- Summary: ${issueData.summary}\n- Project: ${issueData.project}\n- Status: ${issueData.status}\n- Description:\n${issueData.description}\n\n`;
      }
      if (manualReq.trim()) {
        reqDescription += `## Custom Requirement Description\n${manualReq}\n\n`;
      }
      if (context.trim()) {
        reqDescription += `## Additional Context\n${context}\n\n`;
      }

      const res = await fetch(`${apiBase}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueData: {
            product: issueData?.project || 'N/A',
            id: issueData?.id || 'Manual',
            summary: issueData?.summary || 'Manual Requirement',
            description: reqDescription,
            additional_context: SCENARIO_SYSTEM_PROMPT,
          },
          llm: connections.llm,
          continuation: { type: 'list', minItems: 20, maxRounds: 3 },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Generation failed');
      }
      const data = await res.json();
      setScenarios(data.plan);
    } catch (e) {
      alert(e.message);
    }
    setLoading('');
  };

  const uploadToZephyr = () => {
    alert('Zephyr upload will be available once API key is configured. This feature is coming soon!');
  };

  return (
    <div className="max-w-6xl mx-auto px-6 pt-12 pb-32">
      <div className="mb-12">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Test Scenario Generator</h1>
        <p className="text-on-surface-variant dark:text-slate-400 max-w-2xl font-medium leading-relaxed mt-3">
          Generate high-level test scenarios from JIRA requirements covering functional, integration, and edge-case dimensions.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface-container-lowest p-6 rounded-lg shadow-sm border border-outline-variant/30">
            <label className="block text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant mb-3">
              Target JIRA Ticket ID
            </label>
            <div className="flex gap-2">
              <input
                className="w-full bg-surface-container-highest border-none rounded-sm px-4 py-3 text-[0.875rem] focus:ring-2 focus:ring-app-red transition-all dark:bg-slate-800 dark:text-white"
                placeholder="QA-8429"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
              />
              <button
                onClick={fetchPreview}
                disabled={loading === 'fetch'}
                className="bg-surface-container-high text-app-red px-4 py-2 rounded-sm hover:bg-surface-container transition-colors flex items-center justify-center disabled:opacity-50"
              >
                <span className="material-symbols-outlined">search</span>
              </button>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-lg shadow-sm border border-outline-variant/30">
            <label className="block text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant mb-3">
              Manual Requirement / PRD
            </label>
            <textarea
              className="w-full bg-surface-container-highest border-none rounded-sm px-4 py-3 text-[0.875rem] focus:ring-2 focus:ring-app-red transition-all dark:bg-slate-800 dark:text-white resize-none"
              rows={5}
              placeholder="Paste requirement text, user stories, acceptance criteria..."
              value={manualReq}
              onChange={(e) => setManualReq(e.target.value)}
            />
          </div>

          <div className="bg-surface-container-lowest p-6 rounded-lg shadow-sm border border-outline-variant/30">
            <label className="block text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant mb-3">
              Additional Context (Optional)
            </label>
            <textarea
              className="w-full bg-surface-container-highest border-none rounded-sm px-4 py-3 text-[0.875rem] focus:ring-2 focus:ring-app-red transition-all dark:bg-slate-800 dark:text-white resize-none"
              rows={3}
              placeholder="Include performance and security scenarios..."
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <button onClick={fetchPreview} disabled={!!loading} className="w-full py-4 bg-app-red hover:bg-app-dark-red text-white rounded-sm font-bold text-[1rem] shadow-md flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50">
              <span className="material-symbols-outlined">bolt</span>
              {loading === 'fetch' ? 'Fetching...' : 'Fetch Preview'}
            </button>
            <button onClick={generateScenarios} disabled={!!loading || !hasInput} className="w-full py-4 bg-surface-container-high text-on-surface dark:text-white rounded-sm font-bold text-[1rem] flex items-center justify-center gap-3 hover:bg-surface-container transition-colors active:scale-95 disabled:opacity-50">
              <span className="material-symbols-outlined">schema</span>
              {loading === 'generate' ? 'Generating...' : 'Generate Scenarios'}
            </button>
            <button onClick={uploadToZephyr} disabled={!scenarios} className="w-full py-4 bg-surface-container-high text-on-surface dark:text-white rounded-sm font-bold text-[1rem] flex items-center justify-center gap-3 hover:bg-surface-container transition-colors active:scale-95 disabled:opacity-50">
              <span className="material-symbols-outlined">cloud_upload</span>
              Upload to Zephyr
            </button>
          </div>
        </div>

        <div className="lg:col-span-8">
          <div className="bg-surface-container-lowest rounded-lg shadow-sm min-h-[600px] overflow-hidden flex flex-col border border-outline-variant/30">
            <div className="px-8 py-6 bg-surface-container-low flex justify-between items-center border-b border-outline-variant/20">
              <div className="flex items-center gap-4">
                {issueData ? (
                  <>
                    <div className="bg-app-red text-white px-3 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider">Ticket Parsed</div>
                    <h3 className="text-[1rem] font-bold dark:text-white">{issueData.id}: {issueData.summary}</h3>
                  </>
                ) : (
                  <h3 className="text-[1rem] font-bold text-secondary">No ticket loaded</h3>
                )}
              </div>
              {scenarios && (
                <button onClick={() => navigator.clipboard.writeText(scenarios)} className="p-2 hover:bg-surface-variant rounded-full transition-colors" title="Copy">
                  <span className="material-symbols-outlined text-secondary text-sm">content_copy</span>
                </button>
              )}
            </div>
            <div className="p-10 flex-grow font-mono text-[0.875rem] leading-relaxed text-on-surface-variant bg-surface-container-lowest overflow-y-auto max-h-[700px]">
              {loading === 'generate' ? (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <span className="material-symbols-outlined text-5xl text-app-red animate-spin-slow">settings</span>
                  <p className="font-bold text-on-surface dark:text-white">Generating Scenarios...</p>
                </div>
              ) : scenarios ? (
                <div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown>{scenarios}</ReactMarkdown></div>
              ) : issueData ? (
                <div className="space-y-6">
                  <section>
                    <h2 className="text-[1rem] font-bold text-app-red mb-2 uppercase tracking-wide">Ticket Details</h2>
                    <p><strong>Project:</strong> {issueData.project}</p>
                    <p><strong>Status:</strong> {issueData.status}</p>
                    <p><strong>Summary:</strong> {issueData.summary}</p>
                  </section>
                  <section>
                    <h2 className="text-[1rem] font-bold text-app-red mb-2 uppercase tracking-wide">Description</h2>
                    <p className="whitespace-pre-wrap">{issueData.description}</p>
                  </section>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4 opacity-40">
                  <span className="material-symbols-outlined text-6xl">schema</span>
                  <p className="font-bold text-lg">Scenario Canvas</p>
                  <p className="text-sm max-w-sm">Fetch a JIRA ticket to generate high-level test scenarios.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
