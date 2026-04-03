<!DOCTYPE html>

<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>HD Services - Test Case Generator</title>
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
              "on-tertiary": "#ffffff",
              "inverse-surface": "#322f37",
              "surface-container-low": "#f9f1fd",
              "on-primary-fixed": "#410001",
              "on-surface-variant": "#5f3f3b",
              "on-error-container": "#93000a",
              "outline-variant": "#e9bcb6",
              "primary": "#b7000c",
              "on-error": "#ffffff",
              "surface": "#fef7ff",
              "tertiary-fixed-dim": "#c6c6c8",
              "surface-variant": "#e7e0eb",
              "surface-bright": "#fef7ff",
              "on-secondary-fixed": "#001945",
              "surface-container-high": "#ede6f1",
              "secondary-container": "#79a1fe",
              "outline": "#946e69",
              "on-secondary-container": "#003581",
              "inverse-primary": "#ffb4aa",
              "tertiary-container": "#717274",
              "surface-container": "#f3ebf7",
              "on-primary": "#ffffff",
              "error-container": "#ffdad6",
              "on-secondary": "#ffffff",
              "inverse-on-surface": "#f6eefa",
              "background": "#fef7ff",
              "secondary": "#2d5bb3",
              "on-secondary-fixed-variant": "#04429a",
              "secondary-fixed-dim": "#b0c6ff",
              "primary-container": "#e60012",
              "tertiary": "#595a5c",
              "tertiary-fixed": "#e3e2e4",
              "on-primary-container": "#fff7f6",
              "surface-dim": "#dfd7e3",
              "on-tertiary-container": "#f9f8fa",
              "on-background": "#1d1a22",
              "on-tertiary-fixed-variant": "#464749",
              "surface-container-highest": "#e7e0eb",
              "surface-tint": "#c0000d",
              "surface-container-lowest": "#ffffff",
              "on-surface": "#1d1a22",
              "secondary-fixed": "#d9e2ff",
              "on-tertiary-fixed": "#1a1c1d",
              "primary-fixed-dim": "#ffb4aa",
              "primary-fixed": "#ffdad5",
              "error": "#ba1a1a",
              "on-primary-fixed-variant": "#930007"
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
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20;
            vertical-align: middle;
        }
        body { font-family: 'Inter', sans-serif; }
    </style>
