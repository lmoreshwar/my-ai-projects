<!DOCTYPE html>

<html lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Hitachi Intelligent Test Agent - GitHub Integration</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "tertiary": "#595a5c",
                        "surface": "#fef7ff",
                        "on-error-container": "#93000a",
                        "on-tertiary-container": "#f9f8fa",
                        "primary-fixed": "#ffdad5",
                        "surface-bright": "#fef7ff",
                        "outline": "#946e69",
                        "on-background": "#1d1a22",
                        "primary": "#b7000c",
                        "outline-variant": "#e9bcb6",
                        "tertiary-container": "#717274",
                        "surface-tint": "#c0000d",
                        "on-secondary-fixed-variant": "#04429a",
                        "on-secondary-container": "#003581",
                        "tertiary-fixed": "#e3e2e4",
                        "secondary-fixed-dim": "#b0c6ff",
                        "primary-fixed-dim": "#ffb4aa",
                        "surface-container-high": "#ede6f1",
                        "on-error": "#ffffff",
                        "on-primary-fixed": "#410001",
                        "on-primary-container": "#fff7f6",
                        "surface-variant": "#e7e0eb",
                        "surface-container-lowest": "#ffffff",
                        "on-surface-variant": "#5f3f3b",
                        "on-primary": "#ffffff",
                        "secondary": "#2d5bb3",
                        "background": "#fef7ff",
                        "surface-container-highest": "#e7e0eb",
                        "on-tertiary-fixed-variant": "#464749",
                        "inverse-surface": "#322f37",
                        "on-tertiary-fixed": "#1a1c1d",
                        "secondary-fixed": "#d9e2ff",
                        "on-tertiary": "#ffffff",
                        "surface-container-low": "#f9f1fd",
                        "on-secondary-fixed": "#001945",
                        "on-primary-fixed-variant": "#930007",
                        "on-surface": "#1d1a22",
                        "surface-container": "#f3ebf7",
                        "inverse-on-surface": "#f6eefa",
                        "tertiary-fixed-dim": "#c6c6c8",
                        "on-secondary": "#ffffff",
                        "error": "#ba1a1a",
                        "primary-container": "#e60012",
                        "secondary-container": "#79a1fe",
                        "surface-dim": "#dfd7e3",
                        "error-container": "#ffdad6",
                        "inverse-primary": "#ffb4aa"
                    },
                    fontFamily: {
                        "headline": ["Inter"],
                        "body": ["Inter"],
                        "label": ["Inter"]
                    },
                    borderRadius: { "DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem" },
                },
            },
        }
    </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        body { font-family: 'Inter', sans-serif; }
    </style>
