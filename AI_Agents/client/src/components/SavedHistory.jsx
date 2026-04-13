import { useState, useEffect, useMemo } from 'react';
import { listArtifacts, loadArtifact, deleteArtifact } from '../utils/artifactService';

/* ── Type metadata for badges & icons ── */
const TYPE_META = {
  'test-plan':       { label: 'Test Plan',       icon: 'assignment',   color: 'bg-blue-500',    ring: 'ring-blue-500/20' },
  'test-cases':      { label: 'Test Cases',      icon: 'edit_note',    color: 'bg-app-red',     ring: 'ring-app-red/20' },
  'test-scenarios':  { label: 'Test Scenarios',   icon: 'schema',       color: 'bg-purple-500',  ring: 'ring-purple-500/20' },
  'test-review':     { label: 'Test Review',      icon: 'fact_check',   color: 'bg-amber-500',   ring: 'ring-amber-500/20' },
  'selenium-bdd':    { label: 'Selenium BDD',     icon: 'code',         color: 'bg-orange-500',  ring: 'ring-orange-500/20' },
  'playwright-js':   { label: 'Playwright BDD',   icon: 'code_blocks',  color: 'bg-teal-500',    ring: 'ring-teal-500/20' },
  'playwright-pom':  { label: 'Playwright POM',   icon: 'account_tree', color: 'bg-indigo-500',  ring: 'ring-indigo-500/20' },
};

/* ── Parse markdown table → {headers, rows} ─────────────────── */
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

/* ── Smart column index finder ─────────────────────────────── */
function findColumnIndex(headers, ...keywords) {
  const lowerHeaders = headers.map(h => h.toLowerCase());
  for (const kw of keywords) {
    const idx = lowerHeaders.findIndex(h => h.includes(kw));
    if (idx >= 0) return idx;
  }
  return -1;
}

/* ── Execution tag badge colors ── */
function tagBadge(tag) {
  const tl = tag.trim().toLowerCase();
  if (tl.includes('automation'))  return 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400';
  if (tl.includes('sanity'))      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400';
  if (tl.includes('regression'))  return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
  if (tl.includes('smoke'))       return 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400';
  if (tl.includes('functional'))  return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400';
  return 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300';
}

