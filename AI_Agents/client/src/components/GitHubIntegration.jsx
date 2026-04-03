import { useState } from 'react';

/* ── Mock data for connected repositories ── */
const MOCK_REPOS = [
  { name: 'ht-test-agent-core', branch: 'main branch', icon: 'terminal', lastSync: '2 hours ago', status: 'Active' },
  { name: 'playwright-ui-suite', branch: 'develop branch', icon: 'javascript', lastSync: 'Oct 24, 2023', status: 'Active' },
  { name: 'legacy-bdd-features', branch: 'archive/v2', icon: 'description', lastSync: 'Aug 12, 2023', status: 'Paused' },
];

const MOCK_PUSH_HISTORY = [
  { time: 'Today, 14:22', title: 'BDD Feature Pushed', detail: 'user-auth-flow.feature → main', user: 'admin_root', userIcon: 'person', active: true },
  { time: 'Today, 09:15', title: 'Playwright Script Update', detail: 'checkout-validation.spec.js', user: 'moreshwar_qa', userIcon: 'person', active: false },
  { time: 'Yesterday, 18:40', title: 'System Sync Event', detail: 'Automated BDD sync completed', user: 'Agent Alpha', userIcon: 'smart_toy', active: false },
  { time: 'Yesterday, 11:10', title: 'Repo Initialized', detail: 'ht-test-agent-core', user: null, active: false },
];