</head>
<body class="bg-background text-on-surface">
<!-- TopAppBar -->
<header class="bg-[#fef7ff] dark:bg-[#1d1a22] flex justify-between items-center w-full px-6 py-3 fixed top-0 z-50">
<div class="flex items-center gap-3">
<img alt="HD Services Private Limited Logo" class="h-8" data-alt="Corporate minimalist logo with sharp geometric lines and a vibrant primary red accent color on a clean white background" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDjk0GdmyzGjanO2mdtDoLMln_6f5teoyYhYIk21RKduSOC3Bx2h8pPTq0Tie-Sv9IhMQ9V2eKlUp21IgONOB9UZgv1pi2p7m_k7oyvdmqh9TRXrA6D4d0YKUsGIHGvppNQ7Eda8HYcYwhN7NpDVmPT-VDHood-94JAyGmn32mxJKNb2cybvJB-IYuRcTCq5mmFnYss24LOxKZCGGJPiDuN8yA2y42LRemg8kP22nB08H_45j761lTrmlDo5nd1jw3qo-_ODA2FU-zF"/>
<span class="font-bold tracking-tight text-[#e60012] text-xl">HD Services Private Limited</span>
</div>
<div class="flex items-center gap-4">
<div class="relative group">
<span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
<input class="bg-surface-container border-none rounded-full pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-primary-container w-64 transition-all" placeholder="Search test assets..." type="text"/>
</div>
<button class="material-symbols-outlined text-[#1d1a22] dark:text-[#e7e0eb] p-2 hover:bg-[#f9f1fd] rounded-full transition-all">notifications</button>
<button class="material-symbols-outlined text-[#1d1a22] dark:text-[#e7e0eb] p-2 hover:bg-[#f9f1fd] rounded-full transition-all">account_circle</button>
</div>
</header>
<!-- SideNavBar -->
<aside class="h-screen w-64 fixed left-0 top-0 z-40 bg-[#f9f1fd] dark:bg-[#1d1a22] flex flex-col py-6 pt-20">
<div class="px-6 mb-8">
<h2 class="text-primary font-bold text-lg">HD Services</h2>
<p class="text-xs text-secondary tracking-wider uppercase font-semibold">Test Case Generator</p>
</div>
<nav class="flex-1 space-y-1 overflow-y-auto">
<a class="text-[#2d5bb3] flex items-center px-6 py-3 hover:bg-[#e7e0eb] transition-colors gap-3" href="#">
<span class="material-symbols-outlined">settings_ethernet</span>
<span class="text-sm font-medium">Test Connection</span>
</a>
<a class="text-[#2d5bb3] flex items-center px-6 py-3 hover:bg-[#e7e0eb] transition-colors gap-3" href="#">
<span class="material-symbols-outlined">assignment</span>
<span class="text-sm font-medium">Create Test Plan</span>
</a>
<a class="text-[#b7000c] bg-[#ffdad5]/50 rounded-r-full font-bold border-l-4 border-[#b7000c] flex items-center px-6 py-3 gap-3" href="#">
<span class="material-symbols-outlined">note_add</span>
<span class="text-sm">Create Test Cases</span>
</a>
<a class="text-[#2d5bb3] flex items-center px-6 py-3 hover:bg-[#e7e0eb] transition-colors gap-3" href="#">
<span class="material-symbols-outlined">schema</span>
<span class="text-sm font-medium">Create Test Scenarios</span>
</a>
<a class="text-[#2d5bb3] flex items-center px-6 py-3 hover:bg-[#e7e0eb] transition-colors gap-3" href="#">
<span class="material-symbols-outlined">fact_check</span>
<span class="text-sm font-medium">Review Test Cases</span>
</a>
<a class="text-[#2d5bb3] flex items-center px-6 py-3 hover:bg-[#e7e0eb] transition-colors gap-3" href="#">
<span class="material-symbols-outlined">dashboard</span>
<span class="text-sm font-medium">Zephyr Dashboard</span>
</a>
<a class="text-[#2d5bb3] flex items-center px-6 py-3 hover:bg-[#e7e0eb] transition-colors gap-3" href="#">
<span class="material-symbols-outlined">terminal</span>
<span class="text-sm font-medium">Automation</span>
</a>
<a class="text-[#2d5bb3] flex items-center px-6 py-3 hover:bg-[#e7e0eb] transition-colors gap-3" href="#">
<span class="material-symbols-outlined">settings</span>
<span class="text-sm font-medium">Settings</span>
</a>
</nav>
</aside>
<!-- Main Content Canvas -->
<main class="ml-64 pt-16 min-h-screen bg-white">
<div class="max-w-[1600px] mx-auto p-8 grid grid-cols-12 gap-8">
<!-- Left Side: Core Content (9 Columns) -->
<div class="col-span-12 lg:col-span-9 space-y-8">
<!-- Header Section -->
<div>
<h1 class="text-3xl font-bold tracking-tight text-[#e60012] mb-1">Test Case Generator - Live Preview</h1>
<p class="text-on-surface-variant">Drafting intelligent test protocols from system requirements using AI-driven logic.</p>
</div>
<!-- Input Requirements Card -->
<section class="bg-surface-container-lowest p-6 rounded-xl border-l-4 border-primary shadow-sm">
<div class="flex items-center gap-2 mb-4">
<span class="material-symbols-outlined text-primary">description</span>
<h3 class="font-bold text-on-surface">Input Requirements</h3>
</div>
<div class="space-y-4">
<textarea class="w-full bg-surface-container-highest border-none rounded-lg p-4 focus:ring-2 focus:ring-primary placeholder:text-on-surface-variant/50 text-sm" placeholder="Paste your system requirement specification (SRS) or user story here... e.g., 'User should be able to authenticate using MFA'" rows="4"></textarea>
<div class="flex justify-end">
<button class="bg-gradient-to-r from-primary to-primary-container text-white px-6 py-2 rounded-lg font-bold text-sm shadow-md hover:opacity-90 transition-all flex items-center gap-2">
<span class="material-symbols-outlined text-sm" style="font-variation-settings: 'FILL' 1;">auto_awesome</span>
                                Generate Draft
                            </button>
