<!DOCTYPE html>

<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Zephyr Dashboard | Hitachi Digital Architect</title>
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
              "on-secondary-container": "#003581",
              "surface-bright": "#fef7ff",
              "inverse-on-surface": "#f6eefa",
              "tertiary-fixed": "#e3e2e4",
              "on-primary": "#ffffff",
              "on-tertiary-fixed-variant": "#464749",
              "surface-variant": "#e7e0eb",
              "secondary-fixed": "#d9e2ff",
              "outline": "#946e69",
              "on-error-container": "#93000a",
              "on-primary-fixed": "#410001",
              "surface": "#fef7ff",
              "on-tertiary": "#ffffff",
              "on-error": "#ffffff",
              "on-secondary-fixed": "#001945",
              "secondary-container": "#79a1fe",
              "tertiary-container": "#717274",
              "surface-container-high": "#ede6f1",
              "inverse-primary": "#ffb4aa",
              "primary": "#b7000c",
              "tertiary": "#595a5c",
              "on-surface": "#1d1a22",
              "on-tertiary-fixed": "#1a1c1d",
              "surface-container": "#f3ebf7",
              "background": "#fef7ff",
              "primary-fixed": "#ffdad5",
              "primary-container": "#e60012",
              "outline-variant": "#e9bcb6",
              "on-secondary-fixed-variant": "#04429a",
              "surface-container-highest": "#e7e0eb",
              "on-surface-variant": "#5f3f3b",
              "surface-container-low": "#f9f1fd",
              "error-container": "#ffdad6",
              "on-primary-fixed-variant": "#930007",
              "secondary-fixed-dim": "#b0c6ff",
              "surface-container-lowest": "#ffffff",
              "on-secondary": "#ffffff",
              "primary-fixed-dim": "#ffb4aa",
              "on-tertiary-container": "#f9f8fa",
              "inverse-surface": "#322f37",
              "on-primary-container": "#fff7f6",
              "tertiary-fixed-dim": "#c6c6c8",
              "surface-dim": "#dfd7e3",
              "surface-tint": "#c0000d",
              "on-background": "#1d1a22",
              "secondary": "#2d5bb3",
              "error": "#ba1a1a"
            },
            fontFamily: {
              "headline": ["Inter"],
              "body": ["Inter"],
              "label": ["Inter"]
            },
            borderRadius: {"DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem"},
          },
        },
      }
    </script>
<style>
      body { font-family: 'Inter', sans-serif; }
      .material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
      .glass-effect { backdrop-filter: blur(12px); background-color: rgba(254, 247, 255, 0.8); }
      .no-scrollbar::-webkit-scrollbar { display: none; }
    </style>
