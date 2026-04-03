import { useState } from 'react';

/* ── Mock Data (mirroring screenshot) ── */
const MOCK_RELEASES = [
  { name: 'v2.5.0-beta (Current)', value: 'v2.5.0-beta' },
  { name: 'v2.4.0 (Stable)', value: 'v2.4.0' },
  { name: 'v2.3.1 (Archived)', value: 'v2.3.1' },
];

const MOCK_DATA = {
  'v2.5.0-beta': {
    totalPlanned: 1284,
    totalExecuted: 1042,
    remaining: 242,
    growthPercent: '+12% from last release',
    estimatedCompletion: '3 days',
    breakdown: { pass: 842, fail: 114, blocked: 28, deferred: 58, unexecuted: 242 },
    blockedCases: [
      { id: 'HIT-772', title: 'Authentication handshake timeout on high-latency nodes', jira: 'JIRA-552', priority: 'CRITICAL' },
      { id: 'HIT-884', title: 'Database schema mismatch during migration script execution', jira: 'JIRA-618', priority: 'CRITICAL' },
      { id: 'HIT-821', title: 'Third-party payment gateway integration returning 503', jira: 'JIRA-490', priority: 'HIGH' },
    ],
  },
  'v2.4.0': {
    totalPlanned: 1100,
    totalExecuted: 1100,
    remaining: 0,
    growthPercent: 'Fully executed',
    estimatedCompletion: 'Complete',
    breakdown: { pass: 980, fail: 45, blocked: 10, deferred: 15, unexecuted: 0 },
    blockedCases: [],
  },
  'v2.3.1': {
    totalPlanned: 950,
    totalExecuted: 950,
    remaining: 0,
    growthPercent: 'Archived',
    estimatedCompletion: 'Complete',
    breakdown: { pass: 910, fail: 20, blocked: 5, deferred: 15, unexecuted: 0 },
    blockedCases: [],
  },
};

