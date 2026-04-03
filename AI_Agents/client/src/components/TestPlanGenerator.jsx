import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

const TP_STORAGE = 'ai_test_plan_state';

export default function TestPlanGenerator({ connections, apiBase }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(TP_STORAGE) || '{}'); } catch { return {}; } })();
  const [ticketId, setTicketId] = useState(saved.ticketId || '');
  const [issueData, setIssueData] = useState(saved.issueData || null);
  const [plan, setPlan] = useState(saved.plan || '');
  const [downloadUrl, setDownloadUrl] = useState(saved.downloadUrl || '');
  const [mdDownloadUrl, setMdDownloadUrl] = useState(saved.mdDownloadUrl || '');
  const [loading, setLoading] = useState('');
  const [context, setContext] = useState(saved.context || '');

  useEffect(() => {
    try { localStorage.setItem(TP_STORAGE, JSON.stringify({ ticketId, issueData, plan, downloadUrl, mdDownloadUrl, context })); } catch {}
  }, [ticketId, issueData, plan, downloadUrl, mdDownloadUrl, context]);

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
      const data = await res.json();
      setIssueData(data);
    } catch (e) {
      alert(e.message);
    }
    setLoading('');
  };

  const generatePlan = async () => {
    if (!issueData) return alert('Fetch a ticket first');
    if (connections.llm.status !== 'connected') return alert('Connect LLM first in Settings');
    setLoading('generate');
    try {
      const res = await fetch(`${apiBase}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueData: { ...issueData, additional_context: context },
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
          {/* JIRA Input */}
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
              onClick={fetchPreview}
              disabled={!!loading}
              className="w-full py-4 bg-app-red hover:bg-app-dark-red text-white rounded-sm font-bold text-[1rem] shadow-md flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50"
            >
              <span className="material-symbols-outlined">bolt</span>
              {loading === 'fetch' ? 'Fetching...' : 'Fetch Preview'}
            </button>
            <button
              onClick={generatePlan}
              disabled={!!loading || !issueData}
              className="w-full py-4 bg-surface-container-high text-on-surface dark:text-white rounded-sm font-bold text-[1rem] flex items-center justify-center gap-3 hover:bg-surface-container transition-colors active:scale-95 disabled:opacity-50"
            >
              <span className="material-symbols-outlined">description</span>
              {loading === 'generate' ? 'Generating...' : 'Generate .md Plan'}
            </button>
            <button
              onClick={pushToConfluence}
              disabled={!plan}
              className="w-full py-4 bg-surface-container-high text-on-surface dark:text-white rounded-sm font-bold text-[1rem] flex items-center justify-center gap-3 hover:bg-surface-container transition-colors active:scale-95 disabled:opacity-50"
            >
              <span className="material-symbols-outlined">cloud_upload</span>
              Push to Confluence
            </button>
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
                {issueData ? (
                  <>
                    <div className="bg-app-red text-white px-3 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider">
                      Ticket Parsed
                    </div>
                    <h3 className="text-[1rem] font-bold dark:text-white">
                      {issueData.id}: {issueData.summary}
                    </h3>
                  </>
                ) : (
                  <h3 className="text-[1rem] font-bold text-secondary">
                    No ticket loaded — enter a JIRA ID and click Fetch
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
              ) : issueData ? (
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
                    <p className="whitespace-pre-wrap">{issueData.description}</p>
                  </section>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4 opacity-40">
                  <span className="material-symbols-outlined text-6xl">assignment</span>
                  <p className="font-bold text-lg">Test Plan Canvas</p>
                  <p className="text-sm max-w-sm">Fetch a JIRA ticket to preview requirements, then generate a professional test plan.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
