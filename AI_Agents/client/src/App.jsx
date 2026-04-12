import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ConnectionSettings from './components/ConnectionSettings';
import TestPlanGenerator from './components/TestPlanGenerator';
import TestCaseGenerator from './components/TestCaseGenerator';
import TestScenarioGenerator from './components/TestScenarioGenerator';
import ReviewTestCases from './components/ReviewTestCases';
import ZephyrDashboard from './components/ZephyrDashboard';
import SeleniumBDD from './components/SeleniumBDD';
import PlaywrightJS from './components/PlaywrightJS';
import PlaywrightPOM from './components/PlaywrightPOM';
import GitHubIntegration from './components/GitHubIntegration';
import GitHubCICD from './components/GitHubCICD';
import Login from './pages/Login';
import SignUp from './pages/SignUp';

const STORAGE_KEY = 'ai_test_agent_connections';
const TC_STORAGE_KEY = 'ai_test_agent_testcases';
const LIFTED_STATE_KEY = 'ai_test_agent_lifted_state';

// Helper: safe JSON parse
const safeParse = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
};

function App() {
  const [activePage, setActivePage] = useState('connections');
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

  const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  // Track whether user is logged in so we can re-fetch connections after login
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem('blast_token'));

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
    // Trigger re-fetch of the new user's saved connections from DB
    setIsLoggedIn(prev => !prev); // toggle to trigger useEffect
  };

  // ── Load saved connections from DB on mount AND after login ──
  useEffect(() => {
    const fetchConnections = async () => {
      const token = localStorage.getItem('blast_token');
      if (!token) return;

      try {
        const response = await fetch(`${API_BASE}/api/users/connections`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
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
  }, [API_BASE, isLoggedIn]);

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

  const renderPage = () => {
    switch (activePage) {
      case 'connections':
        return <ConnectionSettings connections={connections} setConnections={setConnections} apiBase={API_BASE} onResetGenerated={handleResetGenerated} />;
      case 'test-plan':
        return <TestPlanGenerator connections={connections} apiBase={API_BASE} />;
      case 'test-cases':
        return <TestCaseGenerator connections={connections} apiBase={API_BASE} onTestCasesGenerated={setGeneratedTestCases} onNavigate={setActivePage} />;
      case 'test-scenarios':
        return <TestScenarioGenerator connections={connections} apiBase={API_BASE} />;
      case 'review-cases':
        return <ReviewTestCases connections={connections} apiBase={API_BASE} generatedTestCases={generatedTestCases} onNavigate={setActivePage} reviewCoverage={reviewCoverage} setReviewCoverage={setReviewCoverage} localState={reviewLocalState} setLocalState={setReviewLocalState} onClearTestCases={handleClearTestCases} />;
      case 'zephyr-dashboard':
        return <ZephyrDashboard connections={connections} />;
      case 'selenium-bdd':
        return <SeleniumBDD connections={connections} apiBase={API_BASE} generatedTestCases={generatedTestCases} seleniumOutput={seleniumOutput} setSeleniumOutput={setSeleniumOutput} selectedGroups={seleniumSelectedGroups} setSelectedGroups={setSeleniumSelectedGroups} onClearTestCases={handleClearTestCases} />;
      case 'playwright-js':
        return <PlaywrightJS connections={connections} apiBase={API_BASE} generatedTestCases={generatedTestCases} generatedFiles={bddFiles} setGeneratedFiles={setBddFiles} activeFileIdx={bddActiveIdx} setActiveFileIdx={setBddActiveIdx} selectedGroups={bddSelectedGroups} setSelectedGroups={setBddSelectedGroups} onClearTestCases={handleClearTestCases} />;
      case 'playwright-pom':
        return <PlaywrightPOM connections={connections} apiBase={API_BASE} generatedTestCases={generatedTestCases} generatedFiles={pomFiles} setGeneratedFiles={setPomFiles} activeFileIdx={pomActiveIdx} setActiveFileIdx={setPomActiveIdx} selectedGroups={pomSelectedGroups} setSelectedGroups={setPomSelectedGroups} langFilter={pomLangFilter} setLangFilter={setPomLangFilter} onNavigate={setActivePage} onPushFiles={setPendingPushFiles} onClearTestCases={handleClearTestCases} />;
      case 'github':
        return <GitHubIntegration connections={connections} apiBase={API_BASE} onNavigate={setActivePage} pendingPushFiles={pendingPushFiles} setPendingPushFiles={setPendingPushFiles} />;
      case 'github-cicd':
        return <GitHubCICD connections={connections} apiBase={API_BASE} cicdState={cicdState} setCicdState={setCicdState} />;
      default:
        return <ConnectionSettings connections={connections} setConnections={setConnections} apiBase={API_BASE} onResetGenerated={handleResetGenerated} />;
    }
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
      <main className={`min-h-screen pb-12 transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-80'}`}>
        {renderPage()}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 py-3 bg-app-blue dark:bg-app-dark-blue z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] lg:hidden">
        <button onClick={() => setActivePage('connections')} className={`flex flex-col items-center justify-center transition-all ${activePage === 'connections' ? 'text-white bg-white/15 rounded-xl px-4 py-1' : 'text-white/70 hover:text-white'}`}>
          <span className="material-symbols-outlined">hub</span>
          <span className="text-[11px] font-medium tracking-wide mt-1">Settings</span>
        </button>
        <button onClick={() => setActivePage('test-plan')} className={`flex flex-col items-center justify-center transition-all ${activePage === 'test-plan' ? 'text-white bg-white/15 rounded-xl px-4 py-1' : 'text-white/70 hover:text-white'}`}>
          <span className="material-symbols-outlined">assignment</span>
          <span className="text-[11px] font-medium tracking-wide mt-1">Plan</span>
        </button>
        <button onClick={() => setActivePage('test-cases')} className={`flex flex-col items-center justify-center transition-all ${activePage === 'test-cases' ? 'text-white bg-white/15 rounded-xl px-4 py-1' : 'text-white/70 hover:text-white'}`}>
          <span className="material-symbols-outlined">edit_note</span>
          <span className="text-[11px] font-medium tracking-wide mt-1">Cases</span>
        </button>
        <button onClick={() => setActivePage('review-cases')} className={`flex flex-col items-center justify-center transition-all ${activePage === 'review-cases' ? 'text-white bg-white/15 rounded-xl px-4 py-1' : 'text-white/70 hover:text-white'}`}>
          <span className="material-symbols-outlined">fact_check</span>
          <span className="text-[11px] font-medium tracking-wide mt-1">Review</span>
        </button>
        <button onClick={() => setActivePage('test-scenarios')} className={`flex flex-col items-center justify-center transition-all ${activePage === 'test-scenarios' ? 'text-white bg-white/15 rounded-xl px-4 py-1' : 'text-white/70 hover:text-white'}`}>
          <span className="material-symbols-outlined">schema</span>
          <span className="text-[11px] font-medium tracking-wide mt-1">Scenarios</span>
        </button>
        <button onClick={() => setActivePage('zephyr-dashboard')} className={`flex flex-col items-center justify-center transition-all ${activePage === 'zephyr-dashboard' ? 'text-white bg-white/15 rounded-xl px-4 py-1' : 'text-white/70 hover:text-white'}`}>
          <span className="material-symbols-outlined">dashboard</span>
          <span className="text-[11px] font-medium tracking-wide mt-1">Zephyr</span>
        </button>
      </nav>
    </div>
  );

  return (
    <Routes>
      <Route path="/login" element={<Login onLogin={handleLogin} />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/dashboard" element={dashboardContent} />
      <Route path="/" element={<Navigate to="/login" />} />
    </Routes>
  );
}

export default App;
