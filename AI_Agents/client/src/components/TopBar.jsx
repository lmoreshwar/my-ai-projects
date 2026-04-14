import { useMemo } from 'react';

export default function TopBar({ children, sidebarCollapsed }) {
  // Derive user name and initials from the stored blast_user object
  const { fullName, initials } = useMemo(() => {
    try {
      const raw = localStorage.getItem('blast_user');
      if (raw) {
        const user = JSON.parse(raw);
        const first = (user.firstName || '').trim();
        const last = (user.lastName || '').trim();
        if (first || last) {
          return {
            fullName: `${first} ${last}`.trim(),
            initials: `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
          };
        }
      }
    } catch { /* ignore parse errors */ }
    return { fullName: 'User', initials: 'U' };
  }, []);

  return (
    <header className={`bg-app-red dark:bg-app-dark-red flex items-center justify-between px-3 sm:px-6 h-16 sticky top-0 z-40 transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-80'}`}>
      <div className="flex items-center gap-4">
        {children}
        <div className="flex items-center gap-3">
          <h1 className="text-sm sm:text-lg font-bold text-white uppercase tracking-wider font-headline">
            <span className="hidden sm:inline">B.L.A.S.T AI Test Command Center</span>
            <span className="sm:hidden">B.L.A.S.T</span>
          </h1>
          <span className="hidden lg:inline-block text-[9px] font-bold bg-white/20 text-white/90 px-2 py-0.5 rounded-full uppercase tracking-widest">
            Powered by GenAI
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm ring-2 ring-white/30">
          {initials}
        </div>
        <div className="hidden sm:flex flex-col leading-tight">
          <span className="text-white font-semibold text-sm">{fullName}</span>
          <span className="text-white/80 text-[0.625rem] font-medium uppercase tracking-wider">AI-Driven Test Automation Architect</span>
        </div>
      </div>
    </header>
  );
}
