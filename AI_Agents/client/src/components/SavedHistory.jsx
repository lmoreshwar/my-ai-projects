import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { listArtifacts, loadArtifact, deleteArtifact } from '../utils/artifactService';

const TYPE_META = {
  'test-plan':       { label: 'Test Plan',       icon: 'assignment',   color: 'bg-blue-500' },
  'test-cases':      { label: 'Test Cases',      icon: 'edit_note',    color: 'bg-app-red' },
  'test-scenarios':  { label: 'Test Scenarios',   icon: 'schema',       color: 'bg-purple-500' },
  'test-review':     { label: 'Test Review',      icon: 'fact_check',   color: 'bg-amber-500' },
  'selenium-bdd':    { label: 'Selenium BDD',     icon: 'code',         color: 'bg-orange-500' },
  'playwright-js':   { label: 'Playwright BDD',   icon: 'code_blocks',  color: 'bg-teal-500' },
  'playwright-pom':  { label: 'Playwright POM',   icon: 'account_tree', color: 'bg-indigo-500' },
};

export default function SavedHistory({ apiBase }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [selected, setSelected] = useState(null);   // full artifact object
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeFileIdx, setActiveFileIdx] = useState(0);

  /* ── Load artifact list ── */
  const fetchList = async () => {
    setLoading(true);
    try {
      const data = await listArtifacts(apiBase, filterType || undefined);
      setArtifacts(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchList(); }, [filterType]);

  /* ── Load full artifact ── */
  const openArtifact = async (id) => {
    setLoadingDetail(true);
    setActiveFileIdx(0);
    try {
      const data = await loadArtifact(apiBase, id);
      setSelected(data);
    } catch (e) { alert('Failed to load: ' + e.message); }
    setLoadingDetail(false);
  };

  /* ── Delete ── */
  const handleDelete = async (id) => {
    if (!confirm('Delete this saved item permanently?')) return;
    try {
      await deleteArtifact(apiBase, id);
      setArtifacts(prev => prev.filter(a => a._id !== id));
      if (selected?._id === id) setSelected(null);
    } catch (e) { alert('Delete failed: ' + e.message); }
  };

  /* ── Copy content ── */
  const copyContent = () => {
    if (!selected) return;
    const text = selected.content || selected.files?.map(f => `// ${f.path}\n${f.content}`).join('\n\n') || '';
    navigator.clipboard.writeText(text);
  };

  const meta = (type) => TYPE_META[type] || { label: type, icon: 'description', color: 'bg-slate-500' };

  return (
    <div className="px-6 pt-28 pb-12 max-w-screen-xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-black text-on-surface dark:text-white tracking-tight">Saved History</h1>
          <p className="text-sm text-tertiary dark:text-slate-400 mt-1">Browse and review your previously saved test plans, test cases, reviews, and automation scripts.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filterType}
            onChange={(e) => { setFilterType(e.target.value); setSelected(null); }}
            className="px-4 py-2.5 bg-white dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-600 rounded-lg text-sm font-bold text-on-surface dark:text-white focus:ring-2 focus:ring-app-red outline-none"
          >
            <option value="">All Types</option>
            {Object.entries(TYPE_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <button onClick={fetchList} className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            <span className="material-symbols-outlined text-base align-middle">refresh</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* ── Left: List ── */}
        <div className="col-span-12 lg:col-span-4 space-y-3 max-h-[calc(100vh-220px)] overflow-y-auto pr-2">
          {loading ? (
            <div className="text-center py-12 text-tertiary dark:text-slate-500">
              <span className="material-symbols-outlined text-4xl animate-spin">progress_activity</span>
              <p className="mt-2 text-sm font-bold">Loading...</p>
            </div>
          ) : artifacts.length === 0 ? (
            <div className="text-center py-12">
              <span className="material-symbols-outlined text-5xl text-tertiary dark:text-slate-600">inventory_2</span>
              <p className="mt-3 text-sm font-bold text-tertiary dark:text-slate-500">No saved items yet</p>
              <p className="text-xs text-tertiary dark:text-slate-600 mt-1">Generate test plans, cases, or automation and click "Save to Database"</p>
            </div>
          ) : (
            artifacts.map((a) => {
              const m = meta(a.type);
              const isSelected = selected?._id === a._id;
              return (
                <div
                  key={a._id}
                  onClick={() => openArtifact(a._id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all group ${
                    isSelected
                      ? 'bg-app-red/5 dark:bg-app-red/10 border-app-red/30 ring-2 ring-app-red/20'
                      : 'bg-white dark:bg-slate-800 border-outline-variant/20 dark:border-slate-700 hover:border-app-red/20 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 ${m.color} rounded-lg flex items-center justify-center flex-shrink-0`}>
                      <span className="material-symbols-outlined text-white text-lg">{m.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-on-surface dark:text-white truncate">{a.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-tertiary dark:text-slate-500">{m.label}</span>
                        <span className="text-[10px] text-tertiary dark:text-slate-600">•</span>
                        <span className="text-[10px] text-tertiary dark:text-slate-500">{new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {a.metadata?.overallCoverage && (
                        <span className="inline-block mt-1.5 text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                          Coverage: {a.metadata.overallCoverage}%
                        </span>
                      )}
                      {a.metadata?.totalCases && (
                        <span className="inline-block mt-1.5 ml-1 text-[10px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">
                          {a.metadata.totalCases} test cases
                        </span>
                      )}
                      {a.metadata?.fileCount && (
                        <span className="inline-block mt-1.5 ml-1 text-[10px] font-bold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded-full">
                          {a.metadata.fileCount} files
                        </span>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(a._id); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-slate-400 hover:text-red-500"
                      title="Delete"
                    >
                      <span className="material-symbols-outlined text-lg">delete</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Right: Detail Preview ── */}
        <div className="col-span-12 lg:col-span-8">
          {loadingDetail ? (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-outline-variant/20 dark:border-slate-700 min-h-[500px] flex items-center justify-center">
              <div className="text-center">
                <span className="material-symbols-outlined text-4xl animate-spin text-app-red">progress_activity</span>
                <p className="mt-2 text-sm font-bold text-tertiary dark:text-slate-400">Loading content...</p>
              </div>
            </div>
          ) : selected ? (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-outline-variant/20 dark:border-slate-700 overflow-hidden">
              {/* Detail Header */}
              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-b border-outline-variant/20 dark:border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 ${meta(selected.type).color} rounded-lg flex items-center justify-center`}>
                    <span className="material-symbols-outlined text-white text-base">{meta(selected.type).icon}</span>
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-on-surface dark:text-white">{selected.title}</h2>
                    <p className="text-[10px] text-tertiary dark:text-slate-500">{meta(selected.type).label} • Saved {new Date(selected.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={copyContent} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 rounded text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors" title="Copy to clipboard">
                    <span className="material-symbols-outlined text-sm align-middle mr-1">content_copy</span>Copy
                  </button>
                  <button onClick={() => handleDelete(selected._id)} className="px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
                    <span className="material-symbols-outlined text-sm align-middle mr-1">delete</span>Delete
                  </button>
                </div>
              </div>

              {/* Content area */}
              <div className="p-6 max-h-[calc(100vh-320px)] overflow-y-auto">
                {/* Files view (for automation types) */}
                {selected.files && selected.files.length > 0 ? (
                  <div>
                    {/* File tabs */}
                    <div className="flex flex-wrap gap-1 mb-4 bg-slate-100 dark:bg-slate-900 rounded-lg p-1">
                      {selected.files.map((f, i) => (
                        <button
                          key={i}
                          onClick={() => setActiveFileIdx(i)}
                          className={`px-3 py-1.5 rounded text-xs font-bold transition-colors truncate max-w-[200px] ${
                            i === activeFileIdx
                              ? 'bg-white dark:bg-slate-700 text-on-surface dark:text-white shadow-sm'
                              : 'text-tertiary dark:text-slate-500 hover:text-on-surface dark:hover:text-white'
                          }`}
                        >
                          {f.path.split('/').pop()}
                        </button>
                      ))}
                    </div>
                    {/* File content */}
                    <div className="bg-[#1e1e1e] rounded-lg p-4 overflow-x-auto">
                      <p className="text-[10px] text-slate-500 font-mono mb-2">{selected.files[activeFileIdx]?.path}</p>
                      <pre className="text-sm text-slate-200 font-mono whitespace-pre-wrap leading-relaxed">
                        {selected.files[activeFileIdx]?.content}
                      </pre>
                    </div>
                  </div>
                ) : selected.content ? (
                  /* Markdown content (test plans, cases, scenarios, reviews) */
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-table:text-xs prose-th:bg-slate-100 dark:prose-th:bg-slate-700 prose-td:border-outline-variant/20">
                    <ReactMarkdown>{selected.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-center text-tertiary dark:text-slate-500 py-12">No content available</p>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-outline-variant/20 dark:border-slate-700 min-h-[500px] flex items-center justify-center">
              <div className="text-center">
                <span className="material-symbols-outlined text-5xl text-tertiary dark:text-slate-600">preview</span>
                <p className="mt-3 text-sm font-bold text-tertiary dark:text-slate-500">Select an item to preview</p>
                <p className="text-xs text-tertiary dark:text-slate-600 mt-1">Click on any saved item from the list</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
