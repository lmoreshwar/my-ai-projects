import { useState, useCallback } from 'react';
import DiffViewer from './DiffViewer';

/* ═══════════════════════════════════════════════════════════════════════
   CONFLICT RESOLVER — Side-by-side diff + merge resolution for each file
   Props:
     conflicts     : [{ path, localContent, remoteContent, remoteSha }]
     onResolveAll  : (resolvedFiles) => void — called when all resolved
     onCancel      : () => void
   ═══════════════════════════════════════════════════════════════════════ */

export default function ConflictResolver({ conflicts = [], onResolveAll, onCancel }) {
  const [activeIdx, setActiveIdx] = useState(0);
  // resolution: { path, content, strategy } per file
  const [resolutions, setResolutions] = useState(() =>
    conflicts.map(c => ({ path: c.path, content: c.localContent, strategy: null }))
  );

  const active = conflicts[activeIdx];
  const activeRes = resolutions[activeIdx];
  const allResolved = resolutions.every(r => r.strategy !== null);
  const resolvedCount = resolutions.filter(r => r.strategy !== null).length;

  const updateResolution = useCallback((idx, strategy, content) => {
    setResolutions(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], strategy, content };
      return next;
    });
  }, []);

  const acceptRemote = () => updateResolution(activeIdx, 'remote', active.remoteContent);
  const acceptLocal = () => updateResolution(activeIdx, 'local', active.localContent);
  const handleManualEdit = (value) => updateResolution(activeIdx, 'manual', value);

  const markManual = () => {
    if (!activeRes.strategy) {
      updateResolution(activeIdx, 'manual', active.localContent);
    }
  };

  const handleSubmit = () => {
    if (!allResolved) return;
    const resolved = resolutions.map(r => ({ path: r.path, content: r.content }));
    onResolveAll(resolved);
  };

  if (!active) return null;

  return (
    <div className="space-y-6">
      {/* ── Header Banner ── */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-600 text-2xl mt-0.5">warning</span>
        <div className="flex-1">
          <h3 className="font-bold text-amber-800 dark:text-amber-300 text-sm">
            {conflicts.length} Conflict{conflicts.length > 1 ? 's' : ''} Detected — Resolve Before Pushing
          </h3>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            Files have been modified on the remote branch since your last push. Choose how to handle each conflict.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${allResolved ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
            {resolvedCount}/{conflicts.length} resolved
          </span>
        </div>
      </div>

      {/* ── File Tabs ── */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {conflicts.map((c, i) => {
          const res = resolutions[i];
          const isActive = i === activeIdx;
          return (
            <button
              key={c.path}
              onClick={() => setActiveIdx(i)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-xs whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-app-red text-white shadow-lg shadow-app-red/20'
                  : res.strategy
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                    : 'bg-surface-container-highest dark:bg-slate-800 text-on-surface dark:text-white border border-outline-variant/20 dark:border-slate-700'
              }`}
            >
              {res.strategy ? (
                <span className="material-symbols-outlined text-sm">check_circle</span>
              ) : (
                <span className="material-symbols-outlined text-sm">error</span>
              )}
              {c.path.split('/').pop()}
            </button>
          );
        })}
      </div>

      {/* ── Active File Conflict ── */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-outline-variant/20 dark:border-slate-800 shadow-sm overflow-hidden">
        {/* File info bar */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-amber-400">compare_arrows</span>
            <div>
              <div className="font-mono text-sm font-bold">{active.path}</div>
              <div className="text-[10px] text-white/50 mt-0.5">
                Remote (LEFT) vs Local (RIGHT) — {activeRes.strategy ? `Resolved: ${activeRes.strategy}` : 'Unresolved'}
              </div>
            </div>
          </div>
          {activeRes.strategy && (
            <span className="bg-green-600 text-white text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1">
              <span className="material-symbols-outlined text-xs">check</span>
              {activeRes.strategy === 'remote' ? 'Using Remote' : activeRes.strategy === 'local' ? 'Using Local' : 'Manual Edit'}
            </span>
          )}
        </div>

        {/* Labels */}
        <div className="grid grid-cols-2 border-b border-outline-variant/10 dark:border-slate-800">
          <div className="px-4 py-2 bg-red-50 dark:bg-red-900/10 text-xs font-bold text-red-700 dark:text-red-400 flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">cloud</span>
            Remote Version (origin/{active.path.split('/').pop()})
          </div>
          <div className="px-4 py-2 bg-green-50 dark:bg-green-900/10 text-xs font-bold text-green-700 dark:text-green-400 flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">computer</span>
            Local Version (your changes)
          </div>
        </div>

        {/* Monaco Diff Editor */}
        <DiffViewer
          original={active.remoteContent}
          modified={activeRes.strategy === 'manual' ? activeRes.content : active.localContent}
          fileName={active.path}
          height="350px"
          readOnly={activeRes.strategy !== 'manual'}
          onModifiedChange={activeRes.strategy === 'manual' ? handleManualEdit : undefined}
        />

        {/* Resolution Actions */}
        <div className="p-4 bg-surface-container-low dark:bg-slate-800/50 border-t border-outline-variant/10 dark:border-slate-800 flex items-center gap-3 flex-wrap">
          <button
            onClick={acceptRemote}
            className={`px-4 py-2.5 rounded-lg font-bold text-xs flex items-center gap-2 transition-all ${
              activeRes.strategy === 'remote'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30'
            }`}
          >
            <span className="material-symbols-outlined text-sm">cloud_download</span>
            Accept Remote
          </button>
          <button
            onClick={acceptLocal}
            className={`px-4 py-2.5 rounded-lg font-bold text-xs flex items-center gap-2 transition-all ${
              activeRes.strategy === 'local'
                ? 'bg-green-600 text-white shadow-lg shadow-green-600/20'
                : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30'
            }`}
          >
            <span className="material-symbols-outlined text-sm">computer</span>
            Accept Local
          </button>
          <button
            onClick={markManual}
            className={`px-4 py-2.5 rounded-lg font-bold text-xs flex items-center gap-2 transition-all ${
              activeRes.strategy === 'manual'
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20'
                : 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30'
            }`}
          >
            <span className="material-symbols-outlined text-sm">edit</span>
            Manual Edit
          </button>

          {/* Nav arrows */}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setActiveIdx(Math.max(0, activeIdx - 1))}
              disabled={activeIdx === 0}
              className="p-2 rounded-lg border border-outline-variant/20 dark:border-slate-700 hover:bg-surface-container-highest dark:hover:bg-slate-700 disabled:opacity-30 transition-all"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>
            <span className="text-[10px] font-bold text-on-surface-variant">{activeIdx + 1}/{conflicts.length}</span>
            <button
              onClick={() => setActiveIdx(Math.min(conflicts.length - 1, activeIdx + 1))}
              disabled={activeIdx === conflicts.length - 1}
              className="p-2 rounded-lg border border-outline-variant/20 dark:border-slate-700 hover:bg-surface-container-highest dark:hover:bg-slate-700 disabled:opacity-30 transition-all"
            >
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Bottom Actions ── */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={onCancel}
          className="px-5 py-3 border border-outline-variant/30 dark:border-slate-700 rounded-xl font-bold text-sm hover:bg-surface-container-highest dark:hover:bg-slate-800 transition-all"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!allResolved}
          className={`flex-1 max-w-md py-3 font-bold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
            allResolved
              ? 'bg-app-red text-white shadow-lg shadow-app-red/20 hover:bg-app-dark-red'
              : 'bg-slate-200 dark:bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          <span className="material-symbols-outlined text-sm">{allResolved ? 'cloud_upload' : 'lock'}</span>
          {allResolved
            ? `Push ${conflicts.length} Resolved File${conflicts.length > 1 ? 's' : ''}`
            : `Resolve ${conflicts.length - resolvedCount} remaining conflict${conflicts.length - resolvedCount > 1 ? 's' : ''}`
          }
        </button>
      </div>
    </div>
  );
}
