import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

const TP_STORAGE = 'ai_test_plan_state';

// Checks if JIRA issue data has enough substance for test plan generation
function validateIssueCompleteness(data) {
  const missing = [];
  if (!data.summary || data.summary.trim().length < 5) missing.push('Summary');
  if (!data.description || data.description.trim().length < 20) missing.push('Description');
  return missing;
}

export default function TestPlanGenerator({ connections, apiBase }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(TP_STORAGE) || '{}'); } catch { return {}; } })();
  const [ticketId, setTicketId] = useState(saved.ticketId || '');
  const [issueData, setIssueData] = useState(saved.issueData || null);
  const [plan, setPlan] = useState(saved.plan || '');
  const [downloadUrl, setDownloadUrl] = useState(saved.downloadUrl || '');
  const [mdDownloadUrl, setMdDownloadUrl] = useState(saved.mdDownloadUrl || '');
  const [loading, setLoading] = useState('');
  const [context, setContext] = useState(saved.context || '');
  const [inputMode, setInputMode] = useState(saved.inputMode || 'jira'); // 'jira' or 'manual'
  const [manualInput, setManualInput] = useState(saved.manualInput || '');
  const [dataWarning, setDataWarning] = useState(null); // completeness warning

  useEffect(() => {
    try { localStorage.setItem(TP_STORAGE, JSON.stringify({ ticketId, issueData, plan, downloadUrl, mdDownloadUrl, context, inputMode, manualInput })); } catch {}
  }, [ticketId, issueData, plan, downloadUrl, mdDownloadUrl, context, inputMode, manualInput]);

  const fetchPreview = async (skipConfirm = false) => {
    if (!ticketId.trim()) return alert('Enter a JIRA Ticket ID');
    if (connections.jira.status !== 'connected') return alert('Connect to JIRA first in Settings');

    // If there's existing data loaded, warn before overwriting
    if (!skipConfirm && (issueData || plan)) {
      const ok = window.confirm(
        `You already have data loaded${issueData ? ` for ${issueData.id}` : ''}.\n\nSearching a new ticket will clear all existing data including the generated test plan.\n\nDo you want to continue?`
      );
      if (!ok) return;
    }

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
        const err = await res.json().catch(() => ({}));
        const msg = err.detail || 'Fetch failed';
        // Invalid ticket — show error but keep existing data intact
        alert(`Invalid JIRA Ticket: "${ticketId}"\n\n${msg}\n\nYour existing data has not been changed.`);
        setLoading('');
        return;
      }
      const data = await res.json();
      // Valid ticket — clear old data and load new
      setPlan('');
      setDownloadUrl('');
      setMdDownloadUrl('');
      setIssueData(data);
      // Validate completeness
      const missing = validateIssueCompleteness(data);
      if (missing.length > 0) {
        setDataWarning(`⚠ Incomplete JIRA data — missing: ${missing.join(', ')}. The LLM will only use verified facts. Consider adding details in the Additional Context field or use Manual Input mode.`);
      } else {
        setDataWarning(null);
      }
    } catch (e) {
      // Network or server error — keep existing data
      alert(`Could not fetch ticket "${ticketId}":\n${e.message}\n\nYour existing data has not been changed.`);
    }
    setLoading('');
  };

  const generatePlan = async () => {
    if (connections.llm.status !== 'connected') return alert('Connect LLM first in Settings');

    // Build issueData based on input mode
    let dataToSend;
    if (inputMode === 'jira') {
      if (!issueData) return alert('Fetch a JIRA ticket first');
      const missing = validateIssueCompleteness(issueData);
      if (missing.length > 0) {
        const proceed = window.confirm(
          `⚠ Anti-Hallucination Warning\n\nThe JIRA ticket is missing: ${missing.join(', ')}\n\nThe LLM will ONLY use verified facts from the ticket. Missing fields will be marked as "Insufficient information" in the output.\n\nDo you want to proceed anyway?`
        );
        if (!proceed) return;
      }
      dataToSend = { ...issueData, additional_context: context, inputMode: 'jira' };
    } else {
      // Manual mode
      if (!manualInput.trim() || manualInput.trim().length < 20) {
        return alert('Please provide sufficient requirement details in the Manual Input field (at least 20 characters).');
      }
      dataToSend = {
        id: 'MANUAL-INPUT',
        summary: manualInput.substring(0, 120),
        description: manualInput,
        project: 'Manual',
        status: 'N/A',
        additional_context: context,
        inputMode: 'manual',
      };
    }

    setLoading('generate');
    try {
      const res = await fetch(`${apiBase}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueData: dataToSend,
          llm: connections.llm,
          continuation: { type: 'text', maxRounds: 3 },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Generation failed');
      }
      const data = await res.json();
      setPlan(data.plan);
      setDownloadUrl(data.download_url);
      setMdDownloadUrl(data.md_download_url);
    } catch (e) {
      alert(e.message);
    }
    setLoading('');
  };

  const pushToConfluence = () => {
    alert('Confluence publishing will be available once connection settings are configured. Coming soon!');
  };

  return (
    <div className="max-w-6xl mx-auto px-6 pt-12 pb-32">
      {/* Hero */}
      <div className="mb-12">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Test Plan Generator</h1>
        <p className="text-on-surface-variant dark:text-slate-400 max-w-2xl font-medium leading-relaxed mt-3">
          Transform JIRA user stories into comprehensive, machine-readable markdown test plans with editorial precision and automated edge-case detection.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column */}
        <div className="lg:col-span-4 space-y-6">

          {/* Input Mode Toggle */}
          <div className="bg-surface-container-lowest p-4 rounded-lg shadow-sm border border-outline-variant/30">
            <label className="block text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant mb-3">
              Input Source
            </label>
            <div className="flex rounded-sm overflow-hidden border border-outline-variant/30">
              <button
                onClick={() => { setInputMode('jira'); setDataWarning(null); }}
                className={`flex-1 py-2.5 text-[0.8125rem] font-bold flex items-center justify-center gap-2 transition-all ${inputMode === 'jira' ? 'bg-app-red text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container dark:text-slate-400'}`}
              >
                <span className="material-symbols-outlined text-base">confirmation_number</span>
                JIRA Ticket
              </button>
              <button
                onClick={() => { setInputMode('manual'); setDataWarning(null); }}
                className={`flex-1 py-2.5 text-[0.8125rem] font-bold flex items-center justify-center gap-2 transition-all ${inputMode === 'manual' ? 'bg-app-red text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container dark:text-slate-400'}`}
              >
                <span className="material-symbols-outlined text-base">edit_note</span>
                Manual Input
              </button>
            </div>
          </div>

          {/* JIRA Input — only when jira mode */}
          {inputMode === 'jira' && (
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
              {/* Data completeness warning */}
              {dataWarning && (
                <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-sm text-[0.8125rem] text-amber-800 dark:text-amber-300 leading-snug">
                  {dataWarning}
                </div>
              )}
            </div>
          )}

          {/* Manual Requirement Input — only when manual mode */}
          {inputMode === 'manual' && (
            <div className="bg-surface-container-lowest p-6 rounded-lg shadow-sm border border-outline-variant/30">
              <label className="block text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant mb-3">
                Paste Requirement / User Story
              </label>
              <textarea
                className="w-full bg-surface-container-highest border-none rounded-sm px-4 py-3 text-[0.875rem] focus:ring-2 focus:ring-app-red transition-all dark:bg-slate-800 dark:text-white resize-none"
                rows={8}
                placeholder={"Paste your user story, requirement, or acceptance criteria here...\n\nExample:\nAs a user, I want to login with valid credentials on https://www.saucedemo.com/ so that I can access the product inventory.\n\nAcceptance Criteria:\n- Login with standard_user / secret_sauce\n- Verify inventory page loads\n- Handle invalid credentials gracefully"}
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
              />
              <p className="text-[0.75rem] text-secondary mt-2">
                {manualInput.trim().length < 20
                  ? `${20 - manualInput.trim().length} more characters needed`
                  : `✓ ${manualInput.trim().length} characters — sufficient for generation`}
              </p>
            </div>
          )}

          {/* Context */}
          <div className="bg-surface-container-lowest p-6 rounded-lg shadow-sm border border-outline-variant/30">
            <label className="block text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant mb-3">
              Additional Context (Optional)
            </label>
            <textarea
              className="w-full bg-surface-container-highest border-none rounded-sm px-4 py-3 text-[0.875rem] focus:ring-2 focus:ring-app-red transition-all dark:bg-slate-800 dark:text-white resize-none"
              rows={3}
              placeholder="Focus on edge cases for mobile devices..."
              value={context}
              onChange={(e) => setContext(e.target.value)}
            />
          </div>

          {/* Primary Actions */}
          <div className="space-y-3">
            <button
              onClick={generatePlan}
              disabled={!!loading || (inputMode === 'jira' && !issueData) || (inputMode === 'manual' && manualInput.trim().length < 20)}
              className="w-full py-4 bg-app-red hover:bg-app-dark-red text-white rounded-sm font-bold text-[1rem] shadow-md flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50"
            >
              <span className="material-symbols-outlined">description</span>
              {loading === 'generate' ? 'Generating...' : 'Generate Test Plan'}
            </button>
            <button
              onClick={pushToConfluence}
              disabled={!plan}
              className="w-full py-4 bg-surface-container-high text-on-surface dark:text-white rounded-sm font-bold text-[1rem] flex items-center justify-center gap-3 hover:bg-surface-container transition-colors active:scale-95 disabled:opacity-50"
            >
              <span className="material-symbols-outlined">cloud_upload</span>
              Push to Confluence
            </button>
            {(ticketId || issueData || plan || context || manualInput) && (
              <button
                onClick={() => {
                  if (confirm('Clear all data? This will reset the ticket, context, manual input, and generated plan.')) {
                    setTicketId(''); setIssueData(null); setPlan(''); setDownloadUrl(''); setMdDownloadUrl(''); setContext(''); setManualInput(''); setDataWarning(null);
                    try { localStorage.removeItem(TP_STORAGE); } catch {}
                  }
                }}
                disabled={!!loading}
                className="w-full py-3 bg-slate-100 dark:bg-slate-800 text-on-surface dark:text-white rounded-sm font-bold text-[0.875rem] flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-95 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-lg">restart_alt</span>
                Clear All
              </button>
            )}
          </div>

          {/* Export Options */}
          {plan && (
            <div className="bg-surface-container-low p-5 rounded-lg border border-outline-variant/30">
              <h3 className="text-[0.6875rem] font-bold uppercase tracking-widest text-secondary mb-4">Export Options</h3>
              {downloadUrl && (
                <div className="flex items-center justify-between p-3 bg-surface-container-lowest rounded-sm mb-2 border border-outline-variant/20">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-app-red">download</span>
                    <span className="text-[0.875rem] font-bold dark:text-white">Test_Plan.docx</span>
                  </div>
                  <button
                    onClick={() => window.open(`${apiBase}${downloadUrl}`, '_blank')}
                    className="text-app-red text-[0.875rem] font-bold hover:underline"
                  >
                    Download
                  </button>
                </div>
              )}
              {mdDownloadUrl && (
                <div className="flex items-center justify-between p-3 bg-surface-container-lowest rounded-sm border border-outline-variant/20">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-app-red">download</span>
                    <span className="text-[0.875rem] font-bold dark:text-white">Test_Plan.md</span>
                  </div>
                  <button
                    onClick={() => window.open(`${apiBase}${mdDownloadUrl}`, '_blank')}
                    className="text-app-red text-[0.875rem] font-bold hover:underline"
                  >
                    Download
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Preview */}
        <div className="lg:col-span-8">
          <div className="bg-surface-container-lowest rounded-lg shadow-sm min-h-[600px] overflow-hidden flex flex-col border border-outline-variant/30">
            {/* Preview Header */}
            <div className="px-8 py-6 bg-surface-container-low flex justify-between items-center border-b border-outline-variant/20">
              <div className="flex items-center gap-4">
                {issueData && inputMode === 'jira' ? (
                  <>
                    <div className="bg-app-red text-white px-3 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider">
                      Ticket Parsed
                    </div>
                    <h3 className="text-[1rem] font-bold dark:text-white">
                      {issueData.id}: {issueData.summary}
                    </h3>
                  </>
                ) : inputMode === 'manual' && manualInput.trim().length >= 20 ? (
                  <>
                    <div className="bg-blue-600 text-white px-3 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider">
                      Manual Input
                    </div>
                    <h3 className="text-[1rem] font-bold dark:text-white">
                      {manualInput.substring(0, 80)}{manualInput.length > 80 ? '...' : ''}
                    </h3>
                  </>
                ) : (
                  <h3 className="text-[1rem] font-bold text-secondary">
                    {inputMode === 'jira' ? 'No ticket loaded — enter a JIRA ID and search' : 'Enter requirement details in the Manual Input field'}
                  </h3>
                )}
              </div>
              {plan && (
                <div className="flex gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(plan)}
                    className="p-2 hover:bg-surface-variant rounded-full transition-colors"
                    title="Copy to clipboard"
                  >
                    <span className="material-symbols-outlined text-secondary text-sm">content_copy</span>
                  </button>
                </div>
              )}
            </div>

            {/* Content Canvas */}
            <div className="p-10 flex-grow font-mono text-[0.875rem] leading-relaxed text-on-surface-variant bg-surface-container-lowest overflow-y-auto max-h-[700px]">
              {loading === 'generate' ? (
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <span className="material-symbols-outlined text-5xl text-app-red animate-spin-slow">settings</span>
                  <p className="font-bold text-on-surface dark:text-white">Generating Test Plan...</p>
                  <p className="text-secondary text-sm">Using {connections.llm.platform} LLM</p>
                </div>
              ) : plan ? (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{plan}</ReactMarkdown>
                </div>
              ) : issueData && inputMode === 'jira' ? (
                <div className="space-y-6">
                  <section>
                    <h2 className="text-[1rem] font-bold text-app-red mb-2 uppercase tracking-wide">Ticket Details</h2>
                    <div className="space-y-3">
                      <p><strong>Project:</strong> {issueData.project}</p>
                      <p><strong>Status:</strong> {issueData.status}</p>
                      <p><strong>Summary:</strong> {issueData.summary}</p>
                    </div>
                  </section>
                  <section>
                    <h2 className="text-[1rem] font-bold text-app-red mb-2 uppercase tracking-wide">Description</h2>
                    <p className="whitespace-pre-wrap">{issueData.description || <span className="text-amber-500 italic">No description found in JIRA ticket — consider adding details via Additional Context or Manual Input.</span>}</p>
                  </section>
                  {dataWarning && (
                    <section className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-sm">
                      <h2 className="text-[0.875rem] font-bold text-amber-700 dark:text-amber-300 mb-1">⚠ Data Completeness Check</h2>
                      <p className="text-[0.8125rem] text-amber-800 dark:text-amber-300">{dataWarning}</p>
                    </section>
                  )}
                </div>
              ) : inputMode === 'manual' && manualInput.trim().length >= 20 ? (
                <div className="space-y-6">
                  <section>
                    <h2 className="text-[1rem] font-bold text-blue-600 mb-2 uppercase tracking-wide">Manual Requirement</h2>
                    <p className="whitespace-pre-wrap">{manualInput}</p>
                  </section>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4 opacity-40">
                  <span className="material-symbols-outlined text-6xl">assignment</span>
                  <p className="font-bold text-lg">Test Plan Canvas</p>
                  <p className="text-sm max-w-sm">
                    {inputMode === 'jira'
                      ? 'Fetch a JIRA ticket to preview requirements, then generate a professional test plan.'
                      : 'Paste your requirement in the Manual Input field, then generate a professional test plan.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
