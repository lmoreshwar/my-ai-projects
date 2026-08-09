import { useState, useRef, useEffect } from 'react';

/**
 * CustomSelect — A DOM-rendered dropdown that is visible in screen recordings.
 *
 * Native <select> menus are rendered by the OS, so many screen-recording tools
 * (Clipchamp, OBS window-capture, LinkedIn video compression) miss them entirely.
 * This component renders the option list inside the page DOM so it always appears
 * in recordings.
 *
 * Props:
 *   value       – current selected value
 *   onChange     – (value) => void
 *   options      – [{ value, label }]   or   ['string', ...]
 *   placeholder  – text when nothing is selected
 *   disabled     – boolean
 *   className    – additional wrapper classes
 *   size         – 'sm' | 'md' (default 'md')
 */
export default function CustomSelect({
  value,
  onChange,
  options = [],
  placeholder = '— Select —',
  disabled = false,
  className = '',
  size = 'md',
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Normalise options to { value, label }
  const normOpts = options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o,
  );

  // Find current label
  const selected = normOpts.find((o) => String(o.value) === String(value));

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const isSm = size === 'sm';

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setOpen((p) => !p)}
        disabled={disabled}
        className={`
          w-full min-w-0 flex items-center justify-between gap-2 text-left transition-all
          ${isSm
            ? 'px-2 py-1 text-[11px] font-bold rounded border bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-app-red/40'
            : 'px-4 py-3 font-medium rounded-t-md bg-surface-container-highest dark:bg-slate-800 border-b-2 border-app-red text-on-surface dark:text-white'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <span className={`flex-1 min-w-0 truncate ${selected ? 'text-on-surface dark:text-white' : 'text-on-surface-variant dark:text-slate-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className={`material-symbols-outlined shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${isSm ? 'text-[16px]' : 'text-[20px]'} text-on-surface-variant pointer-events-none`}>
          expand_more
        </span>
      </button>

      {/* Dropdown list — rendered in the DOM so screen recorders capture it */}
      {open && (
        <ul
          className={`
            absolute left-0 right-0 mt-0 max-h-60 overflow-y-auto
            bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700
            rounded-b-lg shadow-xl shadow-black/15 dark:shadow-black/40
            z-[100] animate-in fade-in slide-in-from-top-1 duration-150
          `}
          role="listbox"
        >
          {normOpts.map((opt, i) => {
            const isActive = String(opt.value) === String(value);
            return (
              <li
                key={opt.value ?? i}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  // Handle on mousedown (before the document outside-click listener) so the
                  // menu always closes on select, regardless of event timing.
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  onChange(opt.value);
                }}
                className={`
                  px-4 py-2.5 cursor-pointer transition-colors text-sm
                  ${isActive
                    ? 'bg-app-red/10 text-app-red dark:text-red-400 font-semibold'
                    : 'text-on-surface dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700'
                  }
                `}
              >
                {opt.label}
              </li>
            );
          })}
          {normOpts.length === 0 && (
            <li className="px-4 py-3 text-sm text-slate-400 italic">No options available</li>
          )}
        </ul>
      )}
    </div>
  );
}
