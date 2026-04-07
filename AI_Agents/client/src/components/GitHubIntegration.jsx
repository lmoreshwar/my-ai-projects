import { useState, useEffect, useCallback, useMemo } from 'react';
import ConflictResolver from './ConflictResolver';
import DiffViewer, { InlineDiff } from './DiffViewer';

/* ═══════════════════════════════════════════════════════════════════════
   CONFIG FILE INTELLIGENCE
   - Tracks which config files have been pushed per repo/branch
   - Prevents duplicate config commits
   ═══════════════════════════════════════════════════════════════════════ */
const CONFIG_TRACK_KEY = 'blast_config_pushed';
const CONFIG_FILE_PATTERNS = ['playwright.config.ts', 'playwright.config.js', 'tsconfig.json', 'package.json'];

function getConfigTracker() {
  try { return JSON.parse(localStorage.getItem(CONFIG_TRACK_KEY) || '{}'); } catch { return {}; }
}
function markConfigPushed(repo, branch, filePath) {
  const tracker = getConfigTracker();
  const key = `${repo}::${branch}`;
  if (!tracker[key]) tracker[key] = {};
  tracker[key][filePath] = { pushedAt: new Date().toISOString(), sha: '' };
  localStorage.setItem(CONFIG_TRACK_KEY, JSON.stringify(tracker));
}
function isConfigAlreadyPushed(repo, branch, filePath) {
  const tracker = getConfigTracker();
  return !!tracker[`${repo}::${branch}`]?.[filePath];
}
function isConfigFile(path) {
  const fileName = path.split('/').pop();
  return CONFIG_FILE_PATTERNS.some(p => fileName === p);
}

/* ═══════════════════════════════════════════════════════════════════════
   GITHUB INTEGRATION — Full push with conflict resolution & config intelligence
   ═══════════════════════════════════════════════════════════════════════ */

