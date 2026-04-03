import { useState, useEffect } from 'react';
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

const STORAGE_KEY = 'ai_test_agent_connections';
const TC_STORAGE_KEY = 'ai_test_agent_testcases';

function App() {
  const [activePage, setActivePage] = useState('connections');
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [generatedTestCases, setGeneratedTestCases] = useState(() => {
    try { return localStorage.getItem(TC_STORAGE_KEY) || ''; } catch { return ''; }
  });

  const [connections, setConnections] = useState({
    jira: { url: '', email: '', token: '', status: 'disconnected', message: '' },
    llm: { platform: 'groq', apiKey: '', endpoint: '', model: '', status: 'disconnected', message: '' },
    zephyr: { url: 'https://api.zephyrscale.smartbear.com/v2', apiKey: '', releaseName: '', status: 'disconnected', message: '' },
    github: { token: '', apiUrl: 'https://api.github.com', repos: [], branches: [], selectedRepo: '', selectedBranch: '', repoVisibility: '', status: 'disconnected', message: '' },
  });

  const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '/api';

  // Load saved connections from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setConnections((prev) => ({
          jira: { ...prev.jira, ...parsed.jira, status: 'disconnected', message: '' },
          llm: { ...prev.llm, ...parsed.llm, status: 'disconnected', message: '' },
          zephyr: { ...prev.zephyr, ...parsed.zephyr, releaseName: parsed.zephyr?.releaseName || '', status: 'disconnected', message: '' },
          github: { ...prev.github, ...parsed.github, repos: [], branches: [], repoVisibility: '', status: 'disconnected', message: '' },
        }));
      } catch (e) {
        console.error('Failed to load saved connections', e);
      }
    }
  }, []);

  // Persist connections (without transient state)
  useEffect(() => {
    const toSave = {
      jira: { url: connections.jira.url, email: connections.jira.email, token: connections.jira.token },
      llm: { platform: connections.llm.platform, apiKey: connections.llm.apiKey, endpoint: connections.llm.endpoint, model: connections.llm.model },
      zephyr: { url: connections.zephyr.url, apiKey: connections.zephyr.apiKey, releaseName: connections.zephyr.releaseName },
      github: { token: connections.github.token, apiUrl: connections.github.apiUrl, selectedRepo: connections.github.selectedRepo, selectedBranch: connections.github.selectedBranch },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, [
    connections.jira.url, connections.jira.email, connections.jira.token,
    connections.llm.platform, connections.llm.apiKey, connections.llm.endpoint, connections.llm.model,
    connections.zephyr.url, connections.zephyr.apiKey, connections.zephyr.releaseName,
    connections.github.token, connections.github.apiUrl, connections.github.selectedRepo, connections.github.selectedBranch,
  ]);

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
        return <ConnectionSettings connections={connections} setConnections={setConnections} apiBase={API_BASE} />;
      case 'test-plan':
        return <TestPlanGenerator connections={connections} apiBase={API_BASE} />;
      case 'test-cases':
        return <TestCaseGenerator connections={connections} apiBase={API_BASE} onTestCasesGenerated={setGeneratedTestCases} onNavigate={setActivePage} />;
      case 'test-scenarios':
        return <TestScenarioGenerator connections={connections} apiBase={API_BASE} />;
      case 'review-cases':
        return <ReviewTestCases connections={connections} apiBase={API_BASE} generatedTestCases={generatedTestCases} onNavigate={setActivePage} />;
      case 'zephyr-dashboard':
        return <ZephyrDashboard connections={connections} />;
      case 'selenium-bdd':
        return <SeleniumBDD connections={connections} apiBase={API_BASE} generatedTestCases={generatedTestCases} />;
      case 'playwright-js':
        return <PlaywrightJS connections={connections} apiBase={API_BASE} generatedTestCases={generatedTestCases} />;
      case 'playwright-pom':
        return <PlaywrightPOM connections={connections} apiBase={API_BASE} generatedTestCases={generatedTestCases} />;
      case 'github':
        return <GitHubIntegration connections={connections} onNavigate={setActivePage} />;
      case 'github-cicd':
        return <GitHubCICD connections={connections} apiBase={API_BASE} />;
      default:
        return <ConnectionSettings connections={connections} setConnections={setConnections} apiBase={API_BASE} />;
    }
  };

  return (
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
}

export default App;