</head>
<body class="bg-surface text-on-surface">
<!-- TopAppBar -->
<header class="bg-[#b7000c] dark:bg-[#b7000c] docked full-width top-0 z-50 shadow-[0_4px_20px_rgba(183,0,12,0.15)] fixed w-full h-16 flex justify-between items-center px-6">
<div class="flex items-center gap-4">
<span class="text-xl font-black text-white font-['Inter'] tracking-tight">Hitachi Intelligent Test Agent</span>
</div>
<div class="flex items-center gap-6">
<div class="hidden md:flex items-center gap-6">
<button class="text-white/80 hover:bg-white/10 transition-colors px-3 py-1 rounded">Dashboard</button>
<button class="text-white border-b-2 border-white px-3 py-1 font-bold">Integration</button>
<button class="text-white/80 hover:bg-white/10 transition-colors px-3 py-1 rounded">Reports</button>
</div>
<div class="flex items-center gap-2">
<button class="text-white material-symbols-outlined p-2 hover:bg-white/10 transition-colors scale-95 active:scale-90" data-icon="notifications">notifications</button>
<button class="text-white material-symbols-outlined p-2 hover:bg-white/10 transition-colors scale-95 active:scale-90" data-icon="settings">settings</button>
<button class="text-white material-symbols-outlined p-2 hover:bg-white/10 transition-colors scale-95 active:scale-90" data-icon="help">help</button>
<div class="ml-2 w-8 h-8 rounded-full overflow-hidden border border-white/20">
<img alt="User Profile" data-alt="professional portrait of a technology executive in a dark suit with a clean office background and soft natural lighting" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDeEe4c2QOhVchhjSvGjBjo7BDqc7q1zwdPFkHYM3-KM_9A2P2TKb-cK3UD1Lie-OQdXT2AxRdmTDUbU2Ji6_BHbsfVog1KEkVdRrscl6-KzYTab0BJtK7OO9YT6hVoRWEgJgrHcSc_90hwuf2Noei5emkS5oIte6GZpXAC954ShydMS2WlO4ie_6zVI9EBjoL-4OdQOqcaOXlhw5SxVE9fgNhJrQ1roAMwDN-Igs22gz9VUHDKJZyWek4cRuTPRuqpMe21cgvxFGAf"/>
</div>
</div>
</div>
</header>
<div class="flex pt-16">
<!-- SideNavBar -->
<nav class="fixed left-0 top-16 h-[calc(100vh-64px)] w-64 bg-[#f9f1fd] dark:bg-slate-900 flex flex-col py-4 px-3 gap-y-1 no-border bg-gradient-to-r from-[#f9f1fd] to-[#fef7ff] z-40 overflow-y-auto">
<div class="px-3 mb-6">
<p class="text-xs font-bold uppercase tracking-widest text-[#b7000c] opacity-70">Test Management</p>
<p class="text-[10px] text-slate-500">Quality Assurance Suite</p>
</div>
<div class="space-y-1">
<a class="flex items-center gap-3 px-3 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium rounded-lg" href="#">
<span class="material-symbols-outlined" data-icon="lan">lan</span>
<span>Test Connection</span>
</a>
<a class="flex items-center gap-3 px-3 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium rounded-lg" href="#">
<span class="material-symbols-outlined" data-icon="assignment">assignment</span>
<span>Create Test Plan</span>
</a>
<a class="flex items-center gap-3 px-3 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium rounded-lg" href="#">
<span class="material-symbols-outlined" data-icon="edit_note">edit_note</span>
<span>Create Test Cases</span>
</a>
<a class="flex items-center gap-3 px-3 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium rounded-lg" href="#">
<span class="material-symbols-outlined" data-icon="schema">schema</span>
<span>Create Test Scenarios</span>
</a>
<a class="flex items-center gap-3 px-3 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium rounded-lg" href="#">
<span class="material-symbols-outlined" data-icon="fact_check">fact_check</span>
<span>Review Test Cases</span>
</a>
<a class="flex items-center gap-3 px-3 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium rounded-lg" href="#">
<span class="material-symbols-outlined" data-icon="dashboard">dashboard</span>
<span>Zephyr Dashboard</span>
</a>
<a class="flex items-center gap-3 px-3 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium rounded-lg" href="#">
<span class="material-symbols-outlined" data-icon="smart_toy">smart_toy</span>
<span>Automation</span>
</a>
<a class="flex items-center gap-3 px-3 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium rounded-lg" href="#">
<span class="material-symbols-outlined" data-icon="code">code</span>
<span>Selenium BDD</span>
</a>
<a class="flex items-center gap-3 px-3 py-2 text-[#b7000c] bg-[#ffdad5]/50 backdrop-blur-md rounded-lg font-bold transition-all duration-200 ease-in-out font-['Inter'] text-sm" href="#">
<span class="material-symbols-outlined" data-icon="javascript">javascript</span>
<span>GitHub</span>
</a>
</div>
<div class="mt-auto pt-4 border-t border-slate-200/30">
<a class="flex items-center gap-3 px-3 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium rounded-lg" href="#">
<span class="material-symbols-outlined" data-icon="settings">settings</span>
<span>Settings</span>
</a>
<a class="flex items-center gap-3 px-3 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium rounded-lg" href="#">
<span class="material-symbols-outlined" data-icon="logout">logout</span>
<span>Logout</span>
</a>
</div>
</nav>
<!-- Main Content Area -->
<main class="ml-64 flex-1 p-10 max-w-7xl">
<!-- Header Section -->
<div class="flex justify-between items-end mb-12">
<div class="max-w-2xl">
<h1 class="text-4xl font-bold tracking-tight text-primary-container mb-2 font-headline">GitHub Integration</h1>
<p class="text-on-surface-variant body-md max-w-lg">Manage your automated test suites, synchronize Playwright scripts, and monitor BDD repository health from a centralized architect's console.</p>
</div>
<div class="flex gap-4">
<button class="px-6 py-2.5 rounded-lg bg-surface-container-highest text-on-secondary-container font-semibold transition-all hover:bg-surface-container-high">
                        Manage Repos
                    </button>
<button class="px-6 py-2.5 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white font-semibold shadow-lg shadow-primary/20 flex items-center gap-2 transition-transform active:scale-95">
<span class="material-symbols-outlined text-[20px]" data-icon="sync">sync</span>
                        Sync with GitHub
                    </button>
</div>
</div>
<!-- Bento Grid Layout -->
<div class="grid grid-cols-12 gap-6">
<!-- Left: Connected Repositories -->
<div class="col-span-12 lg:col-span-8 space-y-6">
<div class="bg-surface-container-low p-8 rounded-xl relative overflow-hidden group">
<div class="absolute top-0 right-0 p-8 opacity-5">
<span class="material-symbols-outlined text-9xl" data-icon="hub">hub</span>
</div>
<h2 class="text-xl font-bold text-primary mb-6 flex items-center gap-2">
<span class="material-symbols-outlined" data-icon="account_tree">account_tree</span>
                            Connected Repositories
                        </h2>
