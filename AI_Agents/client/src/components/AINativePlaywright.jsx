import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import CustomSelect from './CustomSelect';
import {
  automationFeasibleCases,
  estimateComplexity,
  primaryTag,
} from '../utils/testCaseParser';

/* ── API helper (auth via blast_token) ── */
function authHeaders() {
  const token = localStorage.getItem('blast_token');
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function api(apiBase, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${apiBase}/api/automation${path}`, {
    method,
    headers: authHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || `Request failed (${res.status})`);
  return data;
}

/* ── Status → badge styling ── */
const STATUS_STYLE = {
  Pending: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  Planning: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  WaitingForApproval: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Generating: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  Executing: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  HandedToCopilot: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  Passed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  Failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  PushedToGate: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  Completed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
};

const COMPLEXITY_STYLE = {
  Low: 'text-green-600 dark:text-green-400',
  Medium: 'text-amber-600 dark:text-amber-400',
  High: 'text-red-600 dark:text-red-400',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[status] || STATUS_STYLE.Pending}`}>
      {status || '—'}
    </span>
  );
}

/* Live Copilot handoff status — reflects real log activity, not a fake spinner. */
const COPILOT_PILL = {
  starting: { label: 'Starting…', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', icon: 'hourglass_top', spin: true },
  running: { label: 'In progress', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', icon: 'progress_activity', spin: true },
  awaiting: { label: 'Waiting for your input', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', icon: 'contact_support', spin: false },
  stalled: { label: 'Still working — quiet for a while', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300', icon: 'progress_activity', spin: true },
  passed: { label: 'Passed', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', icon: 'check_circle', spin: false },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', icon: 'cancel', spin: false },
  error: { label: 'Errored — stopped', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', icon: 'error', spin: false },
};

function CopilotStatusPill({ status }) {
  const s = COPILOT_PILL[status];
  if (!s) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.cls}`}>
      <span className={`material-symbols-outlined text-sm ${s.spin ? 'animate-spin' : ''}`}>{s.icon}</span>
      {s.label}
    </span>
  );
}

const SKILLS = ['New Automation', 'Modify Automation', 'Debug', 'Self Healing', 'Visual Testing'];
const ENVIRONMENTS = ['QA', 'UAT', 'Production'];
const EXECUTION_MODES = [
  { value: 'GenerateOnly', label: 'Generate Only' },
  { value: 'GenerateAndExecute', label: 'Generate and Execute' },
  { value: 'GenerateExecutePushToGate', label: 'Generate, Execute & Push to Gate' },
];

/* ── Run Logs console: large, readable, auto-scrolling, colour-coded ── */
const LOG_TONE = [
  { re: /\[error\]|error|failed|✗|❌/i, cls: 'text-red-400' },
  { re: /\[cloud\]|\[runner\]|dispatched|queued/i, cls: 'text-sky-300' },
  { re: /passed|success|✓|✅|done|reuse/i, cls: 'text-emerald-300' },
  { re: /\[warn\]|warning|skipped|⚠/i, cls: 'text-amber-300' },
];
function toneFor(line) {
  const hit = LOG_TONE.find((t) => t.re.test(line));
  return hit ? hit.cls : 'text-slate-300';
}

function RunLogsConsole({ logs, live, trackUrl }) {
  const bodyRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [stuck, setStuck] = useState(true); // auto-follow newest line while pinned to bottom

  useEffect(() => {
    if (stuck && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [logs, stuck]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logs.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — ignore */ }
  };

  return (
    <div className="rounded-md border border-slate-700 overflow-hidden shadow-sm">
      {/* header bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 border-b border-slate-700">
        <span className="material-symbols-outlined text-base text-emerald-400">terminal</span>
        <span className="text-xs font-semibold text-slate-100">Run Logs</span>
        {live && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> live
          </span>
        )}
        <span className="text-[11px] text-slate-400">{logs.length} line{logs.length === 1 ? '' : 's'}</span>
        <div className="ml-auto flex items-center gap-2">
          {trackUrl && (
            <a href={trackUrl} target="_blank" rel="noreferrer"
               className="text-[11px] text-sky-300 hover:text-sky-200 underline flex items-center gap-0.5">
              <span className="material-symbols-outlined text-sm">open_in_new</span> GitHub Actions
            </a>
          )}
          <button onClick={copy}
                  className="text-[11px] text-slate-300 hover:text-white flex items-center gap-0.5">
            <span className="material-symbols-outlined text-sm">{copied ? 'check' : 'content_copy'}</span>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {/* scrollable body — resizable, monospace, roomy line height */}
      <div ref={bodyRef} onScroll={onScroll}
           className="bg-slate-900 text-[13px] font-mono leading-relaxed p-4 overflow-y-auto resize-y"
           style={{ height: '22rem', minHeight: '12rem' }}>
        {logs.map((line, i) => (
          <div key={i} className="flex gap-3 hover:bg-white/5 -mx-4 px-4">
            <span className="select-none text-slate-600 w-8 text-right shrink-0 tabular-nums">{i + 1}</span>
            <span className={`whitespace-pre-wrap break-words ${toneFor(line)}`}>{line}</span>
          </div>
        ))}
        {live && (
          <div className="flex gap-3 -mx-4 px-4">
            <span className="w-8 shrink-0" />
            <span className="text-slate-500 animate-pulse">▋ waiting for more output…</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AINativePlaywright({ apiBase, generatedTestCases, onNavigate }) {
  const cases = useMemo(() => automationFeasibleCases(generatedTestCases), [generatedTestCases]);

  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Active job + list
  const [jobs, setJobs] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [answerUrl, setAnswerUrl] = useState('');
  const [copilotLog, setCopilotLog] = useState('');
  const [copilotStatus, setCopilotStatus] = useState('idle');
  const copilotActivity = useRef({ len: -1, changedAt: 0 });

  // Plan editing + Copilot inbox input
  const [editingPlan, setEditingPlan] = useState(false);
  const [planDraft, setPlanDraft] = useState('');
  const [copilotInput, setCopilotInput] = useState('');

  // Dialog form
  const [form, setForm] = useState({
    project: 'SauceDemo',
    environment: 'QA',
    url: '',
    agent: 'AI Native Playwright Engineer',
    skill: 'New Automation',
    executionMode: 'GenerateAndExecute',
    comments: '',
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases
      .map((tc) => ({
        id: tc['SRL No.'],
        scenario: tc['Test Case Title'] || '',
        type: tc['Test Case Type'] || '',
        tags: tc['Tags'] || '',
        executionTags: tc['Execution Tags'] || '',
        complexity: estimateComplexity(tc),
        feature: primaryTag(tc),
        description: tc['Description'] || '',
        preconditions: tc['Pre-conditions'] || '',
        testData: tc['Test Data'] || '',
        steps: tc['Test Steps'] || '',
        expectedResults: tc['Expected Results'] || '',
        comments: tc['Comments'] || '',
      }))
      .filter((r) => !q || `${r.id} ${r.scenario} ${r.tags}`.toLowerCase().includes(q));
  }, [cases, search]);

  const jobByCaseId = useMemo(() => {
    const map = {};
    jobs.forEach((j) => (j.testCases || []).forEach((tc) => { map[tc.id] = j; }));
    return map;
  }, [jobs]);

  const loadJobs = useCallback(async () => {
    try {
      const list = await api(apiBase, '/jobs');
      setJobs(Array.isArray(list) ? list : []);
    } catch {
      /* dashboard still works without job history */
    }
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await api(apiBase, '/jobs');
        if (active) setJobs(Array.isArray(list) ? list : []);
      } catch {
        /* dashboard still works without job history */
      }
    })();
    return () => { active = false; };
  }, [apiBase]);

  // Live progress: while a job is generating/executing, poll every 2s for fresh logs & status.
  const activeJobId = activeJob?.jobId;
  const activeStatus = activeJob?.status;
  useEffect(() => {
    if (!activeJobId) return undefined;
    if (activeStatus !== 'Generating' && activeStatus !== 'Executing') return undefined;
    let active = true;
    const tick = async () => {
      try {
        const job = await api(apiBase, `/jobs/${activeJobId}/progress`);
        if (!active) return;
        setActiveJob(job);
        setJobs((prev) => (Array.isArray(prev) ? prev.map((j) => (j.jobId === job.jobId ? job : j)) : prev));
      } catch { /* keep polling */ }
    };
    const id = setInterval(tick, 2000);
    return () => { active = false; clearInterval(id); };
  }, [activeJobId, activeStatus, apiBase]);

  // Derive a REAL Copilot status from log activity + terminal markers (shared by the live
  // stream and the polling fallback). Never a fake spinner.
  const applyCopilotLog = useCallback((log) => {
    if (typeof log !== 'string') return;
    setCopilotLog(log);
    const now = Date.now();
    if (log.length !== copilotActivity.current.len) {
      copilotActivity.current = { len: log.length, changedAt: now };
    }
    const terminal = /\[copilot\]\s*DONE\s*PASSED/i.test(log) ? 'passed'
      : /\[copilot\]\s*DONE\s*FAILED/i.test(log) ? 'failed'
      : /\[copilot\]\s*ERROR/i.test(log) ? 'error' : '';
    if (terminal) { setCopilotStatus(terminal); return; }
    // Needs-input takes priority: a NEEDS-INPUT marker with no later RESUMED/user reply means
    // it's waiting on the user. This is NOT a failure — the run is paused, not stopped.
    const lastNeeds = log.lastIndexOf('[copilot] NEEDS-INPUT');
    const lastResumed = Math.max(log.lastIndexOf('[copilot] RESUMED'), log.lastIndexOf('[user]'));
    if (lastNeeds > -1 && lastNeeds > lastResumed) { setCopilotStatus('awaiting'); return; }
    const stale = now - copilotActivity.current.changedAt;
    const started = /\n.+\n/.test(log); // more than just the seed line
    // Only after a LONG quiet spell (5 min) do we downgrade to a calm "still working" note.
    setCopilotStatus(stale > 300000 ? 'stalled' : (started ? 'running' : 'starting'));
  }, []);

  // Copilot handoff: stream the log LIVE over SSE (no polling gap). Falls back to a 1s poll
  // if the browser/stream can't hold the connection so the console never freezes.
  useEffect(() => {
    if (!activeJobId || activeStatus !== 'HandedToCopilot') return undefined;
    copilotActivity.current = { len: -1, changedAt: Date.now() };

    let closedByUs = false;
    let pollId = null;
    let es = null;

    const startPolling = () => {
      if (pollId) return;
      const tick = async () => {
        try {
          const { log } = await api(apiBase, `/jobs/${activeJobId}/copilot-log`);
          applyCopilotLog(log);
        } catch { /* keep polling */ }
      };
      tick();
      pollId = setInterval(tick, 1000);
    };

    if (typeof EventSource !== 'undefined') {
      const token = localStorage.getItem('blast_token') || '';
      const url = `${apiBase}/api/automation/jobs/${activeJobId}/copilot-stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      try {
        es = new EventSource(url);
        es.onmessage = (ev) => {
          try { applyCopilotLog(JSON.parse(ev.data).log); } catch { /* ignore malformed frame */ }
        };
        es.onerror = () => {
          if (es) { es.close(); es = null; }
          if (!closedByUs) startPolling(); // graceful degradation to polling
        };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      closedByUs = true;
      if (es) es.close();
      if (pollId) clearInterval(pollId);
    };
  }, [activeJobId, activeStatus, apiBase, applyCopilotLog]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const openGenerate = () => {
    if (selected.size === 0) { setError('Select at least one automation-feasible test case.'); return; }
    setError('');
    setDialogOpen(true);
  };

  const submitGenerate = async () => {
    setBusy('generate');
    setError('');
    try {
      const payload = {
        ...form,
        testCases: rows
          .filter((r) => selected.has(r.id))
          .map((r) => ({
            id: r.id,
            title: r.scenario,
            tags: r.tags,
            executionTags: r.executionTags,
            complexity: r.complexity,
            description: r.description,
            preconditions: r.preconditions,
            testData: r.testData,
            steps: r.steps,
            expectedResults: r.expectedResults,
            comments: r.comments,
          })),
      };
      const job = await api(apiBase, '/generate', { method: 'POST', body: payload });
      setActiveJob(job);
      setAnswerUrl(job.url || '');
      setDialogOpen(false);
      await loadJobs();
    } catch (e) {
      setError(e.message);
    }
    setBusy('');
  };

  const submitAnswer = async () => {
    if (!activeJob) return;
    setBusy('answer');
    try {
      const job = await api(apiBase, `/jobs/${activeJob.jobId}/answer`, { method: 'POST', body: { url: answerUrl } });
      setActiveJob(job);
      await loadJobs();
    } catch (e) { setError(e.message); }
    setBusy('');
  };

  const approve = async () => {
    if (!activeJob) return;
    setBusy('approve');
    try {
      const job = await api(apiBase, `/jobs/${activeJob.jobId}/approve`, { method: 'POST' });
      setActiveJob(job);
      await loadJobs();
    } catch (e) { setError(e.message); }
    setBusy('');
  };

  const runCopilot = async () => {
    if (!activeJob) return;
    setBusy('copilot');
    setCopilotLog('');
    try {
      const job = await api(apiBase, `/jobs/${activeJob.jobId}/run-copilot`, { method: 'POST' });
      setActiveJob(job);
      await loadJobs();
    } catch (e) { setError(e.message); }
    setBusy('');
  };

  const startEditPlan = () => { setPlanDraft(activeJob?.plan || ''); setEditingPlan(true); };
  const cancelEditPlan = () => { setEditingPlan(false); setPlanDraft(''); };
  const savePlan = async () => {
    if (!activeJob) return;
    setBusy('plan');
    try {
      const job = await api(apiBase, `/jobs/${activeJob.jobId}/plan`, { method: 'PATCH', body: { plan: planDraft } });
      setActiveJob(job);
      setEditingPlan(false);
      await loadJobs();
    } catch (e) { setError(e.message); }
    setBusy('');
  };

  const sendCopilotInput = async () => {
    if (!activeJob || !copilotInput.trim()) return;
    setBusy('copilot-input');
    try {
      const { log } = await api(apiBase, `/jobs/${activeJob.jobId}/copilot-input`, { method: 'POST', body: { message: copilotInput.trim() } });
      if (typeof log === 'string') setCopilotLog(log);
      setCopilotInput('');
    } catch (e) { setError(e.message); }
    setBusy('');
  };

  const stopCopilot = async () => {
    if (!activeJob) return;
    if (!window.confirm('Stop this Copilot run? It will halt at the next safe checkpoint.')) return;
    setBusy('copilot-stop');
    try {
      const { log } = await api(apiBase, `/jobs/${activeJob.jobId}/copilot-stop`, { method: 'POST' });
      if (typeof log === 'string') applyCopilotLog(log);
    } catch (e) { setError(e.message); }
    setBusy('');
  };

  const pushToGate = async () => {
    if (!activeJob) return;
    if (!window.confirm(`Push generated tests to a new branch (blast/auto-${activeJob.jobId.toLowerCase()}) in the framework repo and open a PR?`)) return;
    setBusy('gate');
    try {
      const job = await api(apiBase, `/jobs/${activeJob.jobId}/push-gate`, { method: 'POST' });
      setActiveJob(job);
      await loadJobs();
    } catch (e) { setError(e.message); }
    setBusy('');
  };

  const refreshProgress = async () => {
    if (!activeJob) return;
    setBusy('progress');
    try {
      const job = await api(apiBase, `/jobs/${activeJob.jobId}/progress`);
      setActiveJob(job);
      await loadJobs();
    } catch (e) { setError(e.message); }
    setBusy('');
  };

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const reportHref = (u) => (u && u.startsWith('/') ? `${apiBase}${u}` : u);

  /* ── Empty state ── */
  if (cases.length === 0) {
    return (
      <div className="p-8 text-center">
        <span className="material-symbols-outlined text-5xl text-app-red mb-3">smart_toy</span>
        <h2 className="text-xl font-bold mb-2">AI Native Playwright</h2>
        <p className="text-on-surface-variant dark:text-slate-400 max-w-md mx-auto">
          No automation-feasible test cases found. Generate test cases and mark them with the
          <span className="font-semibold"> Automation </span> execution tag, review &amp; approve them,
          then return here.
        </p>
        <button
          onClick={() => onNavigate && onNavigate('test-cases')}
          className="mt-4 px-4 py-2 bg-app-red text-white rounded-sm text-sm font-medium hover:bg-app-dark-red transition-colors"
        >
          Go to Create Test Cases
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-3xl text-app-red">smart_toy</span>
        <div>
          <h2 className="text-xl font-bold">AI Native Playwright Automation</h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Orchestrates the AI Native Playwright Framework — plan-first, reuse-first, evidence-based.
          </p>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-sm bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-grow min-w-[200px] max-w-sm">
          <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search test cases…"
            className="w-full pl-8 pr-3 py-2 rounded-sm border border-outline-variant/40 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
          />
        </div>
        <button onClick={loadJobs} className="px-3 py-2 rounded-sm border border-outline-variant/40 dark:border-slate-700 text-sm flex items-center gap-1 hover:bg-surface-container-high dark:hover:bg-slate-800">
          <span className="material-symbols-outlined text-lg">refresh</span> Refresh
        </button>
        <button
          onClick={openGenerate}
          disabled={selected.size === 0}
          className="px-4 py-2 rounded-sm bg-app-red text-white text-sm font-medium flex items-center gap-1 hover:bg-app-dark-red transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-lg">auto_awesome</span>
          Generate Automation{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>

      {/* Dashboard table */}
      <div className="overflow-x-auto rounded-sm border border-outline-variant/30 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-surface-container-high dark:bg-slate-800 text-left">
            <tr>
              <th className="p-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="p-2">Test Case ID</th>
              <th className="p-2">Scenario</th>
              <th className="p-2">Type</th>
              <th className="p-2">Feature</th>
              <th className="p-2">Complexity</th>
              <th className="p-2">Automation Status</th>
              <th className="p-2">Report</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const job = jobByCaseId[r.id];
              return (
                <tr key={r.id} className="border-t border-outline-variant/20 dark:border-slate-700/50 hover:bg-surface-container-low dark:hover:bg-slate-800/50">
                  <td className="p-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.id}`} />
                  </td>
                  <td className="p-2 font-mono text-xs whitespace-nowrap">{r.id}</td>
                  <td className="p-2 max-w-xs truncate" title={r.scenario}>{r.scenario}</td>
                  <td className="p-2 whitespace-nowrap">{r.type || '—'}</td>
                  <td className="p-2 whitespace-nowrap">{r.feature}</td>
                  <td className={`p-2 font-medium ${COMPLEXITY_STYLE[r.complexity]}`}>{r.complexity}</td>
                  <td className="p-2"><StatusBadge status={job ? job.status : 'Pending'} /></td>
                  <td className="p-2">
                    {job && job.reportUrl
                      ? <a href={reportHref(job.reportUrl)} target="_blank" rel="noreferrer" className="text-app-red text-xs underline">Open report ↗</a>
                      : <span className="text-slate-400 text-xs">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Active job panel: plan → missing info → approve → results */}
      {activeJob && (
        <div className="rounded-sm border border-outline-variant/30 dark:border-slate-700 p-4 space-y-3 bg-surface-container-low dark:bg-slate-800/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{activeJob.jobId}</span>
              <StatusBadge status={activeJob.status} />
              {activeJob.provider && activeJob.provider !== 'simulation' && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{activeJob.provider}</span>
              )}
            </div>
            <button onClick={() => setActiveJob(null)} className="text-slate-400 hover:text-slate-600">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          {/* Missing info — blocks until provided */}
          {activeJob.missingInfo && activeJob.missingInfo.length > 0 && (
            <div className="rounded-sm bg-amber-50 dark:bg-amber-900/30 p-3 space-y-2">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Additional information required</p>
              <ul className="list-disc list-inside text-sm text-amber-700 dark:text-amber-300">
                {activeJob.missingInfo.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
              <div className="flex gap-2 items-center">
                <input
                  value={answerUrl}
                  onChange={(e) => setAnswerUrl(e.target.value)}
                  placeholder="Application URL (QA/UAT)"
                  className="flex-grow px-3 py-2 rounded-sm border border-outline-variant/40 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                />
                <button onClick={submitAnswer} disabled={busy === 'answer'} className="px-3 py-2 rounded-sm bg-app-red text-white text-sm disabled:opacity-50">
                  Submit
                </button>
              </div>
            </div>
          )}

          {/* Plan */}
          {activeJob.plan && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-semibold">Implementation Plan</p>
                {!editingPlan ? (
                  <button onClick={startEditPlan} className="text-xs text-app-red underline flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">edit</span> Edit plan
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={savePlan} disabled={busy === 'plan'} className="text-xs px-2 py-1 rounded-sm bg-green-600 text-white disabled:opacity-50">
                      {busy === 'plan' ? 'Saving…' : 'Save plan'}
                    </button>
                    <button onClick={cancelEditPlan} className="text-xs px-2 py-1 rounded-sm border border-outline-variant/40 dark:border-slate-700">Cancel</button>
                  </div>
                )}
              </div>
              {editingPlan ? (
                <>
                  <textarea
                    value={planDraft}
                    onChange={(e) => setPlanDraft(e.target.value)}
                    rows={12}
                    className="w-full text-xs font-mono bg-white dark:bg-slate-900 rounded-sm p-3 border border-outline-variant/30 dark:border-slate-700"
                    placeholder="Edit the implementation plan — add steps, constraints, or extra context. This drives both the LLM and Copilot runs."
                  />
                  <p className="text-[11px] text-on-surface-variant dark:text-slate-400 mt-1">
                    Your edits are used by both <span className="font-medium">Approve &amp; Generate (LLM)</span> and <span className="font-medium">Run with Copilot</span>.
                  </p>
                </>
              ) : (
                <pre className="text-xs whitespace-pre-wrap bg-white dark:bg-slate-900 rounded-sm p-3 border border-outline-variant/30 dark:border-slate-700 max-h-72 overflow-y-auto">
                  {activeJob.plan}
                </pre>
              )}
            </div>
          )}

          {/* Approve */}
          {activeJob.status === 'WaitingForApproval' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={approve} disabled={busy === 'approve'} className="px-4 py-2 rounded-sm bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1">
                  <span className="material-symbols-outlined text-lg">check_circle</span>
                  {busy === 'approve' ? 'Generating…' : 'Approve & Generate (LLM)'}
                </button>
                <button onClick={runCopilot} disabled={busy === 'copilot'} className="px-4 py-2 rounded-sm bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1" title="Hand this job to the local VS Code Copilot agent (evidence-based locators, real agentic run). Console streams below.">
                  <span className="material-symbols-outlined text-lg">smart_toy</span>
                  {busy === 'copilot' ? 'Handing off…' : 'Run with Copilot'}
                </button>
              </div>
              <ul className="text-[11px] text-on-surface-variant dark:text-slate-400 space-y-0.5">
                <li><span className="font-semibold text-green-700 dark:text-green-400">Approve &amp; Generate (LLM):</span> the backend LLM writes the code directly, runs it, and self-heals once. Fast, fully automated, no editor needed.</li>
                <li><span className="font-semibold text-indigo-600 dark:text-indigo-300">Run with Copilot:</span> hands the job to the VS Code Copilot agent (evidence-based locators via @playwright/cli). Its live console streams below; you can send it more info mid-run.</li>
              </ul>
            </div>
          )}

          {/* Copilot handoff console (live tail) */}
          {activeJob.status === 'HandedToCopilot' && (
            <div>
              <div className="text-sm font-semibold mb-1 flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-indigo-500">terminal</span>
                <span>Copilot console (live)</span>
                <CopilotStatusPill status={copilotStatus} />
                {activeJob.copilotHandoff?.launched === false && (
                  <span className="text-[11px] font-normal text-amber-600 dark:text-amber-400">
                    auto-launch failed — run <span className="font-mono">{activeJob.copilotHandoff?.batRel}</span> manually
                  </span>
                )}
              </div>
              {(copilotStatus === 'awaiting' || copilotStatus === 'error') && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-1">
                  {copilotStatus === 'awaiting'
                    ? 'Copilot needs more information — type it below and click Send. The run is paused, not stopped.'
                    : 'Copilot reported an error and stopped. See the last log line below.'}
                </p>
              )}
              <pre className={`text-[11px] whitespace-pre-wrap bg-slate-900 text-emerald-300 rounded-sm p-3 max-h-72 overflow-y-auto border ${copilotStatus === 'error' || copilotStatus === 'failed' ? 'border-red-600/50' : copilotStatus === 'awaiting' ? 'border-amber-500/50' : 'border-indigo-700/40'}`}>
                {copilotLog || 'Waiting for Copilot to start… (watch the VS Code chat panel)'}
              </pre>
              {/* Send additional info to the running Copilot agent (file-based inbox) */}
              <div className="flex gap-2 items-center mt-2">
                <input
                  value={copilotInput}
                  onChange={(e) => setCopilotInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendCopilotInput(); }}
                  placeholder="Send more info to Copilot (e.g. the login URL, credentials to use, a clarification)…"
                  className="flex-grow px-3 py-2 rounded-sm border border-outline-variant/40 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                />
                <button
                  onClick={sendCopilotInput}
                  disabled={busy === 'copilot-input' || !copilotInput.trim()}
                  className="px-3 py-2 rounded-sm bg-indigo-600 text-white text-sm disabled:opacity-50 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-base">send</span>
                  {busy === 'copilot-input' ? 'Sending…' : 'Send'}
                </button>
                <button
                  onClick={stopCopilot}
                  disabled={busy === 'copilot-stop' || copilotStatus === 'passed' || copilotStatus === 'failed' || copilotStatus === 'error'}
                  title="Halt this Copilot run at the next safe checkpoint."
                  className="px-3 py-2 rounded-sm bg-red-600 text-white text-sm disabled:opacity-50 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-base">stop_circle</span>
                  {busy === 'copilot-stop' ? 'Stopping…' : 'Stop'}
                </button>
              </div>
              <p className="text-[10px] text-on-surface-variant dark:text-slate-400 mt-1">
                Messages stream to Copilot live; it picks them up at its next checkpoint. Use <span className="font-medium">Stop</span> to halt the run.
              </p>
            </div>
          )}

          {/* Coding-agent (github) tracking: issue link + poll progress */}
          {(activeJob.issueUrl || activeJob.status === 'Generating' || activeJob.status === 'Executing') && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {activeJob.issueUrl && (
                <a href={activeJob.issueUrl} target="_blank" rel="noreferrer" className="text-sm text-app-red underline">View Issue #{activeJob.issueNumber} →</a>
              )}
              {activeJob.checksStatus && (
                <span className="text-xs text-on-surface-variant dark:text-slate-400">CI checks: <span className="font-mono">{activeJob.checksStatus}</span></span>
              )}
              <button onClick={refreshProgress} disabled={busy === 'progress'} className="px-3 py-1.5 rounded-sm border border-outline-variant/40 dark:border-slate-700 text-sm flex items-center gap-1 disabled:opacity-50">
                <span className="material-symbols-outlined text-base">refresh</span>
                {busy === 'progress' ? 'Checking…' : 'Refresh status'}
              </button>
            </div>
          )}

          {/* Results */}
          {activeJob.generatedFiles && activeJob.generatedFiles.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <p className="text-sm font-semibold mb-1">Generated Files ({activeJob.generatedFiles.length})</p>
                <ul className="text-xs font-mono space-y-0.5">
                  {activeJob.generatedFiles.map((f, i) => <li key={i} className="text-green-700 dark:text-green-400">＋ {f.path}</li>)}
                </ul>
              </div>
              {activeJob.reusedFiles && activeJob.reusedFiles.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-1">Reused Files ({activeJob.reusedFiles.length})</p>
                  <ul className="text-xs font-mono space-y-0.5">
                    {activeJob.reusedFiles.map((f, i) => <li key={i} className="text-slate-500 dark:text-slate-400">♻ {f}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Run logs — only for the LLM path; the Copilot path has its own live console above. */}
          {!activeJob.copilotHandoff && activeJob.logs && activeJob.logs.length > 0 && (
            <RunLogsConsole
              logs={activeJob.logs}
              live={activeStatus === 'Generating' || activeStatus === 'Executing'}
              trackUrl={activeJob.provider === 'github-actions' ? activeJob.reportUrl : ''}
            />
          )}

          {/* Report + Push to Gate */}
          {(activeJob.status === 'Passed' || activeJob.status === 'PushedToGate') && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {activeJob.reportUrl && (
                <a href={reportHref(activeJob.reportUrl)} target="_blank" rel="noreferrer" className="text-sm text-app-red underline flex items-center gap-1">
                  <span className="material-symbols-outlined text-base">description</span> View HTML Report ↗
                </a>
              )}
              {activeJob.status === 'Passed' && (
                <button onClick={pushToGate} disabled={busy === 'gate'} className="px-4 py-2 rounded-sm bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
                  <span className="material-symbols-outlined text-lg">rocket_launch</span>
                  {busy === 'gate' ? 'Pushing…' : 'Push to Gate'}
                </button>
              )}
              {activeJob.prUrl && (
                <a href={activeJob.prUrl} target="_blank" rel="noreferrer" className="text-sm text-app-red underline">
                  Open PR (compare{activeJob.branch ? ` · ${activeJob.branch}` : ''}) →
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Generate dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-md shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/30 dark:border-slate-700">
              <h3 className="font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-app-red">auto_awesome</span>
                Generate Automation
              </h3>
              <button onClick={() => setDialogOpen(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-on-surface-variant dark:text-slate-400">
                {selected.size} test case{selected.size > 1 ? 's' : ''} selected.
              </p>

              <Field label="Project">
                <input value={form.project} onChange={(e) => setF('project', e.target.value)}
                  className="w-full px-3 py-2 rounded-sm border border-outline-variant/40 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Environment">
                  <CustomSelect value={form.environment} onChange={(v) => setF('environment', v)} options={ENVIRONMENTS} />
                </Field>
                <Field label="Application URL">
                  <input value={form.url} onChange={(e) => setF('url', e.target.value)} placeholder="https://qa.example.com"
                    className="w-full px-3 py-2 rounded-sm border border-outline-variant/40 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" />
                </Field>
              </div>

              <Field label="Agent">
                <CustomSelect value={form.agent} onChange={(v) => setF('agent', v)} options={['AI Native Playwright Engineer']} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Skill">
                  <CustomSelect value={form.skill} onChange={(v) => setF('skill', v)} options={SKILLS} />
                </Field>
                <Field label="Execution Mode">
                  <CustomSelect value={form.executionMode} onChange={(v) => setF('executionMode', v)} options={EXECUTION_MODES} />
                </Field>
              </div>

              <Field label="Comments">
                <textarea value={form.comments} onChange={(e) => setF('comments', e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-sm border border-outline-variant/40 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm" />
              </Field>
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-outline-variant/30 dark:border-slate-700">
              <button onClick={() => setDialogOpen(false)} className="px-4 py-2 rounded-sm border border-outline-variant/40 dark:border-slate-700 text-sm">
                Cancel
              </button>
              <button onClick={submitGenerate} disabled={busy === 'generate'} className="px-4 py-2 rounded-sm bg-app-red text-white text-sm font-medium hover:bg-app-dark-red disabled:opacity-50 flex items-center gap-1">
                <span className="material-symbols-outlined text-lg">auto_awesome</span>
                {busy === 'generate' ? 'Planning…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-on-surface-variant dark:text-slate-400 mb-1">{label}</span>
      {children}
    </label>
  );
}