</div>
</div>
</section>
<!-- Data Table Section -->
<section class="space-y-4">
<div class="flex justify-between items-center">
<h3 class="font-bold text-lg text-on-surface flex items-center gap-2">
<span class="material-symbols-outlined">table_chart</span>
                            Generation Preview
                        </h3>
<div class="flex gap-2">
<span class="px-3 py-1 bg-surface-container-high rounded-full text-xs font-semibold text-secondary">15 Cases Generated</span>
</div>
</div>
<div class="bg-white overflow-hidden rounded-xl">
<table class="w-full text-left border-collapse">
<thead>
<tr class="bg-surface-container-low border-b border-surface-variant">
<th class="px-4 py-4 text-xs font-bold text-secondary uppercase tracking-wider w-24">ID</th>
<th class="px-4 py-4 text-xs font-bold text-secondary uppercase tracking-wider">Summary</th>
<th class="px-4 py-4 text-xs font-bold text-secondary uppercase tracking-wider w-32 text-center">Type</th>
<th class="px-4 py-4 text-xs font-bold text-secondary uppercase tracking-wider w-32 text-center">Priority</th>
<th class="px-4 py-4 text-xs font-bold text-secondary uppercase tracking-wider w-20 text-center">Actions</th>
</tr>
</thead>
<tbody class="divide-y divide-surface-container">
<!-- Row Template -->
<tr class="hover:bg-surface-container-lowest/50 transition-colors">
<td class="px-4 py-4 text-sm font-bold text-primary">TC-001</td>
<td class="px-4 py-4 text-sm text-on-surface font-medium">Verify multi-factor authentication token validation</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-secondary/10 text-secondary text-[10px] font-bold rounded uppercase">API</span>
</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-error/10 text-error text-[10px] font-bold rounded uppercase">High</span>
</td>
<td class="px-4 py-4 text-center">
<button class="material-symbols-outlined text-outline hover:text-primary transition-colors">edit</button>
</td>
</tr>
<tr class="hover:bg-surface-container-lowest/50 transition-colors">
<td class="px-4 py-4 text-sm font-bold text-primary">TC-002</td>
<td class="px-4 py-4 text-sm text-on-surface font-medium">User login with expired credentials returns 401</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-secondary/10 text-secondary text-[10px] font-bold rounded uppercase">API</span>
</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-error/10 text-error text-[10px] font-bold rounded uppercase">High</span>
</td>
<td class="px-4 py-4 text-center">
<button class="material-symbols-outlined text-outline hover:text-primary transition-colors">edit</button>
</td>
</tr>
<tr class="hover:bg-surface-container-lowest/50 transition-colors">
<td class="px-4 py-4 text-sm font-bold text-primary">TC-003</td>
<td class="px-4 py-4 text-sm text-on-surface font-medium">Validation of password complexity UI feedback</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-tertiary-container/10 text-tertiary text-[10px] font-bold rounded uppercase">UI</span>
</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-secondary-container/10 text-on-secondary-container text-[10px] font-bold rounded uppercase">Medium</span>
</td>
<td class="px-4 py-4 text-center">
<button class="material-symbols-outlined text-outline hover:text-primary transition-colors">edit</button>
</td>
</tr>
<tr class="hover:bg-surface-container-lowest/50 transition-colors">
<td class="px-4 py-4 text-sm font-bold text-primary">TC-004</td>
<td class="px-4 py-4 text-sm text-on-surface font-medium">End-to-end payment gateway transaction success</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant text-[10px] font-bold rounded uppercase">Integration</span>
</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-error/10 text-error text-[10px] font-bold rounded uppercase">High</span>
</td>
<td class="px-4 py-4 text-center">
<button class="material-symbols-outlined text-outline hover:text-primary transition-colors">edit</button>
</td>
</tr>
<tr class="hover:bg-surface-container-lowest/50 transition-colors">
<td class="px-4 py-4 text-sm font-bold text-primary">TC-005</td>
<td class="px-4 py-4 text-sm text-on-surface font-medium">Verify "Remember Me" cookie persistence across sessions</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-tertiary-container/10 text-tertiary text-[10px] font-bold rounded uppercase">UI</span>
</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-surface-container-highest/50 text-tertiary text-[10px] font-bold rounded uppercase">Low</span>
</td>
<td class="px-4 py-4 text-center">
<button class="material-symbols-outlined text-outline hover:text-primary transition-colors">edit</button>
</td>
</tr>
<tr class="hover:bg-surface-container-lowest/50 transition-colors">
<td class="px-4 py-4 text-sm font-bold text-primary">TC-006</td>
<td class="px-4 py-4 text-sm text-on-surface font-medium">OAuth flow redirection to third party provider</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant text-[10px] font-bold rounded uppercase">Integration</span>
</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-secondary-container/10 text-on-secondary-container text-[10px] font-bold rounded uppercase">Medium</span>
</td>
<td class="px-4 py-4 text-center">
<button class="material-symbols-outlined text-outline hover:text-primary transition-colors">edit</button>
</td>
</tr>
<tr class="hover:bg-surface-container-lowest/50 transition-colors">
<td class="px-4 py-4 text-sm font-bold text-primary">TC-007</td>
<td class="px-4 py-4 text-sm text-on-surface font-medium">Database rollback on failed transaction update</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-secondary/10 text-secondary text-[10px] font-bold rounded uppercase">API</span>
</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-error/10 text-error text-[10px] font-bold rounded uppercase">High</span>
</td>
<td class="px-4 py-4 text-center">
<button class="material-symbols-outlined text-outline hover:text-primary transition-colors">edit</button>
</td>
</tr>
<tr class="hover:bg-surface-container-lowest/50 transition-colors">
<td class="px-4 py-4 text-sm font-bold text-primary">TC-008</td>
<td class="px-4 py-4 text-sm text-on-surface font-medium">Help center tooltips display on mobile viewport</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-tertiary-container/10 text-tertiary text-[10px] font-bold rounded uppercase">UI</span>
</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-surface-container-highest/50 text-tertiary text-[10px] font-bold rounded uppercase">Low</span>
</td>
<td class="px-4 py-4 text-center">
<button class="material-symbols-outlined text-outline hover:text-primary transition-colors">edit</button>
</td>
</tr>
<tr class="hover:bg-surface-container-lowest/50 transition-colors">
<td class="px-4 py-4 text-sm font-bold text-primary">TC-009</td>
<td class="px-4 py-4 text-sm text-on-surface font-medium">API rate limiting for burst traffic conditions</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-secondary/10 text-secondary text-[10px] font-bold rounded uppercase">API</span>
</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-secondary-container/10 text-on-secondary-container text-[10px] font-bold rounded uppercase">Medium</span>
</td>
<td class="px-4 py-4 text-center">
<button class="material-symbols-outlined text-outline hover:text-primary transition-colors">edit</button>
</td>
</tr>
<tr class="hover:bg-surface-container-lowest/50 transition-colors">
<td class="px-4 py-4 text-sm font-bold text-primary">TC-010</td>
<td class="px-4 py-4 text-sm text-on-surface font-medium">Verify localization for Japanese character support</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-tertiary-container/10 text-tertiary text-[10px] font-bold rounded uppercase">UI</span>
</td>
<td class="px-4 py-4 text-center">
<span class="px-2 py-1 bg-secondary-container/10 text-on-secondary-container text-[10px] font-bold rounded uppercase">Medium</span>
</td>
<td class="px-4 py-4 text-center">
<button class="material-symbols-outlined text-outline hover:text-primary transition-colors">edit</button>
</td>
</tr>
</tbody>
</table>
<!-- Pagination -->
<div class="px-4 py-4 bg-surface-container-low flex justify-between items-center">
<span class="text-xs text-on-surface-variant">Showing 1-10 of 15 test cases</span>
<div class="flex gap-2">
<button class="px-3 py-1 border border-outline-variant text-xs font-bold text-on-surface rounded hover:bg-white transition-all disabled:opacity-50" disabled="">Previous</button>
<button class="px-3 py-1 border border-outline-variant text-xs font-bold text-on-surface rounded hover:bg-white transition-all">Next</button>
</div>
</div>
</div>
</section>
</div>
<!-- Right Sidebar: Insights & Export (3 Columns) -->
<div class="col-span-12 lg:col-span-3 space-y-6">
<!-- Export Center -->
<section class="bg-surface-container-low p-6 rounded-xl space-y-4">
<h3 class="font-bold text-sm text-secondary uppercase tracking-widest border-b border-outline-variant pb-2">Export Center</h3>
<div class="space-y-3">
<button class="w-full bg-primary text-white py-3 rounded-lg font-bold text-sm shadow flex items-center justify-center gap-2 hover:bg-primary-container transition-all">
<span class="material-symbols-outlined text-lg" style="font-variation-settings: 'FILL' 1;">cloud_upload</span>
                            Push to Zephyr
                        </button>