<div class="space-y-4">
<!-- Repo Item 1 -->
<div class="bg-surface-container-lowest p-5 rounded-lg flex items-center justify-between transition-all hover:bg-white hover:shadow-sm">
<div class="flex items-center gap-4">
<div class="w-10 h-10 rounded bg-secondary-fixed flex items-center justify-center text-secondary">
<span class="material-symbols-outlined" data-icon="terminal">terminal</span>
</div>
<div>
<h3 class="font-bold text-on-surface">hitachi-test-agent-core</h3>
<p class="text-sm text-secondary font-medium flex items-center gap-1">
<span class="material-symbols-outlined text-[14px]" data-icon="call_split">call_split</span>
                                            main branch
                                        </p>
</div>
</div>
<div class="flex items-center gap-12 text-right">
<div>
<p class="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Last Sync</p>
<p class="text-sm font-medium">2 hours ago</p>
</div>
<div>
<p class="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Status</p>
<p class="text-sm font-bold text-emerald-600 flex items-center gap-1">
<span class="material-symbols-outlined text-[14px]" data-icon="check_circle">check_circle</span>
                                            Active
                                        </p>
</div>
<button class="text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined" data-icon="more_vert">more_vert</span>
</button>
</div>
</div>
<!-- Repo Item 2 -->
<div class="bg-surface-container-lowest p-5 rounded-lg flex items-center justify-between transition-all hover:bg-white hover:shadow-sm">
<div class="flex items-center gap-4">
<div class="w-10 h-10 rounded bg-secondary-fixed flex items-center justify-center text-secondary">
<span class="material-symbols-outlined" data-icon="javascript">javascript</span>
</div>
<div>
<h3 class="font-bold text-on-surface">playwright-ui-suite</h3>
<p class="text-sm text-secondary font-medium flex items-center gap-1">
<span class="material-symbols-outlined text-[14px]" data-icon="call_split">call_split</span>
                                            develop branch
                                        </p>
</div>
</div>
<div class="flex items-center gap-12 text-right">
<div>
<p class="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Last Sync</p>
<p class="text-sm font-medium">Oct 24, 2023</p>
</div>
<div>
<p class="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Status</p>
<p class="text-sm font-bold text-emerald-600 flex items-center gap-1">
<span class="material-symbols-outlined text-[14px]" data-icon="check_circle">check_circle</span>
                                            Active
                                        </p>
</div>
<button class="text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined" data-icon="more_vert">more_vert</span>
</button>
</div>
</div>
<!-- Repo Item 3 -->
<div class="bg-surface-container-lowest p-5 rounded-lg flex items-center justify-between transition-all hover:bg-white hover:shadow-sm">
<div class="flex items-center gap-4">
<div class="w-10 h-10 rounded bg-surface-container-highest flex items-center justify-center text-tertiary">
<span class="material-symbols-outlined" data-icon="description">description</span>
</div>
<div>
<h3 class="font-bold text-on-surface">legacy-bdd-features</h3>
<p class="text-sm text-secondary font-medium flex items-center gap-1">
<span class="material-symbols-outlined text-[14px]" data-icon="call_split">call_split</span>
                                            archive/v2
                                        </p>
</div>
</div>
<div class="flex items-center gap-12 text-right">
<div>
<p class="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Last Sync</p>
<p class="text-sm font-medium">Aug 12, 2023</p>
</div>
<div>
<p class="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold">Status</p>
<p class="text-sm font-bold text-on-surface-variant/50 flex items-center gap-1">
<span class="material-symbols-outlined text-[14px]" data-icon="pause_circle">pause_circle</span>
                                            Paused
                                        </p>
</div>
<button class="text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined" data-icon="more_vert">more_vert</span>
</button>
</div>
</div>
</div>
</div>
</div>
<!-- Right: Push History Log -->
<div class="col-span-12 lg:col-span-4">
<div class="bg-white border-b-4 border-primary p-8 rounded-xl h-full flex flex-col shadow-sm">
<div class="flex items-center justify-between mb-8">
<h2 class="text-xl font-bold text-on-surface flex items-center gap-2">
<span class="material-symbols-outlined" data-icon="history">history</span>
                                Push History
                            </h2>
