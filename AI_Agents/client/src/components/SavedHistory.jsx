import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { listArtifacts, loadArtifact, deleteArtifact } from '../utils/artifactService';

const TYPE_META = {
  'test-plan':       { label: 'Test Plan',       icon: 'assignment',   color: 'bg-blue-500',    ring: 'ring-blue-500/20' },
  'test-cases':      { label: 'Test Cases',      icon: 'edit_note',    color: 'bg-app-red',     ring: 'ring-app-red/20' },
  'test-scenarios':  { label: 'Test Scenarios',   icon: 'schema',       color: 'bg-purple-500',  ring: 'ring-purple-500/20' },
  'test-review':     { label: 'Test Review',      icon: 'fact_check',   color: 'bg-amber-500',   ring: 'ring-amber-500/20' },
  'selenium-bdd':    { label: 'Selenium BDD',     icon: 'code',         color: 'bg-orange-500',  ring: 'ring-orange-500/20' },
  'playwright-js':   { label: 'Playwright BDD',   icon: 'code_blocks',  color: 'bg-teal-500',    ring: 'ring-teal-500/20' },
  'playwright-pom':  { label: 'Playwright POM',   icon: 'account_tree', color: 'bg-indigo-500',  ring: 'ring-indigo-500/20' },
};

/* ── Parse markdown table → {headers, rows} ── */
function parseMarkdownTable(md) {
  if (!md) return null;
  const lines = md.split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 3) return null;
  const split = (line) => line.split('|').slice(1, -1).map(c => c.trim());
  const headers = split(lines[0]);
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = split(lines[i]);
    if (!cells.length || cells.every(c => !c || /^-+$/.test(c))) continue;
    rows.push(cells);
  }
  if (rows.length === 0) return null;
  return { headers, rows };
}

/* ── Extract non-table markdown sections ── */
function extractNonTableSections(md) {
  if (!md) return '';
  const lines = md.split('\n');
  const sections = [];
  let inTable = false;
  for (const line of lines) {
    if (line.trim().startsWith('|')) { inTable = true; continue; }
    if (inTable && line.trim() === '') { inTable = false; continue; }
    if (!inTable) sections.push(line);
  }
  return sections.join('\n').trim();
}

/* ── Priority badge color ── */
function priorityColor(p) {
  const pl = (p || '').toLowerCase();
  if (pl.includes('high') || pl.includes('critical')) return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
  if (pl.includes('medium')) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
  if (pl.includes('low')) return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
  return 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300';
}

/* ── Execution tag badge ── */
function tagBadge(tag) {
  const tl = tag.trim().toLowerCase();
  if (tl.includes('automation')) return 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400';
  if (tl.includes('sanity')) return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400';
  if (tl.includes('regression')) return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
  return 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300';
}

