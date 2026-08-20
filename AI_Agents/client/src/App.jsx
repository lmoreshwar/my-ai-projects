import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ConnectionSettings from './components/ConnectionSettings';
import TestPlanGenerator from './components/TestPlanGenerator';
import TestScenarioGenerator from './components/TestScenarioGenerator';
import TestCaseGenerator from './components/TestCaseGenerator';
import ReviewTestCases from './components/ReviewTestCases';
import ZephyrDashboard from './components/ZephyrDashboard';
import AINativePlaywright from './components/AINativePlaywright';
import AutopilotExplorer from './components/AutopilotExplorer';
import GitHubIntegration from './components/GitHubIntegration';
import GitHubCICD from './components/GitHubCICD';
import SavedHistory from './components/SavedHistory';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import DevHome from './pages/DevHome';

const STORAGE_KEY = 'ai_test_agent_connections';
const TC_STORAGE_KEY = 'ai_test_agent_testcases';
const LIFTED_STATE_KEY = 'ai_test_agent_lifted_state';

// Helper: safe JSON parse
const safeParse = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};

function App() {
  const [activePage, setActivePageInternal] = useState('connections');
  const [visitedPages, setVisitedPages] = useState(() => new Set(['connections']));
  const setActivePage = useCallback((page) => {
    setVisitedPages(prev => { const n = new Set(prev); n.add(page); return n; });
    setActivePageInternal(page);
  }, []);
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [generatedTestCases, setGeneratedTestCases] = useState(() => {
    try { return localStorage.getItem(TC_STORAGE_KEY) || ''; } catch { return ''; }
  });

  // ── Load lifted state from localStorage on mount ──
  const liftedInit = safeParse(LIFTED_STATE_KEY, {});

  // ── Lifted state for tab persistence ──
  // Playwright POM
  const [pomFiles, setPomFiles] = useState(liftedInit.pomFiles || []);
  const [pomActiveIdx, setPomActiveIdx] = useState(liftedInit.pomActiveIdx || 0);
  const [pomSelectedGroups, setPomSelectedGroups] = useState(new Set(liftedInit.pomSelectedGroups || []));
  const [pomLangFilter, setPomLangFilter] = useState(liftedInit.pomLangFilter || 'all');

  // Playwright TS + BDD
  const [bddFiles, setBddFiles] = useState(liftedInit.bddFiles || []);
  const [bddActiveIdx, setBddActiveIdx] = useState(liftedInit.bddActiveIdx || 0);
  const [bddSelectedGroups, setBddSelectedGroups] = useState(new Set(liftedInit.bddSelectedGroups || []));

  // Selenium BDD
  const [seleniumOutput, setSeleniumOutput] = useState(liftedInit.seleniumOutput || '');
  const [seleniumSelectedGroups, setSeleniumSelectedGroups] = useState(new Set(liftedInit.seleniumSelectedGroups || []));

  // Selenium BDD - lifted local state for tab persistence
  const [seleniumLocalState, setSeleniumLocalState] = useState(liftedInit.seleniumLocalState || { ticketId: '', manualReq: '', selectedImported: '', issueData: null });

  // GitHub CI/CD
  const [cicdState, setCicdState] = useState(liftedInit.cicdState || {
    workflows: [], selectedWorkflow: '', activeRun: null,
    jobs: [], artifacts: [], logLines: [], htmlReport: null,
    reportData: null, testResults: { passed: 0, failed: 0, skipped: 0, total: 0 },
    showReport: false, reportView: 'dashboard', reportFilter: 'all',
  });

  // Review Test Cases
  const [reviewCoverage, setReviewCoverage] = useState(liftedInit.reviewCoverage || null);

  // Review Test Cases - lifted local state for tab persistence
  const [reviewLocalState, setReviewLocalState] = useState(liftedInit.reviewLocalState || { ticketId: '', manualReq: '', issueData: null });

  // Pending push files — shared between PlaywrightPOM → GitHub Integration
  const [pendingPushFiles, setPendingPushFiles] = useState([]);

  // ── Persist all lifted state to localStorage ──
  useEffect(() => {
    try {
      const toSave = {
        pomFiles, pomActiveIdx, pomSelectedGroups: [...pomSelectedGroups], pomLangFilter,
        bddFiles, bddActiveIdx, bddSelectedGroups: [...bddSelectedGroups],
        seleniumOutput, seleniumSelectedGroups: [...seleniumSelectedGroups], seleniumLocalState,
        cicdState: { ...cicdState, htmlReport: null }, // skip large HTML blobs
        reviewCoverage, reviewLocalState,
      };
      localStorage.setItem(LIFTED_STATE_KEY, JSON.stringify(toSave));
    } catch { /* localStorage full or unavailable */ }
  }, [pomFiles, pomActiveIdx, pomSelectedGroups, pomLangFilter,
      bddFiles, bddActiveIdx, bddSelectedGroups,
      seleniumOutput, seleniumSelectedGroups, seleniumLocalState,
      cicdState, reviewCoverage, reviewLocalState]);

  // ── Reset all generated data when user reconnects ──
  const handleResetGenerated = () => {
    setGeneratedTestCases('');
    setPomFiles([]); setPomActiveIdx(0); setPomSelectedGroups(new Set()); setPomLangFilter('all');
    setBddFiles([]); setBddActiveIdx(0); setBddSelectedGroups(new Set());
    setSeleniumOutput(''); setSeleniumSelectedGroups(new Set()); setSeleniumLocalState({ ticketId: '', manualReq: '', selectedImported: '', issueData: null });
    setCicdState({
      workflows: [], selectedWorkflow: '', activeRun: null,
      jobs: [], artifacts: [], logLines: [], htmlReport: null,
      reportData: null, testResults: { passed: 0, failed: 0, skipped: 0, total: 0 },
      showReport: false, reportView: 'dashboard', reportFilter: 'all',
    });
    setReviewCoverage(null); setReviewLocalState({ ticketId: '', manualReq: '', issueData: null });
    setVisitedPages(new Set(['connections']));
    try { localStorage.removeItem(LIFTED_STATE_KEY); localStorage.removeItem(TC_STORAGE_KEY); } catch {}
  };

  // ── Clear only test cases (shared callback for automation pages) ──
  const handleClearTestCases = () => {
    setGeneratedTestCases('');
    try { localStorage.removeItem(TC_STORAGE_KEY); } catch {}
  };

  const [connections, setConnections] = useState({
    jira: { url: '', email: '', token: '', status: 'disconnected', message: '' },
    llm: { platform: 'groq', apiKey: '', endpoint: '', model: '', status: 'disconnected', message: '' },
    zephyr: { url: 'https://api.zephyrscale.smartbear.com/v2', apiKey: '', releaseName: '', status: 'disconnected', message: '' },
    github: { token: '', apiUrl: 'https://api.github.com', repos: [], branches: [], selectedRepo: '', selectedBranch: '', repoVisibility: '', status: 'disconnected', message: '' },
  });

  const API_BASE = import.meta.env.DEV
    ? 'http://localhost:8000'
    : (import.meta.env.VITE_API_BASE || '');
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  // Track whether user is logged in so we can re-fetch connections after login
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('blast_token'));
  // Bumped on each login to force a connections re-fetch even if isLoggedIn was already true
  const [connReloadKey, setConnReloadKey] = useState(0);

  // Handler called by Login page after successful authentication
  const handleLogin = () => {
    // Reset all in-memory state so no data from a previous user leaks
    setConnections({
      jira: { url: '', email: '', token: '', status: 'disconnected', message: '' },
      llm: { platform: 'groq', apiKey: '', endpoint: '', model: '', status: 'disconnected', message: '' },
      zephyr: { url: 'https://api.zephyrscale.smartbear.com/v2', apiKey: '', releaseName: '', status: 'disconnected', message: '' },
      github: { token: '', apiUrl: 'https://api.github.com', repos: [], branches: [], selectedRepo: '', selectedBranch: '', repoVisibility: '', status: 'disconnected', message: '' },
    });
    setGeneratedTestCases('');
    setPomFiles([]); setPomActiveIdx(0); setPomSelectedGroups(new Set()); setPomLangFilter('all');
    setBddFiles([]); setBddActiveIdx(0); setBddSelectedGroups(new Set());
    setSeleniumOutput(''); setSeleniumSelectedGroups(new Set()); setSeleniumLocalState({ ticketId: '', manualReq: '', selectedImported: '', issueData: null });
    setCicdState({
      workflows: [], selectedWorkflow: '', activeRun: null,
      jobs: [], artifacts: [], logLines: [], htmlReport: null,
      reportData: null, testResults: { passed: 0, failed: 0, skipped: 0, total: 0 },
      showReport: false, reportView: 'dashboard', reportFilter: 'all',
    });
    setReviewCoverage(null); setReviewLocalState({ ticketId: '', manualReq: '', issueData: null });
    setVisitedPages(new Set(['connections']));
    // Clear persisted generated data so a fresh login never shows the previous user's test cases
    try { localStorage.removeItem(TC_STORAGE_KEY); localStorage.removeItem(LIFTED_STATE_KEY); } catch { /* ignore */ }
    // Mark logged in and trigger a re-fetch of the new user's saved connections from DB
    setIsLoggedIn(true);
    setConnReloadKey((k) => k + 1);
  };

  // ── Load saved connections from DB on mount AND after login ──
  useEffect(() => {
    const fetchConnections = async () => {
      const token = localStorage.getItem('blast_token');
      // Locally the backend runs in DEV_MODE and bypasses auth, so a token isn't required.
      if (!token && !isLocal) return;

      try {
        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`${API_BASE}/api/users/connections`, { headers });
        
        if (response.ok) {
          const parsed = await response.json();
          setConnections((prev) => ({
            jira: { ...prev.jira, ...parsed.jira, status: 'disconnected', message: '' },
            llm: { ...prev.llm, ...parsed.llm, status: 'disconnected', message: '' },
            zephyr: { ...prev.zephyr, ...parsed.zephyr, status: 'disconnected', message: '' },
            github: { ...prev.github, ...parsed.github, repos: [], branches: [], repoVisibility: '', status: 'disconnected', message: '' },
          }));
        }
      } catch (e) {
        console.error('Failed to load saved connections from database', e);
      }
    };

    fetchConnections();
  }, [API_BASE, isLoggedIn, connReloadKey, isLocal]);

  // Persist generated test cases to localStorage
  useEffect(() => {
    if (generatedTestCases) {
      localStorage.setItem(TC_STORAGE_KEY, generatedTestCases);
    }
  }, [generatedTestCases]);

  // Dark mode toggle
  const toggleDark = () => {
    setDarkMode((d) => {
      const next = !d;
      document.documentElement.classList.toggle('dark', next);
      return next;
    });
  };

  const dashboardContent = (
    <div className="bg-background dark:bg-slate-950 text-on-surface dark:text-slate-100 min-h-screen overflow-x-hidden transition-colors duration-200">
      {/* Sidebar */}
      <Sidebar activePage={activePage} onNavigate={setActivePage} onToggleDark={toggleDark} collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(c => !c)} />

      {/* TopBar */}
      <TopBar sidebarCollapsed={sidebarCollapsed}>
        {/* The Sidebar renders the mobile hamburger button as a child */}
      </TopBar>

      {/* Main Content */}
      <main className={`min-h-screen pb-24 lg:pb-12 transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-80'}`}>
        {/* Tab-persistent rendering: visited pages stay mounted so async ops survive tab switches */}
        <div style={{ display: activePage === 'connections' ? undefined : 'none' }}>
          {visitedPages.has('connections') && <ConnectionSettings connections={connections} setConnections={setConnections} apiBase={API_BASE} onResetGenerated={handleResetGenerated} />}
        </div>
        <div style={{ display: activePage === 'test-plan' ? undefined : 'none' }}>
          {visitedPages.has('test-plan') && <TestPlanGenerator connections={connections} apiBase={API_BASE} />}
        </div>
        <div style={{ display: activePage === 'test-scenarios' ? undefined : 'none' }}>
          {visitedPages.has('test-scenarios') && <TestScenarioGenerator connections={connections} apiBase={API_BASE} />}
        </div>
        <div style={{ display: activePage === 'test-cases' ? undefined : 'none' }}>
          {visitedPages.has('test-cases') && <TestCaseGenerator connections={connections} apiBase={API_BASE} onTestCasesGenerated={setGeneratedTestCases} onNavigate={setActivePage} />}
        </div>
        <div style={{ display: activePage === 'review-cases' ? undefined : 'none' }}>
          {visitedPages.has('review-cases') && <ReviewTestCases connections={connections} apiBase={API_BASE} generatedTestCases={generatedTestCases} onNavigate={setActivePage} reviewCoverage={reviewCoverage} setReviewCoverage={setReviewCoverage} localState={reviewLocalState} setLocalState={setReviewLocalState} onClearTestCases={handleClearTestCases} />}
        </div>
        <div style={{ display: activePage === 'zephyr-dashboard' ? undefined : 'none' }}>
          {visitedPages.has('zephyr-dashboard') && <ZephyrDashboard connections={connections} />}
        </div>
        <div style={{ display: activePage === 'ai-native-playwright' ? undefined : 'none' }}>
          {visitedPages.has('ai-native-playwright') && <AINativePlaywright connections={connections} apiBase={API_BASE} generatedTestCases={generatedTestCases} onNavigate={setActivePage} setCicdState={setCicdState} />}
        </div>
        <div style={{ display: activePage === 'autopilot' ? undefined : 'none' }}>
          {visitedPages.has('autopilot') && <AutopilotExplorer apiBase={API_BASE} connections={connections} />}
        </div>
        <div style={{ display: activePage === 'github' ? undefined : 'none' }}>
          {visitedPages.has('github') && <GitHubIntegration connections={connections} apiBase={API_BASE} onNavigate={setActivePage} pendingPushFiles={pendingPushFiles} setPendingPushFiles={setPendingPushFiles} />}
        </div>
        <div style={{ display: activePage === 'github-cicd' ? undefined : 'none' }}>
          {visitedPages.has('github-cicd') && <GitHubCICD connections={connections} apiBase={API_BASE} cicdState={cicdState} setCicdState={setCicdState} />}
        </div>
        <div style={{ display: activePage === 'saved-history' ? undefined : 'none' }}>
          {visitedPages.has('saved-history') && <SavedHistory apiBase={API_BASE} />}
        </div>
      </main>

      {/* App footer (desktop) */}
      <footer className={`hidden lg:flex items-center justify-between gap-4 px-8 py-4 border-t border-outline-variant/20 dark:border-slate-800 bg-background dark:bg-slate-950 text-xs text-on-surface-variant dark:text-slate-500 transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-80'}`}>
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-5 h-5 rounded bg-white ring-1 ring-app-red/15">
            <img src="/blast-mark.png?v=3" alt="BLAST AIQA" className="w-4 h-4 object-contain" />
          </span>
          <span className="font-semibold text-on-surface dark:text-slate-300">BLAST AIQA</span>
          <span className="opacity-60">· Browser-Level Autonomous Software Testing</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="https://blastaiqa.com" target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">blastaiqa.com</a>
          <span className="opacity-60">© 2026 · All rights reserved</span>
        </div>
      </footer>

      {/* Mobile Bottom Nav — scrollable to fit all pages */}
      <nav className="fixed bottom-0 left-0 w-full bg-app-blue dark:bg-app-dark-blue z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] lg:hidden">
        <div className="flex items-center overflow-x-auto px-2 py-2 gap-1 scrollbar-hide">
          {[
            { id: 'connections', icon: 'hub', label: 'Settings' },
            { id: 'test-cases', icon: 'edit_note', label: 'Cases' },
            { id: 'review-cases', icon: 'fact_check', label: 'Review' },
            { id: 'ai-native-playwright', icon: 'smart_toy', label: 'AI·PW' },
            { id: 'autopilot', icon: 'travel_explore', label: 'Autopilot' },
            { id: 'github', icon: 'cloud_upload', label: 'GitHub' },
            { id: 'github-cicd', icon: 'rocket_launch', label: 'CI/CD' },
            { id: 'saved-history', icon: 'inventory_2', label: 'Artifacts' },
            { id: 'zephyr-dashboard', icon: 'dashboard', label: 'Zephyr' },
            { id: 'test-plan', icon: 'assignment', label: 'Plan' },
            { id: 'test-scenarios', icon: 'schema', label: 'Scenarios' },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={`flex flex-col items-center justify-center shrink-0 px-3 py-1.5 rounded-xl transition-all ${
                activePage === item.id
                  ? 'text-white bg-white/15'
                  : 'text-white/60 hover:text-white active:bg-white/10'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
              <span className="text-[9px] font-semibold tracking-wide mt-0.5 whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );

  return (
    <Routes>
      {/* DevHome auto-sets a dev token; keep it for localhost only, force login in production. */}
      <Route path="/" element={isLocal ? <DevHome /> : <Navigate to="/login" replace />} />
      <Route path="/login" element={<Login onLogin={handleLogin} />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/app" element={isLocal || isLoggedIn ? dashboardContent : <Navigate to="/login" replace />} />
      <Route path="/dashboard" element={isLocal || isLoggedIn ? dashboardContent : <Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
