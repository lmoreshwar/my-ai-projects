export default function TopBar({ children, sidebarCollapsed }) {
  return (
    <header className={`bg-app-red dark:bg-app-dark-red flex items-center justify-between px-6 h-16 sticky top-0 z-40 transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-80'}`}>
      <div className="flex items-center gap-4">
        {children}
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-white uppercase tracking-wider font-headline">
            AI Test Command Center
          </h1>
          <span className="hidden lg:inline-block text-[9px] font-bold bg-white/20 text-white/90 px-2 py-0.5 rounded-full uppercase tracking-widest">
            Powered by GenAI
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-sm ring-2 ring-white/30">
          ML
        </div>
        <div className="hidden sm:flex flex-col leading-tight">
          <span className="text-white font-semibold text-sm">Moreshwar Landge</span>
          <span className="text-white/80 text-[0.625rem] font-medium uppercase tracking-wider">AI-Driven Test Automation Architect</span>
        </div>
      </div>
    </header>
  );
}
