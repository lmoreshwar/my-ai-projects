import { useState, useEffect, useRef, useCallback } from 'react';
import CustomSelect from './CustomSelect';

export default function GitHubCICD({ connections, apiBase, cicdState, setCicdState }) {
  /* ── Lifted state from App.jsx for persistence ── */
  const workflows = cicdState.workflows;
  const setWorkflows = (v) => setCicdState(s => ({ ...s, workflows: typeof v === 'function' ? v(s.workflows) : v }));
  const selectedWorkflow = cicdState.selectedWorkflow;
  const setSelectedWorkflow = (v) => setCicdState(s => ({ ...s, selectedWorkflow: typeof v === 'function' ? v(s.selectedWorkflow) : v }));
  const activeRun = cicdState.activeRun;
  const setActiveRun = (v) => setCicdState(s => ({ ...s, activeRun: typeof v === 'function' ? v(s.activeRun) : v }));
  const jobs = cicdState.jobs;
  const setJobs = (v) => setCicdState(s => ({ ...s, jobs: typeof v === 'function' ? v(s.jobs) : v }));
  const artifacts = cicdState.artifacts;
  const setArtifacts = (v) => setCicdState(s => ({ ...s, artifacts: typeof v === 'function' ? v(s.artifacts) : v }));
  const logLines = cicdState.logLines;
  const setLogLines = (v) => setCicdState(s => ({ ...s, logLines: typeof v === 'function' ? v(s.logLines) : v }));
  const htmlReport = cicdState.htmlReport;
  const setHtmlReport = (v) => setCicdState(s => ({ ...s, htmlReport: typeof v === 'function' ? v(s.htmlReport) : v }));
  const reportData = cicdState.reportData;
  const setReportData = (v) => setCicdState(s => ({ ...s, reportData: typeof v === 'function' ? v(s.reportData) : v }));
  const testResults = cicdState.testResults;
  const setTestResults = (v) => setCicdState(s => ({ ...s, testResults: typeof v === 'function' ? v(s.testResults) : v }));

  /* ── Lifted UI state for tab persistence ── */
  const showReport = cicdState.showReport;
  const setShowReport = (v) => setCicdState(s => ({ ...s, showReport: typeof v === 'function' ? v(s.showReport) : v }));
  const reportView = cicdState.reportView;
  const setReportView = (v) => setCicdState(s => ({ ...s, reportView: typeof v === 'function' ? v(s.reportView) : v }));
  const reportFilter = cicdState.reportFilter;
  const setReportFilter = (v) => setCicdState(s => ({ ...s, reportFilter: typeof v === 'function' ? v(s.reportFilter) : v }));

  /* ── Local UI state (transient, OK to reset on tab switch) ── */
  const [selectedRepo, setSelectedRepo] = useState(connections.github?.selectedRepo || '');
  const [selectedBranch, setSelectedBranch] = useState(connections.github?.selectedBranch || '');
  const [branches, setBranches] = useState(connections.github?.branches || []);
  const [triggering, setTriggering] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loadingReport, setLoadingReport] = useState(false);
  const pollingRef = useRef(null);
  const logContainerRef = useRef(null);

  const gh = connections.github || {};
  const repos = gh.repos || [];
  const isConnected = gh.status === 'connected';

  /* ── Sync repo/branch from connections ── */
  useEffect(() => {
    if (gh.selectedRepo && gh.selectedRepo !== selectedRepo) setSelectedRepo(gh.selectedRepo);
    if (gh.selectedBranch && gh.selectedBranch !== selectedBranch) setSelectedBranch(gh.selectedBranch);
    if (gh.branches?.length) setBranches(gh.branches);
  }, [gh.selectedRepo, gh.selectedBranch, gh.branches]);

  /* ── Fetch branches when repo changes ── */
  useEffect(() => {
    if (!selectedRepo || !gh.token) return;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/github-branches`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: gh.token, apiUrl: gh.apiUrl, repo: selectedRepo }),
        });
        const data = await res.json();
        if (data.branches) setBranches(data.branches);
      } catch { /* silent */ }
    })();
  }, [selectedRepo, gh.token]);

  /* ── Fetch workflows when repo changes ── */
  useEffect(() => {
    if (!selectedRepo || !gh.token) return;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/github-workflows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: gh.token, apiUrl: gh.apiUrl, repo: selectedRepo }),
        });
        const data = await res.json();
        if (data.workflows) {
          setWorkflows(data.workflows);
          if (data.workflows.length === 1) setSelectedWorkflow(data.workflows[0].id);
        }
      } catch { /* silent */ }
    })();
  }, [selectedRepo, gh.token]);

  /* ── Poll run status ── */
  const pollStatus = useCallback(async (runId) => {
    if (!runId || !gh.token || !selectedRepo) return;
    try {
      const res = await fetch(`${apiBase}/github-run-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: gh.token, apiUrl: gh.apiUrl, repo: selectedRepo, runId }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setActiveRun(data.run);
        setJobs(data.jobs || []);

        // Parse step-level log lines for the live terminal (exclude system steps)
        const SYSTEM_STEPS = /^(set up job|complete job|post |checkout|setup |cache |upload |download |actions\/|deploy |configure |initialize |clean up)/i;
        const TEST_EXECUTION_STEPS = /^(run playwright|run tests|execute tests|playwright tests|run e2e|run test)/i;
        const OUTPUT_REPORT_STEPS = /^(output report|report url|generate report|upload report|publish report)/i;
        const lines = [];
        (data.jobs || []).forEach(job => {
          (job.steps || []).forEach(step => {
            if (SYSTEM_STEPS.test(step.name)) return; // skip infrastructure steps
            
            // For test execution steps, treat completion as success (test failures are results, not execution failures)
            const isTestExecution = TEST_EXECUTION_STEPS.test(step.name);
            const isOutputReport = OUTPUT_REPORT_STEPS.test(step.name);
            const effectiveConclusion = isTestExecution && (step.conclusion === 'success' || step.conclusion === 'failure') ? 'success' : step.conclusion;
            const displayName = isTestExecution ? 'Playwright Tests Executed' : isOutputReport ? 'Test Report Generated' : step.name;
            
            const icon = effectiveConclusion === 'success' ? '✓' : effectiveConclusion === 'failure' ? '✗' : step.status === 'in_progress' ? '⟳' : '○';
            const color = effectiveConclusion === 'success' ? 'text-emerald-400' : effectiveConclusion === 'failure' ? 'text-red-400' : step.status === 'in_progress' ? 'text-yellow-300' : 'text-slate-500';
            lines.push({ icon, color, text: displayName, conclusion: effectiveConclusion, status: step.status });
          });
        });
        setLogLines(lines);

        // If run is complete, stop polling & fetch artifacts + real test counts
        if (data.run.status === 'completed') {
          setPolling(false);
          clearInterval(pollingRef.current);
          pollingRef.current = null;
          fetchArtifacts(runId);
          fetchTestResults(runId);
        }
      }
    } catch { /* silent */ }
  }, [gh.token, gh.apiUrl, selectedRepo, apiBase]);

  useEffect(() => {
    if (polling && activeRun?.id) {
      pollingRef.current = setInterval(() => pollStatus(activeRun.id), 5000);
      return () => clearInterval(pollingRef.current);
    }
  }, [polling, activeRun?.id, pollStatus]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [logLines]);

  /* ── Fetch artifacts ── */
  const fetchArtifacts = async (runId) => {
    try {
      const res = await fetch(`${apiBase}/github-run-artifacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: gh.token, apiUrl: gh.apiUrl, repo: selectedRepo, runId }),
      });
      const data = await res.json();
      if (data.artifacts) setArtifacts(data.artifacts);
    } catch { /* silent */ }
  };

  /* ── Fetch real test results from run logs ── */
  const fetchTestResults = async (runId) => {
    try {
      const res = await fetch(`${apiBase}/github-parse-test-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: gh.token, apiUrl: gh.apiUrl, repo: selectedRepo, runId }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setTestResults({ passed: data.passed, failed: data.failed, skipped: data.skipped, total: data.total });
      }
    } catch { /* silent */ }
  };

  /* ── Extract & view HTML report from artifact ── */
  const handleViewHtmlReport = async (artifactId) => {
    setLoadingReport(true);
    try {
      const res = await fetch(`${apiBase}/github-extract-html-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: gh.token, apiUrl: gh.apiUrl, repo: selectedRepo, artifactId }),
      });
      const data = await res.json();
      if (data.html) {
        setHtmlReport(data.html);
        setShowReport(true);

        let mergedTestData = data.testData;

        // If HTML artifact has no individual test details, fetch from JSON artifact
        if (!mergedTestData?.tests?.length) {
          const jsonArt = artifacts.find(a => a.name.toLowerCase().includes('json'));
          if (jsonArt) {
            try {
              const jsonRes = await fetch(`${apiBase}/github-extract-html-report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: gh.token, apiUrl: gh.apiUrl, repo: selectedRepo, artifactId: jsonArt.id }),
              });
              const jsonData = await jsonRes.json();
              if (jsonData.testData?.tests?.length) {
                mergedTestData = jsonData.testData;
              }
            } catch { /* silent — dashboard will still show summary from HTML */ }
          }
        }

        if (mergedTestData) {
          setReportData(mergedTestData);
          // Note: We don't overwrite testResults here - the log-parsed results are authoritative for counts
          // reportData is used for individual test details (errors, stack traces, etc.)
        }
        setReportView('dashboard');
        setReportFilter('all');
      } else {
        setError(data.message || 'No HTML report found in this artifact.');
      }
    } catch {
      setError('Failed to extract HTML report.');
    } finally {
      setLoadingReport(false);
    }
  };
  const handleTrigger = async () => {
    if (!selectedRepo || !selectedWorkflow || !gh.token) return;
    setError('');
    setSuccessMsg('');
    setTriggering(true);
    setActiveRun(null);
    setJobs([]);
    setArtifacts([]);
    setLogLines([]);
    setHtmlReport(null);
    setShowReport(false);
    setReportData(null);
    setReportFilter('all');
    setTestResults({ passed: 0, failed: 0, skipped: 0, total: 0 });

    try {
      const res = await fetch(`${apiBase}/github-trigger-workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: gh.token,
          apiUrl: gh.apiUrl,
          repo: selectedRepo,
          workflowId: selectedWorkflow,
          branch: selectedBranch || 'main',
        }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setSuccessMsg(data.message || 'Workflow triggered successfully!');
        if (data.run) {
          setActiveRun(data.run);
          setPolling(true);
        } else {
          // Run not yet available — retry after a few seconds to find it
          const prevRunId = data.previousRunId;
          const findRun = async (retries = 8) => {
            for (let i = 0; i < retries; i++) {
              await new Promise(r => setTimeout(r, 3000));
              try {
                const runsRes = await fetch(`${apiBase}/github-workflows-runs`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token: gh.token, apiUrl: gh.apiUrl, repo: selectedRepo, workflowId: selectedWorkflow, branch: selectedBranch || 'main' }),
                });
                const runsData = await runsRes.json();
                // Only accept a genuinely NEW run (not the old completed one)
                if (runsData.run && runsData.run.id !== prevRunId) {
                  setActiveRun(runsData.run);
                  setPolling(true);
                  return;
                }
              } catch { /* retry */ }
            }
            setSuccessMsg('Workflow triggered but run not found yet. Check GitHub Actions.');
          };
          findRun();
        }
      } else {
        setError(data.message || 'Failed to trigger workflow');
      }
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setTriggering(false);
    }
  };

  /* ── Download artifact ── */
  const handleDownloadArtifact = async (artifactId, artifactName) => {
    try {
      const res = await fetch(`${apiBase}/github-download-artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: gh.token, apiUrl: gh.apiUrl, repo: selectedRepo, artifactId }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${artifactName}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  };

  /* ── Helpers ── */
  const runStatusLabel = activeRun
    ? activeRun.status === 'completed'
      ? activeRun.conclusion === 'success' ? 'Passed' : activeRun.conclusion === 'failure' ? 'Failed' : (activeRun.conclusion || 'Completed')
      : activeRun.status === 'in_progress' ? 'In Progress' : activeRun.status === 'queued' ? 'Queued' : activeRun.status
    : 'Idle';

  const runStatusColor = activeRun
    ? activeRun.conclusion === 'success' ? 'text-emerald-600' : activeRun.conclusion === 'failure' ? 'text-red-600' : 'text-amber-600'
    : 'text-slate-400';

  // Filter out GitHub Actions system/infrastructure steps — for timeline progress only
  const SYSTEM_STEP_PATTERNS = /^(set up job|complete job|post |checkout|setup |cache |upload |download |actions\/|deploy |configure |initialize |clean up)/i;
  const allSteps = jobs.flatMap(j => j.steps || []);
  const testSteps = allSteps.filter(s => !SYSTEM_STEP_PATTERNS.test(s.name));
  const totalSteps = testSteps.length;
  const completedSteps = testSteps.filter(s => s.status === 'completed').length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  // Use ONLY real parsed test results for analytics — no fallback to step counts
  // (Step counts include infrastructure steps like "Install dependencies" which aren't tests)
  const passedCount = testResults.passed;
  const failedCount = testResults.failed;
  const skippedCount = testResults.skipped;

  /* ── Render ── */
  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-16">
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-black tracking-tight text-app-red mb-2">GitHub CICD Dashboard</h1>
          {(cicdState.activeRun || cicdState.jobs.length > 0 || cicdState.reportData || cicdState.logLines.length > 0) && (
            <button
              onClick={() => { if (confirm('Clear all CI/CD data? This will reset run results, jobs, logs, report, and artifacts.')) { setCicdState(s => ({ ...s, activeRun: null, jobs: [], artifacts: [], logLines: [], htmlReport: null, reportData: null, testResults: { passed: 0, failed: 0, skipped: 0, total: 0 }, showReport: false })); } }}
              disabled={polling}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-on-surface dark:text-white rounded-sm text-[0.8125rem] font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-95 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">restart_alt</span>
              Clear All
            </button>
          )}
        </div>
        <p className="text-on-surface-variant dark:text-slate-400 font-medium italic opacity-80">
          Orchestrate enterprise-grade automation pipelines with precision.
        </p>
      </div>

      {/* Connection Warning */}
      {!isConnected && (
        <div className="mb-6 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-center gap-3">
          <span className="material-symbols-outlined text-amber-600">warning</span>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            GitHub is not connected. Please configure your GitHub token in <span className="font-bold">Test Connection</span> settings first.
          </p>
        </div>
      )}

      {successMsg && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3">
          <span className="material-symbols-outlined text-emerald-600">check_circle</span>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{successMsg}</p>
          <button onClick={() => setSuccessMsg('')} className="ml-auto text-emerald-400 hover:text-emerald-600"><span className="material-symbols-outlined text-sm">close</span></button>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 flex items-center gap-3">
          <span className="material-symbols-outlined text-red-600">error</span>
          <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600"><span className="material-symbols-outlined text-sm">close</span></button>
        </div>
      )}

      {/* Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ─── Left Column: Pipeline Configuration ─── */}
        <div className="lg:col-span-4 space-y-6">
          {/* Config Card */}
          <div className="bg-surface-container-low dark:bg-slate-900 p-8 rounded-xl space-y-8 border border-outline-variant/20">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-app-red">settings</span>
              <h3 className="font-bold text-on-surface dark:text-white uppercase tracking-widest text-xs">Pipeline Configuration</h3>
            </div>

            <div className="space-y-6">
              {/* Repository */}
              <div>
                <label className="block text-xs font-bold text-secondary dark:text-slate-400 mb-2 uppercase tracking-wide">Select Repository</label>
                <CustomSelect
                    value={selectedRepo}
                    onChange={(val) => { setSelectedRepo(val); setSelectedBranch(''); setWorkflows([]); setSelectedWorkflow(''); }}
                    disabled={!isConnected}
                    placeholder="— Select Repository —"
                    options={repos.map(r => {
                      const name = typeof r === 'string' ? r : r.name;
                      const label = typeof r === 'string' ? r : `${r.name} (${r.visibility})`;
                      return { value: name, label };
                    })}
                  />
              </div>

              {/* Branch */}
              <div>
                <label className="block text-xs font-bold text-secondary dark:text-slate-400 mb-2 uppercase tracking-wide">Select Branch</label>
                <CustomSelect
                    value={selectedBranch}
                    onChange={(val) => setSelectedBranch(val)}
                    disabled={!selectedRepo}
                    placeholder="— Select Branch —"
                    options={branches.map(b => ({ value: b, label: b }))}
                  />
              </div>

              {/* Workflow */}
              <div>
                <label className="block text-xs font-bold text-secondary dark:text-slate-400 mb-2 uppercase tracking-wide">Select Workflow</label>
                <CustomSelect
                    value={selectedWorkflow}
                    onChange={(val) => setSelectedWorkflow(val)}
                    disabled={!workflows.length}
                    placeholder="— Select Workflow —"
                    options={workflows.map(w => ({ value: w.id, label: `${w.name} (${w.path})` }))}
                  />
              </div>
            </div>

            {/* Trigger Button */}
            <button
              onClick={handleTrigger}
              disabled={triggering || !selectedRepo || !selectedWorkflow || !isConnected || polling}
              className="w-full py-4 bg-gradient-to-br from-app-red to-app-dark-red text-white font-bold rounded-md flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-all shadow-md shadow-app-red/20 disabled:opacity-50 disabled:hover:scale-100"
            >
              {triggering ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[20px]">sync</span>
                  Triggering...
                </>
              ) : polling ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[20px]">sync</span>
                  Pipeline Running...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined">play_arrow</span>
                  Trigger Automation Suite
                </>
              )}
            </button>
          </div>

          {/* Pipeline Summary Card */}
          <div className="bg-surface-container-highest dark:bg-slate-800 p-6 rounded-xl border border-outline-variant/20">
            <div className="flex items-center justify-between mb-5">
              <span className="text-xs font-bold text-secondary dark:text-slate-400 uppercase tracking-widest">Pipeline Summary</span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${
                isConnected
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                  : 'bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-400'}`}/>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">folder</span>Repository
                </span>
                <span className="font-bold text-on-surface dark:text-white truncate max-w-[140px]" title={selectedRepo}>
                  {selectedRepo || '—'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">call_split</span>Branch
                </span>
                <span className="font-bold text-on-surface dark:text-white truncate max-w-[140px]">
                  {selectedBranch || '—'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">play_circle</span>Workflow
                </span>
                <span className="font-bold text-on-surface dark:text-white truncate max-w-[140px]" title={workflows.find(w => String(w.id) === String(selectedWorkflow))?.name}>
                  {workflows.find(w => String(w.id) === String(selectedWorkflow))?.name || '—'}
                </span>
              </div>
            </div>
            {activeRun && (
              <div className="mt-4 pt-4 border-t border-outline-variant/20 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">tag</span>Run #
                  </span>
                  <span className="font-bold text-on-surface dark:text-white">{activeRun.run_number}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">info</span>Status
                  </span>
                  <span className={`font-bold capitalize ${runStatusColor}`}>{runStatusLabel}</span>
                </div>
                {activeRun.html_url && (
                  <a href={activeRun.html_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-app-blue dark:text-blue-400 hover:underline mt-1 truncate">
                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    View on GitHub
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── Right Column: Real-Time Execution ─── */}
        <div className="lg:col-span-8 bg-surface-container-lowest dark:bg-slate-900 p-8 rounded-xl shadow-sm border-l-4 border-indigo-500 border border-outline-variant/20">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <span className={`material-symbols-outlined ${polling ? 'text-amber-500 animate-pulse' : activeRun?.status === 'completed' && activeRun?.conclusion === 'success' ? 'text-emerald-500' : activeRun?.status === 'completed' && activeRun?.conclusion === 'failure' ? 'text-red-500' : activeRun?.status === 'in_progress' ? 'text-amber-500 animate-pulse' : 'text-indigo-500'}`}
                style={activeRun?.status === 'completed' && activeRun?.conclusion === 'success' ? { fontVariationSettings: "'FILL' 1" } : {}}>
                {polling ? 'sync' : activeRun?.status === 'completed' && activeRun?.conclusion === 'success' ? 'check_circle' : activeRun?.status === 'completed' && activeRun?.conclusion === 'failure' ? 'cancel' : activeRun?.status === 'in_progress' ? 'sync' : 'pending'}
              </span>
              <h3 className="font-bold text-on-surface dark:text-white uppercase tracking-widest text-xs">Real-Time Execution</h3>
            </div>
            {activeRun && (
              <span className="px-3 py-1 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black rounded-full uppercase tracking-tight">
                Build #{activeRun.run_number}
              </span>
            )}
          </div>

          {/* Steps Timeline */}
          {jobs.length > 0 ? (
            <div className="space-y-0 mb-6">
              {jobs.map(job => {
                const SYSTEM_STEPS_RE = /^(set up job|complete job|post |checkout|setup |cache |upload |download |actions\/|deploy |configure |initialize |clean up)/i;
                const TEST_EXECUTION_RE = /^(run playwright|run tests|execute tests|playwright tests|run e2e|run test)/i;
                const OUTPUT_REPORT_RE = /^(output report|report url|generate report|upload report|publish report)/i;
                const filteredSteps = (job.steps || []).filter(s => !SYSTEM_STEPS_RE.test(s.name));
                return (
                <div key={job.id}>
                  <div className="mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-secondary dark:text-slate-400">{job.name}</span>
                  </div>
                  {filteredSteps.map((step, idx) => {
                    const isLast = idx === filteredSteps.length - 1;
                    const isComplete = step.status === 'completed';
                    const isActive = step.status === 'in_progress';
                    
                    // For test execution steps, treat completion as success (test failures are results, not execution failures)
                    const isTestExecution = TEST_EXECUTION_RE.test(step.name);
                    const isOutputReport = OUTPUT_REPORT_RE.test(step.name);
                    const effectiveConclusion = isTestExecution && (step.conclusion === 'success' || step.conclusion === 'failure') ? 'success' : step.conclusion;
                    const displayName = isTestExecution ? 'Playwright Tests Executed' : isOutputReport ? 'Test Report Generated' : step.name;
                    const isFailed = effectiveConclusion === 'failure';
                    const isPassed = effectiveConclusion === 'success';

                    const dotBg = isPassed ? 'bg-emerald-500' : isFailed ? 'bg-red-500' : isActive ? 'bg-amber-400 animate-pulse' : 'bg-surface-container-highest dark:bg-slate-700 border border-outline-variant';
                    const lineBg = isPassed ? 'bg-emerald-500' : isFailed ? 'bg-red-500' : 'bg-outline-variant/30';
                    const iconName = isPassed ? 'check' : isFailed ? 'close' : isActive ? 'sync' : 'hourglass_empty';
                    const iconColor = (isPassed || isFailed) ? 'text-white' : isActive ? 'text-amber-900' : 'text-outline dark:text-slate-500';

                    const duration = step.started_at && step.completed_at
                      ? `${((new Date(step.completed_at) - new Date(step.started_at)) / 1000).toFixed(1)}s`
                      : isActive ? 'Running...' : '';

                    return (
                      <div key={step.number} className="relative pl-8 pb-6">
                        <div className={`absolute left-0 top-0 w-6 h-6 ${dotBg} rounded-full flex items-center justify-center`}>
                          <span className={`material-symbols-outlined text-sm ${iconColor}`} style={isPassed ? { fontVariationSettings: "'FILL' 1" } : isActive ? {} : {}}>
                            {iconName}
                          </span>
                        </div>
                        {!isLast && <div className={`absolute left-[11px] top-6 w-[2px] h-full ${lineBg}`}></div>}
                        <div>
                          <h4 className={`text-sm font-bold ${isComplete || isActive ? 'text-on-surface dark:text-white' : 'text-outline dark:text-slate-500'}`}>
                            {displayName}
                          </h4>
                          {duration && <span className="text-[10px] font-mono text-secondary dark:text-slate-500 mt-1 block">Duration: {duration}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                );
              })}
            </div>
          ) : (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="material-symbols-outlined text-6xl text-outline-variant/40 mb-4">rocket_launch</span>
              <p className="text-sm font-medium text-on-surface-variant dark:text-slate-500 max-w-xs">
                Select a repository, branch, and workflow, then trigger the pipeline to see real-time execution progress here.
              </p>
            </div>
          )}

          {/* Live Terminal */}
          {logLines.length > 0 && (
            <div ref={logContainerRef} className="bg-slate-900 dark:bg-black rounded-lg p-4 font-mono text-xs text-emerald-400 max-h-48 overflow-y-auto border border-slate-700">
              {logLines.map((line, i) => (
                <p key={i} className={line.color}>
                  <span className="mr-2">{line.icon}</span>
                  {line.text}
                  {line.conclusion === 'success' && <span className="ml-2 text-emerald-500 font-bold">PASSED</span>}
                  {line.conclusion === 'failure' && <span className="ml-2 text-red-500 font-bold">FAILED</span>}
                  {line.status === 'in_progress' && <span className="ml-2 text-yellow-300 animate-pulse">RUNNING</span>}
                </p>
              ))}
              {polling && <p className="animate-pulse text-slate-500 mt-1">_</p>}
            </div>
          )}
        </div>

        {/* ─── Full-Width Bottom: Execution Analytics ─── */}
        <div className="lg:col-span-12 mt-4">
          <div className="bg-surface-container-low dark:bg-slate-900 rounded-2xl overflow-hidden shadow-sm border border-outline-variant/20">
            {/* Analytics Header */}
            <div className="p-8 border-b border-outline-variant/10 bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h3 className="text-2xl font-black text-on-surface dark:text-white tracking-tighter">Execution Analytics</h3>
                <p className="text-sm text-secondary dark:text-slate-400 font-medium">
                  Build status:{' '}
                  <span className={`font-bold ${runStatusColor}`}>
                    {activeRun ? `${runStatusLabel} (${progressPct}% Complete)` : 'No active run'}
                  </span>
                </p>
              </div>
              <div className="flex gap-4">
                <div className="text-center px-6 py-2 bg-white dark:bg-slate-700 rounded-xl shadow-sm">
                  <p className="text-[10px] font-bold text-secondary dark:text-slate-400 uppercase">Passed</p>
                  <p className="text-xl font-black text-emerald-600">{passedCount}</p>
                </div>
                <div className="text-center px-6 py-2 bg-white dark:bg-slate-700 rounded-xl shadow-sm">
                  <p className="text-[10px] font-bold text-secondary dark:text-slate-400 uppercase">Failed</p>
                  <p className="text-xl font-black text-red-600">{failedCount}</p>
                </div>
                <div className="text-center px-6 py-2 bg-white dark:bg-slate-700 rounded-xl shadow-sm">
                  <p className="text-[10px] font-bold text-secondary dark:text-slate-400 uppercase">Skipped</p>
                  <p className="text-xl font-black text-outline dark:text-slate-400">{skippedCount}</p>
                </div>
              </div>
            </div>

            {/* Report / Artifacts Area */}
            <div className="p-8 relative">
              {/* Graphical Report Dashboard */}
              {showReport && (() => {
                // Use testResults (from log parsing) as authoritative source for counts
                // reportData provides individual test details (errors, stack traces) from artifact
                const testsFromReport = reportData?.tests || [];
                const byFileFromReport = reportData?.byFile || {};
                
                // Summary always uses testResults (log-parsed), not artifact data
                const s = { passed: passedCount, failed: failedCount, skipped: skippedCount, flaky: 0, total: passedCount + failedCount + skippedCount, totalDuration: '', totalDurationMs: 0 };
                const rd = { tests: testsFromReport, byFile: byFileFromReport, summary: s, config: reportData?.config || {} };
                
                const total = s.total || 1;
                const passRate = Math.round((s.passed / total) * 100);
                const failRate = Math.round((s.failed / total) * 100);
                const skipRate = 100 - passRate - failRate;
                // SVG donut chart calculations
                const radius = 54, cx = 64, cy = 64, circumference = 2 * Math.PI * radius;
                const passLen = (s.passed / total) * circumference;
                const failLen = (s.failed / total) * circumference;
                const skipLen = (s.skipped / total) * circumference;
                const passOffset = 0;
                const failOffset = passLen;
                const skipOffset = passLen + failLen;

                const filteredTests = rd.tests.filter(t =>
                  reportFilter === 'all' ? true : reportFilter === 'failed' ? (t.status === 'failed' || t.status === 'flaky') : t.status === reportFilter
                );

                return (
                <div className="mb-6 space-y-6">
                  {/* Report Header with view toggle */}
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-on-surface dark:text-white flex items-center gap-2">
                      <span className="material-symbols-outlined text-indigo-500">analytics</span>
                      Test Execution Report
                    </h4>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setReportView('dashboard')} className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide rounded-lg transition-all ${reportView === 'dashboard' ? 'bg-indigo-500 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                        <span className="material-symbols-outlined text-sm align-middle mr-1">bar_chart</span>Dashboard
                      </button>
                      <button onClick={() => setReportView('raw')} className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide rounded-lg transition-all ${reportView === 'raw' ? 'bg-indigo-500 text-white shadow-md' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                        <span className="material-symbols-outlined text-sm align-middle mr-1">code</span>Raw HTML
                      </button>
                      {artifacts.length > 0 && (
                        <button
                          onClick={() => handleDownloadArtifact(artifacts[0].id, artifacts[0].name)}
                          className="px-3 py-1.5 text-[10px] font-bold text-slate-400 hover:text-app-blue flex items-center gap-1 transition-colors"
                          title="Download Artifact"
                        >
                          <span className="material-symbols-outlined text-sm">download</span>
                        </button>
                      )}
                      <button onClick={() => { setShowReport(false); setReportData(null); setReportFilter('all'); }} className="px-3 py-1.5 text-[10px] font-bold text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors">
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    </div>
                  </div>

                  {reportView === 'dashboard' ? (
                    <div className="space-y-6">
                      {/* Top Row: Donut Chart + Summary Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Donut Chart */}
                        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-outline-variant/20 flex flex-col items-center justify-center">
                          <p className="text-[10px] font-bold text-secondary dark:text-slate-400 uppercase tracking-widest mb-4">Pass Rate</p>
                          <div className="relative">
                            <svg width="128" height="128" viewBox="0 0 128 128">
                              <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#e5e7eb" strokeWidth="12" className="dark:stroke-slate-700"/>
                              {s.passed > 0 && <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#10b981" strokeWidth="12" strokeDasharray={`${passLen} ${circumference - passLen}`} strokeDashoffset={-passOffset} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} className="transition-all duration-1000"/>}
                              {s.failed > 0 && <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#ef4444" strokeWidth="12" strokeDasharray={`${failLen} ${circumference - failLen}`} strokeDashoffset={-failOffset} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} className="transition-all duration-1000"/>}
                              {s.skipped > 0 && <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#94a3b8" strokeWidth="12" strokeDasharray={`${skipLen} ${circumference - skipLen}`} strokeDashoffset={-skipOffset} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} className="transition-all duration-1000"/>}
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-2xl font-black text-on-surface dark:text-white">{passRate}%</span>
                              <span className="text-[9px] text-slate-400 font-bold uppercase">Pass Rate</span>
                            </div>
                          </div>
                          <div className="flex gap-4 mt-4">
                            <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500"/><span className="text-[10px] text-slate-500 font-medium">Passed</span></div>
                            <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-red-500"/><span className="text-[10px] text-slate-500 font-medium">Failed</span></div>
                            <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-slate-400"/><span className="text-[10px] text-slate-500 font-medium">Skipped</span></div>
                          </div>
                        </div>

                        {/* Summary Cards Grid */}
                        <div className="md:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
                          {/* Total */}
                          <button onClick={() => setReportFilter('all')} className={`group p-5 rounded-2xl border transition-all hover:scale-[1.03] active:scale-95 text-left ${reportFilter === 'all' ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700 shadow-md shadow-indigo-500/10' : 'bg-white dark:bg-slate-800 border-outline-variant/20 hover:border-indigo-300'}`}>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                                <span className="material-symbols-outlined text-indigo-500 text-[18px]">summarize</span>
                              </div>
                            </div>
                            <p className="text-3xl font-black text-indigo-600 dark:text-indigo-400">{s.total}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Total Tests</p>
                          </button>
                          {/* Passed */}
                          <button onClick={() => setReportFilter('passed')} className={`group p-5 rounded-2xl border transition-all hover:scale-[1.03] active:scale-95 text-left ${reportFilter === 'passed' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 shadow-md shadow-emerald-500/10' : 'bg-white dark:bg-slate-800 border-outline-variant/20 hover:border-emerald-300'}`}>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                                <span className="material-symbols-outlined text-emerald-500 text-[18px]">check_circle</span>
                              </div>
                            </div>
                            <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{s.passed}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Passed</p>
                            <div className="mt-2 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${passRate}%` }}/>
                            </div>
                          </button>
                          {/* Failed */}
                          <button onClick={() => setReportFilter('failed')} className={`group p-5 rounded-2xl border transition-all hover:scale-[1.03] active:scale-95 text-left ${reportFilter === 'failed' ? 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700 shadow-md shadow-red-500/10' : 'bg-white dark:bg-slate-800 border-outline-variant/20 hover:border-red-300'}`}>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                                <span className="material-symbols-outlined text-red-500 text-[18px]">cancel</span>
                              </div>
                            </div>
                            <p className="text-3xl font-black text-red-600 dark:text-red-400">{s.failed}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Failed</p>
                            <div className="mt-2 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div className="h-full bg-red-500 rounded-full transition-all duration-700" style={{ width: `${failRate}%` }}/>
                            </div>
                          </button>
                          {/* Skipped */}
                          <button onClick={() => setReportFilter('skipped')} className={`group p-5 rounded-2xl border transition-all hover:scale-[1.03] active:scale-95 text-left ${reportFilter === 'skipped' ? 'bg-slate-100 dark:bg-slate-700/50 border-slate-400 shadow-md' : 'bg-white dark:bg-slate-800 border-outline-variant/20 hover:border-slate-400'}`}>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                                <span className="material-symbols-outlined text-slate-400 text-[18px]">block</span>
                              </div>
                            </div>
                            <p className="text-3xl font-black text-slate-500 dark:text-slate-400">{s.skipped}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Skipped</p>
                            <div className="mt-2 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div className="h-full bg-slate-400 rounded-full transition-all duration-700" style={{ width: `${skipRate}%` }}/>
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Test Cases List (Drill-Down) */}
                      {rd.tests.length > 0 ? (
                        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-outline-variant/20 overflow-hidden shadow-sm">
                          <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
                            <h5 className="text-xs font-bold uppercase tracking-widest text-secondary dark:text-slate-400 flex items-center gap-2">
                              <span className="material-symbols-outlined text-sm text-indigo-500">list_alt</span>
                              Test Cases
                              <span className="ml-2 px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 text-[10px] rounded-full font-black">{filteredTests.length}</span>
                              {s.totalDuration && <span className="ml-3 text-[10px] text-slate-400 font-mono">Total: {s.totalDuration}</span>}
                            </h5>
                            <div className="flex gap-1">
                              {['all', 'passed', 'failed', 'skipped'].map(f => (
                                <button key={f} onClick={() => setReportFilter(f)} className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-md transition-all ${reportFilter === f ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                                  {f}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="max-h-[500px] overflow-y-auto">
                            {/* Group by file if available */}
                            {(() => {
                              const grouped = {};
                              filteredTests.forEach(t => {
                                const file = t.file || 'Tests';
                                if (!grouped[file]) grouped[file] = [];
                                grouped[file].push(t);
                              });
                              return Object.entries(grouped).map(([file, tests]) => (
                                <div key={file}>
                                  {Object.keys(grouped).length > 1 && (
                                    <div className="px-6 py-2.5 bg-slate-50/80 dark:bg-slate-900/50 border-b border-outline-variant/10 flex items-center gap-2">
                                      <span className="material-symbols-outlined text-indigo-400 text-sm">description</span>
                                      <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wide truncate">{file.replace(/^.*[\\/]/, '')}</span>
                                      <span className="text-[10px] text-slate-400 ml-auto">{tests.length} tests</span>
                                    </div>
                                  )}
                                  {tests.map((test, i) => {
                                    const isPassed = test.status === 'passed';
                                    const isFailed = test.status === 'failed' || test.status === 'flaky';
                                    const statusColor = isPassed ? 'text-emerald-500' : isFailed ? 'text-red-500' : 'text-slate-400';
                                    const statusBg = isPassed ? 'bg-emerald-50 dark:bg-emerald-950/20' : isFailed ? 'bg-red-50 dark:bg-red-950/20' : 'bg-slate-50 dark:bg-slate-800/50';
                                    const statusIcon = isPassed ? 'check_circle' : isFailed ? 'cancel' : 'block';
                                    return (
                                      <div key={i} className="border-b border-outline-variant/5 last:border-b-0">
                                        <div className="px-6 py-3.5 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                          <span className={`material-symbols-outlined ${statusColor} text-lg flex-shrink-0`} style={{ fontVariationSettings: "'FILL' 1" }}>{statusIcon}</span>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-on-surface dark:text-white truncate">{test.name}</p>
                                            {test.fullTitle && test.fullTitle !== test.name && (
                                              <p className="text-[10px] text-slate-400 mt-0.5 truncate">{test.fullTitle}</p>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-3 flex-shrink-0">
                                            {test.duration && <span className="text-[10px] font-mono text-slate-400 bg-slate-50 dark:bg-slate-700 px-2 py-0.5 rounded">{test.duration}</span>}
                                            <span className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-full ${statusBg} ${statusColor} tracking-wide`}>
                                              {test.status}
                                            </span>
                                          </div>
                                        </div>
                                        {/* Error details for failed tests */}
                                        {isFailed && (test.error || test.attachments?.length > 0) && (
                                          <div className="px-6 pb-3 ml-10 space-y-3">
                                            {/* Error message */}
                                            {test.error && (
                                              <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/30 rounded-lg p-3">
                                                <div className="flex items-center gap-2 mb-2">
                                                  <span className="material-symbols-outlined text-red-500 text-sm">error</span>
                                                  <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wide">Error Details</span>
                                                </div>
                                                <p className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-all leading-relaxed">{test.error}</p>
                                                {test.errorSnippet && test.errorSnippet !== test.error && (
                                                  <div className="mt-2 p-2 bg-red-100 dark:bg-red-900/30 rounded border border-red-200 dark:border-red-800/40">
                                                    <pre className="text-[10px] text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap">{test.errorSnippet}</pre>
                                                  </div>
                                                )}
                                                {test.errorStack && (
                                                  <details className="mt-2">
                                                    <summary className="text-[10px] text-red-400 cursor-pointer hover:text-red-600 font-bold uppercase flex items-center gap-1">
                                                      <span className="material-symbols-outlined text-xs">code</span>
                                                      Stack Trace
                                                    </summary>
                                                    <pre className="text-[10px] text-red-400/70 font-mono mt-1 whitespace-pre-wrap break-all max-h-32 overflow-y-auto bg-red-100/50 dark:bg-red-950/30 p-2 rounded">{test.errorStack}</pre>
                                                  </details>
                                                )}
                                              </div>
                                            )}
                                            
                                            {/* Attachments (screenshots, videos) - only show if we have actual data */}
                                            {test.attachments?.filter(a => a.body).length > 0 && (
                                              <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                                                <div className="flex items-center gap-2 mb-3">
                                                  <span className="material-symbols-outlined text-indigo-500 text-sm">attach_file</span>
                                                  <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Attachments</span>
                                                  <span className="text-[10px] text-slate-400">({test.attachments.filter(a => a.body).length})</span>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                  {test.attachments.filter(a => a.body).map((att, ai) => (
                                                    <div key={ai} className="flex items-center gap-2 p-2 bg-white dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600">
                                                      <span className={`material-symbols-outlined text-sm ${
                                                        att.type === 'screenshot' ? 'text-emerald-500' :
                                                        att.type === 'video' ? 'text-purple-500' : 'text-slate-400'
                                                      }`}>
                                                        {att.type === 'screenshot' ? 'image' :
                                                         att.type === 'video' ? 'videocam' : 'attachment'}
                                                      </span>
                                                      <div className="flex-1 min-w-0">
                                                        <p className="text-[10px] font-medium text-slate-700 dark:text-slate-200 truncate">{att.name}</p>
                                                        <p className="text-[9px] text-slate-400">{att.type}</p>
                                                      </div>
                                                      {att.type === 'screenshot' && (
                                                        <button 
                                                          onClick={() => {
                                                            const imgWindow = window.open('', '_blank');
                                                            imgWindow.document.write(`<html><head><title>${att.name}</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1e293b;}</style></head><body><img src="data:${att.contentType};base64,${att.body}" style="max-width:100%;max-height:100vh;"/></body></html>`);
                                                          }}
                                                          className="px-2 py-1 text-[9px] font-bold text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded transition-colors"
                                                        >
                                                          View
                                                        </button>
                                                      )}
                                                      {att.type === 'video' && (
                                                        <button 
                                                          onClick={() => {
                                                            const vidWindow = window.open('', '_blank');
                                                            vidWindow.document.write(`<html><head><title>${att.name}</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1e293b;}</style></head><body><video controls autoplay style="max-width:100%;max-height:100vh;"><source src="data:${att.contentType};base64,${att.body}" type="${att.contentType}"/></video></body></html>`);
                                                          }}
                                                          className="px-2 py-1 text-[9px] font-bold text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded transition-colors"
                                                        >
                                                          Play
                                                        </button>
                                                      )}
                                                    </div>
                                                  ))}
                                                </div>
                                                {/* Inline screenshot preview for first screenshot */}
                                                {test.attachments.find(a => a.type === 'screenshot' && a.body) && (
                                                  <details className="mt-3" open>
                                                    <summary className="text-[10px] text-indigo-500 cursor-pointer hover:text-indigo-700 font-bold uppercase flex items-center gap-1">
                                                      <span className="material-symbols-outlined text-xs">image</span>
                                                      Screenshot Preview
                                                    </summary>
                                                    <div className="mt-2 p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700">
                                                      <img 
                                                        src={`data:${test.attachments.find(a => a.type === 'screenshot' && a.body).contentType};base64,${test.attachments.find(a => a.type === 'screenshot' && a.body).body}`}
                                                        alt="Failure screenshot"
                                                        className="max-w-full max-h-64 rounded shadow-lg mx-auto cursor-pointer hover:opacity-90 transition-opacity"
                                                        onClick={() => {
                                                          const att = test.attachments.find(a => a.type === 'screenshot' && a.body);
                                                          const imgWindow = window.open('', '_blank');
                                                          imgWindow.document.write(`<html><head><title>Screenshot</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1e293b;}</style></head><body><img src="data:${att.contentType};base64,${att.body}" style="max-width:100%;max-height:100vh;"/></body></html>`);
                                                        }}
                                                      />
                                                    </div>
                                                  </details>
                                                )}
                                                {/* Inline video preview */}
                                                {test.attachments.find(a => a.type === 'video' && a.body) && (
                                                  <details className="mt-3">
                                                    <summary className="text-[10px] text-purple-500 cursor-pointer hover:text-purple-700 font-bold uppercase flex items-center gap-1">
                                                      <span className="material-symbols-outlined text-xs">videocam</span>
                                                      Video Recording
                                                    </summary>
                                                    <div className="mt-2 p-2 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700">
                                                      <video 
                                                        controls
                                                        className="max-w-full max-h-64 rounded shadow-lg mx-auto"
                                                      >
                                                        <source 
                                                          src={`data:${test.attachments.find(a => a.type === 'video' && a.body).contentType};base64,${test.attachments.find(a => a.type === 'video' && a.body).body}`}
                                                          type={test.attachments.find(a => a.type === 'video' && a.body).contentType}
                                                        />
                                                        Your browser does not support video playback.
                                                      </video>
                                                    </div>
                                                  </details>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ));
                            })()}
                            {filteredTests.length === 0 && (
                              <div className="px-6 py-12 text-center">
                                <span className="material-symbols-outlined text-3xl text-slate-300 dark:text-slate-600 mb-2">filter_list_off</span>
                                <p className="text-sm text-slate-400 font-medium">No {reportFilter} test cases found.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-outline-variant/20 p-8 text-center">
                          <span className="material-symbols-outlined text-4xl text-indigo-300 dark:text-indigo-700 mb-3">info</span>
                          <p className="text-sm text-slate-500 font-medium mb-4">Individual test details could not be extracted. View the raw HTML report for full details.</p>
                          <button onClick={() => setReportView('raw')} className="px-5 py-2.5 bg-indigo-500 text-white text-xs font-bold rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-2 mx-auto">
                            <span className="material-symbols-outlined text-sm">code</span>
                            View Raw HTML Report
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Raw HTML View */
                    <div className="border border-outline-variant/30 rounded-xl overflow-hidden shadow-lg bg-white dark:bg-slate-800">
                      {htmlReport ? (
                        <>
                          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/30">
                            <div className="flex items-start gap-3">
                              <span className="material-symbols-outlined text-amber-500 text-lg mt-0.5">info</span>
                              <div>
                                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                                  Playwright HTML reports are interactive SPAs that may not render correctly in an embedded view.
                                </p>
                                <p className="text-xs text-amber-600 dark:text-amber-300 mt-1">
                                  For the best experience, download the artifact and open index.html locally, or use the Dashboard view above.
                                </p>
                                <div className="flex gap-2 mt-3">
                                  <button 
                                    onClick={() => {
                                      const blob = new Blob([htmlReport], { type: 'text/html' });
                                      const url = URL.createObjectURL(blob);
                                      const a = document.createElement('a');
                                      a.href = url;
                                      a.download = 'playwright-report.html';
                                      a.click();
                                      URL.revokeObjectURL(url);
                                    }}
                                    className="px-3 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-1"
                                  >
                                    <span className="material-symbols-outlined text-sm">download</span>
                                    Download HTML
                                  </button>
                                  <button 
                                    onClick={() => {
                                      const newWindow = window.open('', '_blank');
                                      newWindow.document.write(htmlReport);
                                      newWindow.document.close();
                                    }}
                                    className="px-3 py-1.5 bg-indigo-500 text-white text-xs font-bold rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-1"
                                  >
                                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                                    Open in New Tab
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                          <iframe srcDoc={htmlReport} title="Playwright HTML Report" className="w-full border-0" style={{ height: '600px' }} sandbox="allow-scripts allow-same-origin"/>
                        </>
                      ) : (
                        <div className="p-12 text-center">
                          <span className="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-600 mb-3">description_off</span>
                          <p className="text-sm text-slate-500 font-medium">No HTML report content available.</p>
                          <p className="text-xs text-slate-400 mt-1">Download the artifact to view the full report locally.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })()}

              {artifacts.filter(a => !a.name.toLowerCase().includes('json')).length > 0 && !showReport ? (
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-secondary dark:text-slate-400 mb-3">Artifacts</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {artifacts.filter(a => !a.name.toLowerCase().includes('json')).map(art => (
                      <div key={art.id} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-outline-variant/20">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-sm font-bold text-on-surface dark:text-white">{art.name}</p>
                            <p className="text-[10px] text-slate-500">{(art.size_in_bytes / 1024).toFixed(1)} KB</p>
                          </div>
                          <span className="material-symbols-outlined text-app-red text-lg">folder_zip</span>
                        </div>
                        <div className="flex gap-2">
                          {art.name.toLowerCase().includes('report') || art.name.toLowerCase().includes('playwright') || art.name.toLowerCase().includes('html') ? (
                            <button
                              onClick={() => handleViewHtmlReport(art.id)}
                              disabled={loadingReport || polling || activeRun?.status !== 'completed'}
                              title={polling || activeRun?.status !== 'completed' ? 'Report will be available after pipeline completes' : ''}
                              className="flex-1 px-3 py-2 bg-gradient-to-br from-app-red to-app-dark-red text-white text-xs font-bold rounded-lg transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                            >
                              <span className="material-symbols-outlined text-sm">{loadingReport ? 'sync' : polling || activeRun?.status !== 'completed' ? 'hourglass_empty' : 'visibility'}</span>
                              {loadingReport ? 'Loading...' : polling || activeRun?.status !== 'completed' ? 'Waiting...' : 'View Report'}
                            </button>
                          ) : null}
                          <button
                            onClick={() => handleDownloadArtifact(art.id, art.name)}
                            className="px-3 py-2 bg-app-blue text-white text-xs font-bold rounded-lg hover:bg-app-dark-blue transition-colors flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-sm">download</span>
                            Download
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : artifacts.length === 0 && !showReport ? (
                <div className="w-full h-48 bg-gradient-to-r from-surface-container-highest dark:from-slate-800 to-surface-container-high dark:to-slate-700 rounded-xl flex items-center justify-center relative overflow-hidden">
                  <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-from)_0%,_transparent_70%)] from-app-red"></div>
                  <div className="flex flex-col items-center gap-4 z-10">
                    <span className="material-symbols-outlined text-4xl text-app-red opacity-20">insert_chart</span>
                    {activeRun?.status === 'completed' ? (
                      <p className="text-sm text-on-surface-variant dark:text-slate-500 font-medium">No artifacts found for this run.</p>
                    ) : activeRun ? (
                      <p className="text-sm text-on-surface-variant dark:text-slate-500 font-medium">Artifacts will appear here after the pipeline completes.</p>
                    ) : (
                      <button
                        disabled
                        className="px-8 py-3 bg-app-blue text-white font-bold rounded-full flex items-center gap-2 opacity-50 cursor-not-allowed"
                      >
                        <span className="material-symbols-outlined text-sm">visibility</span>
                        View Full HTML Report
                      </button>
                    )}
                  </div>
                  {/* Decorative bars */}
                  <div className="absolute bottom-0 left-0 w-full flex items-end px-4 gap-1 opacity-10">
                    {[12, 24, 16, 32, 20, 28, 14].map((h, i) => (
                      <div key={i} className="w-full bg-app-red" style={{ height: `${h}px` }}></div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