<button class="w-full bg-surface-container-highest text-on-secondary-container py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 hover:bg-surface-container-high transition-all">
<span class="material-symbols-outlined text-lg">markdown</span>
                            Download .md File
                        </button>
<button class="w-full bg-surface-container-highest text-on-secondary-container py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 hover:bg-surface-container-high transition-all">
<span class="material-symbols-outlined text-lg">grid_on</span>
                            Download Excel File
                        </button>
</div>
</section>
<!-- AI Insights Card -->
<section class="bg-[#1d1a22] text-white p-6 rounded-xl relative overflow-hidden group">
<!-- Subtle background decoration -->
<div class="absolute -right-4 -top-4 w-24 h-24 bg-primary/20 rounded-full blur-2xl group-hover:bg-primary/40 transition-all duration-700"></div>
<div class="relative z-10 space-y-4">
<div class="flex items-center gap-2 text-primary-fixed">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">analytics</span>
<h3 class="font-bold text-sm uppercase tracking-wider">AI Insights</h3>
</div>
<div class="space-y-1">
<p class="text-4xl font-extrabold text-white">94%</p>
<p class="text-xs text-primary-fixed font-medium uppercase">Coverage Confidence</p>
</div>
<p class="text-sm text-surface-variant leading-relaxed italic">
                            "The generated suite covers 100% of defined API endpoints. Consider adding negative path scenarios for the OAuth flow to reach 98% confidence."
                        </p>
