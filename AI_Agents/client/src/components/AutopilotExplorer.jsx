import { useState, useCallback, useRef, useEffect } from 'react';
import PrTargetBadge from './PrTargetBadge';
import StatusChip from './StatusChip';

/* ── API helper (auth via blast_token) ── */
function authHeaders() {
  const token = localStorage.getItem('blast_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const TEST_TYPES = ['Positive', 'Negative', 'Boundary', 'Security-lite', 'Accessibility'];
// Default to Positive only; the user opts into Negative/Boundary/Security/Accessibility manually.
const DEFAULT_TYPES = ['Positive'];
const TERMINAL = new Set(['Passed', 'Partial', 'Failed', 'Cancelled', 'Skipped', 'Completed', 'PushedToGate', 'Merged', 'Discarded']);
// States where polling should PAUSE: terminal outcomes plus states that need a user decision
// (the plan is ready to Approve, info is needed, or exploration was blocked).
const STOP_POLLING = new Set([...TERMINAL, 'WaitingForApproval', 'Pending', 'Blocked']);

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-outline-variant/50 dark:border-slate-700 bg-white dark:bg-slate-800 text-on-surface dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-app-red/40 transition';
const labelCls = 'block text-xs font-semibold text-on-surface-variant dark:text-slate-400 mb-1';

// Discovered-vs-Relevant: a display-only semantic role for a discovered control, from its kind.
// Navigation/infrastructure controls stay in the inventory but never become Automation Trace steps.
function controlRole(type) {
  if (type === 'link' || type === 'tab') return { text: 'navigation', cls: 'text-slate-500' };
  if (type === 'file') return { text: 'upload', cls: 'text-app-red' };
  if (type === 'button') return { text: 'action', cls: 'text-sky-600' };
  return { text: 'feature input', cls: 'text-emerald-600' };
}

/**
 * Autopilot — Explore & Automate.
 * Phase 0 scaffold: collects URL + feature (+ optional creds/advanced/evidence), posts to
 * /api/automation/explore, and renders the returned scaffold plan. The explore/author engine
 * is wired in Phase 1; this page proves the UX and page→API→job flow.
 */
export default function AutopilotExplorer({ apiBase, connections }) {
  const [form, setForm] = useState({
    url: '',
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
  // Set when the requested feature already has a passing spec in the connected repo gate — the user
  // chooses [View existing test] / [Automate anyway] instead of silently re-exploring.
  const [duplicate, setDuplicate] = useState(null);
  const [proceeding, setProceeding] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [merging, setMerging] = useState(false);
  const [smoking, setSmoking] = useState(false);
  // Discovery scenario selection (V2 plans): the ids the user ticked in the approval dossier.
  const [selectedScenarios, setSelectedScenarios] = useState(() => new Set());
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);
  // Job ids we've already reconciled once so a stale 'Blocked' doesn't loop.
  const reconciledRef = useRef(new Set());

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

  const submit = useCallback(async (force = false) => {
    setError('');
    if (!form.url.trim()) return setError('Application URL is required.');
    if (!form.feature.trim()) return setError('Feature / widget name is required.');
    setBusy(true);
    setJob(null);
    if (force) setDuplicate(null);
    try {
      const res = await fetch(`${apiBase}/api/automation/explore`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          url: form.url.trim(),
          feature: form.feature.trim(),
          // "Automate anyway" — skip the already-automated guard and explore regardless.
          force: force || undefined,
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
      // The feature is already automated — surface the choice instead of running a full explore.
      if (data && data.alreadyAutomated) { setDuplicate(data.alreadyAutomated); return; }
      setDuplicate(null);
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
          if (STOP_POLLING.has(data.status)) { stopPoll(); setProceeding(false); }
        }
      } catch { /* transient — keep polling */ }
    }, 2000);
  }, [apiBase]);

  // Auto-poll whenever a job is in an active (non-terminal, non-waiting) state — this covers BOTH
  // the Explore phase (after Preview Plan) and the Approve phase, and resumes after a remount.
  // Without this the UI would freeze on "Exploring" because the run finishes server-side but the
  // client never asks for the result.
  useEffect(() => {
    if (job && job.jobId && !STOP_POLLING.has(job.status)) pollProgress(job.jobId);
    else stopPoll();
  }, [job?.jobId, job?.status, pollProgress]);

  // Self-heal a stale 'Blocked': a cloud (github-actions) job may show a Blocked status persisted
  // before the status-sync fix, even though the GitHub run finished green with a valid plan. Because
  // Blocked pauses polling, do ONE reconciliation fetch per job load — the server reclassifies it to
  // WaitingForApproval (plan ready) or leaves it Blocked (a real "nothing to automate" state).
  useEffect(() => {
    if (!job || !job.jobId) return;
    if (job.status !== 'Blocked' || job.provider !== 'github-actions') return;
    if (reconciledRef.current.has(job.jobId)) return;
    reconciledRef.current.add(job.jobId);
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/automation/jobs/${job.jobId}/progress`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data && data.jobId) setJob(data);
      } catch { /* transient — the next open will retry */ }
    })();
  }, [apiBase, job?.jobId, job?.status, job?.provider]);

  // When a V2 discovery plan arrives, pre-select every automation-ready scenario so the user can
  // Proceed immediately (they can still untick). Blocked scenarios are never auto-selected.
  const discoveryScenarios = Array.isArray(job?.discoveryPlan?.scenarios) ? job.discoveryPlan.scenarios : [];
  useEffect(() => {
    if (discoveryScenarios.length) {
      setSelectedScenarios(new Set(discoveryScenarios.filter((s) => s.ready && !s.blocked).map((s) => s.id)));
    }
  }, [job?.jobId, discoveryScenarios.length]);

  const toggleScenario = useCallback((id) => {
    setSelectedScenarios((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Approve the plan → generate + run the scripts (existing pipeline), then stream progress.
  const proceed = useCallback(async () => {
    if (!job) return;
    setError('');
    setProceeding(true);
    try {
      const scenarioIds = Array.from(selectedScenarios);
      const res = await fetch(`${apiBase}/api/automation/jobs/${job.jobId}/approve`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify(scenarioIds.length ? { scenarioIds } : {}),
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
  }, [apiBase, job, pollProgress, selectedScenarios]);

  // Discard the attempt — clears a pending (Exploring/WaitingForApproval) job's lock, or deletes
  // the orphan generation branch after a run, so a fresh run can start.
  const discard = useCallback(async () => {
    if (!job) return;
    const pending = job.status === 'Exploring' || job.status === 'WaitingForApproval';
    const deleteRemote = job.status === 'PushedToGate' &&
      window.confirm('A branch was already pushed to origin. Also delete the REMOTE branch? This cannot be undone.');
    const confirmMsg = pending
      ? 'Cancel and discard this attempt? This clears the pending job so you can start a new one.'
      : 'Discard this attempt and delete the generation branch? Any un-merged generated tests will be removed.';
    if (!window.confirm(confirmMsg)) return;
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

  // Merge the BLAST pull request via the GitHub connection (same token used to open it).
  const mergePr = useCallback(async () => {
    if (!job) return;
    setError('');
    setMerging(true);
    try {
      const res = await fetch(`${apiBase}/api/automation/jobs/${job.jobId}/merge-pr`, {
        method: 'POST', headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.msg || `Merge failed (${res.status})`);
      setJob(data);
    } catch (e) {
      setError(e.message || 'Could not merge the pull request.');
    } finally {
      setMerging(false);
    }
  }, [apiBase, job]);

  // After a merge, trigger a SCOPED @Smoke CI run (not the full suite) and open the Actions run.
  const runSmoke = useCallback(async () => {
    if (!job) return;
    setError('');
    setSmoking(true);
    try {
      const res = await fetch(`${apiBase}/api/automation/jobs/${job.jobId}/run-smoke`, {
        method: 'POST', headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.msg || `Smoke run failed (${res.status})`);
      setJob(data);
      if (data.smokeRunUrl) window.open(data.smokeRunUrl, '_blank', 'noopener');
    } catch (e) {
      setError(e.message || 'Could not start the smoke run.');
    } finally {
      setSmoking(false);
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
            Give a screen. The AI designs the tests. Works with any web application.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Form ── */}
        <div className="bg-surface-container-low dark:bg-slate-900 rounded-2xl border border-outline-variant/30 dark:border-slate-800 p-5 space-y-4">
          <div>
            <label className={labelCls}>Application URL *</label>
            <input className={inputCls} value={form.url} onChange={(e) => set('url', e.target.value)}
              placeholder="https://your-app.com/login" />
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
                  onChange={(e) => set('username', e.target.value)} placeholder="your-username" />
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
                  onChange={(e) => set('loginUrl', e.target.value)} placeholder="defaults to the app origin, e.g. https://your-app.com" />
              </div>
              <div>
                <label className={labelCls}>Flow / step URLs (optional — one per line, for multi-step features)</label>
                <textarea className={inputCls} rows={3} value={form.flowUrls}
                  onChange={(e) => set('flowUrls', e.target.value)}
                  placeholder={'https://your-app.com/step-one\nhttps://your-app.com/step-two'} />
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

          {duplicate && (
            <div className="text-sm rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-3 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
                <span className="material-symbols-outlined text-[18px]">info</span>
                This feature is already automated
              </div>
              <div className="text-on-surface-variant dark:text-slate-300">
                <span className="font-medium">{duplicate.feature}</span> already has a passing test
                {duplicate.testId ? <> (<span className="font-mono">{duplicate.testId}</span>)</> : null}
                {duplicate.mergedAt ? <> · updated {new Date(duplicate.mergedAt).toLocaleDateString()}</> : null}.
                {duplicate.specPath && <div className="font-mono text-xs mt-1 break-all">{duplicate.specPath}</div>}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {duplicate.specUrl && (
                  <a href={duplicate.specUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-outline-variant/40 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    View existing test
                  </a>
                )}
                <button onClick={() => submit(true)} disabled={busy}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-app-red hover:bg-app-dark-red disabled:opacity-60">
                  <span className="material-symbols-outlined text-[16px]">bolt</span>
                  Automate anyway
                </button>
                <button onClick={() => setDuplicate(null)} disabled={busy}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-outline-variant/40 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-error bg-error/10 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">error</span>{error}
            </div>
          )}

          <PrTargetBadge connections={connections} />

          <div className="flex gap-3 pt-1">
            <button onClick={() => submit(false)} disabled={!canSubmit}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white transition ${
                canSubmit ? 'bg-app-red hover:bg-app-dark-red' : 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed'
              }`}>              {busy ? (
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
                Job <span className="font-mono">{job.jobId}</span>
                <StatusChip status={job.status} />
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

              {/* Discovery dossier + scenario picker (V2 plans) */}
              {discoveryScenarios.length > 0 && (
                <div className="mb-3 space-y-3">
                  {job.discoveryPlan?.applicationSummary && (
                    <details className="text-xs bg-surface-container dark:bg-slate-800/40 rounded-lg p-3">
                      <summary className="cursor-pointer font-bold text-on-surface dark:text-slate-200">Application summary</summary>
                      <div className="mt-2 text-on-surface-variant dark:text-slate-300 space-y-0.5">
                        <div>Feature: {job.discoveryPlan.applicationSummary.feature}</div>
                        <div>Page: {job.discoveryPlan.applicationSummary.pageTitle}</div>
                        <div>URL: {job.discoveryPlan.applicationSummary.finalUrl}</div>
                      </div>
                    </details>
                  )}

                  {Array.isArray(job.discoveryPlan?.inventory) && job.discoveryPlan.inventory.length > 0 && (
                    <details className="text-xs bg-surface-container dark:bg-slate-800/40 rounded-lg p-3">
                      <summary className="cursor-pointer font-bold text-on-surface dark:text-slate-200">
                        Discovered controls ({job.discoveryPlan.inventory.length})
                        <span className="ml-1 text-[10px] font-normal opacity-60">— everything on the page; only feature-relevant controls become Automation Trace steps</span>
                      </summary>
                      <ul className="mt-2 space-y-1 max-h-52 overflow-auto">
                        {job.discoveryPlan.inventory.map((it) => {
                          const role = controlRole(it.type);
                          return (
                            <li key={it.id} className="flex gap-2 items-baseline text-on-surface-variant dark:text-slate-300">
                              <span className="font-mono text-[10px] shrink-0 opacity-70">{it.type}</span>
                              <span className={`text-[10px] shrink-0 ${role.cls}`}>{role.text}</span>
                              <span className="truncate">{it.label}</span>
                              {it.required === true && <span className="text-[10px] text-amber-600">required</span>}
                              {it.prepopulated && <span className="text-[10px] text-sky-600">prefilled</span>}
                              {it.blocked && <span className="text-[10px] text-app-red">⛔ {it.blockedReason || 'blocked'}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}

                  {job.discoveryPlan?.completeness && (
                    <div className={`text-xs rounded-lg px-3 py-2 ${job.discoveryPlan.completeness.passed ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'}`}>
                      {job.discoveryPlan.completeness.passed
                        ? 'Discovery completeness: PASS'
                        : `Discovery gaps: ${(job.discoveryPlan.completeness.missing || []).join('; ')}`}
                    </div>
                  )}

                  <div>
                    <div className="text-xs font-bold text-on-surface dark:text-slate-200 mb-1">
                      Select scenarios to automate ({selectedScenarios.size} selected)
                    </div>
                    <ul className="space-y-1.5">
                      {discoveryScenarios.map((s) => {
                        const disabled = s.blocked || !s.ready;
                        const steps = Array.isArray(s.steps) ? s.steps : [];
                        const executableCount = steps.filter((st) => st.type !== 'click' && !st.blocked).length;
                        const blockedCount = steps.filter((st) => st.blocked).length;
                        return (
                          <li key={s.id}>
                            <label className={`flex gap-2 items-start text-xs rounded-lg px-2 py-1.5 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-surface-container dark:hover:bg-slate-800/40'}`}>
                              <input type="checkbox" className="mt-0.5" disabled={disabled}
                                checked={selectedScenarios.has(s.id)} onChange={() => toggleScenario(s.id)} />
                              <span className="min-w-0">
                                <span className="font-mono text-app-red mr-1">{s.id}</span>
                                <span className="text-on-surface dark:text-slate-200">{s.title}</span>
                                <span className="ml-1 text-[10px] opacity-70">[{s.type}]</span>
                                <span className={`ml-1 text-[10px] ${s.ready ? 'text-green-600' : 'text-amber-600'}`}>
                                  {s.ready ? '● automation-ready' : '○ needs a probe'}
                                </span>
                                {disabled && <span className="block text-[10px] text-app-red">{s.blockedReason || 'Not automation-ready'}</span>}
                                {steps.length > 0 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-[10px] opacity-70">
                                      Automation Trace — {executableCount} executable step{executableCount === 1 ? '' : 's'}{blockedCount ? `, ${blockedCount} blocked` : ''}
                                    </summary>
                                    <ol className="mt-1 ml-1 space-y-0.5">
                                      {steps.map((st) => (
                                        <li key={st.order} className={`flex gap-1.5 items-baseline text-[10px] ${st.blocked ? 'text-app-red' : 'text-on-surface-variant dark:text-slate-300'}`}>
                                          <span className="font-mono opacity-70 shrink-0">{st.order}.</span>
                                          <span className="font-mono opacity-70 shrink-0">{st.type}</span>
                                          {st.classification && <span className="opacity-60 shrink-0">[{st.classification}]</span>}
                                          <span className="truncate">{st.action}</span>
                                          {st.blocked && <span className="shrink-0">⛔ {st.blockedReason || 'blocked — not executable'}</span>}
                                        </li>
                                      ))}
                                    </ol>
                                  </details>
                                )}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
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
                  <button onClick={proceed} disabled={proceeding || (discoveryScenarios.length > 0 && selectedScenarios.size === 0)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 transition">
                    <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                    {discoveryScenarios.length > 0 ? `Proceed — generate ${selectedScenarios.size} scenario(s)` : 'Proceed — generate scripts'}
                  </button>
                )}
                {/* A failed/partial generation keeps the SAME plan — one click retries codegen without re-exploring. */}
                {(job.status === 'Failed' || job.status === 'Partial') && (
                  <button onClick={proceed} disabled={proceeding}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 transition">
                    <span className="material-symbols-outlined text-[18px]">refresh</span>
                    Retry — generate scripts
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

                {/* Merge PR — appears once a pull request exists and is not yet merged. */}
                {job.prUrl && !job.prMerged && job.status !== 'Merged' &&
                  (job.status === 'Passed' || job.status === 'Completed' || job.status === 'PushedToGate' || job.status === 'Partial') && (
                  <div className="mt-1 space-y-2">
                    <a href={job.prUrl} target="_blank" rel="noreferrer"
                      className="text-xs underline text-app-red flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      View pull request{job.prNumber ? ` #${job.prNumber}` : ''}
                    </a>
                    <button onClick={mergePr} disabled={merging}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-60 transition">
                      <span className="material-symbols-outlined text-[18px]">{merging ? 'progress_activity' : 'merge'}</span>
                      {merging ? 'Merging…' : 'Merge PR'}
                    </button>
                    {job.prMergeable === false && (
                      <div className="text-xs text-error flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">warning</span>
                        Not mergeable ({job.prMergeableState || 'conflict'}) — resolve on GitHub first.
                      </div>
                    )}
                  </div>
                )}

                {/* Merged — show the merge + a scoped smoke run (NOT the full suite). */}
                {(job.status === 'Merged' || job.prMerged) && (
                  <div className="mt-1 space-y-2">
                    <div className="text-sm text-green-700 dark:text-green-300 flex items-center gap-2 py-1">
                      <span className="material-symbols-outlined text-[18px]">merge</span>
                      Merged{job.prNumber ? ` #${job.prNumber}` : ''}.
                      {job.prUrl ? (
                        <a href={job.prUrl} target="_blank" rel="noreferrer"
                          className="underline text-app-red ml-1">View PR</a>
                      ) : null}
                    </div>
                    <button onClick={runSmoke} disabled={smoking}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 transition">
                      <span className="material-symbols-outlined text-[18px]">{smoking ? 'progress_activity' : 'bolt'}</span>
                      {smoking ? 'Starting smoke run…' : 'Run Smoke Tests'}
                    </button>
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
                {(job.status === 'Exploring' || job.status === 'WaitingForApproval' || job.status === 'Failed' || job.status === 'Partial' || job.status === 'PushedToGate') && (
                  <button onClick={discard} disabled={discarding}
                    className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-semibold text-on-surface-variant dark:text-slate-300 border border-outline-variant/50 dark:border-slate-700 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60 transition">
                    <span className="material-symbols-outlined text-[18px]">{discarding ? 'progress_activity' : 'delete_sweep'}</span>
                    {discarding
                      ? 'Discarding…'
                      : (job.status === 'Exploring' || job.status === 'WaitingForApproval' ? 'Cancel & discard' : 'Discard attempt')}
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
