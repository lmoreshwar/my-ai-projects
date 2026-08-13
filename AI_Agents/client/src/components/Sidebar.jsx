import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Sidebar order = frequency of use + workflow sequence: setup once, work daily, ship daily,
// plan occasionally. Test Plan is a kickoff document, so it sits at the bottom.
const navGroups = [
  {
    title: 'Setup',
    items: [{ id: 'connections', icon: 'hub', label: 'Connections' }],
  },
  {
    title: 'Workflow',
    items: [
      { id: 'test-cases', icon: 'edit_note', label: 'Create Test Cases' },
      { id: 'review-cases', icon: 'fact_check', label: 'Review Test Cases' },
      { id: 'ai-native-playwright', icon: 'smart_toy', label: 'AI Native Playwright' },
      { id: 'autopilot', icon: 'travel_explore', label: 'Autopilot' },
    ],
  },
  {
    title: 'Delivery',
    items: [
      { id: 'github-cicd', icon: 'rocket_launch', label: 'GitHub CI/CD' },
      { id: 'saved-history', icon: 'inventory_2', label: 'Test Artifacts', filled: true },
      { id: 'zephyr-dashboard', icon: 'dashboard', label: 'Zephyr Dashboard', filled: true },
    ],
  },
  {
    title: 'Planning',
    items: [
      { id: 'test-plan', icon: 'assignment', label: 'Create Test Plan' },
      { id: 'test-scenarios', icon: 'schema', label: 'Create Test Scenarios' },
    ],
  },
];

export default function Sidebar({ activePage, onNavigate, onToggleDark, collapsed, onToggleCollapse }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();

  const handleNav = (id) => {
    onNavigate(id);
    setMobileOpen(false);
  };

  const handleLogout = () => {
    // Clear ALL user-specific data from localStorage to prevent data leaking to next user
    localStorage.removeItem('blast_token');
    localStorage.removeItem('blast_user');
    localStorage.removeItem('ai_test_agent_connections');
    localStorage.removeItem('ai_test_agent_testcases');
    localStorage.removeItem('ai_test_agent_lifted_state');
    // Navigate back to the login screen
    navigate('/login');
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile hamburger (rendered inside TopBar externally) */}
      <button
        className="p-2 hover:bg-white/10 rounded-full text-white transition-colors lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
      >
        <span className="material-symbols-outlined">menu</span>
      </button>

      {/* Drawer */}
      <aside
        className={`fixed left-0 top-0 h-full ${collapsed ? 'w-[72px]' : 'w-80'} bg-surface-container-low dark:bg-slate-900 z-[70] border-r border-outline-variant/30 flex flex-col transition-all duration-300 ease-in-out persistent-drawer ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        {/* Brand + Collapse Toggle */}
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-4 h-16 border-b border-outline-variant/30 bg-white dark:bg-slate-900`}>
          {collapsed ? (
            <button onClick={onToggleCollapse} title="Expand sidebar" aria-label="Expand sidebar" className="group">
              <span className="grid place-items-center w-11 h-11 rounded-xl bg-white ring-1 ring-app-red/15 shadow-sm transition-transform group-hover:scale-105">
                <img src="/blast-mark.png?v=2" alt="BLAST AIQA" className="w-10 h-10 object-contain" />
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2.5 overflow-hidden">
              <span className="grid place-items-center w-11 h-11 rounded-xl bg-white ring-1 ring-app-red/15 shadow-sm shrink-0">
                <img src="/blast-mark.png?v=2" alt="BLAST AIQA" className="w-10 h-10 object-contain" />
              </span>
              <div className="leading-none min-w-0">
                <div className="whitespace-nowrap">
                  <span className="font-headline font-black text-lg tracking-tighter bg-gradient-to-r from-app-red to-primary bg-clip-text text-transparent">BLAST</span>
                  <span className="font-headline font-black text-lg tracking-tighter text-on-surface dark:text-white ml-1">AIQA</span>
                </div>
                <span className="block text-[9px] font-bold uppercase tracking-[0.16em] text-on-surface-variant/70 dark:text-slate-500 mt-0.5 whitespace-nowrap">
                  Autonomous QA Platform
                </span>
              </div>
            </div>
          )}
          {/* Desktop collapse toggle */}
          {!collapsed && (
            <button
              className="p-1.5 hover:bg-surface-variant dark:hover:bg-slate-800 rounded-full transition-colors hidden lg:flex items-center justify-center shrink-0"
              onClick={onToggleCollapse}
              title="Collapse sidebar"
            >
              <span className="material-symbols-outlined text-app-red">
                chevron_left
              </span>
            </button>
          )}
          {/* Mobile close */}
          <button
            className="p-2 hover:bg-surface-variant dark:hover:bg-slate-800 rounded-full transition-colors lg:hidden shrink-0"
            onClick={() => setMobileOpen(false)}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Nav items */}
        <div className="flex-grow overflow-y-auto p-4 space-y-4">
          {navGroups.map((group) => (
            <nav key={group.title} className="flex flex-col space-y-1">
              {collapsed ? (
                <div className="h-px bg-outline-variant/30 dark:bg-slate-800 my-1" />
              ) : (
                <span className="px-4 pt-1 pb-1 text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant/60 dark:text-slate-500">
                  {group.title}
                </span>
              )}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleNav(item.id)}
                  title={collapsed ? item.label : ''}
                  className={`flex items-center ${collapsed ? 'justify-center px-0' : 'gap-4 px-4'} py-3 w-full text-left transition-all rounded-sm ${
                    activePage === item.id
                      ? 'nav-item-active'
                      : 'text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800'
                  }`}
                >
                  <span className={`material-symbols-outlined ${activePage === item.id ? '' : 'text-app-dark-red dark:text-app-red'}`} style={item.filled ? { fontVariationSettings: "'FILL' 1" } : {}}>
                    {item.icon}
                  </span>
                  {!collapsed && <span className="text-sm">{item.label}</span>}
                </button>
              ))}
            </nav>
          ))}

        </div>

        {/* Bottom section: Settings + Dark Mode */}
        <div className="mt-auto border-t border-outline-variant/30 dark:border-slate-800 p-4 space-y-1">
          <button
            onClick={() => handleNav('connections')}
            title={collapsed ? 'Settings' : ''}
            className={`flex items-center ${collapsed ? 'justify-center px-0' : 'gap-4 px-4'} py-3 w-full text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800 transition-all rounded-sm text-left`}
          >
            <span className="material-symbols-outlined">settings</span>
            {!collapsed && <span className="text-sm">Settings</span>}
          </button>
          <button
            onClick={onToggleDark}
            title={collapsed ? 'Dark Mode' : ''}
            className={`flex items-center ${collapsed ? 'justify-center px-0' : 'gap-4 px-4'} py-3 w-full text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800 transition-all rounded-sm text-left`}
          >
            <span className="material-symbols-outlined">dark_mode</span>
            {!collapsed && <span className="text-sm">Dark Mode</span>}
          </button>
          
          {/* Logout Button */}
          <button
            onClick={handleLogout}
            title={collapsed ? 'Logout' : ''}
            className={`flex items-center ${collapsed ? 'justify-center px-0' : 'gap-4 px-4'} py-3 w-full text-on-surface-variant dark:text-slate-400 font-medium hover:bg-error/10 hover:text-error transition-all rounded-sm text-left`}
          >
            <span className="material-symbols-outlined text-error">logout</span>
            {!collapsed && <span className="text-sm font-bold text-error">Logout</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
