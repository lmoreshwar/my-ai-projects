<!DOCTYPE html>

<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>HD Services - GitHub CICD Dashboard</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "on-primary-container": "#fff7f6",
                        "on-secondary-fixed": "#001945",
                        "background": "#fef7ff",
                        "on-tertiary-container": "#f9f8fa",
                        "inverse-surface": "#322f37",
                        "on-tertiary": "#ffffff",
                        "on-primary": "#ffffff",
                        "on-secondary-fixed-variant": "#04429a",
                        "on-surface-variant": "#5f3f3b",
                        "on-background": "#1d1a22",
                        "surface-variant": "#e7e0eb",
                        "primary-fixed": "#ffdad5",
                        "secondary-fixed-dim": "#b0c6ff",
                        "primary-fixed-dim": "#ffb4aa",
                        "tertiary": "#595a5c",
                        "on-tertiary-fixed-variant": "#464749",
                        "on-surface": "#1d1a22",
                        "secondary": "#2d5bb3",
                        "tertiary-fixed-dim": "#c6c6c8",
                        "outline": "#946e69",
                        "inverse-primary": "#ffb4aa",
                        "outline-variant": "#e9bcb6",
                        "surface-dim": "#dfd7e3",
                        "secondary-container": "#79a1fe",
                        "on-primary-fixed": "#410001",
                        "error": "#ba1a1a",
                        "surface-container-highest": "#e7e0eb",
                        "surface": "#fef7ff",
                        "on-tertiary-fixed": "#1a1c1d",
                        "on-primary-fixed-variant": "#930007",
                        "secondary-fixed": "#d9e2ff",
                        "primary": "#b7000c",
                        "tertiary-fixed": "#e3e2e4",
                        "on-error": "#ffffff",
                        "error-container": "#ffdad6",
                        "surface-container-high": "#ede6f1",
                        "surface-container-lowest": "#ffffff",
                        "on-secondary-container": "#003581",
                        "on-secondary": "#ffffff",
                        "on-error-container": "#93000a",
                        "surface-tint": "#c0000d",
                        "primary-container": "#e60012",
                        "surface-container-low": "#f9f1fd",
                        "tertiary-container": "#717274",
                        "surface-bright": "#fef7ff",
                        "inverse-on-surface": "#f6eefa",
                        "surface-container": "#f3ebf7"
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
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
  </head>