export default function GitHubIntegration({ connections, apiBase, onNavigate, pendingPushFiles, setPendingPushFiles }) {
  // ── Push Configuration ──
  const [pushRepo, setPushRepo] = useState(connections?.github?.selectedRepo || '');
  const [pushBranch, setPushBranch] = useState(connections?.github?.selectedBranch || 'main');
  const [pushBranchList, setPushBranchList] = useState(connections?.github?.branches || []);
  const [fetchingBranches, setFetchingBranches] = useState(false);
  const [basePath, setBasePath] = useState('tests');
  const [commitMessage, setCommitMessage] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);

  // ── Push State ──
  const [pushView, setPushView] = useState('idle');
  // 'idle' | 'checking' | 'ready' | 'conflicts' | 'pushing' | 'success' | 'error'
  const [fileStatuses, setFileStatuses] = useState([]);
  // [{path, localPath, status, remoteSha, remoteContent, isConfig, configSkipped}]
  const [pushError, setPushError] = useState('');
  const [pushProgress, setPushProgress] = useState({ current: 0, total: 0, file: '' });
  const [pushHistory, setPushHistory] = useState([]);
  const [previewFile, setPreviewFile] = useState(null); // file to show diff for
  const [commitSha, setCommitSha] = useState('');

  // Files to push
  const files = pendingPushFiles || [];
  const hasFiles = files.length > 0;

  // Auto-set commit message when files arrive
  useEffect(() => {
    if (hasFiles && !commitMessage) {
      setCommitMessage(`chore: add Playwright POM tests — ${new Date().toISOString().split('T')[0]}`);
    }
  }, [hasFiles]);

  // Auto-set repo/branch from connections
  useEffect(() => {
    if (connections?.github?.selectedRepo && !pushRepo) {
      setPushRepo(connections.github.selectedRepo);
    }
    if (connections?.github?.branches?.length > 0 && pushBranchList.length === 0) {
      setPushBranchList(connections.github.branches);
    }
    if (connections?.github?.selectedBranch && !pushBranch) {
      setPushBranch(connections.github.selectedBranch);
    }
  }, [connections?.github]);

  const ghConnected = connections?.github?.status === 'connected';
  const repos = connections?.github?.repos || [];

  // ── Derived Counts ──
  const conflictFiles = useMemo(() => fileStatuses.filter(f => f.status === 'modified'), [fileStatuses]);
  const newFiles = useMemo(() => fileStatuses.filter(f => f.status === 'new'), [fileStatuses]);
  const unchangedFiles = useMemo(() => fileStatuses.filter(f => f.status === 'unchanged'), [fileStatuses]);
  const configSkipped = useMemo(() => fileStatuses.filter(f => f.configSkipped), [fileStatuses]);
  const pushableFiles = useMemo(() => fileStatuses.filter(f => f.status !== 'unchanged' && !f.configSkipped), [fileStatuses]);

  // ── File icon helper ──
  const fileIcon = useCallback((path) => {
    if (path.endsWith('.ts')) return { icon: 'code', color: 'text-blue-400', badge: 'TS' };
    if (path.endsWith('.js')) return { icon: 'javascript', color: 'text-yellow-400', badge: 'JS' };
    if (path.includes('Page')) return { icon: 'account_tree', color: 'text-purple-400', badge: 'PO' };
    if (isConfigFile(path)) return { icon: 'settings', color: 'text-amber-400', badge: 'CFG' };
    if (path.includes('spec') || path.includes('test')) return { icon: 'science', color: 'text-green-400', badge: 'SPEC' };
    if (path.includes('feature')) return { icon: 'description', color: 'text-teal-400', badge: 'BDD' };
    return { icon: 'draft', color: 'text-slate-400', badge: '' };
  }, []);

  // ── Fetch branches for selected repo ──
  const handleRepoChange = async (repoFullName) => {
    setPushRepo(repoFullName);
    setPushBranchList([]);
    setPushBranch('');
    setFileStatuses([]);
    setPushView('idle');
    setPreviewFile(null);
    if (!repoFullName) return;

    setFetchingBranches(true);
    try {
      const res = await fetch(`${apiBase}/github-branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: connections.github.token,
          apiUrl: connections.github.apiUrl || 'https://api.github.com',
          repo: repoFullName,
        }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setPushBranchList(data.branches || []);
        const repoInfo = repos.find(r => r.name === repoFullName);
        const defaultBr = repoInfo?.default_branch || 'main';
        setPushBranch((data.branches || []).includes(defaultBr) ? defaultBr : (data.branches?.[0] || 'main'));
      }
    } catch { /* silently fail */ }
    setFetchingBranches(false);
  };

  // ── Create new branch ──
  const handleCreateBranch = async () => {
    if (!newBranchName.trim() || !pushRepo || !pushBranch) return;
    setCreatingBranch(true);
    try {
      const res = await fetch(`${apiBase}/github-create-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: connections.github.token,
          apiUrl: connections.github.apiUrl || 'https://api.github.com',
          repo: pushRepo,
          baseBranch: pushBranch,
          newBranch: newBranchName.trim(),
        }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setPushBranchList(prev => [...prev, newBranchName.trim()]);
        setPushBranch(newBranchName.trim());
        setNewBranchName('');
        setShowNewBranch(false);
        setFileStatuses([]);
        setPushView('idle');
      } else {
        alert(`Failed: ${data.message}`);
      }
    } catch (e) {
      alert(`Error creating branch: ${e.message}`);
    }
    setCreatingBranch(false);
  };

  /* ════════════════════════════════════════════════════════════════════
     CHECK FOR CONFLICTS — Uses backend /github-compare for proper
     server-side comparison + config file intelligence
     ════════════════════════════════════════════════════════════════════ */
  const checkConflicts = async () => {
    if (!pushRepo || !pushBranch) return alert('Select a repository and branch first');
    setPushView('checking');
    setFileStatuses([]);
    setPreviewFile(null);

    // Build file paths with config intelligence
    const filePaths = files.map(file => {
      const remotePath = basePath ? `${basePath.replace(/\/+$/, '')}/${file.path}` : file.path;
      return { remotePath, localContent: file.content, localPath: file.path };
    });

    try {
      const res = await fetch(`${apiBase}/github-compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: connections.github.token,
          apiUrl: connections.github.apiUrl || 'https://api.github.com',
          repo: pushRepo,
          branch: pushBranch,
          filePaths: filePaths.map(fp => ({ remotePath: fp.remotePath, localContent: fp.localContent })),
        }),
      });
      const data = await res.json();

      if (data.status === 'success') {
        const statuses = data.results.map((r, i) => {
          const fp = filePaths[i];
          const isCfg = isConfigFile(fp.localPath);
          let configSkipped = false;

          // Config intelligence: skip if already exists remotely & was pushed before
          if (isCfg && r.status !== 'new') {
            const alreadyPushed = isConfigAlreadyPushed(pushRepo, pushBranch, fp.remotePath);
            if (alreadyPushed && r.status === 'unchanged') {
              configSkipped = true;
            } else if (alreadyPushed && r.status === 'modified') {
              // Config exists and differs — mark as config conflict for user decision
              configSkipped = false; // let user decide
            }
          }
          // If config file is new, also check if it was tracked as pushed (edge case: deleted on remote)
          if (isCfg && r.status === 'new' && isConfigAlreadyPushed(pushRepo, pushBranch, fp.remotePath)) {
            configSkipped = false; // re-push since it was deleted
          }

          return {
            path: fp.remotePath,
            localPath: fp.localPath,
            status: r.status,
            remoteSha: r.remoteSha || null,
            remoteContent: r.remoteContent || null,
            isConfig: isCfg,
            configSkipped,
          };
        });

        setFileStatuses(statuses);

        // If there are real conflicts (modified files), show conflict view
        const modifiedFiles = statuses.filter(s => s.status === 'modified' && !s.configSkipped);
        if (modifiedFiles.length > 0) {
          setPushView('ready'); // show summary, user can open conflict resolver
        } else {
          setPushView('ready');
        }
      } else {
        setPushError(data.message || 'Failed to compare files');
        setPushView('error');
      }
    } catch (e) {
      setPushError(e.message);
      setPushView('error');
    }
  };

  /* ════════════════════════════════════════════════════════════════════
     EXECUTE PUSH — Atomic commit via Git Tree API (backend)
     ════════════════════════════════════════════════════════════════════ */
  const executePush = async (resolvedOverrides) => {
    if (!commitMessage.trim()) return alert('Please enter a commit message');
    setPushView('pushing');
    setPushError('');

    // Build final file list (skip unchanged + configSkipped)
    let filesToPush = [];
    for (const fs of fileStatuses) {
      if (fs.status === 'unchanged' || fs.configSkipped) continue;

      // Check if this file has a resolved override (from conflict resolver)
      const override = resolvedOverrides?.find(o => o.path === fs.path);
      const localFile = files.find(f => f.path === fs.localPath);
      if (!localFile && !override) continue;

      filesToPush.push({
        path: fs.path,
        content: override?.content || localFile.content,
      });
    }

    if (filesToPush.length === 0) {
      setPushView('success');
      return;
    }

    setPushProgress({ current: 0, total: filesToPush.length, file: 'Creating atomic commit...' });

    try {
      const res = await fetch(`${apiBase}/github-push-tree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: connections.github.token,
          apiUrl: connections.github.apiUrl || 'https://api.github.com',
          repo: pushRepo,
          branch: pushBranch,
          commitMessage: commitMessage.trim(),
          files: filesToPush,
        }),
      });
      const data = await res.json();

      if (data.status === 'success') {
        setCommitSha(data.commitSha || '');
        // Track config files as pushed
        for (const fp of filesToPush) {
          if (isConfigFile(fp.path)) {
            markConfigPushed(pushRepo, pushBranch, fp.path);
          }
        }
        // Record in push history
        setPushHistory(prev => [{
          time: new Date().toLocaleTimeString(),
          title: `${filesToPush.length} files pushed`,
          detail: `${pushRepo} → ${pushBranch}`,
          message: commitMessage,
          sha: (data.commitSha || '').substring(0, 7),
        }, ...prev.slice(0, 9)]);
        setPushProgress({ current: filesToPush.length, total: filesToPush.length, file: '' });
        setPushView('success');
      } else {
        throw new Error(data.message || 'Push failed');
      }
    } catch (e) {
      setPushError(e.message);
      setPushView('error');
    }
  };

  // ── Handle conflict resolution callback ──
  const handleConflictsResolved = (resolvedFiles) => {
    // resolvedFiles: [{ path, content }] — from ConflictResolver
    // Update fileStatuses to mark conflicts as resolved, then push
    executePush(resolvedFiles);
  };

  // ── Clear pending files ──
  const clearFiles = () => {
    if (setPendingPushFiles) setPendingPushFiles([]);
    setFileStatuses([]);
    setPushView('idle');
    setPushError('');
    setCommitMessage('');
    setPreviewFile(null);
    setCommitSha('');
  };

  // ── Pull latest (re-check) ──
  const pullLatest = () => {
    setFileStatuses([]);
    setPushView('idle');
    setPreviewFile(null);
    checkConflicts();
  };

  /* ═══════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════ */
  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-16 space-y-8">
      {/* ── Header ── */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="max-w-2xl">
          <span className="text-secondary font-bold text-xs tracking-widest uppercase block mb-2">Version Control</span>
          <h1 className="text-4xl font-black tracking-tight text-app-red mb-3">GitHub Integration</h1>
          <p className="text-on-surface-variant dark:text-slate-400 max-w-lg font-medium leading-relaxed">
            Push generated scripts to GitHub with conflict detection, intelligent config handling, and atomic commits.
          </p>
        </div>
        <div className="flex gap-3">
          {hasFiles && pushView === 'ready' && (
            <button
              onClick={pullLatest}
              className="px-4 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 font-semibold transition-all hover:bg-blue-100 dark:hover:bg-blue-900/30 flex items-center gap-2 border border-blue-200 dark:border-blue-800"
            >
              <span className="material-symbols-outlined text-lg">sync</span>
              Pull Latest
            </button>
          )}
          <button
            onClick={() => onNavigate && onNavigate('connections')}
            className="px-5 py-2.5 rounded-lg bg-surface-container-highest dark:bg-slate-800 text-on-surface dark:text-white font-semibold transition-all hover:bg-surface-container-high dark:hover:bg-slate-700 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">settings</span>
            Connection Settings
          </button>
        </div>
      </header>

      {/* ── Not Connected Banner ── */}
      {!ghConnected && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-6 flex items-start gap-4">
          <span className="material-symbols-outlined text-amber-600 text-2xl mt-0.5">warning</span>
          <div>
            <h3 className="font-bold text-amber-800 dark:text-amber-300 mb-1">GitHub Not Connected</h3>
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Configure your GitHub Personal Access Token in <strong>Connection Settings</strong> to enable push functionality.
            </p>
            <button
              onClick={() => onNavigate && onNavigate('connections')}
              className="mt-3 px-4 py-2 bg-amber-600 text-white font-bold rounded-lg text-xs hover:bg-amber-700 transition-all"
            >
              Go to Settings
            </button>
          </div>
        </div>
      )}

      {/* ── Conflict Resolution Full-Screen View ── */}
      {ghConnected && pushView === 'conflicts' && conflictFiles.length > 0 && (
        <ConflictResolver
          conflicts={conflictFiles.map(f => ({
            path: f.path,
            localContent: files.find(lf => lf.path === f.localPath)?.content || '',
            remoteContent: f.remoteContent || '',
            remoteSha: f.remoteSha,
          }))}
          onResolveAll={handleConflictsResolved}
          onCancel={() => setPushView('ready')}
        />
      )}

      {/* ── Diff Preview Modal ── */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setPreviewFile(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 bg-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-amber-400">compare_arrows</span>
                <div>
                  <div className="font-mono text-sm font-bold text-white">{previewFile.path}</div>
                  <div className="text-[10px] text-white/50">Remote (left) vs Local (right)</div>
                </div>
              </div>
              <button onClick={() => setPreviewFile(null)} className="text-white/60 hover:text-white p-1 rounded hover:bg-white/10 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {previewFile.remoteContent != null ? (
                <DiffViewer
                  original={previewFile.remoteContent}
                  modified={previewFile.localContent}
                  fileName={previewFile.path}
                  height="60vh"
                />
              ) : (
                <div className="p-6">
                  <div className="text-xs font-bold text-green-600 mb-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">add_circle</span> New File
                  </div>
                  <pre className="font-mono text-xs bg-slate-950 text-green-300 p-4 rounded-lg overflow-auto max-h-[50vh] whitespace-pre-wrap">{previewFile.localContent}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Main Grid (hidden during conflict resolution) ── */}
      {ghConnected && pushView !== 'conflicts' && (
        <div className="grid grid-cols-12 gap-6">

          {/* ═══════════ LEFT: Files + Push Config ═══════════ */}
          <div className="col-span-12 lg:col-span-7 space-y-6">

            {/* ── Pending Files Card ── */}
            <section className="bg-white dark:bg-slate-900 rounded-xl border border-outline-variant/20 dark:border-slate-800 shadow-sm overflow-hidden">
              <div className="p-4 bg-gradient-to-r from-slate-900 to-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-white text-xl">folder_zip</span>
                  <div>
                    <h3 className="font-bold text-white text-sm">Files to Push</h3>
                    <p className="text-[10px] text-white/50">{hasFiles ? `${files.length} files from Playwright POM` : 'No files pending'}</p>
                  </div>
                </div>
                {hasFiles && (
                  <button
                    onClick={clearFiles}
                    className="text-white/60 hover:text-white text-xs font-bold flex items-center gap-1 hover:bg-white/10 px-2 py-1 rounded transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                    Clear
                  </button>
                )}
              </div>

              {hasFiles ? (
                <div className="max-h-[280px] overflow-y-auto divide-y divide-outline-variant/10 dark:divide-slate-800">
                  {files.map((f, i) => {
                    const fi = fileIcon(f.path);
                    const status = fileStatuses.find(s => s.localPath === f.path);
                    const isCfg = isConfigFile(f.path);
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-container-highest/50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                        onClick={() => {
                          if (status) {
                            setPreviewFile({
                              path: status.path,
                              localContent: f.content,
                              remoteContent: status.remoteContent,
                              status: status.status,
                            });
                          }
                        }}
                      >
                        <span className={`material-symbols-outlined text-lg ${fi.color}`}>{fi.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-mono font-medium text-on-surface dark:text-white truncate">{f.path}</div>
                          <div className="text-[10px] text-on-surface-variant dark:text-slate-500 flex items-center gap-2">
                            {f.content.split('\n').length} lines
                            {isCfg && <span className="text-amber-500 font-bold">CONFIG</span>}
                          </div>
                        </div>
                        {fi.badge && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            fi.badge === 'TS' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                            fi.badge === 'JS' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                            fi.badge === 'PO' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' :
                            fi.badge === 'CFG' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                            fi.badge === 'SPEC' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                            'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                          }`}>{fi.badge}</span>
                        )}
                        {status && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            status.configSkipped ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 line-through' :
                            status.status === 'new' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                            status.status === 'modified' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                            status.status === 'unchanged' ? 'bg-slate-100 dark:bg-slate-700 text-slate-500' :
                            'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>{status.configSkipped ? 'SKIP (config)' : status.status}</span>
                        )}
                        {status && (status.status === 'modified' || status.status === 'new') && (
                          <span className="material-symbols-outlined text-sm text-on-surface-variant/40 dark:text-slate-600">visibility</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-8 text-center">
                  <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 dark:text-slate-600">upload_file</span>
                  <p className="text-sm text-on-surface-variant dark:text-slate-500 mt-2 font-medium">No files pending for push</p>
                  <p className="text-xs text-on-surface-variant/60 dark:text-slate-600 mt-1">
                    Generate Playwright POM scripts and click <strong>"Push to Git Repo"</strong> to send files here.
                  </p>
                  <button
                    onClick={() => onNavigate && onNavigate('playwright-pom')}
                    className="mt-4 px-4 py-2 bg-app-red text-white font-bold rounded-lg text-xs hover:bg-app-dark-red transition-all"
                  >
                    Go to Playwright POM
                  </button>
                </div>
              )}
            </section>

            {/* ── Config Intelligence Banner ── */}
            {configSkipped.length > 0 && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex items-start gap-3">
                <span className="material-symbols-outlined text-blue-600 text-lg mt-0.5">shield</span>
                <div>
                  <h4 className="font-bold text-blue-800 dark:text-blue-300 text-xs">Config Intelligence Active</h4>
                  <p className="text-[10px] text-blue-700 dark:text-blue-400 mt-0.5">
                    {configSkipped.length} config file(s) skipped — already exist in the repository and haven't changed.
                    This prevents duplicate config commits and merge conflicts.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {configSkipped.map(f => (
                      <span key={f.path} className="text-[9px] font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded">
                        {f.path.split('/').pop()}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Push Configuration ── */}
            {hasFiles && (
              <section className="bg-white dark:bg-slate-900 rounded-xl border border-outline-variant/20 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-outline-variant/10 dark:border-slate-800 bg-surface-container-low dark:bg-slate-800/50 flex items-center gap-2">
                  <span className="material-symbols-outlined text-app-red text-xl">tune</span>
                  <h3 className="font-bold text-on-surface dark:text-white text-sm">Push Configuration</h3>
                </div>
                <div className="p-5 space-y-4">
                  {/* Repo + Branch */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-secondary dark:text-slate-400 uppercase tracking-wider block mb-1.5">Repository</label>
                      <select
                        value={pushRepo}
                        onChange={(e) => handleRepoChange(e.target.value)}
                        disabled={pushView === 'pushing'}
                        className="w-full bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm font-mono focus:border-app-red focus:ring-1 focus:ring-app-red outline-none disabled:opacity-50"
                      >
                        <option value="">Select repository...</option>
                        {repos.map((r) => (
                          <option key={r.name} value={r.name}>{r.name} ({r.visibility})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-secondary dark:text-slate-400 uppercase tracking-wider block mb-1.5">Branch</label>
                      <div className="relative">
                        <select
                          value={pushBranch}
                          onChange={(e) => { setPushBranch(e.target.value); setFileStatuses([]); setPushView('idle'); }}
                          disabled={!pushRepo || fetchingBranches || pushView === 'pushing'}
                          className="w-full bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm font-mono focus:border-app-red focus:ring-1 focus:ring-app-red outline-none disabled:opacity-50"
                        >
                          {fetchingBranches && <option>Loading branches...</option>}
                          {!fetchingBranches && !pushRepo && <option>Select repo first</option>}
                          {!fetchingBranches && pushRepo && pushBranchList.length === 0 && <option>No branches found</option>}
                          {pushBranchList.map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                        {fetchingBranches && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <div className="w-4 h-4 border-2 border-app-red/30 border-t-app-red rounded-full animate-spin" />
                          </div>
                        )}
                      </div>
                      {/* New Branch Toggle */}
                      {pushRepo && (
                        <button
                          onClick={() => setShowNewBranch(!showNewBranch)}
                          className="mt-1.5 text-[10px] text-app-red font-bold hover:underline flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-xs">add</span>
                          {showNewBranch ? 'Cancel' : 'Create New Branch'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* New Branch Form */}
                  {showNewBranch && (
                    <div className="flex gap-2 items-end p-3 bg-surface-container-lowest dark:bg-slate-800/50 rounded-lg border border-outline-variant/20 dark:border-slate-700">
                      <div className="flex-1">
                        <label className="text-[10px] font-bold text-secondary dark:text-slate-400 uppercase tracking-wider block mb-1">New Branch Name</label>
                        <input
                          value={newBranchName}
                          onChange={(e) => setNewBranchName(e.target.value.replace(/\s+/g, '-'))}
                          className="w-full bg-white dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-600 rounded-lg px-3 py-2 text-sm font-mono focus:border-app-red focus:ring-1 focus:ring-app-red outline-none"
                          placeholder="feature/playwright-tests"
                        />
                        <p className="text-[10px] text-on-surface-variant mt-0.5">Based on: <strong>{pushBranch || 'main'}</strong></p>
                      </div>
                      <button
                        onClick={handleCreateBranch}
                        disabled={!newBranchName.trim() || creatingBranch}
                        className="px-4 py-2 bg-app-red text-white font-bold rounded-lg text-xs hover:bg-app-dark-red transition-all disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {creatingBranch ? (
                          <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating...</>
                        ) : (
                          <><span className="material-symbols-outlined text-sm">call_split</span> Create</>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Base Path */}
                  <div>
                    <label className="text-[10px] font-bold text-secondary dark:text-slate-400 uppercase tracking-wider block mb-1.5">Base Path in Repository</label>
                    <input
                      value={basePath}
                      onChange={(e) => { setBasePath(e.target.value); setFileStatuses([]); setPushView('idle'); }}
                      disabled={pushView === 'pushing'}
                      className="w-full bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm font-mono focus:border-app-red focus:ring-1 focus:ring-app-red outline-none disabled:opacity-50"
                      placeholder="tests"
                    />
                    <p className="text-[10px] text-on-surface-variant dark:text-slate-500 mt-1">
                      Files will be pushed as: <code className="bg-surface-container-highest dark:bg-slate-800 px-1 py-0.5 rounded text-[10px] font-mono">{basePath || '.'}/{files[0]?.path || 'pages/Example.ts'}</code>
                    </p>
                  </div>

                  {/* Commit Message */}
                  <div>
                    <label className="text-[10px] font-bold text-secondary dark:text-slate-400 uppercase tracking-wider block mb-1.5">Commit Message</label>
                    <input
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      disabled={pushView === 'pushing'}
                      className="w-full bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant/30 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm focus:border-app-red focus:ring-1 focus:ring-app-red outline-none disabled:opacity-50"
                      placeholder="chore: add Playwright POM tests"
                    />
                  </div>

                  {/* Check / Push Actions */}
                  {pushView === 'idle' && (
                    <button
                      onClick={checkConflicts}
                      disabled={!pushRepo || !pushBranch}
                      className="w-full py-3.5 bg-slate-800 dark:bg-slate-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-700 dark:hover:bg-slate-600 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined text-lg">fact_check</span>
                      Check for Conflicts ({files.length} files)
                    </button>
                  )}

                  {pushView === 'checking' && (
                    <div className="flex items-center justify-center gap-3 py-6">
                      <div className="w-6 h-6 border-3 border-app-red/30 border-t-app-red rounded-full animate-spin" />
                      <span className="text-sm font-semibold text-on-surface-variant dark:text-slate-400">Checking remote files for conflicts...</span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ── Conflict Results + Push Button ── */}
            {hasFiles && (pushView === 'ready' || pushView === 'pushing') && fileStatuses.length > 0 && (
              <section className="bg-white dark:bg-slate-900 rounded-xl border border-outline-variant/20 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-outline-variant/10 dark:border-slate-800 bg-surface-container-low dark:bg-slate-800/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-app-red text-xl">compare_arrows</span>
                    <h3 className="font-bold text-on-surface dark:text-white text-sm">Change Summary</h3>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {newFiles.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-full text-[10px] font-bold border border-green-200 dark:border-green-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> {newFiles.length} new
                      </span>
                    )}
                    {conflictFiles.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-full text-[10px] font-bold border border-amber-200 dark:border-amber-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {conflictFiles.length} modified
                      </span>
                    )}
                    {unchangedFiles.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-full text-[10px] font-bold border border-slate-200 dark:border-slate-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> {unchangedFiles.length} skip
                      </span>
                    )}
                    {configSkipped.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-full text-[10px] font-bold border border-blue-200 dark:border-blue-800">
                        <span className="material-symbols-outlined text-xs">shield</span> {configSkipped.length} config skip
                      </span>
                    )}
                  </div>
                </div>

                {/* Conflict Warning Banner */}
                {conflictFiles.length > 0 && (
                  <div className="mx-4 mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start gap-2">
                    <span className="material-symbols-outlined text-amber-600 text-lg mt-0.5">warning</span>
                    <div className="flex-1">
                      <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                        {conflictFiles.length} file(s) modified on remote — conflicts detected
                      </p>
                      <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                        Resolve conflicts before pushing, or force-push to overwrite remote versions.
                      </p>
                    </div>
                    <button
                      onClick={() => setPushView('conflicts')}
                      className="px-3 py-1.5 bg-amber-600 text-white font-bold rounded-lg text-[10px] hover:bg-amber-700 transition-all flex items-center gap-1 flex-shrink-0"
                    >
                      <span className="material-symbols-outlined text-xs">merge_type</span>
                      Resolve Conflicts
                    </button>
                  </div>
                )}

                {/* File List */}
                <div className="m-4 bg-surface-container-lowest dark:bg-slate-800/50 rounded-lg border border-outline-variant/20 dark:border-slate-700 max-h-[200px] overflow-y-auto divide-y divide-outline-variant/10 dark:divide-slate-700">
                  {fileStatuses.map((fs, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-3 px-3 py-2 text-xs cursor-pointer hover:bg-surface-container-highest/50 dark:hover:bg-slate-700/50 transition-colors ${
                        fs.status === 'unchanged' || fs.configSkipped ? 'opacity-40' : ''
                      }`}
                      onClick={() => {
                        const localFile = files.find(f => f.path === fs.localPath);
                        if (localFile) {
                          setPreviewFile({
                            path: fs.path,
                            localContent: localFile.content,
                            remoteContent: fs.remoteContent,
                            status: fs.status,
                          });
                        }
                      }}
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        fs.configSkipped ? 'bg-blue-400' :
                        fs.status === 'new' ? 'bg-green-500' :
                        fs.status === 'modified' ? 'bg-amber-500' :
                        fs.status === 'error' ? 'bg-red-500' :
                        'bg-slate-400'
                      }`} />
                      <span className="font-mono text-on-surface dark:text-white flex-1 truncate">{fs.path}</span>
                      {fs.isConfig && (
                        <span className="text-[9px] font-bold text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-1 py-0.5 rounded">CFG</span>
                      )}
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        fs.configSkipped ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 line-through' :
                        fs.status === 'new' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                        fs.status === 'modified' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                        fs.status === 'error' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                        'bg-slate-100 dark:bg-slate-700 text-slate-500'
                      }`}>
                        {fs.configSkipped ? 'skip' : fs.status}
                      </span>
                      <span className="material-symbols-outlined text-xs text-on-surface-variant/30">visibility</span>
                    </div>
                  ))}
                </div>

                {/* Push Actions */}
                <div className="p-4 flex gap-3">
                  <button
                    onClick={() => { setPushView('idle'); setFileStatuses([]); setPreviewFile(null); }}
                    disabled={pushView === 'pushing'}
                    className="px-4 py-3 border border-outline-variant/30 dark:border-slate-700 rounded-xl font-bold text-sm hover:bg-surface-container-highest dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                  >
                    Re-check
                  </button>
                  {conflictFiles.length > 0 && (
                    <button
                      onClick={() => setPushView('conflicts')}
                      className="px-4 py-3 bg-amber-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-amber-600 transition-all"
                    >
                      <span className="material-symbols-outlined text-sm">merge_type</span>
                      Resolve ({conflictFiles.length})
                    </button>
                  )}
                  <button
                    onClick={() => executePush()}
                    disabled={pushView === 'pushing' || pushableFiles.length === 0}
                    className="flex-1 py-3 bg-app-red text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-app-red/20 hover:bg-app-dark-red transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {pushView === 'pushing' ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Pushing {pushProgress.current}/{pushProgress.total}...
                      </>
                    ) : pushableFiles.length === 0 ? (
                      <>
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                        All Files Up to Date
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-sm">cloud_upload</span>
                        {conflictFiles.length > 0 ? 'Force Push' : 'Push'} {pushableFiles.length} File{pushableFiles.length > 1 ? 's' : ''} to {pushRepo.split('/').pop()}/{pushBranch}
                      </>
                    )}
                  </button>
                </div>
              </section>
            )}

            {/* ── Success Banner ── */}
            {pushView === 'success' && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-5 flex items-start gap-4">
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-green-600 text-2xl">check_circle</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-green-800 dark:text-green-300">Push Successful!</h4>
                  <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                    {pushableFiles.length} file(s) committed atomically to <strong>{pushRepo}</strong> on branch <strong>{pushBranch}</strong>
                  </p>
                  {commitSha && (
                    <p className="text-[10px] text-green-600/70 dark:text-green-500 mt-1 font-mono">
                      Commit: {commitSha.substring(0, 7)} — {commitMessage}
                    </p>
                  )}
                  {configSkipped.length > 0 && (
                    <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">shield</span>
                      {configSkipped.length} config file(s) intelligently skipped
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => { setPushView('idle'); setFileStatuses([]); setCommitSha(''); }}
                    className="px-4 py-2 bg-green-600 text-white font-bold rounded-lg text-xs hover:bg-green-700 transition-all"
                  >
                    Done
                  </button>
                  <a
                    href={`https://github.com/${pushRepo}/tree/${pushBranch}/${basePath}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 font-bold rounded-lg text-xs hover:bg-green-100 dark:hover:bg-green-900/30 transition-all text-center"
                  >
                    View on GitHub
                  </a>
                </div>
              </div>
            )}

            {/* ── Error Banner ── */}
            {pushView === 'error' && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-red-600 text-xl mt-0.5">error</span>
                  <div>
                    <h4 className="font-bold text-red-800 dark:text-red-300">Push Failed</h4>
                    <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">{pushError}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setPushView('idle'); setPushError(''); setFileStatuses([]); }}
                    className="px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-bold rounded-lg text-xs hover:bg-red-200 dark:hover:bg-red-900/50 transition-all"
                  >
                    Re-check & Retry
                  </button>
                  <button
                    onClick={clearFiles}
                    className="px-4 py-2 text-red-500 font-bold text-xs hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ═══════════ RIGHT: Connected Repos + Push History ═══════════ */}
          <div className="col-span-12 lg:col-span-5 space-y-6">

            {/* ── Connected Repositories ── */}
            <section className="bg-white dark:bg-slate-900 rounded-xl border border-outline-variant/20 dark:border-slate-800 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-outline-variant/10 dark:border-slate-800 bg-surface-container-low dark:bg-slate-800/50 flex items-center gap-2">
                <span className="material-symbols-outlined text-app-red text-xl">account_tree</span>
                <h3 className="font-bold text-on-surface dark:text-white text-sm">Connected Repositories</h3>
                <span className="ml-auto text-[10px] font-bold bg-app-red/10 dark:bg-app-red/20 text-app-red px-2 py-0.5 rounded-full">{repos.length}</span>
              </div>
              {repos.length > 0 ? (
                <div className="divide-y divide-outline-variant/10 dark:divide-slate-800 max-h-[280px] overflow-y-auto">
                  {repos.map((repo, i) => (
                    <button
                      key={i}
                      onClick={() => handleRepoChange(repo.name)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:bg-surface-container-highest/50 dark:hover:bg-slate-800/50 ${
                        pushRepo === repo.name ? 'bg-app-red/5 dark:bg-app-red/10 border-l-4 border-app-red' : 'border-l-4 border-transparent'
                      }`}
                    >
                      <div className="w-8 h-8 rounded bg-surface-container-highest dark:bg-slate-700 flex items-center justify-center text-secondary">
                        <span className="material-symbols-outlined text-lg">{repo.visibility === 'Private' ? 'lock' : 'public'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-on-surface dark:text-white truncate">{repo.name}</div>
                        <div className="text-[10px] text-on-surface-variant dark:text-slate-500">{repo.visibility} · {repo.default_branch}</div>
                      </div>
                      {pushRepo === repo.name && (
                        <span className="material-symbols-outlined text-app-red text-lg">check_circle</span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-on-surface-variant dark:text-slate-500">
                  <span className="material-symbols-outlined text-3xl opacity-30">folder_off</span>
                  <p className="text-xs font-medium mt-2">No repositories found</p>
                  <p className="text-[10px] mt-1">Check your GitHub token permissions</p>
                </div>
              )}
            </section>

            {/* ── Push History ── */}
            <section className="bg-white dark:bg-slate-900 rounded-xl border border-outline-variant/20 dark:border-slate-800 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-outline-variant/10 dark:border-slate-800 bg-surface-container-low dark:bg-slate-800/50 flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-xl">history</span>
                <h3 className="font-bold text-on-surface dark:text-white text-sm">Push History</h3>
                {pushHistory.length > 0 && (
                  <span className="ml-auto text-[10px] bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-bold">{pushHistory.length}</span>
                )}
              </div>
              {pushHistory.length > 0 ? (
                <div className="p-4 space-y-4 max-h-[300px] overflow-y-auto">
                  {pushHistory.map((item, i) => (
                    <div key={i} className="relative pl-5 border-l-2 border-app-red/20">
                      <div className={`absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ${i === 0 ? 'bg-app-red' : 'bg-app-red/30'}`} />
                      <p className="text-[10px] font-bold text-secondary uppercase">{item.time}</p>
                      <p className="text-sm font-bold text-on-surface dark:text-white">{item.title}</p>
                      <p className="text-xs text-on-surface-variant dark:text-slate-400">{item.detail}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {item.sha && <span className="text-[10px] font-mono bg-surface-container-highest dark:bg-slate-800 px-1.5 py-0.5 rounded text-on-surface-variant">{item.sha}</span>}
                        <span className="text-[10px] text-on-surface-variant/60 dark:text-slate-600 font-mono">{item.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-on-surface-variant dark:text-slate-500">
                  <span className="material-symbols-outlined text-3xl opacity-30">history</span>
                  <p className="text-xs font-medium mt-2">No pushes yet this session</p>
                  <p className="text-[10px] mt-1">Push history will appear here</p>
                </div>
              )}
            </section>

            {/* ── Quick Stats ── */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface-container-low dark:bg-slate-900 rounded-xl p-4 text-center border border-outline-variant/10 dark:border-slate-800">
                <div className="text-2xl font-black text-app-red">{repos.length}</div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Repos</div>
              </div>
              <div className="bg-surface-container-low dark:bg-slate-900 rounded-xl p-4 text-center border border-outline-variant/10 dark:border-slate-800">
                <div className="text-2xl font-black text-green-600">{pushHistory.length}</div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Pushes</div>
              </div>
              <div className="bg-surface-container-low dark:bg-slate-900 rounded-xl p-4 text-center border border-outline-variant/10 dark:border-slate-800">
                <div className="text-2xl font-black text-blue-600">{configSkipped.length}</div>
                <div className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Config Skip</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