<span class="text-[10px] bg-primary-fixed text-on-primary-fixed px-2 py-0.5 rounded font-black">LIVE</span>
</div>
<div class="space-y-6 flex-1 overflow-y-auto pr-2">
<!-- Log Item 1 -->
<div class="relative pl-6 border-l-2 border-primary-fixed">
<div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-primary ring-4 ring-white"></div>
<p class="text-[10px] font-bold text-secondary uppercase mb-1">Today, 14:22</p>
<p class="text-sm font-bold text-on-surface leading-tight">BDD Feature Pushed</p>
<p class="text-xs text-on-surface-variant mt-1">user-auth-flow.feature → main</p>
<div class="mt-2 text-[10px] inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-high rounded text-on-surface-variant">
<span class="material-symbols-outlined text-[12px]" data-icon="person">person</span> admin_root
                                </div>
</div>
<!-- Log Item 2 -->
<div class="relative pl-6 border-l-2 border-primary-fixed">
<div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-primary-fixed ring-4 ring-white"></div>
<p class="text-[10px] font-bold text-secondary uppercase mb-1">Today, 09:15</p>
<p class="text-sm font-bold text-on-surface leading-tight">Playwright Script Update</p>
<p class="text-xs text-on-surface-variant mt-1">checkout-validation.spec.js</p>
<div class="mt-2 text-[10px] inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-high rounded text-on-surface-variant">
<span class="material-symbols-outlined text-[12px]" data-icon="person">person</span> j_doe_hitachi
                                </div>
</div>
<!-- Log Item 3 -->
<div class="relative pl-6 border-l-2 border-primary-fixed">
<div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-primary-fixed ring-4 ring-white"></div>
<p class="text-[10px] font-bold text-secondary uppercase mb-1">Yesterday, 18:40</p>
<p class="text-sm font-bold text-on-surface leading-tight">System Sync Event</p>
<p class="text-xs text-on-surface-variant mt-1">Automated BDD sync completed</p>
<div class="mt-2 text-[10px] inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-high rounded text-on-surface-variant">
<span class="material-symbols-outlined text-[12px]" data-icon="smart_toy">smart_toy</span> Agent Alpha
                                </div>
</div>
<!-- Log Item 4 -->
<div class="relative pl-6 border-l-2 border-primary-fixed">
<div class="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-primary-fixed ring-4 ring-white opacity-50"></div>
<p class="text-[10px] font-bold text-secondary uppercase mb-1">Yesterday, 11:10</p>
<p class="text-sm font-bold text-on-surface leading-tight">Repo Initialized</p>
<p class="text-xs text-on-surface-variant mt-1">hitachi-test-agent-core</p>
</div>
</div>
<button class="mt-8 w-full py-2 border-t border-dashed border-outline-variant text-secondary text-sm font-bold hover:text-primary transition-colors flex items-center justify-center gap-2">
                            View Full Audit Log
                            <span class="material-symbols-outlined text-sm" data-icon="arrow_forward">arrow_forward</span>
</button>
</div>
</div>
<!-- Footer Stats / Bento Extras -->
<div class="col-span-12 grid grid-cols-1 md:grid-cols-4 gap-6">
<div class="bg-surface-container-low p-6 rounded-xl">
<p class="text-xs font-bold text-secondary uppercase tracking-widest mb-1">Total Pushes</p>
<p class="text-3xl font-black text-on-surface">1,248</p>
<p class="text-[10px] text-emerald-600 font-bold mt-2 flex items-center gap-1">
<span class="material-symbols-outlined text-[12px]" data-icon="trending_up">trending_up</span> +12% from last month
                        </p>
</div>
<div class="bg-surface-container-low p-6 rounded-xl">
<p class="text-xs font-bold text-secondary uppercase tracking-widest mb-1">Active Branches</p>
<p class="text-3xl font-black text-on-surface">24</p>
<p class="text-[10px] text-on-surface-variant font-medium mt-2">Across 6 repositories</p>
</div>
<div class="bg-primary p-6 rounded-xl text-white shadow-xl shadow-primary/10">
<p class="text-xs font-bold uppercase tracking-widest mb-1 opacity-80">Sync Health</p>
<p class="text-3xl font-black">99.8%</p>
<p class="text-[10px] font-bold mt-2 flex items-center gap-1">
<span class="material-symbols-outlined text-[12px]" data-icon="verified">verified</span> Zero conflicts detected
                        </p>
</div>
<div class="bg-surface-container-low p-6 rounded-xl border border-primary/10">
<div class="flex items-center gap-4">
<div class="w-12 h-12 bg-white rounded-lg flex items-center justify-center text-primary">
<span class="material-symbols-outlined text-3xl" data-icon="terminal">terminal</span>
</div>
<div>
<p class="text-xs font-bold text-secondary uppercase tracking-widest">CLI Auth</p>
<p class="text-sm font-bold text-on-surface">HITACHI_TOKEN_01</p>
<p class="text-[10px] text-emerald-600 font-bold">Expires in 14 days</p>
</div>
</div>
</div>
</div>
</div>
</main>
</div>
</body></html>