<body class="bg-background text-on-background min-h-screen">
<!-- TopAppBar -->
<header class="fixed top-0 w-full z-50 flex items-center px-6 h-16 bg-[#fef7ff] dark:bg-slate-950 no-border-tonal-shift">
<div class="flex items-center gap-4">
<img alt="HD Services Logo" class="h-8 w-8 rounded-lg" data-alt="High-resolution corporate logo for HD Services, minimalist design with bold red accents and sharp geometric shapes" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCcb1P2hqg5MGKKjjlPEzUty3OLoG0f22WdoL8RuIYW5Xb9PgUbGQ9uiSEIivWckt8fdWPDx9pCmLidy4Cd3UnfpQ_EJ3VnF_pyxUJNo6Qlmfbpzjsr5cxQ5tNIVvFwmU9iZV2z9xOpMNcA0oP0y4FDLAUSmgKc9G_hOvX3G8KleuQh69adpynLNs49WG2XFU7Eutnp46M39Q8eDXoyCc5srW0oPoDIx6Lf7CmUIJn6q_ohWoZ3ofkVkyp9cra2VTwlw464GPqX3rNV"/>
<h1 class="font-['Inter'] font-bold tracking-tight text-[#e60012] text-lg">HD Services Private Limited</h1>
</div>
<div class="ml-auto flex items-center gap-6">
<div class="hidden md:flex items-center gap-2 px-3 py-1 bg-surface-container-high rounded-full">
<span class="w-2 h-2 rounded-full bg-emerald-500"></span>
<span class="text-xs font-bold text-on-surface-variant uppercase tracking-wider">GitHub Connected</span>
</div>
<span class="material-symbols-outlined text-[#2d5bb3] cursor-pointer hover:bg-[#e7e0eb] p-2 rounded-full transition-colors">account_circle</span>
</div>
</header>
<!-- NavigationDrawer -->
<aside class="fixed left-0 top-16 h-[calc(100vh-64px)] overflow-y-auto bg-[#f9f1fd] dark:bg-slate-900 h-full w-72 border-r-0 hidden md:block">
<div class="p-6">
<h2 class="text-[#b7000c] font-['Inter'] text-sm font-bold uppercase tracking-widest mb-6">Intelligent Test Agent</h2>
<nav class="space-y-1">
<a class="flex items-center gap-4 px-4 py-3 text-slate-700 dark:text-slate-300 font-['Inter'] text-sm font-medium hover:bg-[#e7e0eb] rounded-full transition-colors" href="#">
<span class="material-symbols-outlined" data-icon="api">api</span>
<span>Test Connection</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-slate-700 dark:text-slate-300 font-['Inter'] text-sm font-medium hover:bg-[#e7e0eb] rounded-full transition-colors" href="#">
<span class="material-symbols-outlined" data-icon="assignment">assignment</span>
<span>Create Test Plan</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-slate-700 dark:text-slate-300 font-['Inter'] text-sm font-medium hover:bg-[#e7e0eb] rounded-full transition-colors" href="#">
<span class="material-symbols-outlined" data-icon="edit_note">edit_note</span>
<span>Create Test Cases</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-slate-700 dark:text-slate-300 font-['Inter'] text-sm font-medium hover:bg-[#e7e0eb] rounded-full transition-colors" href="#">
<span class="material-symbols-outlined" data-icon="schema">schema</span>
<span>Create Test Scenarios</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-slate-700 dark:text-slate-300 font-['Inter'] text-sm font-medium hover:bg-[#e7e0eb] rounded-full transition-colors" href="#">
<span class="material-symbols-outlined" data-icon="fact_check">fact_check</span>
<span>Review Test Cases</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-slate-700 dark:text-slate-300 font-['Inter'] text-sm font-medium hover:bg-[#e7e0eb] rounded-full transition-colors" href="#">
<span class="material-symbols-outlined" data-icon="dashboard">dashboard</span>
<span>Zephyr Dashboard</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-slate-700 dark:text-slate-300 font-['Inter'] text-sm font-medium hover:bg-[#e7e0eb] rounded-full transition-colors" href="#">
<span class="material-symbols-outlined" data-icon="precision_manufacturing">precision_manufacturing</span>
<span>Automation (Selenium BDD)</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-slate-700 dark:text-slate-300 font-['Inter'] text-sm font-medium hover:bg-[#e7e0eb] rounded-full transition-colors" href="#">
<span class="material-symbols-outlined" data-icon="javascript">javascript</span>
<span>Playwright JS</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-[#b7000c] bg-[#ffdad5]/80 backdrop-blur-md rounded-full font-bold" href="#">
<span class="material-symbols-outlined" data-icon="rocket_launch">rocket_launch</span>
<span>GitHub CICD</span>
</a>
</nav>
</div>
</aside>
<!-- Main Content -->
<main class="md:ml-72 pt-24 pb-24 px-6 md:px-12">
<div class="max-w-6xl mx-auto">
<!-- Header Section -->
<div class="mb-12">
<h2 class="text-4xl font-extrabold text-primary-container tracking-tighter mb-2">GitHub CICD Dashboard</h2>
<p class="text-secondary font-medium italic opacity-80">Orchestrate enterprise-grade automation pipelines with precision.</p>
</div>
<!-- Bento Grid Layout -->
<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
<!-- Configuration Card -->
<div class="lg:col-span-4 space-y-6">
<div class="bg-surface-container-low p-8 rounded-xl space-y-8">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-primary" data-icon="settings">settings</span>
<h3 class="font-bold text-on-surface uppercase tracking-widest text-xs">Pipeline Configuration</h3>
</div>
<div class="space-y-6">
<div>
<label class="block text-xs font-bold text-secondary mb-2 uppercase tracking-wide">Select Repository</label>
<div class="relative group">
<select class="w-full appearance-none bg-surface-container-highest border-b-2 border-primary border-t-0 border-x-0 rounded-none px-4 py-3 focus:ring-0 focus:border-primary-container font-medium text-on-surface transition-all">
<option>hd-services-qa-automation</option>
<option>core-api-testing-suite</option>
<option>frontend-playwright-tests</option>
</select>
<span class="material-symbols-outlined absolute right-3 top-3 pointer-events-none text-outline">expand_more</span>
</div>
</div>
<div>
<label class="block text-xs font-bold text-secondary mb-2 uppercase tracking-wide">Select Branch</label>
<div class="relative">
<select class="w-full appearance-none bg-surface-container-highest border-b-2 border-primary border-t-0 border-x-0 rounded-none px-4 py-3 focus:ring-0 focus:border-primary-container font-medium text-on-surface transition-all">
<option>main</option>
<option>develop</option>
<option>feature/agent-integration</option>
<option>release/v2.4.0</option>
</select>
<span class="material-symbols-outlined absolute right-3 top-3 pointer-events-none text-outline">expand_more</span>
</div>
</div>
</div>
<button class="w-full py-4 bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold rounded-md flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-all shadow-md">
<span class="material-symbols-outlined" data-icon="play_arrow">play_arrow</span>
                            Trigger Automation Suite
                        </button>
</div>
<!-- Connection Stats -->
<div class="bg-surface-container-highest p-6 rounded-xl">
<div class="flex items-center justify-between mb-4">
<span class="text-xs font-bold text-secondary uppercase tracking-widest">Environment</span>
<span class="text-xs font-medium text-on-surface-variant">Staging-Cluster-04</span>
</div>
<div class="flex items-center gap-2">
<div class="flex -space-x-2">
<div class="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[10px] text-white font-bold">HD</div>
<div class="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-[10px] text-white font-bold">GH</div>
</div>
<div class="h-[1px] flex-grow bg-outline-variant opacity-30"></div>
<span class="text-[10px] font-bold text-primary italic">Sync Active</span>
</div>
</div>
</div>
<!-- Execution Progress & Logs -->
<div class="lg:col-span-8 bg-surface-container-lowest p-8 rounded-xl shadow-sm border-l-4 border-primary">
<div class="flex items-center justify-between mb-8">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-primary" data-icon="pending">pending</span>
<h3 class="font-bold text-on-surface uppercase tracking-widest text-xs">Real-Time Execution</h3>
</div>
<span class="px-3 py-1 bg-primary-fixed text-on-primary-fixed-variant text-[10px] font-black rounded-full uppercase tracking-tighter">Build #8429</span>
</div>
<div class="space-y-0">
<!-- Step 1 -->
<div class="relative pl-8 pb-8">
<div class="absolute left-0 top-0 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
<span class="material-symbols-outlined text-white text-sm" style="font-variation-settings: 'FILL' 1;">check</span>
</div>
<div class="absolute left-3 top-6 w-[1px] h-full bg-emerald-500"></div>
<div>
<h4 class="text-sm font-bold text-on-surface">Setting up job</h4>
<p class="text-xs text-on-surface-variant mt-1">Runner: ubuntu-latest | OS: Linux 6.2.0</p>
<span class="text-[10px] font-mono text-secondary mt-2 block">Duration: 1.2s</span>
</div>
</div>
<!-- Step 2 -->
<div class="relative pl-8 pb-8">
<div class="absolute left-0 top-0 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
<span class="material-symbols-outlined text-white text-sm" style="font-variation-settings: 'FILL' 1;">check</span>
</div>
<div class="absolute left-3 top-6 w-[1px] h-full bg-emerald-500"></div>
<div>
<h4 class="text-sm font-bold text-on-surface">Installing dependencies</h4>
<p class="text-xs text-on-surface-variant mt-1">npm ci --prefer-offline</p>
<span class="text-[10px] font-mono text-secondary mt-2 block">Duration: 45.8s</span>
</div>
</div>
<!-- Step 3 (Active) -->
<div class="relative pl-8 pb-8">
<div class="absolute left-0 top-0 w-6 h-6 bg-primary-fixed-dim rounded-full flex items-center justify-center animate-pulse">
<span class="material-symbols-outlined text-primary text-sm">sync</span>
</div>
<div class="absolute left-3 top-6 w-[1px] h-full bg-outline-variant border-dashed border-l"></div>
<div>
<h4 class="text-sm font-bold text-on-surface">Executing Playwright scripts</h4>
<p class="text-xs text-on-surface-variant mt-1 italic">npx playwright test --project=chromium</p>
<div class="mt-4 bg-on-background rounded-lg p-4 font-mono text-xs text-emerald-400 overflow-x-auto">
<p class="opacity-50">Running 124 tests using 4 workers</p>
<p>[1/124] Login Service - Valid Credentials ... <span class="text-emerald-500 font-bold">PASSED</span></p>
<p>[2/124] Dashboard - API Hydration Check ... <span class="text-emerald-500 font-bold">PASSED</span></p>
<p class="animate-pulse">_</p>
</div>
</div>
</div>
<!-- Step 4 (Pending) -->
<div class="relative pl-8">
<div class="absolute left-0 top-0 w-6 h-6 bg-surface-container-highest rounded-full flex items-center justify-center border border-outline-variant">
<span class="material-symbols-outlined text-outline text-sm">hourglass_empty</span>
</div>
<div>
<h4 class="text-sm font-bold text-outline">Upload Test Artifacts</h4>
<p class="text-xs text-on-surface-variant opacity-40 mt-1">Awaiting previous steps...</p>
</div>
</div>
</div>
</div>
<!-- Execution Report Preview (Full Width Bottom) -->
<div class="lg:col-span-12 mt-4">
<div class="bg-surface-container-low rounded-2xl overflow-hidden shadow-sm">
<div class="p-8 border-b border-outline-variant border-opacity-10 bg-white/50 backdrop-blur-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
<div>
<h3 class="text-2xl font-black text-on-surface tracking-tighter">Execution Analytics</h3>
<p class="text-sm text-secondary font-medium">Build status: <span class="text-primary font-bold">In Progress (82% Complete)</span></p>
</div>
<div class="flex gap-4">
<div class="text-center px-6 py-2 bg-white rounded-xl shadow-sm">
<p class="text-[10px] font-bold text-secondary uppercase">Passed</p>
<p class="text-xl font-black text-emerald-600">102</p>
</div>
<div class="text-center px-6 py-2 bg-white rounded-xl shadow-sm">
<p class="text-[10px] font-bold text-secondary uppercase">Failed</p>
<p class="text-xl font-black text-error">0</p>
</div>
<div class="text-center px-6 py-2 bg-white rounded-xl shadow-sm">
<p class="text-[10px] font-bold text-secondary uppercase">Skipped</p>
<p class="text-xl font-black text-outline">22</p>
</div>
</div>
</div>
<div class="p-8 relative">
<!-- Visual Placeholder for Report Chart -->
<div class="w-full h-48 bg-gradient-to-r from-surface-container-highest to-surface-container-high rounded-xl flex items-center justify-center relative overflow-hidden">
<div class="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-from)_0%,_transparent_70%)] from-primary"></div>
<div class="flex flex-col items-center gap-4 z-10">
<span class="material-symbols-outlined text-4xl text-primary opacity-20" data-icon="insert_chart">insert_chart</span>
<button class="px-8 py-3 bg-secondary text-white font-bold rounded-full hover:bg-on-secondary-fixed-variant transition-colors flex items-center gap-2">
<span class="material-symbols-outlined text-sm">visibility</span>
                                        View Full HTML Report
                                    </button>
</div>
<!-- Decorative Graph Elements -->
<div class="absolute bottom-0 left-0 w-full flex items-end px-4 gap-1 opacity-20">
<div class="w-full bg-primary h-12"></div>
<div class="w-full bg-primary h-24"></div>
<div class="w-full bg-primary h-16"></div>
<div class="w-full bg-primary h-32"></div>
<div class="w-full bg-primary h-20"></div>
<div class="w-full bg-primary h-28"></div>
<div class="w-full bg-primary h-14"></div>
</div>
</div>
</div>
</div>
</div>
</div>
</div>
</main>
<!-- BottomNavBar (Mobile Only) -->
<footer class="fixed bottom-0 w-full z-50 flex justify-around items-center px-4 py-3 md:hidden bg-[#fef7ff]/80 dark:bg-slate-950/80 backdrop-blur-xl shadow-[0_-4px_20px_rgba(29,26,34,0.04)] rounded-t-xl">
<div class="flex flex-col items-center justify-center text-[#2d5bb3]">
<span class="material-symbols-outlined" data-icon="home">home</span>
<span class="font-['Inter'] text-[10px] font-bold uppercase tracking-widest mt-1">Home</span>
</div>
<div class="flex flex-col items-center justify-center text-[#2d5bb3]">
<span class="material-symbols-outlined" data-icon="checklist">checklist</span>
<span class="font-['Inter'] text-[10px] font-bold uppercase tracking-widest mt-1">Tests</span>
</div>
<div class="flex flex-col items-center justify-center bg-[#ffdad5] text-[#b7000c] rounded-2xl px-4 py-1">
<span class="material-symbols-outlined" data-icon="rocket_launch" style="font-variation-settings: 'FILL' 1;">rocket_launch</span>
<span class="font-['Inter'] text-[10px] font-bold uppercase tracking-widest mt-1">GitHub</span>
</div>
<div class="flex flex-col items-center justify-center text-[#2d5bb3]">
<span class="material-symbols-outlined" data-icon="analytics">analytics</span>
<span class="font-['Inter'] text-[10px] font-bold uppercase tracking-widest mt-1">Reports</span>
</div>
<div class="flex flex-col items-center justify-center text-[#2d5bb3]">
<span class="material-symbols-outlined" data-icon="person">person</span>
<span class="font-['Inter'] text-[10px] font-bold uppercase tracking-widest mt-1">Profile</span>
</div>
</footer>
</body></html>