</head>
<body class="bg-surface text-on-surface min-h-screen flex flex-col">
<!-- TopAppBar -->
<header class="fixed top-0 z-50 bg-primary-container dark:bg-red-900 text-white w-full px-6 py-3 flex justify-between items-center shadow-sm">
<div class="flex items-center gap-4">
<span class="text-xl font-bold tracking-tight Inter">Hitachi Digital Architect</span>
<div class="ml-4 px-3 py-1 bg-white/10 rounded-full flex items-center gap-2 border border-white/20">
<span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">check_circle</span>
<span class="text-xs font-medium uppercase tracking-wider">Connected to Zephyr</span>
</div>
</div>
<div class="flex items-center gap-6">
<div class="hidden md:flex items-center gap-4">
<button class="material-symbols-outlined hover:bg-red-800 p-2 rounded-full transition-colors">notifications</button>
<button class="material-symbols-outlined hover:bg-red-800 p-2 rounded-full transition-colors">help</button>
</div>
<div class="h-8 w-8 rounded-full bg-white/20 overflow-hidden ring-2 ring-white/30">
<img alt="User Profile" class="w-full h-full object-cover" data-alt="Close up portrait of a professional corporate employee with a friendly expression in a clean studio setting" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA4AcP7cip7Vb3uUGsk4uDghBzi76iJZlXuFtcO1zPKbLZogldVUuMTEW-iTbZ1lnzThWHHYySUosoUPsaahPK8W90wUE82zaEEv6QvYn0UlD7MUcQoo9lHU-DtcMSeEdzKyoShGO5-VK90HbT3Tz2g0l6kC_BnI_M20fagei5CVoHrwQdYFOMMh7ey3gAHrmeopPSnWtn6d1ksniOgO2ggvHeKkCPh8qc038hAcDQGzXrRW0N6wIF4yFuQdvvg7Qmv5bd0KaW0Bnuv"/>
</div>
</div>
</header>
<div class="flex flex-1 pt-14">
<!-- SideNavBar -->
<aside class="fixed left-0 h-[calc(100vh-3.5rem)] w-64 bg-slate-50 dark:bg-slate-900 flex flex-col py-4 border-r border-transparent">
<div class="px-6 mb-8">
<h2 class="text-red-700 dark:text-red-500 font-bold text-sm tracking-widest uppercase">Command Center</h2>
<p class="text-slate-500 text-xs">Quality Assurance</p>
</div>
<nav class="flex-1 space-y-1">
<a class="group flex items-center px-6 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-all duration-200 border-l-4 border-transparent" href="#">
<span class="material-symbols-outlined mr-3">lan</span>
<span class="label-md font-medium">Test Connection</span>
</a>
<a class="group flex items-center px-6 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-all duration-200 border-l-4 border-transparent" href="#">
<span class="material-symbols-outlined mr-3">assignment</span>
<span class="label-md font-medium">Create Test Plan</span>
</a>
<a class="group flex items-center px-6 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-all duration-200 border-l-4 border-transparent" href="#">
<span class="material-symbols-outlined mr-3">edit_document</span>
<span class="label-md font-medium">Create Test Cases</span>
</a>
<a class="group flex items-center px-6 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-all duration-200 border-l-4 border-transparent" href="#">
<span class="material-symbols-outlined mr-3">schema</span>
<span class="label-md font-medium">Create Test Scenarios</span>
</a>
<a class="group flex items-center px-6 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-all duration-200 border-l-4 border-transparent" href="#">
<span class="material-symbols-outlined mr-3">fact_check</span>
<span class="label-md font-medium">Review Test Cases</span>
</a>
<!-- Active Item -->
<a class="group flex items-center px-6 py-3 text-red-700 dark:text-red-400 bg-red-50/50 dark:bg-red-900/20 border-l-4 border-red-700 transition-all duration-200" href="#">
<span class="material-symbols-outlined mr-3" style="font-variation-settings: 'FILL' 1;">dashboard</span>
<span class="label-md font-bold">Zephyr Dashboard</span>
</a>
</nav>
<div class="mt-auto pt-4 border-t border-slate-200 dark:border-slate-800 space-y-1">
<a class="flex items-center px-6 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50" href="#">
<span class="material-symbols-outlined mr-3">settings</span>
<span class="text-sm">Settings</span>
</a>
<a class="flex items-center px-6 py-3 text-slate-600 dark:text-slate-400 hover:bg-slate-200/50" href="#">
<span class="material-symbols-outlined mr-3">dark_mode</span>
<span class="text-sm">Dark Mode</span>
</a>
</div>
</aside>
<!-- Main Content Area -->
<main class="flex-1 ml-64 p-8 bg-surface">
<!-- Editorial Header Section -->
<div class="mb-12 max-w-5xl">
<h1 class="text-4xl font-extrabold text-primary-container tracking-tighter mb-4">Zephyr Quality Analytics</h1>
<div class="flex items-center justify-between">
<p class="text-on-surface-variant max-w-lg">Enterprise-grade testing metrics and real-time execution tracking for the Hitachi Digital Architect ecosystem.</p>
<div class="relative min-w-[240px]">
<label class="block text-[10px] font-bold uppercase tracking-widest text-secondary mb-1">Select Release</label>
<select class="w-full bg-surface-container-highest border-none border-b-2 border-primary-container focus:ring-0 text-on-surface font-semibold py-2 px-3 rounded-t-sm">
<option>v2.5.0-beta (Current)</option>
<option>v2.4.0 (Stable)</option>
<option>v2.3.1 (Archived)</option>
</select>
</div>
</div>
</div>
<!-- Bento Grid - Stats Cards -->
<div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
<div class="col-span-1 md:col-span-2 bg-surface-container-low p-6 rounded-xl flex flex-col justify-between h-48">
<div>
<span class="text-secondary font-bold text-xs uppercase tracking-widest">Total Test Cases Planned</span>
<div class="text-5xl font-extrabold text-on-surface mt-2">1,284</div>
</div>
<div class="flex items-center gap-2 text-primary font-bold text-sm">
<span class="material-symbols-outlined text-sm">trending_up</span>
<span>+12% from last release</span>
</div>
</div>
<div class="bg-surface-container-highest p-6 rounded-xl flex flex-col justify-between h-48 border-b-4 border-secondary">
<div>
<span class="text-secondary font-bold text-xs uppercase tracking-widest">Total Executed</span>
<div class="text-4xl font-bold text-on-surface mt-2">1,042</div>
</div>
<div class="w-full bg-white/50 h-2 rounded-full overflow-hidden">
<div class="bg-secondary h-full" style="width: 81%"></div>
</div>
</div>
<div class="bg-surface-container-low p-6 rounded-xl flex flex-col justify-between h-48">
<div>
<span class="text-secondary font-bold text-xs uppercase tracking-widest">Remaining</span>
<div class="text-4xl font-bold text-on-surface mt-2">242</div>
</div>
<div class="text-on-surface-variant text-xs font-medium italic">Estimated completion: 3 days</div>
</div>
</div>
<!-- Detailed Metrics & Charts -->
<div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
<!-- Status Breakdown List -->
<div class="lg:col-span-1 bg-white p-8 rounded-xl border-l-4 border-primary-container shadow-sm">
<h3 class="text-xl font-bold text-on-surface mb-6">Status Breakdown</h3>
<div class="space-y-6">
<div class="flex items-center justify-between">
<div class="flex items-center gap-3">
<div class="w-3 h-3 rounded-full bg-emerald-500"></div>
<span class="font-semibold">Pass</span>
</div>
<span class="font-bold">842</span>
</div>
<div class="flex items-center justify-between">
<div class="flex items-center gap-3">
<div class="w-3 h-3 rounded-full bg-red-600"></div>
<span class="font-semibold">Fail</span>
</div>
<span class="font-bold">114</span>
</div>
<div class="flex items-center justify-between">
<div class="flex items-center gap-3">
<div class="w-3 h-3 rounded-full bg-amber-500"></div>
<span class="font-semibold">Blocked</span>
</div>
<span class="font-bold">28</span>
</div>
<div class="flex items-center justify-between">
<div class="flex items-center gap-3">
<div class="w-3 h-3 rounded-full bg-slate-400"></div>
<span class="font-semibold">Deferred</span>
</div>
<span class="font-bold">58</span>
</div>
<div class="flex items-center justify-between">
<div class="flex items-center gap-3">
<div class="w-3 h-3 rounded-full bg-slate-200"></div>
<span class="font-semibold">Unexecuted</span>
</div>
<span class="font-bold">242</span>
</div>
</div>
</div>
<!-- Visual Charts Placeholder -->
<div class="lg:col-span-2 bg-surface-container-lowest p-8 rounded-xl border border-outline-variant/10 flex flex-col">
<h3 class="text-xl font-bold text-on-surface mb-8">Release Health Dynamics</h3>
<div class="flex-1 flex items-end justify-between gap-4 pb-4">
<!-- Simulated Bar Chart -->
<div class="flex flex-col items-center flex-1">
<div class="w-full bg-emerald-500/80 rounded-t-sm" style="height: 180px"></div>
<span class="text-[10px] font-bold mt-2 uppercase">Pass</span>
</div>
<div class="flex flex-col items-center flex-1">
<div class="w-full bg-red-600/80 rounded-t-sm" style="height: 60px"></div>
<span class="text-[10px] font-bold mt-2 uppercase">Fail</span>
</div>
<div class="flex flex-col items-center flex-1">
<div class="w-full bg-amber-500/80 rounded-t-sm" style="height: 35px"></div>
<span class="text-[10px] font-bold mt-2 uppercase">Block</span>
</div>
<div class="flex flex-col items-center flex-1">
<div class="w-full bg-slate-400/80 rounded-t-sm" style="height: 45px"></div>
<span class="text-[10px] font-bold mt-2 uppercase">Def</span>
</div>
<div class="flex flex-col items-center flex-1">
<div class="w-full bg-slate-200 rounded-t-sm" style="height: 120px"></div>
<span class="text-[10px] font-bold mt-2 uppercase">Unex</span>
</div>
</div>
</div>
</div>
<!-- Blocked Test Cases Table -->
<div class="bg-white rounded-xl shadow-sm overflow-hidden border border-outline-variant/10">
<div class="px-8 py-6 border-b border-surface-container flex justify-between items-center">
<h3 class="text-xl font-bold text-on-surface">Critical Inhibitors: Blocked Test Cases</h3>
<span class="px-3 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-full">Action Required</span>
</div>
<div class="overflow-x-auto">
<table class="w-full text-left">
<thead>
<tr class="bg-surface-container-low text-secondary uppercase text-[10px] font-bold tracking-widest">
<th class="px-8 py-4">Test ID</th>
<th class="px-8 py-4">Title</th>
<th class="px-8 py-4">Linked JIRA Defect</th>
<th class="px-8 py-4">Priority</th>
</tr>
</thead>
<tbody class="divide-y divide-surface-container">
<tr class="hover:bg-slate-50 transition-colors">
<td class="px-8 py-4 font-mono text-sm text-primary">HIT-772</td>
<td class="px-8 py-4 font-medium">Authentication handshake timeout on high-latency nodes</td>
<td class="px-8 py-4">
<span class="flex items-center gap-1 text-secondary font-bold">
<span class="material-symbols-outlined text-sm">link</span>
                                        JIRA-552
                                    </span>
