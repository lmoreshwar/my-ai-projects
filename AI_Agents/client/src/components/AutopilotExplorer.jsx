import { useState, useCallback, useRef, useEffect } from 'react';

/* ── API helper (auth via blast_token) ── */
function authHeaders() {
  const token = localStorage.getItem('blast_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const TEST_TYPES = ['Positive', 'Negative', 'Boundary', 'Security-lite', 'Accessibility'];
// Default to Positive only; the user opts into Negative/Boundary/Security/Accessibility manually.
const DEFAULT_TYPES = ['Positive'];
const TERMINAL = new Set(['Passed', 'Partial', 'Failed', 'Completed', 'PushedToGate', 'Merged', 'Discarded']);

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-outline-variant/50 dark:border-slate-700 bg-white dark:bg-slate-800 text-on-surface dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-app-red/40 transition';
const labelCls = 'block text-xs font-semibold text-on-surface-variant dark:text-slate-400 mb-1';

/**
 * Autopilot — Explore & Automate.
 * Phase 0 scaffold: collects URL + feature (+ optional creds/advanced/evidence), posts to
 * /api/automation/explore, and renders the returned scaffold plan. The explore/author engine
 * is wired in Phase 1; this page proves the UX and page→API→job flow.
 */
export default function AutopilotExplorer({ apiBase }) {
  const [form, setForm] = useState({
    url: 'https://www.saucedemo.com',
    feature: '',
    username: '',
    password: '',
    loginUrl: '',
    flowUrls: '',
    scopeHint: '',
    maxCases: 8,
    environment: 'QA',
    notes: '',
  });
  const [testTypes, setTestTypes] = useState(new Set(DEFAULT_TYPES));
  const [showPassword, setShowPassword] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [files, setFiles] = useState([]); // uploaded evidence (name only in Phase 0)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState(null);
  const [proceeding, setProceeding] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPoll(), []);

  const set = useCallback((k, v) => setForm((f) => ({ ...f, [k]: v })), []);

  const toggleType = (t) =>
    setTestTypes((prev) => {
      const n = new Set(prev);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

  const onPickFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...picked.map((f) => ({ name: f.name, size: f.size }))]);
    e.target.value = '';
  };
  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const canSubmit = form.url.trim() && form.feature.trim() && !busy;

  const submit = useCallback(async () => {
    setError('');
    if (!form.url.trim()) return setError('Application URL is required.');
    if (!form.feature.trim()) return setError('Feature / widget name is required.');
    setBusy(true);
    setJob(null);
    try {
      const res = await fetch(`${apiBase}/api/automation/explore`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          url: form.url.trim(),
          feature: form.feature.trim(),
          // Creds are sent for the transient explore session only — the API never persists them.
          username: form.username || undefined,
          password: form.password || undefined,
          environment: form.environment,
          testTypes: [...testTypes],
          maxCases: Number(form.maxCases) || 8,
          loginUrl: form.loginUrl || '',
          flowUrls: (form.flowUrls || '').split(/\r?\n/).map((u) => u.trim()).filter(Boolean),
          scopeHint: form.scopeHint || '',
          notes: form.notes || '',
          evidenceFiles: files.map((f) => f.name),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.msg || `Request failed (${res.status})`);
      setJob(data);
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [apiBase, form, testTypes, files]);

  // Poll generation progress until the run reaches a terminal state.
  const pollProgress = useCallback((jobId) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${apiBase}/api/automation/jobs/${jobId}/progress`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data && data.jobId) {
          setJob(data);
          if (TERMINAL.has(data.status)) { stopPoll(); setProceeding(false); }
        }
      } catch { /* transient — keep polling */ }
    }, 2000);
  }, [apiBase]);

  // Approve the plan → generate + run the scripts (existing pipeline), then stream progress.
  const proceed = useCallback(async () => {
    if (!job) return;
    setError('');
    setProceeding(true);
    try {
      const res = await fetch(`${apiBase}/api/automation/jobs/${job.jobId}/approve`, {
        method: 'POST', headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.msg || `Approve failed (${res.status})`);
      setJob(data);
      if (TERMINAL.has(data.status)) setProceeding(false);
      else pollProgress(job.jobId);
    } catch (e) {
      setError(e.message || 'Could not start generation.');
      setProceeding(false);
    }
  }, [apiBase, job, pollProgress]);

  // Discard the attempt — deletes the orphan generation branch so a fresh run starts from scratch.
  const discard = useCallback(async () => {
    if (!job) return;
    const deleteRemote = job.status === 'PushedToGate' &&
      window.confirm('A branch was already pushed to origin. Also delete the REMOTE branch? This cannot be undone.');
    if (!window.confirm('Discard this attempt and delete the generation branch? Any un-merged generated tests will be removed.')) return;
    setError('');
    setDiscarding(true);
    try {
      const res = await fetch(`${apiBase}/api/automation/jobs/${job.jobId}/discard`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ deleteRemote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.msg || `Discard failed (${res.status})`);
      setJob(data);
    } catch (e) {
      setError(e.message || 'Could not discard the attempt.');
    } finally {
      setDiscarding(false);
    }
  }, [apiBase, job]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <span className="material-symbols-outlined text-app-red text-3xl">travel_explore</span>
        <div>
          <h1 className="text-2xl font-bold text-on-surface dark:text-slate-100 font-headline">
            Autopilot — Explore &amp; Automate
          </h1>
          <p className="text-sm text-on-surface-variant dark:text-slate-400">
            Give a screen. The AI designs the tests. Currently tuned for saucedemo.com.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Form ── */}
        <div className="bg-surface-container-low dark:bg-slate-900 rounded-2xl border border-outline-variant/30 dark:border-slate-800 p-5 space-y-4">
          <div>
            <label className={labelCls}>Application URL *</label>
            <input className={inputCls} value={form.url} onChange={(e) => set('url', e.target.value)}
              placeholder="https://www.saucedemo.com" />
          </div>

          <div>
            <label className={labelCls}>Feature / Widget *</label>
            <input className={inputCls} value={form.feature} onChange={(e) => set('feature', e.target.value)}
              placeholder="Login, Cart, Checkout, Menu…" />
            <p className="text-[11px] text-on-surface-variant/70 dark:text-slate-500 mt-1">
              What to test. Keeps authoring focused — no crawling.
            </p>
          </div>

          {/* Auth */}
          <div className="rounded-lg bg-surface-container dark:bg-slate-800/40 p-3 space-y-3">
            <p className="text-xs font-semibold text-on-surface-variant dark:text-slate-400 flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">lock</span>
              Authentication (optional — leave blank if testing the login page itself)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Username</label>
                <input className={inputCls} value={form.username} autoComplete="off"
                  onChange={(e) => set('username', e.target.value)} placeholder="standard_user" />
              </div>
              <div>
                <label className={labelCls}>Password</label>
                <div className="relative">
                  <input className={inputCls + ' pr-9'} type={showPassword ? 'text' : 'password'}
                    value={form.password} autoComplete="new-password"
                    onChange={(e) => set('password', e.target.value)} placeholder="••••••••" />
                  <button type="button" onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant dark:text-slate-400"
                    title={showPassword ? 'Hide' : 'Show'}>
                    <span className="material-symbols-outlined text-[18px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-on-surface-variant/70 dark:text-slate-500">
              When provided, Autopilot logs in first, then snapshots the feature URL — so screens
              behind a login (Cart, Checkout…) can be explored. Used only for the transient explore
              session — never stored, logged, or committed.
            </p>
          </div>

          {/* Advanced */}
          <button type="button" onClick={() => setShowAdvanced((s) => !s)}
            className="flex items-center gap-1 text-sm font-semibold text-app-red">
            <span className="material-symbols-outlined text-[18px]">
              {showAdvanced ? 'expand_less' : 'expand_more'}
            </span>
            Advanced
          </button>
          {showAdvanced && (
            <div className="space-y-4 pl-1">
              <div>
                <label className={labelCls}>Test types</label>
                <div className="flex flex-wrap gap-2">
                  {TEST_TYPES.map((t) => {
                    const on = testTypes.has(t);
                    return (
                      <button key={t} type="button" onClick={() => toggleType(t)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                          on
                            ? 'bg-app-red text-white border-app-red'
                            : 'bg-transparent text-on-surface-variant dark:text-slate-400 border-outline-variant/50 dark:border-slate-700'
                        }`}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Max cases</label>
                  <input className={inputCls} type="number" min={1} max={30} value={form.maxCases}
                    onChange={(e) => set('maxCases', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>Environment</label>
                  <select className={inputCls} value={form.environment}
                    onChange={(e) => set('environment', e.target.value)}>
                    <option value="QA">QA</option>
                    <option value="UAT">UAT</option>
                    <option value="Production">Production</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Login URL (optional — auth-gated exploration)</label>
                <input className={inputCls} value={form.loginUrl}
                  onChange={(e) => set('loginUrl', e.target.value)} placeholder="defaults to the app origin, e.g. https://www.saucedemo.com" />
              </div>
              <div>
                <label className={labelCls}>Flow / step URLs (optional — one per line, for multi-step features)</label>
                <textarea className={inputCls} rows={3} value={form.flowUrls}
                  onChange={(e) => set('flowUrls', e.target.value)}
                  placeholder={'https://www.saucedemo.com/checkout-step-one.html\nhttps://www.saucedemo.com/checkout-step-two.html'} />
              </div>
              <div>
                <label className={labelCls}>Scope hint (route or CSS selector)</label>
                <input className={inputCls} value={form.scopeHint}
                  onChange={(e) => set('scopeHint', e.target.value)} placeholder="/inventory  or  #login_button_container" />
              </div>
              <div>
                <label className={labelCls}>Notes / acceptance criteria</label>
                <textarea className={inputCls} rows={3} value={form.notes}
                  onChange={(e) => set('notes', e.target.value)} placeholder="Any intent the AI should factor into case design…" />
              </div>
            </div>
          )}

          {/* Evidence upload */}
          <div>
            <label className={labelCls}>Evidence (optional)</label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-outline-variant/50 dark:border-slate-700 rounded-lg p-4 text-center cursor-pointer hover:border-app-red/60 transition">
              <span className="material-symbols-outlined text-app-red">upload_file</span>
              <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-1">
                Click to upload snapshot(s) — PNG/JPG screenshot or a saved .yml/HTML snapshot
              </p>
              <input ref={fileInputRef} type="file" multiple hidden
                accept=".png,.jpg,.jpeg,.yml,.yaml,.html,.htm" onChange={onPickFiles} />
            </div>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between text-xs bg-surface-container dark:bg-slate-800/40 rounded px-2 py-1">
                    <span className="truncate text-on-surface-variant dark:text-slate-300">{f.name}</span>
                    <button type="button" onClick={() => removeFile(i)} className="text-error ml-2">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <div className="text-sm text-error bg-error/10 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">error</span>{error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={submit} disabled={!canSubmit}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white transition ${
                canSubmit ? 'bg-app-red hover:bg-app-dark-red' : 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed'
              }`}>
              {busy ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                  Exploring…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">bolt</span>
                  Preview Plan
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Plan output ── */}
        <div className="bg-surface-container-low dark:bg-slate-900 rounded-2xl border border-outline-variant/30 dark:border-slate-800 p-5">
          <h2 className="text-sm font-bold text-on-surface dark:text-slate-100 mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-app-red text-[20px]">description</span>
            Implementation Plan
          </h2>
          {!job && !busy && (
            <div className="text-sm text-on-surface-variant/70 dark:text-slate-500 py-12 text-center">
              Fill the form and hit <strong>Preview Plan</strong>. The AI-authored plan appears here.
            </div>
          )}
          {busy && (
            <div className="text-sm text-on-surface-variant dark:text-slate-400 py-12 text-center">
              <span className="material-symbols-outlined animate-spin text-app-red">progress_activity</span>
              <p className="mt-2">Exploring the feature and designing test cases…</p>
            </div>
          )}
          {job && (
            <div>
              <div className="text-[11px] text-on-surface-variant dark:text-slate-500 mb-2 flex items-center gap-2">
                Job <span className="font-mono">{job.jobId}</span> · status{' '}
                <span className="font-semibold">{job.status}</span>
                {job.featureSummary ? <span>· {job.featureSummary}</span> : null}
              </div>

              {/* Blocked: exploration could not capture the requested screen — show a precise
                  message and NO test cases; the Proceed button stays hidden/disabled. */}
              {job.blocked && (
                <div className="mb-3 rounded-xl border border-app-red/40 bg-app-red/5 dark:bg-red-950/30 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-app-red">
                    <span className="material-symbols-outlined text-[20px]">block</span>
                    {job.blocked.title}
                  </div>
                  <p className="mt-1 text-xs text-on-surface-variant dark:text-slate-300">{job.blocked.message}</p>
                  {Array.isArray(job.blocked.checklist) && job.blocked.checklist.length > 0 && (
                    <>
                      <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant dark:text-slate-400">What to check</div>
                      <ol className="list-decimal ml-5 mt-1 space-y-0.5 text-xs text-on-surface dark:text-slate-200">
                        {job.blocked.checklist.map((c, i) => <li key={i}>{c}</li>)}
                      </ol>
                    </>
                  )}
                  <p className="mt-2 text-[11px] text-on-surface-variant/80 dark:text-slate-500">
                    No test cases were authored. Fix the input above and run <strong>Preview Plan</strong> again.
                  </p>
                </div>
              )}

              {/* Authored cases */}
              {Array.isArray(job.testCases) && job.testCases.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-bold text-on-surface dark:text-slate-200 mb-1">
                    Authored cases ({job.testCases.length})
                  </div>
                  <ul className="space-y-1 max-h-40 overflow-auto">
                    {job.testCases.map((tc) => (
                      <li key={tc.id} className="text-xs text-on-surface-variant dark:text-slate-300 flex gap-2">
                        <span className="font-mono text-app-red shrink-0">{tc.id}</span>
                        <span className="truncate">{tc.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!job.blocked && (
                <pre className="text-xs whitespace-pre-wrap font-mono text-on-surface dark:text-slate-200 bg-surface-container dark:bg-slate-800/40 rounded-lg p-3 max-h-72 overflow-auto">
                  {job.plan}
                </pre>
              )}

              {/* Missing info blocks Proceed */}
              {Array.isArray(job.missingInfo) && job.missingInfo.length > 0 && (
                <div className="mt-3 text-xs text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 rounded-lg px-3 py-2">
                  <strong>Needs info before proceeding:</strong>
                  <ul className="list-disc ml-4 mt-1">
                    {job.missingInfo.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}

              {/* Proceed / result actions */}
              <div className="mt-3">
                {job.status === 'WaitingForApproval' && (
                  <button onClick={proceed} disabled={proceeding}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 transition">
                    <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                    Proceed — generate scripts
                  </button>
                )}
                {(proceeding || job.status === 'Generating' || job.status === 'Executing') && (
                  <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-300 py-2">
                    <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                    Generating &amp; running the scripts…
                  </div>
                )}
                {(job.status === 'Passed' || job.status === 'Completed') && (
                  <div className="text-sm text-green-700 dark:text-green-300 flex items-center gap-2 py-1">
                    <span className="material-symbols-outlined text-[18px]">check_circle</span>
                    Done — {job.executionStatus || job.status}.
                    {job.reportUrl ? (
                      <a href={`${apiBase}${job.reportUrl}`} target="_blank" rel="noreferrer"
                        className="underline text-app-red ml-1">View report</a>
                    ) : null}
                  </div>
                )}
                {job.status === 'Partial' && (
                  <div className="text-sm text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 font-semibold">
                      <span className="material-symbols-outlined text-[18px]">rule</span>
                      Partial — only passing case(s) were kept.
                      {job.reportUrl ? (
                        <a href={`${apiBase}${job.reportUrl}`} target="_blank" rel="noreferrer"
                          className="underline text-app-red ml-1">View report</a>
                      ) : null}
                    </div>
                    {Array.isArray(job.automatedCases) && job.automatedCases.length > 0 && (
                      <div className="mt-1 text-xs">Automated: <span className="font-mono">{job.automatedCases.join(', ')}</span></div>
                    )}
                    {Array.isArray(job.failedCases) && job.failedCases.length > 0 && (
                      <div className="text-xs">Will retry next run: <span className="font-mono">{job.failedCases.join(', ')}</span></div>
                    )}
                  </div>
                )}
                {job.status === 'Discarded' && (
                  <div className="text-sm text-on-surface-variant dark:text-slate-400 flex items-center gap-2 py-1">
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                    Attempt discarded — generate again to start fresh.
                  </div>
                )}
                {job.status === 'Failed' && (
                  <div className="text-sm text-error flex items-center gap-2 py-1">
                    <span className="material-symbols-outlined text-[18px]">error</span>
                    {job.error || 'Run failed.'}
                    {job.reportUrl ? (
                      <a href={`${apiBase}${job.reportUrl}`} target="_blank" rel="noreferrer"
                        className="underline text-app-red ml-1">View report</a>
                    ) : null}
                  </div>
                )}
                {(job.status === 'Failed' || job.status === 'Partial' || job.status === 'PushedToGate') && (
                  <button onClick={discard} disabled={discarding}
                    className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-semibold text-on-surface-variant dark:text-slate-300 border border-outline-variant/50 dark:border-slate-700 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60 transition">
                    <span className="material-symbols-outlined text-[18px]">{discarding ? 'progress_activity' : 'delete_sweep'}</span>
                    {discarding ? 'Discarding…' : 'Discard attempt'}
                  </button>
                )}
              </div>

              {/* Live logs */}
              {Array.isArray(job.logs) && job.logs.length > 0 && (
                <details className="mt-3" open={proceeding}>
                  <summary className="text-xs font-semibold text-on-surface-variant dark:text-slate-400 cursor-pointer">
                    Logs ({job.logs.length})
                  </summary>
                  <pre className="mt-1 text-[11px] whitespace-pre-wrap font-mono text-on-surface-variant dark:text-slate-400 bg-black/5 dark:bg-black/30 rounded-lg p-2 max-h-52 overflow-auto">
                    {job.logs.join('\n')}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
