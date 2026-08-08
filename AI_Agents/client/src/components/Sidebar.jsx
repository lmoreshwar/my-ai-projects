import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const navItems = [
  { id: 'connections', icon: 'hub', label: 'Test Connection' },
  { id: 'test-plan', icon: 'assignment', label: 'Create Test Plan' },
  { id: 'test-cases', icon: 'edit_note', label: 'Create Test Cases' },
  { id: 'review-cases', icon: 'fact_check', label: 'Review Test Cases' },
];

const bottomItems = [
  { id: 'saved-history', icon: 'inventory_2', label: 'Test Artifacts', filled: true },
  { id: 'zephyr-dashboard', icon: 'dashboard', label: 'Zephyr Dashboard', filled: true },
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
          {!collapsed && (
            <h2 className="text-lg font-bold text-app-red font-headline uppercase tracking-wider whitespace-nowrap overflow-hidden">
              Command Center
            </h2>
          )}
          {/* Desktop collapse toggle */}
          <button
            className="p-1.5 hover:bg-surface-variant dark:hover:bg-slate-800 rounded-full transition-colors hidden lg:flex items-center justify-center"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span className="material-symbols-outlined text-app-red transition-transform duration-300" style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              chevron_left
            </span>
          </button>
          {/* Mobile close */}
          <button
            className="p-2 hover:bg-surface-variant dark:hover:bg-slate-800 rounded-full transition-colors lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Nav items */}
        <div className="flex-grow overflow-y-auto p-4 space-y-2">
          <nav className="flex flex-col space-y-1">
            {navItems.map((item) => (
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

            {/* ── AI Native Playwright ── */}
            <button
              onClick={() => handleNav('ai-native-playwright')}
              title={collapsed ? 'AI Native Playwright' : ''}
              className={`flex items-center ${collapsed ? 'justify-center px-0' : 'gap-4 px-4'} py-3 w-full text-left transition-all rounded-sm ${
                activePage === 'ai-native-playwright'
                  ? 'nav-item-active'
                  : 'text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800'
              }`}
            >
              <span className={`material-symbols-outlined ${activePage === 'ai-native-playwright' ? '' : 'text-app-dark-red dark:text-app-red'}`}>
                smart_toy
              </span>
              {!collapsed && <span className="text-sm">AI Native Playwright</span>}
            </button>

            {/* ── GitHub ── */}
            <button
              onClick={() => handleNav('github')}
              title={collapsed ? 'GitHub' : ''}
              className={`flex items-center ${collapsed ? 'justify-center px-0' : 'gap-4 px-4'} py-3 w-full text-left transition-all rounded-sm ${
                activePage === 'github'
                  ? 'nav-item-active'
                  : 'text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800'
              }`}
            >
              <span className={`material-symbols-outlined ${activePage === 'github' ? '' : 'text-app-dark-red dark:text-app-red'}`}>
                cloud_upload
              </span>
              {!collapsed && <span className="text-sm">GitHub</span>}
            </button>

            {/* ── GitHub CICD ── */}
            <button
              onClick={() => handleNav('github-cicd')}
              title={collapsed ? 'GitHub CICD' : ''}
              className={`flex items-center ${collapsed ? 'justify-center px-0' : 'gap-4 px-4'} py-3 w-full text-left transition-all rounded-sm ${
                activePage === 'github-cicd'
                  ? 'nav-item-active'
                  : 'text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800'
              }`}
            >
              <span className={`material-symbols-outlined ${activePage === 'github-cicd' ? '' : 'text-app-dark-red dark:text-app-red'}`}>
                rocket_launch
              </span>
              {!collapsed && <span className="text-sm">GitHub CICD</span>}
            </button>

            {/* ── Zephyr Dashboard (last item) ── */}
            {bottomItems.map((item) => (
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