export default function GitHubIntegration({ connections, onNavigate }) {
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(null);

  const handleSync = () => {
    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      setLastSyncTime(new Date().toLocaleTimeString());
    }, 2000);
  };

  const handleManageRepos = () => {
    if (onNavigate) onNavigate('connections');
  };

  return (
    <div className="max-w-7xl mx-auto px-6 pt-8 pb-16">
      {/* ── Header Section ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-black tracking-tight text-app-red mb-3">GitHub Integration</h1>
          <p className="text-on-surface-variant dark:text-slate-400 max-w-lg font-medium leading-relaxed">
            Manage your automated test suites, synchronize Playwright scripts, and monitor BDD repository health from a centralized architect's console.
          </p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={handleManageRepos}
            className="px-6 py-2.5 rounded-lg bg-surface-container-highest dark:bg-slate-800 text-on-surface dark:text-white font-semibold transition-all hover:bg-surface-container-high dark:hover:bg-slate-700"
          >
            Manage Repos
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-6 py-2.5 rounded-lg bg-gradient-to-br from-app-red to-app-dark-red text-white font-semibold shadow-lg shadow-app-red/20 flex items-center gap-2 transition-transform active:scale-95 disabled:opacity-60"
          >
            <span className={`material-symbols-outlined text-[20px] ${syncing ? 'animate-spin' : ''}`}>sync</span>
            {syncing ? 'Syncing...' : 'Sync with GitHub'}
          </button>
        </div>
      </div>

      {lastSyncTime && (
        <div className="mb-6 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 inline-flex items-center gap-2">
          <span className="material-symbols-outlined text-green-600 text-sm">check_circle</span>
          <span className="text-xs text-green-700 dark:text-green-400 font-semibold">Last synced at {lastSyncTime}</span>
        </div>
      )}

      {/* ── Bento Grid Layout ── */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: Connected Repositories */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          <div className="bg-surface-container-low dark:bg-slate-900 p-8 rounded-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <span className="material-symbols-outlined text-[120px]">hub</span>
            </div>
            <h2 className="text-xl font-bold text-app-red dark:text-app-red mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined">account_tree</span>
              Connected Repositories
            </h2>
            <div className="space-y-4">
              {MOCK_REPOS.map((repo, i) => (
                <div key={i} className="bg-surface-container-lowest dark:bg-slate-800 p-5 rounded-lg flex items-center justify-between transition-all hover:bg-white dark:hover:bg-slate-700 hover:shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded flex items-center justify-center ${repo.status === 'Paused' ? 'bg-surface-container-highest dark:bg-slate-700 text-tertiary' : 'bg-secondary/10 text-secondary'}`}>
                      <span className="material-symbols-outlined">{repo.icon}</span>
                    </div>
                    <div>
                      <h3 className="font-bold text-on-surface dark:text-white">{repo.name}</h3>
                      <p className="text-sm text-secondary font-medium flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">call_split</span>
                        {repo.branch}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-8 md:gap-12 text-right">
                    <div className="hidden sm:block">
                      <p className="text-[10px] uppercase tracking-wider text-on-surface-variant dark:text-slate-500 font-bold">Last Sync</p>
                      <p className="text-sm font-medium text-on-surface dark:text-white">{repo.lastSync}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-on-surface-variant dark:text-slate-500 font-bold">Status</p>
                      {repo.status === 'Active' ? (
                        <p className="text-sm font-bold text-emerald-600 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">check_circle</span>
                          Active
                        </p>
                      ) : (
                        <p className="text-sm font-bold text-on-surface-variant/50 dark:text-slate-500 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">pause_circle</span>
                          Paused
                        </p>
                      )}
                    </div>
                    <button className="text-on-surface-variant dark:text-slate-400 hover:text-app-red transition-colors">
                      <span className="material-symbols-outlined">more_vert</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Push History Log */}
        <div className="col-span-12 lg:col-span-4">
          <div className="bg-white dark:bg-slate-900 border-b-4 border-app-red p-8 rounded-xl h-full flex flex-col shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold text-on-surface dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined">history</span>
                Push History
              </h2>
              <span className="text-[10px] bg-app-red/10 text-app-red px-2 py-0.5 rounded font-black">LIVE</span>
            </div>
            <div className="space-y-6 flex-1 overflow-y-auto pr-2">
              {MOCK_PUSH_HISTORY.map((item, i) => (
                <div key={i} className="relative pl-6 border-l-2 border-app-red/20">
                  <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full ring-4 ring-white dark:ring-slate-900 ${item.active ? 'bg-app-red' : 'bg-app-red/30'}`} />
                  <p className="text-[10px] font-bold text-secondary uppercase mb-1">{item.time}</p>
                  <p className="text-sm font-bold text-on-surface dark:text-white leading-tight">{item.title}</p>
                  <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-1">{item.detail}</p>
                  {item.user && (
                    <div className="mt-2 text-[10px] inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-high dark:bg-slate-800 rounded text-on-surface-variant dark:text-slate-400">
                      <span className="material-symbols-outlined text-[12px]">{item.userIcon}</span> {item.user}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button className="mt-8 w-full py-2 border-t border-dashed border-outline-variant dark:border-slate-700 text-secondary text-sm font-bold hover:text-app-red transition-colors flex items-center justify-center gap-2">
              View Full Audit Log
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* Footer Stats */}
        <div className="col-span-12 grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-surface-container-low dark:bg-slate-900 p-6 rounded-xl">
            <p className="text-xs font-bold text-secondary uppercase tracking-widest mb-1">Total Pushes</p>
            <p className="text-3xl font-black text-on-surface dark:text-white">1,248</p>
            <p className="text-[10px] text-emerald-600 font-bold mt-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">trending_up</span> +12% from last month
            </p>
          </div>
          <div className="bg-surface-container-low dark:bg-slate-900 p-6 rounded-xl">
            <p className="text-xs font-bold text-secondary uppercase tracking-widest mb-1">Active Branches</p>
            <p className="text-3xl font-black text-on-surface dark:text-white">24</p>
            <p className="text-[10px] text-on-surface-variant dark:text-slate-500 font-medium mt-2">Across 6 repositories</p>
          </div>
          <div className="bg-app-red p-6 rounded-xl text-white shadow-xl shadow-app-red/10">
            <p className="text-xs font-bold uppercase tracking-widest mb-1 opacity-80">Sync Health</p>
            <p className="text-3xl font-black">99.8%</p>
            <p className="text-[10px] font-bold mt-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">verified</span> Zero conflicts detected
            </p>
          </div>
          <div className="bg-surface-container-low dark:bg-slate-900 p-6 rounded-xl border border-app-red/10 dark:border-slate-800">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-lg flex items-center justify-center text-app-red">
                <span className="material-symbols-outlined text-3xl">terminal</span>
              </div>
              <div>
                <p className="text-xs font-bold text-secondary uppercase tracking-widest">CLI Auth</p>
                <p className="text-sm font-bold text-on-surface dark:text-white">HT_TOKEN_01</p>
                <p className="text-[10px] text-emerald-600 font-bold">Expires in 14 days</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Demo Banner */}
      <div className="mt-8 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-center gap-3">
        <span className="material-symbols-outlined text-amber-600">info</span>
        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
          <strong>Demo Mode:</strong> Repository data shown is mock data for demonstration purposes. Configure your GitHub Personal Access Token in Connection Settings to enable live integration.
        </p>
      </div>
    </div>
  );
}
