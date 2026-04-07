import { useMemo } from 'react';
import { DiffEditor } from '@monaco-editor/react';

/* ═══════════════════════════════════════════════════════════════════════
   DIFF VIEWER — Side-by-side file comparison using Monaco Diff Editor
   Props:
     original  : string (remote content)
     modified  : string (local content)
     fileName  : string (used for language detection)
     height    : string (CSS height, default '400px')
     readOnly  : boolean (default true)
     onModifiedChange : (value) => void  (optional, for editable mode)
   ═══════════════════════════════════════════════════════════════════════ */

export default function DiffViewer({ original = '', modified = '', fileName = '', height = '400px', readOnly = true, onModifiedChange }) {
  // Detect language from file extension
  const language = useMemo(() => {
    if (!fileName) return 'typescript';
    const ext = fileName.split('.').pop()?.toLowerCase();
    const map = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml',
      feature: 'plaintext', py: 'python', java: 'java', html: 'html',
      css: 'css', sh: 'shell', bash: 'shell',
    };
    return map[ext] || 'plaintext';
  }, [fileName]);

  const editorOptions = useMemo(() => ({
    readOnly,
    minimap: { enabled: false },
    fontSize: 12,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    renderSideBySide: true,
    wordWrap: 'on',
    automaticLayout: true,
    renderOverviewRuler: false,
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    enableSplitViewResizing: true,
    originalEditable: false,
  }), [readOnly]);

  const handleMount = (editor) => {
    if (onModifiedChange) {
      const modifiedEditor = editor.getModifiedEditor();
      modifiedEditor.onDidChangeModelContent(() => {
        onModifiedChange(modifiedEditor.getValue());
      });
    }
  };

  return (
    <div className="rounded-lg overflow-hidden border border-outline-variant/20 dark:border-slate-700" style={{ height }}>
      <DiffEditor
        height={height}
        language={language}
        original={original}
        modified={modified}
        theme="vs-dark"
        options={editorOptions}
        onMount={handleMount}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   INLINE DIFF — Lightweight text diff for non-Monaco contexts
   Shows added/removed lines with color coding
   ═══════════════════════════════════════════════════════════════════════ */

export function InlineDiff({ original = '', modified = '' }) {
  const diff = useMemo(() => computeLineDiff(original, modified), [original, modified]);

  return (
    <div className="font-mono text-xs bg-slate-950 rounded-lg overflow-auto max-h-[300px] p-3 space-y-0">
      {diff.map((line, i) => (
        <div
          key={i}
          className={`px-2 py-0.5 rounded-sm whitespace-pre-wrap ${
            line.type === 'add' ? 'bg-green-900/40 text-green-300' :
            line.type === 'remove' ? 'bg-red-900/40 text-red-300' :
            'text-slate-400'
          }`}
        >
          <span className="inline-block w-5 text-right mr-3 opacity-40 select-none">
            {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
          </span>
          {line.text}
        </div>
      ))}
    </div>
  );
}

/* ── Simple line-by-line diff algorithm ── */
function computeLineDiff(original, modified) {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const result = [];

  // LCS-based diff
  const m = origLines.length, n = modLines.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = origLines[i - 1] === modLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  let i = m, j = n;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
      ops.push({ type: 'same', text: origLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', text: modLines[j - 1] });
      j--;
    } else {
      ops.push({ type: 'remove', text: origLines[i - 1] });
      i--;
    }
  }
  return ops.reverse();
}