<div class="pt-2">
<div class="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
<div class="bg-primary-container w-[94%] h-full"></div>
</div>
</div>
</div>
</section>
<!-- Quick Preview Visual -->
<div class="rounded-xl overflow-hidden aspect-video relative group cursor-pointer shadow-lg">
<img alt="Abstract visualization of data architecture" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" data-alt="Sophisticated dark blue and red abstract visualization of interconnected digital nodes and glowing data pathways in a 3D architectural space" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC4QFGWIBQfgzqTW1gDjnCma9Vgi9XhGGah_ob8Q0JgSGWLONP_6_S4VJhGAY8Kfa3tTVQqu1GrqMGyDDo3Q0CMCQiWl7m6aJYMzkb-xLT8JFDqivsUDQvQ8SIMHJ-6b0KCOfRs19SddCaPbT_QwuM9kvCjkND49fYytp6ZJnrsRQ_om-ETM6rnLXZ1SlwvMeWRga_H-Uo8n78CWtuBPqDyEbml5osGdrFCKAKeCw2eCto6UeBjS-EcWijNfWgyrCGadwMzAY9mZm3e"/>
<div class="absolute inset-0 bg-gradient-to-t from-on-surface/80 to-transparent flex items-end p-4">
<p class="text-xs text-white font-medium">System Architecture Mapping Active</p>
</div>
</div>
</div>
</div>
</main>
</body></html>