</td>
<td class="px-8 py-4"><span class="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded">CRITICAL</span></td>
</tr>
<tr class="hover:bg-slate-50 transition-colors">
<td class="px-8 py-4 font-mono text-sm text-primary">HIT-804</td>
<td class="px-8 py-4 font-medium">Database schema mismatch during migration script execution</td>
<td class="px-8 py-4">
<span class="flex items-center gap-1 text-secondary font-bold">
<span class="material-symbols-outlined text-sm">link</span>
                                        JIRA-618
                                    </span>
</td>
<td class="px-8 py-4"><span class="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded">CRITICAL</span></td>
</tr>
<tr class="hover:bg-slate-50 transition-colors">
<td class="px-8 py-4 font-mono text-sm text-primary">HIT-821</td>
<td class="px-8 py-4 font-medium">Third-party payment gateway integration returning 503</td>
<td class="px-8 py-4">
<span class="flex items-center gap-1 text-secondary font-bold">
<span class="material-symbols-outlined text-sm">link</span>
                                        JIRA-490
                                    </span>
</td>
<td class="px-8 py-4"><span class="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded">HIGH</span></td>
</tr>
</tbody>
</table>
</div>
</div>
</main>
</div>
<!-- Background Decorative Element (The Architect Texture) -->
<div class="fixed bottom-0 right-0 w-1/3 h-1/2 -z-10 pointer-events-none opacity-[0.03]">
<img alt="Abstract architectural blueprint" class="w-full h-full object-contain object-right-bottom" data-alt="Faded abstract architectural blueprint with precise lines, geometric shapes, and grid patterns on a white background" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCA2pTGWQTUh5zg-l_ja0SEiYDCi-EUnM0j5uUyt2gJTE2gnbE5tvJgdUswDaz_hg2EFkk2vLgqUNdMlCpbnT62iBsvvjgfUrZHpbEfPDl7lIdhtODGnYlUKw2Cr2vu7NQj0Tg-bUcAO5m14tr_1OFTKsH485fYigD07MBWEJdYArOjokREzVNnm56Z3wbD_vAzaY0r9Z-Vxb4iOcz059fNX9rKUlVXjSiVTqD_eJr6SbQiWHvEUmgivuP9zAihSWD3xpNrCF1NYdmu"/>
</div>
</body></html>