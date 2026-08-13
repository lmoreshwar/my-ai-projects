/**
 * StatusChip — the single source of truth for job status styling across BLAST.
 * Backend status values are unchanged; this only maps them to a consistent label,
 * color and icon so every screen (Autopilot, AI Native, CI) reads the same.
 */
const TONE = {
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};

const STATUS = {
  Pending: { tone: 'slate', icon: 'schedule', label: 'Pending' },
  Planning: { tone: 'blue', icon: 'edit_note', label: 'Planning' },
  Exploring: { tone: 'indigo', icon: 'travel_explore', label: 'Exploring', spin: false },
  WaitingForApproval: { tone: 'amber', icon: 'hourglass_top', label: 'Waiting for approval' },
  Generating: { tone: 'indigo', icon: 'progress_activity', label: 'Generating', spin: true },
  Executing: { tone: 'indigo', icon: 'progress_activity', label: 'Executing', spin: true },
  Running: { tone: 'indigo', icon: 'progress_activity', label: 'Running', spin: true },
  HandedToCopilot: { tone: 'indigo', icon: 'smart_toy', label: 'Handed to Copilot' },
  Passed: { tone: 'green', icon: 'check_circle', label: 'Passed' },
  Partial: { tone: 'amber', icon: 'check_circle', label: 'Partial' },
  Failed: { tone: 'red', icon: 'cancel', label: 'Failed' },
  Blocked: { tone: 'amber', icon: 'block', label: 'Blocked' },
  PushedToGate: { tone: 'purple', icon: 'call_merge', label: 'Pull Request raised' },
  Merged: { tone: 'green', icon: 'merge', label: 'Merged to main' },
  Completed: { tone: 'green', icon: 'check_circle', label: 'Completed' },
  Discarded: { tone: 'slate', icon: 'delete', label: 'Discarded' },
};

export default function StatusChip({ status, className = '' }) {
  const s = STATUS[status] || STATUS.Pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${TONE[s.tone]} ${className}`}>
      <span className={`material-symbols-outlined text-[14px] leading-none ${s.spin ? 'animate-spin' : ''}`}>{s.icon}</span>
      {s.label || status || '—'}
    </span>
  );
}
