<!DOCTYPE html>

<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Connection Settings - Hitachi Digital Services</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "hitachi-red": "#E60012",
              "hitachi-dark-red": "#b7000c",
              "hitachi-blue": "#004098",
              "hitachi-dark-blue": "#002d6b",
              "on-secondary": "#ffffff",
              "tertiary-fixed-dim": "#65dca4",
              "on-surface-variant": "#434654",
              "on-tertiary": "#ffffff",
              "surface-container-high": "#f0f2f5",
              "error-container": "#ffdad6",
              "on-error": "#ffffff",
              "background": "#ffffff",
              "on-background": "#1a1c1e",
              "surface-container-low": "#f8f9fa",
              "on-secondary-container": "#1d1b20",
              "surface-variant": "#e1e2ec",
              "surface-container": "#f0f2f5",
              "surface": "#ffffff",
              "on-tertiary-container": "#002114",
              "outline-variant": "#c4c6d0",
              "error": "#ba1a1a",
              "tertiary-fixed": "#9cf6c9",
              "inverse-on-surface": "#f1f0f4",
              "secondary-fixed": "#e8def8",
              "inverse-primary": "#d0bcff",
              "secondary-fixed-dim": "#ccc2dc",
              "on-primary-fixed": "#21005d",
              "primary-container": "#E60012",
              "surface-container-highest": "#e1e2ec",
              "tertiary": "#006d45",
              "primary": "#E60012",
              "inverse-surface": "#2f3033",
              "primary-fixed-dim": "#d0bcff",
              "on-error-container": "#410002",
              "on-surface": "#1a1c1e",
              "outline": "#74777f",
              "surface-bright": "#ffffff",
              "on-primary-fixed-variant": "#4f378b",
              "on-secondary-fixed-variant": "#4a4458",
              "secondary-container": "#e8def8",
              "surface-dim": "#ded8e1",
              "secondary": "#625b71",
              "surface-tint": "#E60012",
              "on-tertiary-fixed": "#002114",
              "on-primary": "#ffffff",
              "on-primary-container": "#ffffff",
              "surface-container-lowest": "#ffffff",
              "on-secondary-fixed": "#1d1b20",
              "tertiary-container": "#bbf2d4",
              "primary-fixed": "#eaddff",
              "on-tertiary-fixed-variant": "#005234"
            },
            fontFamily: {
              "headline": ["Inter"],
              "body": ["Inter"],
              "label": ["Inter"]
            },
            borderRadius: {"DEFAULT": "4px", "lg": "8px", "xl": "12px", "full": "9999px"},
          },
        },
      }
    </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        body {
            font-family: 'Inter', sans-serif;
            background-color: #ffffff;
        }
        @media (max-width: 768px) {
            .drawer-open #navigation-drawer {
                transform: translateX(0);
            }
            .drawer-overlay {
                display: none;
            }
            .drawer-open .drawer-overlay {
                display: block;
            }
        }
    </style>
