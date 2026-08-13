/**
 * PrTargetBadge — shows where BLAST will open the Pull Request, using the saved GitHub
 * connection (selectedRepo / selectedBranch). Falls back to a hint when none is chosen.
 */
export default function PrTargetBadge({ connections, className = '' }) {
  const gh = connections?.github || {};
  const repo = gh.selectedRepo || '';
  const branch = gh.selectedBranch || 'main';

  return (
    <div
      title={repo ? `Pull Request will open in ${repo} @ ${branch}` : 'No target repo selected — set it in Connections → GitHub'}
      className={`flex items-center gap-2 min-w-0 max-w-full px-3 py-1.5 rounded-lg border text-xs ${
        repo
          ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300'
          : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
      } ${className}`}
    >
      <span className="material-symbols-outlined text-[16px] shrink-0">{repo ? 'call_merge' : 'warning'}</span>
      {repo ? (
        <span className="truncate">
          PR → <span className="font-semibold">{repo}</span> @ <span className="font-semibold">{branch}</span>
        </span>
      ) : (
        <span className="truncate">
          No target repo — set it in <span className="font-semibold">Connections → GitHub</span>
        </span>
      )}
    </div>
  );
}