export default function SavedHistory({ apiBase }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [selected, setSelected] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);

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

  /* ── Group artifacts by ticketId for better organization ── */
  const groupedArtifacts = useMemo(() => {
    let filtered = artifacts;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = artifacts.filter(a =>
        a.title.toLowerCase().includes(q) ||
        (a.metadata?.ticketId || '').toLowerCase().includes(q) ||
        (TYPE_META[a.type]?.label || '').toLowerCase().includes(q)
      );
    }
    const groups = {};
    for (const a of filtered) {
      const key = a.metadata?.ticketId?.toUpperCase() || a.title || 'Untitled';
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    }
    return groups;
  }, [artifacts, searchQuery]);

  /* ── Load full artifact ── */
  const openArtifact = async (id) => {
    setLoadingDetail(true);
    setActiveFileIdx(0);
    setExpandedRow(null);
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

  const meta = (type) => TYPE_META[type] || { label: type, icon: 'description', color: 'bg-slate-500', ring: 'ring-slate-500/20' };

  /* ── Render test cases in tabular format ── */
  const renderTestCaseTable = (content) => {
    const table = parseMarkdownTable(content);
    const nonTableText = extractNonTableSections(content);
    if (!table) {
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      );
    }

    const h = table.headers.map(x => x.toLowerCase());
    const srlIdx = h.findIndex(c => c.includes('srl') || c.includes('#') || c.includes('no') || c.includes('id'));
    const titleIdx = h.findIndex(c => c.includes('title') || c.includes('name') || c.includes('summary'));
    const typeIdx = h.findIndex(c => c.includes('type') && !c.includes('execution'));
    const priorityIdx = h.findIndex(c => c.includes('priority'));
    const tagsIdx = h.findIndex(c => c.includes('tag') || c.includes('execution'));
    const stepsIdx = h.findIndex(c => c.includes('step'));
    const expectedIdx = h.findIndex(c => c.includes('expected'));
    const prereqIdx = h.findIndex(c => c.includes('prereq') || c.includes('pre-req') || c.includes('precond'));

    return (
      <div className="space-y-4">
        {nonTableText && (
          <div className="prose prose-sm dark:prose-invert max-w-none mb-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-outline-variant/20">
            <ReactMarkdown>{nonTableText}</ReactMarkdown>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold px-3 py-1.5 bg-app-red/10 text-app-red rounded-full">
            {table.rows.length} Test Cases
          </span>
          {selected?.metadata?.overallCoverage && (
            <span className="text-xs font-bold px-3 py-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-full">
              Coverage: {selected.metadata.overallCoverage}%
            </span>
          )}
        </div>

        <div className="border border-outline-variant/20 dark:border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-900">
                  {srlIdx >= 0 && <th className="px-3 py-3 text-left font-black text-[10px] uppercase tracking-wider text-tertiary dark:text-slate-400 w-12">#</th>}
                  {titleIdx >= 0 && <th className="px-3 py-3 text-left font-black text-[10px] uppercase tracking-wider text-tertiary dark:text-slate-400 min-w-[200px]">Title</th>}
                  {typeIdx >= 0 && <th className="px-3 py-3 text-left font-black text-[10px] uppercase tracking-wider text-tertiary dark:text-slate-400 w-28">Type</th>}
                  {priorityIdx >= 0 && <th className="px-3 py-3 text-left font-black text-[10px] uppercase tracking-wider text-tertiary dark:text-slate-400 w-24">Priority</th>}
                  {tagsIdx >= 0 && <th className="px-3 py-3 text-left font-black text-[10px] uppercase tracking-wider text-tertiary dark:text-slate-400 w-36">Tags</th>}
                  <th className="px-3 py-3 text-center font-black text-[10px] uppercase tracking-wider text-tertiary dark:text-slate-400 w-16">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10 dark:divide-slate-700/50">
                {table.rows.map((row, idx) => {
                  const isExpanded = expandedRow === idx;
                  return (
                    <tr key={idx} className="group">
                      <td colSpan={100} className="p-0">
                        <div className={`flex items-center cursor-pointer transition-colors ${isExpanded ? 'bg-app-red/5 dark:bg-app-red/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                          onClick={() => setExpandedRow(isExpanded ? null : idx)}>
                          {srlIdx >= 0 && <div className="px-3 py-3 w-12 flex-shrink-0 text-xs font-bold text-tertiary dark:text-slate-500">{row[srlIdx] || idx + 1}</div>}
                          {titleIdx >= 0 && <div className="px-3 py-3 min-w-[200px] flex-1 text-xs font-semibold text-on-surface dark:text-white">{row[titleIdx]}</div>}
                          {typeIdx >= 0 && <div className="px-3 py-3 w-28 flex-shrink-0"><span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{row[typeIdx]}</span></div>}
                          {priorityIdx >= 0 && <div className="px-3 py-3 w-24 flex-shrink-0"><span className={`text-[10px] font-bold px-2 py-0.5 rounded ${priorityColor(row[priorityIdx])}`}>{row[priorityIdx]}</span></div>}
                          {tagsIdx >= 0 && (
                            <div className="px-3 py-3 w-36 flex-shrink-0 flex flex-wrap gap-1">
                              {(row[tagsIdx] || '').split(',').filter(Boolean).map((t, ti) => (
                                <span key={ti} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${tagBadge(t)}`}>{t.trim()}</span>
                              ))}
                            </div>
                          )}
                          <div className="px-3 py-3 w-16 flex-shrink-0 text-center">
                            <span className={`material-symbols-outlined text-sm text-tertiary dark:text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>expand_more</span>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-2 bg-slate-50/50 dark:bg-slate-900/50 border-t border-outline-variant/10 dark:border-slate-700/50">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {prereqIdx >= 0 && row[prereqIdx] && (
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-wider text-tertiary dark:text-slate-500 mb-1">Prerequisites</p>
                                  <p className="text-xs text-on-surface dark:text-slate-300 leading-relaxed">{row[prereqIdx]}</p>
                                </div>
                              )}
                              {stepsIdx >= 0 && row[stepsIdx] && (
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-wider text-tertiary dark:text-slate-500 mb-1">Steps</p>
                                  <p className="text-xs text-on-surface dark:text-slate-300 leading-relaxed whitespace-pre-line">{row[stepsIdx]}</p>
                                </div>
                              )}
                              {expectedIdx >= 0 && row[expectedIdx] && (
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-wider text-tertiary dark:text-slate-500 mb-1">Expected Result</p>
                                  <p className="text-xs text-on-surface dark:text-slate-300 leading-relaxed">{row[expectedIdx]}</p>
                                </div>
                              )}
                              {table.headers.map((header, ci) => {
                                if ([srlIdx, titleIdx, typeIdx, priorityIdx, tagsIdx, stepsIdx, expectedIdx, prereqIdx].includes(ci)) return null;
                                if (!row[ci]) return null;
                                return (
                                  <div key={ci}>
                                    <p className="text-[10px] font-black uppercase tracking-wider text-tertiary dark:text-slate-500 mb-1">{header}</p>
                                    <p className="text-xs text-on-surface dark:text-slate-300 leading-relaxed">{row[ci]}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  /* ── Render content based on artifact type ── */
  const renderContent = () => {
    if (!selected) return null;
    if ((selected.type === 'test-cases' || selected.type === 'test-review') && selected.content) {
      return renderTestCaseTable(selected.content);
    }
    if (selected.files && selected.files.length > 0) {
      return (
        <div>
          <div className="flex flex-wrap gap-1 mb-4 bg-slate-100 dark:bg-slate-900 rounded-lg p-1">
            {selected.files.map((f, i) => (
              <button key={i} onClick={() => setActiveFileIdx(i)}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-colors truncate max-w-[200px] ${i === activeFileIdx ? 'bg-white dark:bg-slate-700 text-on-surface dark:text-white shadow-sm' : 'text-tertiary dark:text-slate-500 hover:text-on-surface dark:hover:text-white'}`}>
                {f.path.split('/').pop()}
              </button>
            ))}
          </div>
          <div className="bg-[#1e1e1e] rounded-lg p-4 overflow-x-auto">
            <p className="text-[10px] text-slate-500 font-mono mb-2">{selected.files[activeFileIdx]?.path}</p>
            <pre className="text-sm text-slate-200 font-mono whitespace-pre-wrap leading-relaxed">{selected.files[activeFileIdx]?.content}</pre>
          </div>
        </div>
      );
    }
    if (selected.content) {
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-bold prose-table:text-xs prose-th:bg-slate-100 dark:prose-th:bg-slate-700 prose-td:border-outline-variant/20">
          <ReactMarkdown>{selected.content}</ReactMarkdown>
        </div>
      );
    }
    return <p className="text-center text-tertiary dark:text-slate-500 py-12">No content available</p>;
  };

  return (
    <div className="px-6 pt-28 pb-12 max-w-screen-xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-black text-on-surface dark:text-white tracking-tight">Saved History</h1>
          <p className="text-sm text-tertiary dark:text-slate-400 mt-1">Browse previously saved test plans, cases, reviews, and automation scripts.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-tertiary dark:text-slate-500 text-base">search</span>
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by ticket ID or title..."
              className="pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-600 rounded-lg text-sm font-medium text-on-surface dark:text-white focus:ring-2 focus:ring-app-red outline-none w-56" />
          </div>
          <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setSelected(null); }}
            className="px-4 py-2.5 bg-white dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-600 rounded-lg text-sm font-bold text-on-surface dark:text-white focus:ring-2 focus:ring-app-red outline-none">
            <option value="">All Types</option>
            {Object.entries(TYPE_META).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
          </select>
          <button onClick={fetchList} className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" title="Refresh">
            <span className="material-symbols-outlined text-base align-middle">refresh</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <span className="text-xs font-bold text-tertiary dark:text-slate-500">{artifacts.length} saved items</span>
        <span className="text-xs text-tertiary dark:text-slate-600">•</span>
        <span className="text-xs font-bold text-tertiary dark:text-slate-500">{Object.keys(groupedArtifacts).length} ticket{Object.keys(groupedArtifacts).length !== 1 ? 's' : ''}</span>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* ── Left: Grouped List ── */}
        <div className="col-span-12 lg:col-span-4 space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto pr-2">
          {loading ? (
            <div className="text-center py-12 text-tertiary dark:text-slate-500">
              <span className="material-symbols-outlined text-4xl animate-spin">progress_activity</span>
              <p className="mt-2 text-sm font-bold">Loading...</p>
            </div>
          ) : Object.keys(groupedArtifacts).length === 0 ? (
            <div className="text-center py-12">
              <span className="material-symbols-outlined text-5xl text-tertiary dark:text-slate-600">inventory_2</span>
              <p className="mt-3 text-sm font-bold text-tertiary dark:text-slate-500">
                {searchQuery ? 'No items match your search' : 'No saved items yet'}
              </p>
              <p className="text-xs text-tertiary dark:text-slate-600 mt-1">
                {searchQuery ? 'Try a different search term' : 'Generate test plans, cases, or automation and click "Save to Database"'}
              </p>
            </div>
          ) : (
            Object.entries(groupedArtifacts).map(([groupKey, items]) => (
              <div key={groupKey} className="mb-3">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="material-symbols-outlined text-sm text-app-red">confirmation_number</span>
                  <span className="text-[11px] font-black uppercase tracking-widest text-on-surface dark:text-white">{groupKey}</span>
                  <span className="text-[10px] font-bold text-tertiary dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{items.length}</span>
                </div>
                <div className="space-y-1.5 ml-1">
                  {items.map((a) => {
                    const m = meta(a.type);
                    const isSelected = selected?._id === a._id;
                    return (
                      <div key={a._id} onClick={() => openArtifact(a._id)}
                        className={`px-3 py-2.5 rounded-lg border cursor-pointer transition-all group flex items-center gap-3 ${
                          isSelected
                            ? `bg-white dark:bg-slate-800 border-transparent ring-2 ${m.ring} shadow-md`
                            : 'bg-white dark:bg-slate-800 border-outline-variant/15 dark:border-slate-700/50 hover:border-outline-variant/30 hover:shadow-sm'
                        }`}>
                        <div className={`w-7 h-7 ${m.color} rounded-md flex items-center justify-center flex-shrink-0`}>
                          <span className="material-symbols-outlined text-white text-sm">{m.icon}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-tertiary dark:text-slate-500">{m.label}</span>
                            {a.metadata?.totalCases && (
                              <span className="text-[9px] font-bold bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">{a.metadata.totalCases} TCs</span>
                            )}
                            {a.metadata?.fileCount && (
                              <span className="text-[9px] font-bold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full">{a.metadata.fileCount} files</span>
                            )}
                          </div>
                          <p className="text-[10px] text-tertiary dark:text-slate-500 mt-0.5">
                            {new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(a._id); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-slate-400 hover:text-red-500" title="Delete">
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
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
              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-b border-outline-variant/20 dark:border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 ${meta(selected.type).color} rounded-lg flex items-center justify-center`}>
                    <span className="material-symbols-outlined text-white text-base">{meta(selected.type).icon}</span>
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-on-surface dark:text-white">{selected.title}</h2>
                    <p className="text-[10px] text-tertiary dark:text-slate-500">{meta(selected.type).label} • Saved {new Date(selected.createdAt).toLocaleString()}
                      {selected.metadata?.ticketId && <> • Ticket: <span className="font-bold text-app-red">{selected.metadata.ticketId.toUpperCase()}</span></>}
                    </p>
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
              <div className="p-6 max-h-[calc(100vh-320px)] overflow-y-auto">
                {renderContent()}
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
