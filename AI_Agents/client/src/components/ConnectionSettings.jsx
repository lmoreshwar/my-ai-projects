import { useState, useEffect } from 'react';
import CustomSelect from './CustomSelect';

export default function ConnectionSettings({ connections, setConnections, apiBase, onResetGenerated }) {
  const [testing, setTesting] = useState({ jira: false, llm: false, zephyr: false, github: false });
  const [fetchingBranches, setFetchingBranches] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const saveConnectionToDB = async (section, data) => {
    const token = localStorage.getItem('blast_token');
    if (!token) {
      setSavedMsg('You must be logged in to save connections securely.');
      setTimeout(() => setSavedMsg(''), 4000);
      return false;
    }

    try {
      const response = await fetch(`${apiBase}/users/connections/${section}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) throw new Error('Failed to save to database');
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const saveConnection = async (section) => {
    const names = { jira: 'JIRA', llm: 'LLM', zephyr: 'Zephyr', github: 'GitHub' };
    
    // Validate that the connection was actually tested and passed
    if (connections[section].status !== 'connected') {
      setSavedMsg(`Warning: Please test the ${names[section]} connection successfully before saving.`);
      setTimeout(() => setSavedMsg(''), 4000);
      return;
    }

    const sectionData = {};
    if (section === 'jira') {
      sectionData.url = connections.jira.url;
      sectionData.email = connections.jira.email;
      sectionData.token = connections.jira.token;
    } else if (section === 'llm') {
      sectionData.platform = connections.llm.platform;
      sectionData.apiKey = connections.llm.apiKey;
      sectionData.endpoint = connections.llm.endpoint;
      sectionData.model = connections.llm.model;
    } else if (section === 'zephyr') {
      sectionData.url = connections.zephyr.url;
      sectionData.apiKey = connections.zephyr.apiKey;
      sectionData.releaseName = connections.zephyr.releaseName;
    } else if (section === 'github') {
      sectionData.token = connections.github.token;
      sectionData.apiUrl = connections.github.apiUrl;
    }

    setSavedMsg(`Saving ${names[section]} credentials securely to database...`);

    const success = await saveConnectionToDB(section, sectionData);

    if (success) {
      setSavedMsg(`${names[section]} connection securely saved! It will load automatically on login.`);
    } else {
      setSavedMsg(`Failed to save ${names[section]} connection.`);
    }
    setTimeout(() => setSavedMsg(''), 4000);
  };

  const updateConn = (section, field, value) => {
    setConnections((prev) => ({
      ...prev,
      [section]: { ...prev[section], [field]: value },
    }));
  };

  const testJira = async () => {
    setTesting((p) => ({ ...p, jira: true }));
    updateConn('jira', 'status', 'testing');
    updateConn('jira', 'message', 'Testing connection...');
    try {
      const res = await fetch(`${apiBase}/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'jira', config: connections.jira }),
      });
      const data = await res.json();
      updateConn('jira', 'status', data.status === 'success' ? 'connected' : 'error');
      updateConn('jira', 'message', data.message);
    } catch {
      updateConn('jira', 'status', 'error');
      updateConn('jira', 'message', 'Network error or server down');
    }
    setTesting((p) => ({ ...p, jira: false }));
  };

  const testLlm = async () => {
    setTesting((p) => ({ ...p, llm: true }));
    updateConn('llm', 'status', 'testing');
    updateConn('llm', 'message', 'Testing connection...');
    try {
      const res = await fetch(`${apiBase}/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'llm', config: connections.llm }),
      });
      const data = await res.json();
      updateConn('llm', 'status', data.status === 'success' ? 'connected' : 'error');
      updateConn('llm', 'message', data.message);
      // Reset all generated data when a new LLM connection succeeds
      if (data.status === 'success' && onResetGenerated) onResetGenerated();
    } catch {
      updateConn('llm', 'status', 'error');
      updateConn('llm', 'message', 'Network error or server down');
    }
    setTesting((p) => ({ ...p, llm: false }));
  };

  const testZephyr = async () => {
    setTesting((p) => ({ ...p, zephyr: true }));
    updateConn('zephyr', 'status', 'testing');
    updateConn('zephyr', 'message', 'Testing connection...');
    try {
      const res = await fetch(`${apiBase}/test-zephyr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connections.zephyr),
      });
      const data = await res.json();
      updateConn('zephyr', 'status', data.status === 'success' ? 'connected' : 'error');
      updateConn('zephyr', 'message', data.message);
    } catch {
      updateConn('zephyr', 'status', 'error');
      updateConn('zephyr', 'message', 'Network error or server down');
    }
    setTesting((p) => ({ ...p, zephyr: false }));
  };

  const testGitHub = async () => {
    setTesting((p) => ({ ...p, github: true }));
    updateConn('github', 'status', 'testing');
    updateConn('github', 'message', 'Authenticating with GitHub...');
    updateConn('github', 'repos', []);
    updateConn('github', 'branches', []);
    updateConn('github', 'selectedRepo', '');
    updateConn('github', 'selectedBranch', '');
    updateConn('github', 'repoVisibility', '');
    try {
      const res = await fetch(`${apiBase}/test-github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: connections.github.token, apiUrl: connections.github.apiUrl }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        updateConn('github', 'status', 'connected');
        updateConn('github', 'message', data.message);
        updateConn('github', 'repos', data.repos || []);
      } else {
        updateConn('github', 'status', 'error');
        updateConn('github', 'message', data.message);
      }
    } catch {
      updateConn('github', 'status', 'error');
      updateConn('github', 'message', 'Network error or server down');
    }
    setTesting((p) => ({ ...p, github: false }));
  };

  const fetchBranches = async (repoFullName) => {
    setFetchingBranches(true);
    updateConn('github', 'selectedRepo', repoFullName);
    updateConn('github', 'branches', []);
    updateConn('github', 'selectedBranch', '');
    // Set visibility from cached repos
    const repoInfo = (connections.github.repos || []).find((r) => r.name === repoFullName);
    updateConn('github', 'repoVisibility', repoInfo ? repoInfo.visibility : '');
    try {
      const res = await fetch(`${apiBase}/github-branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: connections.github.token, apiUrl: connections.github.apiUrl, repo: repoFullName }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        updateConn('github', 'branches', data.branches || []);
        // Auto-select default branch
        const defaultBranch = repoInfo?.default_branch || 'main';
        if ((data.branches || []).includes(defaultBranch)) {
          updateConn('github', 'selectedBranch', defaultBranch);
        }
      }
    } catch {
      // silently fail branch fetch
    }
    setFetchingBranches(false);
  };

  const StatusBadge = ({ status }) => {
    if (status === 'connected')
      return (
        <div className="flex items-center bg-green-50 dark:bg-green-900/30 px-3 py-1 rounded-full border border-green-100 dark:border-green-800">
          <span className="text-[0.625rem] font-bold uppercase tracking-widest text-green-700 dark:text-green-400">Connected</span>
        </div>
      );
    if (status === 'testing')
      return (
        <div className="flex items-center bg-yellow-50 dark:bg-yellow-900/30 px-3 py-1 rounded-full border border-yellow-100 dark:border-yellow-800">
          <span className="text-[0.625rem] font-bold uppercase tracking-widest text-yellow-700 dark:text-yellow-400">Testing...</span>
        </div>
      );
    if (status === 'error')
      return (
        <div className="flex items-center bg-red-50 dark:bg-red-900/30 px-3 py-1 rounded-full border border-red-100 dark:border-red-800">
          <span className="text-[0.625rem] font-bold uppercase tracking-widest text-app-red">Error</span>
        </div>
      );
    return (
      <div className="flex items-center bg-red-50 dark:bg-red-900/30 px-3 py-1 rounded-full border border-red-100 dark:border-red-800">
        <span className="text-[0.625rem] font-bold uppercase tracking-widest text-app-red">Config Required</span>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-6 pt-12 pb-32">
      {/* Save Success Toast */}
      {savedMsg && (
        <div className="fixed top-20 right-6 z-50 animate-in flex items-center gap-3 px-5 py-3 bg-emerald-50 dark:bg-emerald-900/30 rounded-xl border border-emerald-200 dark:border-emerald-800 shadow-lg">
          <span className="material-symbols-outlined text-emerald-600 dark:text-emerald-400">check_circle</span>
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{savedMsg}</p>
          <button onClick={() => setSavedMsg('')} className="ml-2 text-emerald-500 hover:text-emerald-700">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Connection Settings</h1>
        <p className="text-on-surface-variant dark:text-slate-400 max-w-2xl font-medium leading-relaxed mt-2">
          Configure and verify connections to third-party services like JIRA, LLMs, Zephyr, and GitHub to enable full-cycle test automation.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* JIRA Connection */}
        <section className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-8 shadow-sm flex flex-col gap-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center border border-slate-100 dark:border-slate-700">
                <span className="material-symbols-outlined text-app-red text-3xl">bug_report</span>
              </div>
              <h3 className="text-xl font-bold tracking-tight text-on-surface dark:text-white">JIRA</h3>
            </div>
            <StatusBadge status={connections.jira.status} />
          </div>
          <div className="flex flex-col gap-5">
            <div className="space-y-2">
              <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                JIRA URL
              </label>
              <input
                className="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-app-red focus:ring-1 focus:ring-app-red transition-all text-sm text-on-surface dark:text-white"
                placeholder="https://your-domain.atlassian.net"
                value={connections.jira.url}
                onChange={(e) => updateConn('jira', 'url', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                USER EMAIL
              </label>
              <input
                className="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-app-red focus:ring-1 focus:ring-app-red transition-all text-sm text-on-surface dark:text-white"
                placeholder="you@company.com"
                value={connections.jira.email}
                onChange={(e) => updateConn('jira', 'email', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                API TOKEN
              </label>
              <input
                className="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-app-red focus:ring-1 focus:ring-app-red transition-all text-sm text-on-surface dark:text-white"
                type="password"
                placeholder="Enter your Jira API token"
                value={connections.jira.token}
                onChange={(e) => updateConn('jira', 'token', e.target.value)}
              />
            </div>
          </div>
          {connections.jira.message && (
            <p className={`text-xs ${connections.jira.status === 'error' ? 'text-red-500' : 'text-green-600'}`}>
              {connections.jira.message}
            </p>
          )}
          <div className="flex items-center gap-3 pt-4">
            <button
              onClick={testJira}
              disabled={testing.jira}
              className="flex-1 h-12 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {testing.jira ? 'Testing...' : 'Test Connection'}
            </button>
            <button onClick={() => saveConnection('jira')} className="flex-[1.5] h-12 bg-app-red text-white font-bold text-sm rounded shadow-lg shadow-app-red/20 active:bg-app-dark-red transition-all">
              Save Connection
            </button>
          </div>
        </section>

        {/* LLM Connection */}
        <section className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-8 shadow-sm flex flex-col gap-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center border border-slate-100 dark:border-slate-700">
                <span className="material-symbols-outlined text-app-red text-3xl">psychology</span>
              </div>
              <h3 className="text-xl font-bold tracking-tight text-on-surface dark:text-white">LLM Provider</h3>
            </div>
            <StatusBadge status={connections.llm.status} />
          </div>
          <div className="flex flex-col gap-5">
            <div className="space-y-2">
              <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                LLM PROVIDER
              </label>
              <CustomSelect
                value={connections.llm.platform}
                onChange={(val) => updateConn('llm', 'platform', val)}
                options={[
                  { value: 'groq', label: 'Groq' },
                  { value: 'ollama', label: 'Ollama (Local)' },
                  { value: 'grok', label: 'Grok (xAI)' },
                  { value: 'gemini', label: 'Gemini' },
                ]}
                placeholder="Select LLM Provider"
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                LLM MODEL
              </label>
              <CustomSelect
                value={connections.llm.model}
                onChange={(val) => updateConn('llm', 'model', val)}
                options={
                  connections.llm.platform === 'groq' 
                    ? [
                        { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
                        { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' }
                      ]
                    : connections.llm.platform === 'gemini'
                    ? [
                        { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
                        { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
                        { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
                      ]
                    : [
                        { value: 'grok-2', label: 'Grok 2' },
                        { value: 'llama3', label: 'Llama 3 (Local)' }
                      ]
                }
                placeholder="Select Model"
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                API KEY
              </label>
              <input
                className="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-app-red focus:ring-1 focus:ring-app-red transition-all text-sm text-on-surface dark:text-white"
                type="password"
                placeholder="sk-..."
                value={connections.llm.apiKey}
                onChange={(e) => updateConn('llm', 'apiKey', e.target.value)}
              />
            </div>
            {connections.llm.platform === 'ollama' && (
              <div className="space-y-2">
                <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                  ENDPOINT URL
                </label>
                <input
                  className="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-app-red focus:ring-1 focus:ring-app-red transition-all text-sm text-on-surface dark:text-white"
                  placeholder="http://localhost:11434/v1"
                  value={connections.llm.endpoint}
                  onChange={(e) => updateConn('llm', 'endpoint', e.target.value)}
                />
              </div>
            )}
          </div>
          {connections.llm.message && (
            <p className={`text-xs ${connections.llm.status === 'error' ? 'text-red-500' : 'text-green-600'}`}>
              {connections.llm.message}
            </p>
          )}
          <div className="flex items-center gap-3 pt-4">
            <button
              onClick={testLlm}
              disabled={testing.llm}
              className="flex-1 h-12 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {testing.llm ? 'Testing...' : 'Test Connection'}
            </button>
            <button onClick={() => saveConnection('llm')} className="flex-[1.5] h-12 bg-app-red text-white font-bold text-sm rounded shadow-lg shadow-app-red/20 active:bg-app-dark-red transition-all">
              Save Connection
            </button>
          </div>
        </section>

        {/* ZEPHYR */}
        <section className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-8 shadow-sm flex flex-col gap-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center border border-slate-100 dark:border-slate-700">
                <span className="material-symbols-outlined text-app-red text-3xl">cloud_sync</span>
              </div>
              <h3 className="text-xl font-bold tracking-tight text-on-surface dark:text-white">Zephyr Scale</h3>
            </div>
            <StatusBadge status={connections.zephyr.status} />
          </div>
          <div className="flex flex-col gap-5">
            <div className="space-y-2">
              <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                ZEPHYR URL
              </label>
              <input
                className="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-app-red focus:ring-1 focus:ring-app-red transition-all text-sm text-on-surface dark:text-white"
                placeholder="https://api.zephyrscale.smartbear.com/v2"
                value={connections.zephyr.url}
                onChange={(e) => updateConn('zephyr', 'url', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                API KEY
              </label>
              <input
                className="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-app-red focus:ring-1 focus:ring-app-red transition-all text-sm text-on-surface dark:text-white"
                type="password"
                placeholder="zephyr-api-key..."
                value={connections.zephyr.apiKey}
                onChange={(e) => updateConn('zephyr', 'apiKey', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                RELEASE NAME
              </label>
              <input
                className="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-app-red focus:ring-1 focus:ring-app-red transition-all text-sm text-on-surface dark:text-white"
                placeholder="e.g. v2.5.0-beta"
                value={connections.zephyr.releaseName || ''}
                onChange={(e) => updateConn('zephyr', 'releaseName', e.target.value)}
              />
            </div>
          </div>
          {connections.zephyr.message && (
            <p className={`text-xs ${connections.zephyr.status === 'error' ? 'text-red-500' : 'text-green-600'}`}>
              {connections.zephyr.message}
            </p>
          )}
          <div className="flex items-center gap-3 pt-4">
            <button
              onClick={testZephyr}
              disabled={testing.zephyr}
              className="flex-1 h-12 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {testing.zephyr ? 'Testing...' : 'Test Connection'}
            </button>
            <button onClick={() => saveConnection('zephyr')} className="flex-[1.5] h-12 bg-app-red text-white font-bold text-sm rounded shadow-lg shadow-app-red/20 active:bg-app-dark-red transition-all">
              Save Connection
            </button>
          </div>
        </section>

        {/* GITHUB */}
        <section className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-8 shadow-sm flex flex-col gap-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center border border-slate-100 dark:border-slate-700">
                <span className="material-symbols-outlined text-app-red text-3xl">cloud_upload</span>
              </div>
              <h3 className="text-xl font-bold tracking-tight text-on-surface dark:text-white">GitHub Integration</h3>
            </div>
            <StatusBadge status={connections.github?.status || 'disconnected'} />
          </div>

          {/* Connection Fields */}
          <div className="flex flex-col gap-5">
            <div className="space-y-2">
              <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                API URL
              </label>
              <input
                className="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-app-red focus:ring-1 focus:ring-app-red transition-all text-sm text-on-surface dark:text-white"
                placeholder="https://api.github.com"
                value={connections.github?.apiUrl || 'https://api.github.com'}
                onChange={(e) => updateConn('github', 'apiUrl', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">
                PERSONAL ACCESS TOKEN
              </label>
              <input
                className="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-app-red focus:ring-1 focus:ring-app-red transition-all text-sm text-on-surface dark:text-white"
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={connections.github?.token || ''}
                onChange={(e) => updateConn('github', 'token', e.target.value)}
              />
              <p className="text-[0.6rem] text-slate-400 dark:text-slate-600 ml-1">
                Required scopes: <span className="font-semibold text-slate-500 dark:text-slate-400">repo</span>, <span className="font-semibold text-slate-500 dark:text-slate-400">read:org</span> (optional for org repos)
              </p>
            </div>
          </div>

          {/* Test Connection Button */}
          {connections.github?.message && (
            <p className={`text-xs ${connections.github.status === 'error' ? 'text-red-500' : 'text-green-600'}`}>
              {connections.github.message}
            </p>
          )}
          <div>
            <button
              onClick={testGitHub}
              disabled={testing.github || !connections.github?.token}
              className="w-full h-12 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {testing.github ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                  Connecting...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-base">cable</span>
                  Test Connection
                </>
              )}
            </button>
          </div>

          {/* Post-Connection: Success message */}
          {connections.github?.status === 'connected' && (
            <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <span className="material-symbols-outlined text-green-600 text-xl">check_circle</span>
              <div>
                <p className="text-sm font-bold text-green-700 dark:text-green-400">GitHub Connected Successfully</p>
                <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">
                  {(connections.github.repos || []).length} repositories found. Use the <span className="font-bold">GitHub CICD</span> page to select a repo, branch and trigger workflows.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Info Cards */}
      <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
        <div className="md:col-span-2 bg-[#f0f4f9] dark:bg-slate-900 rounded-xl p-10 flex flex-col justify-between border-l-8 border-app-blue">
          <div>
            <h4 className="text-xl font-bold text-on-surface dark:text-white mb-3">Automated Validation Logic</h4>
            <p className="text-slate-600 dark:text-slate-400 text-sm mb-8 leading-relaxed max-w-lg">
              Connections are verified against a 12-point health check including latency, token permission scope, and endpoint availability.
            </p>
          </div>
          <div className="flex gap-10">
            <div className="flex flex-col">
              <span className="text-4xl font-black text-app-blue dark:text-blue-400 leading-none">24ms</span>
              <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-slate-500 mt-2">AVG LATENCY</span>
            </div>
            <div className="flex flex-col">
              <span className="text-4xl font-black text-green-600 leading-none">STABLE</span>
              <span className="text-[0.6875rem] font-bold uppercase tracking-widest text-slate-500 mt-2">HEALTH STATUS</span>
            </div>
          </div>
        </div>
        <div className="bg-app-blue rounded-xl p-8 relative overflow-hidden flex flex-col justify-end text-white">
          <div className="absolute top-0 right-0 p-6 opacity-10">
            <span className="material-symbols-outlined text-7xl">security</span>
          </div>
          <h4 className="text-lg font-bold mb-3">Encrypted Storage</h4>
          <p className="text-white/80 text-xs leading-relaxed">
            All API keys are AES-256 encrypted at rest and never logged in plain text.
          </p>
        </div>
      </div>
    </div>
  );
}