</head>
<body class="text-on-surface antialiased bg-white dark:bg-slate-950">
<!-- TopAppBar -->
<header class="bg-[#E60012] dark:bg-[#b7000c] fixed top-0 right-0 left-0 md:left-64 z-50 transition-all duration-200">
<div class="flex items-center w-full px-6 h-16">
<button class="p-2 -ml-2 text-white hover:bg-white/10 rounded-full transition-colors md:hidden" onclick="document.body.classList.add('drawer-open')">
<span class="material-symbols-outlined">menu</span>
</button>
<div class="flex items-center gap-3 ml-4 md:ml-0">
<h1 class="text-xl font-bold text-white uppercase tracking-wider">Hitachi Digital Services</h1>
</div>
</div>
</header>
<!-- Persistent Navigation Drawer -->
<div class="drawer-overlay fixed inset-0 bg-black/50 z-[60] backdrop-blur-sm transition-opacity md:hidden" id="drawer-overlay" onclick="document.body.classList.remove('drawer-open')"></div>
<aside class="fixed left-0 top-0 h-full w-64 bg-[#f9f1fd] dark:bg-slate-900 z-[70] shadow-2xl md:shadow-none -translate-x-full md:translate-x-0 transition-transform duration-300 ease-in-out border-r border-slate-200 dark:border-slate-800" id="navigation-drawer">
<div class="flex flex-col h-full p-4 space-y-2">
<div class="px-4 py-6 border-b border-slate-200 dark:border-slate-800 mb-4">
<h2 class="text-lg font-bold text-[#E60012] uppercase tracking-tight">Command Center</h2>
</div>
<nav class="flex-1 space-y-1 overflow-y-auto">
<a class="flex items-center gap-4 px-4 py-3 text-slate-600 dark:text-slate-400 font-medium hover:bg-[#e7e0eb] dark:hover:bg-slate-800 rounded-lg transition-colors group" href="#">
<span class="material-symbols-outlined text-[#b7000c] dark:text-[#E60012] group-hover:scale-110 transition-transform">hub</span>
<span class="font-medium text-sm">Test Connection</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-slate-600 dark:text-slate-400 font-medium hover:bg-[#e7e0eb] dark:hover:bg-slate-800 rounded-lg transition-colors group" href="#">
<span class="material-symbols-outlined text-[#b7000c] dark:text-[#E60012] group-hover:scale-110 transition-transform">assignment</span>
<span class="font-medium text-sm">Create Test Plan</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-slate-600 dark:text-slate-400 font-medium hover:bg-[#e7e0eb] dark:hover:bg-slate-800 rounded-lg transition-colors group" href="#">
<span class="material-symbols-outlined text-[#b7000c] dark:text-[#E60012] group-hover:scale-110 transition-transform">edit_note</span>
<span class="font-medium text-sm">Create Test Cases</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-slate-600 dark:text-slate-400 font-medium hover:bg-[#e7e0eb] dark:hover:bg-slate-800 rounded-lg transition-colors group" href="#">
<span class="material-symbols-outlined text-[#b7000c] dark:text-[#E60012] group-hover:scale-110 transition-transform">schema</span>
<span class="font-medium text-sm">Create Test Scenarios</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-slate-600 dark:text-slate-400 font-medium hover:bg-[#e7e0eb] dark:hover:bg-slate-800 rounded-lg transition-colors group" href="#">
<span class="material-symbols-outlined text-[#b7000c] dark:text-[#E60012] group-hover:scale-110 transition-transform">fact_check</span>
<span class="font-medium text-sm">Review Test Cases</span>
</a>
<div class="mt-8 pt-4 border-t border-slate-200 dark:border-slate-800">
<p class="px-4 text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest mb-2">System Settings</p>
<a class="flex items-center gap-4 px-4 py-3 text-[#b7000c] bg-white dark:bg-slate-800 rounded-lg shadow-sm font-bold transition-all" href="#">
<span class="material-symbols-outlined">settings</span>
<span class="font-medium text-sm">Settings</span>
</a>
<button class="w-full mt-2 flex items-center gap-4 px-4 py-3 text-slate-600 dark:text-slate-400 font-medium hover:bg-[#e7e0eb] dark:hover:bg-slate-800 rounded-lg transition-colors text-left" onclick="document.documentElement.classList.toggle('dark')">
<span class="material-symbols-outlined text-[#b7000c] dark:text-[#E60012]">dark_mode</span>
<span class="font-medium text-sm">Toggle Dark Mode</span>
</button>
</div>
</nav>
</div>
</aside>
<!-- Main Content Wrapper -->
<main class="md:ml-64 pt-16 min-h-screen pb-24 md:pb-12">
<div class="max-w-5xl mx-auto px-6 pt-12">
<!-- Hero Section Header -->
<div class="mb-12 border-l-4 border-hitachi-red pl-6">
<span class="font-label text-[0.6875rem] font-bold uppercase tracking-widest text-hitachi-red mb-2 block">Configuration Hub</span>
<h2 class="text-4xl font-black tracking-tight leading-none text-on-surface mb-4 dark:text-white">Connection Settings</h2>
<p class="text-body-md text-on-surface-variant dark:text-slate-400 max-w-xl">Configure your orchestration engine by connecting Jira issue tracking and your preferred Large Language Model provider.</p>
</div>
<div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
<!-- JIRA SECTION -->
<section class="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-8 shadow-sm flex flex-col gap-6">
<div class="flex items-center justify-between mb-2">
<div class="flex items-center gap-4">
<div class="w-12 h-12 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center border border-slate-100 dark:border-slate-700">
<span class="material-symbols-outlined text-hitachi-red text-3xl">alt_route</span>
</div>
<h3 class="text-xl font-bold tracking-tight text-on-surface dark:text-white">JIRA Integration</h3>
</div>
<div class="flex items-center bg-green-50 dark:bg-green-900/30 px-3 py-1 rounded-full border border-green-100 dark:border-green-800">
<span class="text-[0.625rem] font-bold uppercase tracking-widest text-green-700 dark:text-green-400">Connection Success</span>
</div>
</div>
<div class="flex flex-col gap-5">
<div class="space-y-2">
<label class="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">JIRA INSTANCE URL</label>
<input class="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-hitachi-red focus:ring-1 focus:ring-hitachi-red transition-all text-sm text-on-surface dark:text-white" placeholder="https://your-domain.atlassian.net" type="text"/>
</div>
<div class="space-y-2">
<label class="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">API TOKEN</label>
<input class="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-hitachi-red focus:ring-1 focus:ring-hitachi-red transition-all text-sm text-on-surface dark:text-white" type="password" value="••••••••••••••••"/>
</div>
</div>
<div class="flex items-center gap-3 pt-4">
<button class="flex-1 h-12 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        Test Connection
                    </button>
<button class="flex-[1.5] h-12 bg-hitachi-red text-white font-bold text-sm rounded shadow-lg shadow-hitachi-red/20 active:bg-hitachi-dark-red transition-all">
                        Save Connection
                    </button>
</div>
</section>
<!-- LLM SECTION -->
<section class="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-8 shadow-sm flex flex-col gap-6">
<div class="flex items-center justify-between mb-2">
<div class="flex items-center gap-4">
<div class="w-12 h-12 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center border border-slate-100 dark:border-slate-700">
<span class="material-symbols-outlined text-hitachi-red text-3xl">psychology</span>
</div>
<h3 class="text-xl font-bold tracking-tight text-on-surface dark:text-white">LLM Provider</h3>
</div>
<div class="flex items-center bg-red-50 dark:bg-red-900/30 px-3 py-1 rounded-full border border-red-100 dark:border-red-800">
<span class="text-[0.625rem] font-bold uppercase tracking-widest text-hitachi-red">Config Required</span>
</div>
</div>
<div class="flex flex-col gap-5">
<div class="grid grid-cols-2 gap-4">
<div class="space-y-2">
<label class="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">PROVIDER</label>
<select class="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-hitachi-red focus:ring-1 focus:ring-hitachi-red transition-all text-sm text-on-surface dark:text-white appearance-none">
<option>OpenAI</option>
<option>Anthropic</option>
<option>Grok</option>
<option>Llama</option>
<option>Gemini</option>
</select>
</div>
<div class="space-y-2">
<label class="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">MODEL NAME</label>
<input class="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-hitachi-red focus:ring-1 focus:ring-hitachi-red transition-all text-sm text-on-surface dark:text-white" placeholder="gpt-4-turbo" type="text"/>
</div>
</div>
<div class="space-y-2">
<label class="text-[0.625rem] font-bold uppercase tracking-widest text-on-surface-variant dark:text-slate-500 ml-1">API KEY</label>
<input class="w-full h-12 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded focus:border-hitachi-red focus:ring-1 focus:ring-hitachi-red transition-all text-sm text-on-surface dark:text-white" placeholder="sk-..." type="password"/>
</div>
</div>
<div class="flex items-center gap-3 pt-4">
<button class="flex-1 h-12 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        Test Connection
                    </button>
<button class="flex-[1.5] h-12 bg-hitachi-red text-white font-bold text-sm rounded shadow-lg shadow-hitachi-red/20 active:bg-hitachi-dark-red transition-all">
                        Save Connection
                    </button>
</div>
</section>
</div>
<!-- Details Section with Blue Accents -->
<div class="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
<div class="md:col-span-2 bg-[#f0f4f9] dark:bg-slate-900 rounded-xl p-10 flex flex-col justify-between border-l-8 border-hitachi-blue">
<div>
<h4 class="text-xl font-bold text-on-surface dark:text-white mb-3">Automated Validation Logic</h4>
<p class="text-slate-600 dark:text-slate-400 text-sm mb-8 leading-relaxed max-w-lg">Connections are verified against a 12-point health check including latency, token permission scope, and endpoint availability. The Curator ensures 99.9% uptime for your testing pipelines.</p>
</div>
<div class="flex gap-10">
<div class="flex flex-col">
<span class="text-4xl font-black text-hitachi-blue dark:text-blue-400 leading-none">24ms</span>
<span class="text-[0.6875rem] font-bold uppercase tracking-widest text-slate-500 mt-2">AVG LATENCY</span>
</div>
<div class="flex flex-col">
<span class="text-4xl font-black text-green-600 leading-none">STABLE</span>
<span class="text-[0.6875rem] font-bold uppercase tracking-widest text-slate-500 mt-2">HEALTH STATUS</span>
</div>
</div>
</div>
<div class="bg-hitachi-blue rounded-xl p-8 relative overflow-hidden flex flex-col justify-end text-white">
<div class="absolute top-0 right-0 p-6 opacity-10">
<span class="material-symbols-outlined text-7xl">security</span>
</div>
<h4 class="text-lg font-bold mb-3">Encrypted Storage</h4>
<p class="text-white/80 text-xs leading-relaxed">All API keys are AES-256 encrypted at rest and never logged in plain text.</p>
</div>
</div>
</div>
</main>
<!-- BottomNavBar (Mobile Only) -->
<nav class="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 py-3 bg-[#004098] dark:bg-[#002d6b] z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] md:hidden">
<a class="flex flex-col items-center justify-center text-white/70 hover:text-white transition-all scale-95 active:scale-90" href="#">
<span class="material-symbols-outlined">dashboard</span>
<span class="text-[11px] font-medium tracking-wide mt-1">Dashboard</span>
</a>
<a class="flex flex-col items-center justify-center text-white/70 hover:text-white transition-all scale-95 active:scale-90" href="#">
<span class="material-symbols-outlined">analytics</span>
<span class="text-[11px] font-medium tracking-wide mt-1">Analytics</span>
</a>
<a class="flex flex-col items-center justify-center text-white bg-white/15 rounded-xl px-4 py-1 transition-all scale-95 active:scale-90" href="#">
<span class="material-symbols-outlined">settings</span>
<span class="text-[11px] font-medium tracking-wide mt-1">Settings</span>
</a>
<a class="flex flex-col items-center justify-center text-white/70 hover:text-white transition-all scale-95 active:scale-90" href="#">
<span class="material-symbols-outlined">description</span>
<span class="text-[11px] font-medium tracking-wide mt-1">Reports</span>
</a>
</nav>
</body></html>