/* ── Type badge colors ── */
function typeBadge(t) {
  const tl = (t || '').toLowerCase();
  if (tl.includes('positive') || tl.includes('happy'))  return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400';
  if (tl.includes('negative') || tl.includes('unhappy')) return 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400';
  if (tl.includes('edge') || tl.includes('boundary'))   return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
  if (tl.includes('ui'))          return 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400';
  if (tl.includes('security'))    return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400';
  if (tl.includes('performance')) return 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400';
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

  useEffect(() => {
    fetchList();
    setSelected(null);
    setSearchQuery('');         // clear search on type change so results aren't hidden
  }, [filterType]);

  /* ── Group artifacts by ticketId ── */
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
      const key = a.metadata?.ticketId?.toUpperCase() || 'General';
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

  /* ────────────────────────────────────────────────────
     Render test cases / test review in beautiful table
     ──────────────────────────────────────────────────── */
  const renderTestCaseTable = (content) => {
    const table = parseMarkdownTable(content);
    if (!table) {
      // No table found → show raw content as plain text
      return (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-5 border border-outline-variant/10">
          <pre className="text-xs text-on-surface dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{content}</pre>
        </div>
      );
    }

    const h = table.headers;
    // Map column indices based on actual RICE-POT output format
    const srlIdx      = findColumnIndex(h, 'srl', '#');
    const titleIdx    = findColumnIndex(h, 'title', 'name', 'summary');
    const descIdx     = findColumnIndex(h, 'description');
    const preCondIdx  = findColumnIndex(h, 'pre-cond', 'precond', 'prereq');
    const testDataIdx = findColumnIndex(h, 'test data');
    const stepsIdx    = findColumnIndex(h, 'step');
    const expectedIdx = findColumnIndex(h, 'expected');
    const typeIdx     = findColumnIndex(h, 'type');
    const tagsIdx     = findColumnIndex(h, 'tag');
    const execTagIdx  = findColumnIndex(h, 'execution');
    const commentsIdx = findColumnIndex(h, 'comment');

    return (
      <div className="space-y-4">
        {/* Stats bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-black px-3 py-1.5 bg-app-red/10 text-app-red rounded-full flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm">checklist</span>
            {table.rows.length} Test Cases
          </span>
          {selected?.metadata?.overallCoverage && (
            <span className="text-xs font-bold px-3 py-1.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-full flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">verified</span>
              Coverage: {selected.metadata.overallCoverage}%
            </span>
          )}
        </div>

        {/* Test Case Cards */}
        <div className="space-y-2">
          {table.rows.map((row, idx) => {
            const isExpanded = expandedRow === idx;
            const srl = srlIdx >= 0 ? row[srlIdx] : `TC_${String(idx + 1).padStart(3, '0')}`;
            const title = titleIdx >= 0 ? row[titleIdx] : `Test Case ${idx + 1}`;
            const desc = descIdx >= 0 ? row[descIdx] : '';
            const tcType = typeIdx >= 0 ? row[typeIdx] : '';
            const execTag = execTagIdx >= 0 ? row[execTagIdx] : '';
            const tags = tagsIdx >= 0 ? row[tagsIdx] : '';
            const steps = stepsIdx >= 0 ? row[stepsIdx] : '';
            const expected = expectedIdx >= 0 ? row[expectedIdx] : '';
            const preCond = preCondIdx >= 0 ? row[preCondIdx] : '';
            const testData = testDataIdx >= 0 ? row[testDataIdx] : '';
            const comments = commentsIdx >= 0 ? row[commentsIdx] : '';

            return (
              <div key={idx}
                className={`border rounded-xl overflow-hidden transition-all ${
                  isExpanded
                    ? 'border-app-red/30 dark:border-app-red/20 shadow-md shadow-app-red/5'
                    : 'border-outline-variant/15 dark:border-slate-700/50 hover:border-outline-variant/30 hover:shadow-sm'
                }`}>
                {/* Card header — always visible */}
                <div
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                    isExpanded ? 'bg-app-red/5 dark:bg-app-red/10' : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/80'
                  }`}
                  onClick={() => setExpandedRow(isExpanded ? null : idx)}>

                  {/* SRL badge */}
                  <div className="flex-shrink-0 min-w-[3.5rem] px-2 h-8 bg-slate-900 dark:bg-slate-700 rounded-lg flex items-center justify-center">
                    <span className="text-[10px] font-black text-white tracking-wide whitespace-nowrap">{srl}</span>
                  </div>

                  {/* Title + description */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-on-surface dark:text-white truncate">{title}</p>
                    {desc && <p className="text-[11px] text-tertiary dark:text-slate-400 truncate mt-0.5">{desc}</p>}
                  </div>

                  {/* Type badge */}
                  {tcType && (
                    <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-md ${typeBadge(tcType)}`}>
                      {tcType}
                    </span>
                  )}

                  {/* Execution tags */}
                  <div className="flex-shrink-0 flex gap-1 max-w-[180px] flex-wrap justify-end">
                    {(execTag || tags || '').split(',').filter(Boolean).slice(0, 3).map((t, ti) => (
                      <span key={ti} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${tagBadge(t)}`}>{t.trim()}</span>
                    ))}
                  </div>

                  {/* Expand icon */}
                  <span className={`material-symbols-outlined text-base text-tertiary dark:text-slate-500 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>expand_more</span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-3 bg-slate-50/80 dark:bg-slate-900/60 border-t border-outline-variant/10 dark:border-slate-700/40">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {preCond && (
                        <DetailBlock icon="task_alt" label="Pre-conditions" value={preCond} />
                      )}
                      {testData && (
                        <DetailBlock icon="database" label="Test Data" value={testData} />
                      )}
                      {steps && (
                        <DetailBlock icon="format_list_numbered" label="Test Steps" value={steps} numbered />
                      )}
                      {expected && (
                        <DetailBlock icon="check_circle" label="Expected Results" value={expected} numbered />
                      )}
                      {comments && (
                        <DetailBlock icon="comment" label="Comments" value={comments} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /* ── Render content based on artifact type ── */
  const renderContent = () => {
    if (!selected) return null;

    // Test cases & test review → tabular card view
    if ((selected.type === 'test-cases' || selected.type === 'test-review') && selected.content) {
      return renderTestCaseTable(selected.content);
    }

    // Automation scripts → code viewer with file tabs
    if (selected.files && selected.files.length > 0) {
      return (
        <div>
          <div className="flex flex-wrap gap-1 mb-4 bg-slate-100 dark:bg-slate-900 rounded-lg p-1">
            {selected.files.map((f, i) => (
              <button key={i} onClick={() => setActiveFileIdx(i)}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-colors truncate max-w-[200px] ${
                  i === activeFileIdx
                    ? 'bg-white dark:bg-slate-700 text-on-surface dark:text-white shadow-sm'
                    : 'text-tertiary dark:text-slate-500 hover:text-on-surface dark:hover:text-white'
                }`}>
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

    // Everything else → plain markdown-like display
    if (selected.content) {
      return (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-5 border border-outline-variant/10">
          <pre className="text-xs text-on-surface dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{selected.content}</pre>
        </div>
      );
    }

    return <p className="text-center text-tertiary dark:text-slate-500 py-12">No content available</p>;
  };

  /* ═══════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════ */
  return (
    <div className="px-6 pt-28 pb-12 max-w-screen-xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-black text-on-surface dark:text-white tracking-tight flex items-center gap-2">
            <span className="material-symbols-outlined text-app-red">history</span>
            Saved History
          </h1>
          <p className="text-sm text-tertiary dark:text-slate-400 mt-1">Browse your saved test plans, cases, reviews and automation scripts.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-tertiary dark:text-slate-500 text-base">search</span>
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by ticket or title..."
              className="pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-600 rounded-lg text-sm font-medium text-on-surface dark:text-white focus:ring-2 focus:ring-app-red outline-none w-52" />
          </div>
          {/* Type filter dropdown */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-2.5 bg-white dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-600 rounded-lg text-sm font-bold text-on-surface dark:text-white focus:ring-2 focus:ring-app-red outline-none cursor-pointer">
            <option value="">All Types</option>
            {Object.entries(TYPE_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          {/* Refresh */}
          <button onClick={fetchList} className="px-3 py-2.5 bg-slate-100 dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" title="Refresh">
            <span className="material-symbols-outlined text-base align-middle">refresh</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <span className="text-xs font-bold text-tertiary dark:text-slate-500">{artifacts.length} saved items</span>
        <span className="text-xs text-tertiary dark:text-slate-600">•</span>
        <span className="text-xs font-bold text-tertiary dark:text-slate-500">{Object.keys(groupedArtifacts).length} group{Object.keys(groupedArtifacts).length !== 1 ? 's' : ''}</span>
        {filterType && (
          <>
            <span className="text-xs text-tertiary dark:text-slate-600">•</span>
            <span className="text-xs font-bold text-app-red">Showing: {TYPE_META[filterType]?.label}</span>
          </>
        )}
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* ── Left: Grouped List ── */}
        <div className="col-span-12 lg:col-span-4 space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto pr-2 custom-scroll">
          {loading ? (
            <div className="text-center py-12 text-tertiary dark:text-slate-500">
              <span className="material-symbols-outlined text-4xl animate-spin">progress_activity</span>
              <p className="mt-2 text-sm font-bold">Loading...</p>
            </div>
          ) : Object.keys(groupedArtifacts).length === 0 ? (
            <div className="text-center py-12">
              <span className="material-symbols-outlined text-5xl text-tertiary dark:text-slate-600">inventory_2</span>
              <p className="mt-3 text-sm font-bold text-tertiary dark:text-slate-500">
                {searchQuery ? 'No items match your search' : filterType ? `No ${TYPE_META[filterType]?.label || filterType} saved yet` : 'No saved items yet'}
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
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-tertiary dark:text-slate-500">{m.label}</span>
                            {a.metadata?.version && (
                              <span className="text-[9px] font-black bg-app-red/10 text-app-red px-1.5 py-0.5 rounded-full">v{a.metadata.version}</span>
                            )}
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
              {/* Detail header — clean, no ticket details */}
              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-b border-outline-variant/20 dark:border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 ${meta(selected.type).color} rounded-lg flex items-center justify-center`}>
                    <span className="material-symbols-outlined text-white text-base">{meta(selected.type).icon}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-on-surface dark:text-white">{meta(selected.type).label}</h2>
                      {selected.metadata?.version && (
                        <span className="text-[10px] font-black bg-app-red/10 text-app-red px-2 py-0.5 rounded-full">v{selected.metadata.version}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-tertiary dark:text-slate-500">
                      Saved {new Date(selected.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={copyContent} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center gap-1" title="Copy to clipboard">
                    <span className="material-symbols-outlined text-sm">content_copy</span>Copy
                  </button>
                  <button onClick={() => handleDelete(selected._id)} className="px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">delete</span>Delete
                  </button>
                </div>
              </div>
              {/* Content area */}
              <div className="p-6 max-h-[calc(100vh-320px)] overflow-y-auto custom-scroll">
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

/* ── Strip HTML <br> tags from text ── */
function stripBr(text) {
  if (!text) return '';
  return text.replace(/<br\s*\/?>/gi, ' ').replace(/\s{2,}/g, ' ').trim();
}

/* ── Split numbered steps "1. Foo 2. Bar" → ["Foo", "Bar"] ── */
function splitNumberedSteps(text) {
  if (!text) return [];
  const clean = stripBr(text);

  // Strategy: extract steps using sequential numbering (1. 2. 3. ...)
  // Only treat "N." as a step marker if N follows the expected sequence
  const steps = [];
  let expected = 1;
  let remaining = clean;

  while (remaining.length > 0) {
    // Find where the NEXT expected step number starts
    const nextNum = expected + 1;
    const nextPattern = new RegExp(`(?<=[.!?\\s])${nextNum}\\.\\s`);
    const nextMatch = remaining.match(nextPattern);

    if (nextMatch && nextMatch.index !== undefined) {
      // Everything before the next marker is the current step
      let stepText = remaining.substring(0, nextMatch.index).trim();
      // Strip leading "N. " from step text
      stepText = stepText.replace(/^\d+\.\s*/, '');
      if (stepText) steps.push(stepText);
      remaining = remaining.substring(nextMatch.index);
      expected = nextNum;
    } else {
      // No more sequential markers — rest is the last step
      let stepText = remaining.trim().replace(/^\d+\.\s*/, '');
      if (stepText) steps.push(stepText);
      break;
    }
  }

  if (steps.length > 1) return steps;

  // Fallback: try splitting on semicolons or " - "
  const alt = clean.split(/;\s*|\s+-\s+/).map(s => s.trim()).filter(Boolean);
  if (alt.length > 1) return alt;
  return [clean];
}

/* ── Reusable detail block for expanded row ── */
function DetailBlock({ icon, label, value, wide, numbered }) {
  const steps = numbered ? splitNumberedSteps(value) : null;

  return (
    <div className={wide ? 'md:col-span-2' : ''}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="material-symbols-outlined text-xs text-app-red">{icon}</span>
        <p className="text-[10px] font-black uppercase tracking-wider text-tertiary dark:text-slate-500">{label}</p>
      </div>
      {numbered && steps && steps.length > 1 ? (
        <ol className="text-xs text-on-surface dark:text-slate-300 leading-relaxed bg-white dark:bg-slate-800 rounded-lg p-3 border border-outline-variant/10 dark:border-slate-700/40 space-y-1.5 list-none m-0">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 bg-app-red/10 text-app-red text-[10px] font-black rounded-full flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span className="flex-1">{step}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-on-surface dark:text-slate-300 leading-relaxed whitespace-pre-line bg-white dark:bg-slate-800 rounded-lg p-3 border border-outline-variant/10 dark:border-slate-700/40">{stripBr(value)}</p>
      )}
    </div>
  );
}