const priorityColors = {
  CRITICAL: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  HIGH: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  MEDIUM: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  LOW: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

export default function ZephyrDashboard({ connections }) {
  const [selectedRelease, setSelectedRelease] = useState('v2.5.0-beta');
  const data = MOCK_DATA[selectedRelease] || MOCK_DATA['v2.5.0-beta'];
  const bd = data.breakdown;
  const isConnected = connections?.zephyr?.status === 'connected';
  const executionPercent = data.totalPlanned > 0 ? Math.round((data.totalExecuted / data.totalPlanned) * 100) : 0;

  // Bar chart max height
  const maxVal = Math.max(bd.pass, bd.fail, bd.blocked, bd.deferred, bd.unexecuted, 1);
  const barHeight = (val) => Math.max(8, (val / maxVal) * 200);

  return (
    <div className="max-w-6xl mx-auto px-6 pt-12 pb-16">
      {/* Demo Banner */}
      {!isConnected && (
        <div className="mb-6 flex items-center gap-3 px-5 py-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
          <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">info</span>
          <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
            <strong>Demo Mode</strong> — Displaying sample data for preview purposes. Connect to Zephyr Scale in <span className="underline cursor-pointer">Connection Settings</span> to view live metrics.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="mb-12 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Zephyr Quality Analytics
        </h1>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-on-surface-variant dark:text-slate-400 max-w-lg font-medium leading-relaxed">
            Enterprise-grade testing metrics and real-time execution tracking for your test automation ecosystem.
          </p>
          <div className="min-w-[240px]">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-secondary dark:text-slate-500 mb-1">
              Select Release
            </label>
            <select
              className="w-full bg-surface-container-highest dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-on-surface dark:text-white font-semibold py-2 px-3 rounded text-sm focus:ring-1 focus:ring-app-red focus:border-app-red"
              value={selectedRelease}
              onChange={(e) => setSelectedRelease(e.target.value)}
            >
              {MOCK_RELEASES.map((r) => (
                <option key={r.value} value={r.value}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
        {/* Total Planned */}
        <div className="col-span-1 md:col-span-2 bg-surface-container-low dark:bg-slate-900 p-6 rounded-xl flex flex-col justify-between h-48 border border-slate-100 dark:border-slate-800">
          <div>
            <span className="text-secondary dark:text-slate-500 font-bold text-xs uppercase tracking-widest">Total Test Cases Planned</span>
            <div className="text-5xl font-extrabold text-on-surface dark:text-white mt-2">
              {data.totalPlanned.toLocaleString()}
            </div>
          </div>
          <div className="flex items-center gap-2 text-app-red font-bold text-sm">
            <span className="material-symbols-outlined text-sm">trending_up</span>
            <span>{data.growthPercent}</span>
          </div>
        </div>

        {/* Total Executed */}
        <div className="bg-surface-container-highest dark:bg-slate-800 p-6 rounded-xl flex flex-col justify-between h-48 border-b-4 border-app-blue">
          <div>
            <span className="text-secondary dark:text-slate-500 font-bold text-xs uppercase tracking-widest">Total Executed</span>
            <div className="text-4xl font-bold text-on-surface dark:text-white mt-2">
              {data.totalExecuted.toLocaleString()}
            </div>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
            <div className="bg-app-blue h-full rounded-full transition-all duration-500" style={{ width: `${executionPercent}%` }} />
          </div>
        </div>

        {/* Remaining */}
        <div className="bg-surface-container-low dark:bg-slate-900 p-6 rounded-xl flex flex-col justify-between h-48 border border-slate-100 dark:border-slate-800">
          <div>
            <span className="text-secondary dark:text-slate-500 font-bold text-xs uppercase tracking-widest">Remaining</span>
            <div className="text-4xl font-bold text-on-surface dark:text-white mt-2">
              {data.remaining.toLocaleString()}
            </div>
          </div>
          <div className="text-on-surface-variant dark:text-slate-500 text-xs font-medium italic">
            Estimated completion: {data.estimatedCompletion}
          </div>
        </div>
      </div>

      {/* Status Breakdown + Release Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
        {/* Status Breakdown */}
        <div className="lg:col-span-1 bg-white dark:bg-slate-900 p-8 rounded-xl border-l-4 border-app-red shadow-sm">
          <h3 className="text-xl font-bold text-on-surface dark:text-white mb-6">Status Breakdown</h3>
          <div className="space-y-5">
            {[
              { label: 'Pass', color: 'bg-emerald-500', value: bd.pass },
              { label: 'Fail', color: 'bg-red-600', value: bd.fail },
              { label: 'Blocked', color: 'bg-amber-500', value: bd.blocked },
              { label: 'Deferred', color: 'bg-slate-400', value: bd.deferred },
              { label: 'Unexecuted', color: 'bg-slate-200 dark:bg-slate-700', value: bd.unexecuted },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${item.color}`} />
                  <span className="font-semibold text-on-surface dark:text-white text-sm">{item.label}</span>
                </div>
                <span className="font-bold text-on-surface dark:text-white">{item.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Release Health Dynamics — bar chart */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-8 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col">
          <h3 className="text-xl font-bold text-on-surface dark:text-white mb-8">Release Health Dynamics</h3>
          <div className="flex-1 flex items-end justify-between gap-4 pb-4">
            {[
              { label: 'PASS', color: 'bg-emerald-500/80', value: bd.pass },
              { label: 'FAIL', color: 'bg-red-600/80', value: bd.fail },
              { label: 'BLOCK', color: 'bg-amber-500/80', value: bd.blocked },
              { label: 'DEF', color: 'bg-slate-400/80', value: bd.deferred },
              { label: 'UNEX', color: 'bg-slate-200 dark:bg-slate-700', value: bd.unexecuted },
            ].map((bar) => (
              <div key={bar.label} className="flex flex-col items-center flex-1">
                <div
                  className={`w-full ${bar.color} rounded-t-sm transition-all duration-500`}
                  style={{ height: `${barHeight(bar.value)}px` }}
                />
                <span className="text-[10px] font-bold mt-2 uppercase text-secondary dark:text-slate-500">{bar.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Blocked Test Cases Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm overflow-hidden border border-slate-100 dark:border-slate-800">
        <div className="px-8 py-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
          <h3 className="text-xl font-bold text-on-surface dark:text-white">
            Critical Inhibitors: Blocked Test Cases
          </h3>
          {data.blockedCases.length > 0 && (
            <span className="px-3 py-1 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs font-bold rounded-full">
              Action Required
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          {data.blockedCases.length > 0 ? (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface-container-low dark:bg-slate-800 text-secondary dark:text-slate-500 uppercase text-[10px] font-bold tracking-widest">
                  <th className="px-8 py-4">Test ID</th>
                  <th className="px-8 py-4">Title</th>
                  <th className="px-8 py-4">Linked JIRA Defect</th>
                  <th className="px-8 py-4">Priority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.blockedCases.map((tc) => (
                  <tr key={tc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-8 py-4 font-mono text-sm text-app-red">{tc.id}</td>
                    <td className="px-8 py-4 font-medium text-on-surface dark:text-white text-sm">{tc.title}</td>
                    <td className="px-8 py-4">
                      <span className="flex items-center gap-1 text-app-blue font-bold text-sm">
                        <span className="material-symbols-outlined text-sm">link</span>
                        {tc.jira}
                      </span>
                    </td>
                    <td className="px-8 py-4">
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${priorityColors[tc.priority] || priorityColors.MEDIUM}`}>
                        {tc.priority}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-8 py-12 text-center text-secondary dark:text-slate-500">
              <span className="material-symbols-outlined text-4xl mb-2 block">check_circle</span>
              <p className="font-semibold">No blocked test cases for this release.</p>
            </div>
          )}
        </div>
      </div>

      {/* Demo footer note */}
      {!isConnected && (
        <div className="mt-8 text-center">
          <p className="text-[11px] text-secondary dark:text-slate-600 italic">
            Sample data shown for demonstration purposes. Live data will populate once Zephyr Scale is connected.
          </p>
        </div>
      )}
    </div>
  );
}
