import { useState, useRef } from 'react';
import CustomSelect from './CustomSelect';

export default function ConnectionSettings({ connections, setConnections, apiBase, onResetGenerated }) {
  const [testing, setTesting] = useState({ jira: false, llm: false, zephyr: false, github: false });
  const [savedMsg, setSavedMsg] = useState('');
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [createRepoMsg, setCreateRepoMsg] = useState({ type: '', text: '' });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [updatingTarget, setUpdatingTarget] = useState(false);
  const llmAbortRef = useRef(null);

  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const saveConnectionToDB = async (section, data) => {
    const token = localStorage.getItem('blast_token');
    // Locally the backend runs in DEV_MODE and bypasses auth, so a token isn't required.
    if (!token && !isLocal) {
      setSavedMsg('You must be logged in to save connections securely.');
      setTimeout(() => setSavedMsg(''), 4000);
      return false;
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`${apiBase}/api/users/connections/${section}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const errText = await response.text();
        console.error(`Save ${section} failed (${response.status}):`, errText);
        throw new Error(`Failed to save (${response.status})`);
      }
      return true;
    } catch (err) {
      console.error('Save connection error:', err);
      return false;
    }
  };

  const saveConnection = async (section) => {
    const names = { jira: 'JIRA', llm: 'LLM', zephyr: 'Zephyr', github: 'GitHub' };

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
      // Persist the chosen target repo so the cloud runner opens the PR in THIS repo.
      sectionData.selectedRepo = connections.github.selectedRepo || '';
      sectionData.selectedBranch = connections.github.selectedBranch || 'main';
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

  const LLM_DEFAULT_MODEL = {
    gemini: 'gemini-flash-latest',
    openai: 'gpt-5.6-luna',
    groq: 'openai/gpt-oss-120b',
    grok: 'grok-2',
    nvidia: 'qwen/qwen3-coder-480b-a35b-instruct',
    ollama: 'llama3',
  };

  const updateConn = (section, field, value) => {
    setConnections((prev) => {
      const next = { ...prev[section], [field]: value };
      // Switching LLM provider: reset the model to that provider's default so a
      // stale model from the previous provider can't fail the connection test.
      if (section === 'llm' && field === 'platform') {
        next.model = LLM_DEFAULT_MODEL[value] || '';
      }
      return { ...prev, [section]: next };
    });
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
    const controller = new AbortController();
    llmAbortRef.current = controller;
    try {
      const res = await fetch(`${apiBase}/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'llm', config: connections.llm }),
        signal: controller.signal,
      });
      const data = await res.json();
      updateConn('llm', 'status', data.status === 'success' ? 'connected' : 'error');
      updateConn('llm', 'message', data.message);
      // Reset all generated data when a new LLM connection succeeds
      if (data.status === 'success' && onResetGenerated) onResetGenerated();
    } catch (err) {
      if (err.name === 'AbortError') {
        updateConn('llm', 'status', '');
        updateConn('llm', 'message', 'Connection test cancelled — you can switch models now.');
      } else {
        updateConn('llm', 'status', 'error');
        updateConn('llm', 'message', 'Network error or server down');
      }
    }
    llmAbortRef.current = null;
    setTesting((p) => ({ ...p, llm: false }));
  };

  const cancelLlmTest = () => {
    if (llmAbortRef.current) {
      llmAbortRef.current.abort();
      llmAbortRef.current = null;
    }
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

  const saveGitHubTarget = async (selectedRepo, selectedBranch) => {
    const target = {
      token: connections.github.token,
      apiUrl: connections.github.apiUrl,
      selectedRepo,
      selectedBranch,
    };
    if (!await saveConnectionToDB('github', target)) {
      throw new Error('Could not save your Pull Request destination.');
    }
  };

  const fetchBranches = async (repo) => {
    const res = await fetch(`${apiBase}/github-branches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: connections.github.token,
        apiUrl: connections.github.apiUrl,
        repo,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'success') {
      throw new Error(data.message || 'Could not load repository branches.');
    }
    return data.branches || [];
  };

  const selectTargetRepo = async (selectedRepo) => {
    const repository = (connections.github.repos || []).find((repo) => repo.name === selectedRepo);
    const selectedBranch = repository?.default_branch || 'main';
    setUpdatingTarget(true);
    setCreateRepoMsg({ type: '', text: '' });
    updateConn('github', 'selectedRepo', selectedRepo);
    updateConn('github', 'selectedBranch', selectedBranch);
    updateConn('github', 'branches', [selectedBranch]);
    try {
      await saveGitHubTarget(selectedRepo, selectedBranch);
      const branches = await fetchBranches(selectedRepo);
      updateConn('github', 'branches', branches);
      setSavedMsg(`Pull Request destination changed to ${selectedRepo} @ ${selectedBranch}.`);
      setTimeout(() => setSavedMsg(''), 4000);
    } catch (error) {
      setCreateRepoMsg({ type: 'error', text: error.message || 'Could not update the Pull Request destination.' });
    }
    setUpdatingTarget(false);
  };

  const selectTargetBranch = async (selectedBranch) => {
    const selectedRepo = connections.github.selectedRepo;
    if (!selectedRepo) return;
    setUpdatingTarget(true);
    setCreateRepoMsg({ type: '', text: '' });
    updateConn('github', 'selectedBranch', selectedBranch);
    try {
      await saveGitHubTarget(selectedRepo, selectedBranch);
      setSavedMsg(`Pull Request destination changed to ${selectedRepo} @ ${selectedBranch}.`);
      setTimeout(() => setSavedMsg(''), 4000);
    } catch (error) {
      setCreateRepoMsg({ type: 'error', text: error.message || 'Could not update the Pull Request destination.' });
    }
    setUpdatingTarget(false);
  };

  const createRepoFromTemplate = async () => {
    const name = newRepoName.trim();
    if (!name) {
      setCreateRepoMsg({ type: 'error', text: 'Enter a name for your new repository.' });
      return;
    }
    setCreatingRepo(true);
    setCreateRepoMsg({ type: '', text: 'Creating your repo...' });
    try {
      const connection = {
        token: connections.github.token,
        apiUrl: connections.github.apiUrl,
        selectedRepo: connections.github.selectedRepo || '',
        selectedBranch: connections.github.selectedBranch || 'main',
      };
      const saved = await saveConnectionToDB('github', connection);
      if (!saved) throw new Error('Save your GitHub connection before creating a repo.');

      const authToken = localStorage.getItem('blast_token');
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      const res = await fetch(`${apiBase}/api/github/create-repo`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.msg || `Could not create the repository (${res.status}).`);

      const target = {
        ...connection,
        selectedRepo: data.fullName,
        selectedBranch: data.defaultBranch,
      };
      if (!await saveConnectionToDB('github', target)) {
        throw new Error(`Created ${data.fullName}, but could not save it as the target. Select it after reconnecting.`);
      }
      updateConn('github', 'selectedRepo', data.fullName);
      updateConn('github', 'selectedBranch', data.defaultBranch);
      updateConn('github', 'branches', [data.defaultBranch]);
      updateConn('github', 'repoVisibility', 'Public');
      setCreateRepoMsg({ type: 'success', text: `Created ${data.fullName}. It is now your Pull Request target.` });
      setNewRepoName('');
      setShowCreateForm(false);
    } catch (error) {
      setCreateRepoMsg({ type: 'error', text: error.message || 'Could not create the repository.' });
    }
    setCreatingRepo(false);
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
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-32">
      {/* Save Toast - green for success, red for failure */}
      {savedMsg && (
        <div className={`fixed top-20 right-6 z-50 animate-in flex items-center gap-3 px-5 py-3 rounded-xl border shadow-lg ${
          savedMsg.startsWith('Failed') || savedMsg.startsWith('Warning') || savedMsg.startsWith('You must')
            ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
            : 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800'
        }`}>
          <span className={`material-symbols-outlined ${
            savedMsg.startsWith('Failed') || savedMsg.startsWith('Warning') || savedMsg.startsWith('You must')
              ? 'text-red-600 dark:text-red-400'
              : 'text-emerald-600 dark:text-emerald-400'
          }`}>{savedMsg.startsWith('Failed') || savedMsg.startsWith('Warning') || savedMsg.startsWith('You must') ? 'error' : 'check_circle'}</span>
          <p className={`text-sm font-semibold ${
            savedMsg.startsWith('Failed') || savedMsg.startsWith('Warning') || savedMsg.startsWith('You must')
              ? 'text-red-700 dark:text-red-400'
              : 'text-emerald-700 dark:text-emerald-400'
          }`}>{savedMsg}</p>
          <button onClick={() => setSavedMsg('')} className="ml-2 text-slate-400 hover:text-slate-600">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Connections</h1>
        <p className="text-sm text-on-surface-variant dark:text-slate-400 mt-1">
          Connect JIRA, LLM, Zephyr &amp; GitHub to power your automation.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
        {/* JIRA Connection */}
        <section className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 sm:p-8 shadow-sm flex flex-col gap-6">
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
        <section className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 sm:p-8 shadow-sm flex flex-col gap-6">
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
                  { value: 'gemini', label: 'Google Gemini' },
                  { value: 'openai', label: 'OpenAI' },
                  { value: 'groq', label: 'Groq' },
                  { value: 'grok', label: 'Grok (xAI)' },
                  { value: 'nvidia', label: 'NVIDIA NIM' },
                  { value: 'ollama', label: 'Ollama (Local)' },
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
                  connections.llm.platform === 'gemini'
                    ? [
                        { value: 'gemini-flash-latest', label: 'Gemini Flash (latest, recommended)' },
                        { value: 'gemini-flash-lite-latest', label: 'Gemini Flash Lite (latest, fastest)' },
                        { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (free, fast)' },
                        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (blocked for new users)' },
                        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (best quality)' },
                      ]
                    : connections.llm.platform === 'openai'
                    ? [
                        { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna (fast, cheapest)' },
                        { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra (balanced)' },
                        { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol (flagship)' },
                        { value: 'gpt-4o-mini', label: 'GPT-4o Mini (fast)' },
                        { value: 'gpt-4o', label: 'GPT-4o' },
                        { value: 'o3-mini', label: 'o3 Mini (reasoning)' },
                      ]
                    : connections.llm.platform === 'groq'
                    ? [
                        { value: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (best free)' },
                        { value: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (fastest)' },
                        { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (reliable)' },
                      ]
                    : connections.llm.platform === 'grok'
                    ? [
                        { value: 'grok-2', label: 'Grok 2' },
                        { value: 'grok-beta', label: 'Grok Beta' },
                      ]
                    : connections.llm.platform === 'nvidia'
                    ? [
                        { value: 'qwen/qwen3-coder-480b-a35b-instruct', label: 'Qwen3 Coder 480B (best for code)' },
                        { value: 'qwen/qwen2.5-coder-32b-instruct', label: 'Qwen2.5 Coder 32B (fast coder)' },
                        { value: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B' },
                        { value: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', label: 'Nemotron Super 49B (faster)' },
                        { value: 'nvidia/nvidia-nemotron-nano-9b-v2', label: 'Nemotron Nano 9B (fastest)' },
                      ]
                    : [
                        { value: 'llama3', label: 'Llama 3 (Local)' },
                        { value: 'mistral', label: 'Mistral (Local)' },
                        { value: 'codellama', label: 'Code Llama (Local)' },
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
            <p className={`text-xs ${connections.llm.status === 'error' ? 'text-red-500' : connections.llm.status === 'connected' ? 'text-green-600' : 'text-amber-500'}`}>
              {connections.llm.message}
            </p>
          )}
          <div className="flex items-center gap-3 pt-4">
            <button
              onClick={testing.llm ? cancelLlmTest : testLlm}
              disabled={!testing.llm && !connections.llm.apiKey}
              className={`flex-1 h-12 font-bold text-sm rounded transition-colors ${
                testing.llm
                  ? 'border-2 border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 animate-pulse'
                  : 'border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50'
              }`}
            >
              {testing.llm ? (
                <span className="flex items-center justify-center gap-1.5">
                  <span className="material-symbols-outlined text-base">stop_circle</span>
                  Cancel
                </span>
              ) : 'Test Connection'}
            </button>
            <button onClick={() => saveConnection('llm')} className="flex-[1.5] h-12 bg-app-red text-white font-bold text-sm rounded shadow-lg shadow-app-red/20 active:bg-app-dark-red transition-all">
              Save Connection
            </button>
          </div>
        </section>

        {/* ZEPHYR */}
        <section className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 sm:p-8 shadow-sm flex flex-col gap-6">
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
        <section className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-5 sm:p-8 shadow-sm flex flex-col gap-6">
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
                Required scopes: <span className="font-semibold text-slate-500 dark:text-slate-400">repo</span>, <span className="font-semibold text-slate-500 dark:text-slate-400">workflow</span>, <span className="font-semibold text-slate-500 dark:text-slate-400">read:org</span> (optional for org repos)
              </p>
            </div>
            {/* Show the PR destination only once a repo is actually chosen (avoids noise for new users). */}
            {connections.github?.selectedRepo && (
              <div className="space-y-1 p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded">
                <p className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500">Pull Request target</p>
                <p className="text-sm font-semibold text-on-surface dark:text-white">
                  {connections.github.selectedRepo}{connections.github.selectedBranch ? ` @ ${connections.github.selectedBranch}` : ''}
                </p>
                <p className="text-[0.6rem] text-slate-400 dark:text-slate-600">Your generated tests open as a Pull Request here.</p>
              </div>
            )}
          </div>

          {/* Test Connection Button */}
          {connections.github?.message && (
            <p className={`text-xs ${connections.github.status === 'error' ? 'text-red-500' : 'text-green-600'}`}>
              {connections.github.message}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={testGitHub}
              disabled={testing.github || !connections.github?.token}
              className="flex-1 h-12 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
            <button onClick={() => saveConnection('github')} className="flex-[1.5] h-12 bg-app-red text-white font-bold text-sm rounded shadow-lg shadow-app-red/20 active:bg-app-dark-red transition-all">
              Save Connection
            </button>
          </div>

          {/* Post-Connection: provision a predictable target from the canonical template. */}
          {connections.github?.status === 'connected' && (() => {
            const hasRepo = !!connections.github?.selectedRepo;
            const showCreate = !hasRepo || showCreateForm;
            return (
            <div className="flex flex-col gap-4">
              <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg">
                <div>
                  <p className="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500">Pull Request destination</p>
                  <p className="text-[0.7rem] text-slate-500 dark:text-slate-400 mt-1">Choose where BLAST opens generated-test Pull Requests.</p>
                </div>
                <CustomSelect
                  value={connections.github?.selectedRepo || ''}
                  onChange={selectTargetRepo}
                  disabled={updatingTarget}
                  placeholder="Run Test Connection to load repositories"
                  options={[
                    ...((connections.github?.selectedRepo && !(connections.github?.repos || []).some((repo) => repo.name === connections.github.selectedRepo))
                      ? [{ value: connections.github.selectedRepo, label: connections.github.selectedRepo }]
                      : []),
                    ...(connections.github?.repos || []).map((repo) => ({
                      value: repo.name,
                      label: `${repo.name} (${repo.visibility})`,
                    })),
                  ]}
                />
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Branch</span>
                  <CustomSelect
                    value={connections.github?.selectedBranch || ''}
                    onChange={selectTargetBranch}
                    disabled={updatingTarget || !connections.github?.selectedRepo}
                    size="sm"
                    placeholder="Select a repository first"
                    options={[...(connections.github?.branches || []), ...(connections.github?.selectedBranch && !(connections.github?.branches || []).includes(connections.github.selectedBranch) ? [connections.github.selectedBranch] : [])]}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <span className="material-symbols-outlined text-green-600 text-xl">check_circle</span>
                <div>
                  <p className="text-sm font-bold text-green-700 dark:text-green-400">GitHub Connected Successfully</p>
                  <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">
                    {hasRepo
                      ? 'Your automation repo is ready. Pull Requests open in the target shown above.'
                      : 'Create your automation repository from the BLAST template below.'}
                  </p>
                </div>
              </div>
              {showCreate ? (
                <div className="space-y-2 p-4 bg-app-blue/5 border border-app-blue/20 rounded-lg">
                  <p className="text-[0.625rem] font-bold uppercase tracking-widest text-app-blue">
                    {hasRepo ? 'Create a different automation repo' : 'New here? Create your automation repo'}
                  </p>
                  <p className="text-[0.7rem] text-slate-500 dark:text-slate-400">
                    Spin up your own copy of the BLAST framework (with the required workflows) in one click, then it becomes your target repo.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="my-blast-automation"
                      value={newRepoName}
                      onChange={(e) => setNewRepoName(e.target.value)}
                      className="flex-1 h-11 px-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-app-blue focus:ring-1 focus:ring-app-blue transition-all text-sm text-on-surface dark:text-white"
                    />
                    <button
                      onClick={createRepoFromTemplate}
                      disabled={creatingRepo || !newRepoName.trim()}
                      className="h-11 px-4 bg-app-blue text-white font-bold text-sm rounded shadow-lg shadow-app-blue/20 hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
                    >
                      {creatingRepo ? (
                        <>
                          <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                          Creating…
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-base">add</span>
                          Create Repo
                        </>
                      )}
                    </button>
                  </div>
                  {createRepoMsg.text && (
                    <p className={`text-xs ${createRepoMsg.type === 'error' ? 'text-red-500' : createRepoMsg.type === 'success' ? 'text-green-600' : 'text-slate-500'}`}>
                      {createRepoMsg.text}
                    </p>
                  )}
                  {hasRepo && (
                    <button
                      onClick={() => { setShowCreateForm(false); setNewRepoName(''); setCreateRepoMsg({ type: '', text: '' }); }}
                      className="text-[0.7rem] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="self-start flex items-center gap-1.5 text-xs font-semibold text-app-blue hover:brightness-110"
                >
                  <span className="material-symbols-outlined text-base">add</span>
                  Create a different repo
                </button>
              )}
            </div>
            );
          })()}
        </section>
      </div>

      {/* Compact security note */}
      <div className="mt-8 mb-10 flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
        <span className="material-symbols-outlined text-app-blue text-lg">lock</span>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Connections are validated on <span className="font-semibold text-slate-600 dark:text-slate-300">Test Connection</span>, and all keys are encrypted at rest — never logged in plain text.
        </p>
      </div>
    </div>
  );
}
