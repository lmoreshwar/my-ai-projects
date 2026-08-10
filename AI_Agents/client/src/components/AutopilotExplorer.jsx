import { useState, useCallback, useRef } from 'react';

/* ── API helper (auth via blast_token) ── */
function authHeaders() {
  const token = localStorage.getItem('blast_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

const TEST_TYPES = ['Positive', 'Negative', 'Boundary', 'Security-lite', 'Accessibility'];
const DEFAULT_TYPES = ['Positive', 'Negative'];

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
  const fileInputRef = useRef(null);

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
              Used only for the transient explore session — never stored, logged, or committed.
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
              <div className="text-[11px] text-on-surface-variant dark:text-slate-500 mb-2">
                Job <span className="font-mono">{job.jobId}</span> · status {job.status}
              </div>
              <pre className="text-xs whitespace-pre-wrap font-mono text-on-surface dark:text-slate-200 bg-surface-container dark:bg-slate-800/40 rounded-lg p-3 max-h-[520px] overflow-auto">
                {job.plan}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
