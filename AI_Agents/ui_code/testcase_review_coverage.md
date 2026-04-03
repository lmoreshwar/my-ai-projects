<!DOCTYPE html>

<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Test Case Review &amp; Coverage - HD Services Private Limited</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "tertiary-container": "#717274",
              "outline": "#946e69",
              "inverse-on-surface": "#f6eefa",
              "secondary-container": "#79a1fe",
              "on-secondary-fixed-variant": "#04429a",
              "on-error-container": "#93000a",
              "on-tertiary-fixed-variant": "#464749",
              "on-primary-fixed-variant": "#930007",
              "on-tertiary-fixed": "#1a1c1d",
              "surface-tint": "#c0000d",
              "surface-container-highest": "#e7e0eb",
              "background": "#fef7ff",
              "surface-container-lowest": "#ffffff",
              "tertiary-fixed": "#e3e2e4",
              "on-tertiary": "#ffffff",
              "on-background": "#1d1a22",
              "tertiary-fixed-dim": "#c6c6c8",
              "surface-variant": "#e7e0eb",
              "surface-container": "#f3ebf7",
              "surface-dim": "#dfd7e3",
              "outline-variant": "#e9bcb6",
              "primary-fixed": "#ffdad5",
              "on-secondary-container": "#003581",
              "error-container": "#ffdad6",
              "secondary": "#2d5bb3",
              "on-surface-variant": "#5f3f3b",
              "on-tertiary-container": "#f9f8fa",
              "surface-container-low": "#f9f1fd",
              "surface-bright": "#fef7ff",
              "primary-fixed-dim": "#ffb4aa",
              "on-primary": "#ffffff",
              "surface-container-high": "#ede6f1",
              "inverse-surface": "#322f37",
              "inverse-primary": "#ffb4aa",
              "tertiary": "#595a5c",
              "on-primary-fixed": "#410001",
              "on-secondary": "#ffffff",
              "secondary-fixed-dim": "#b0c6ff",
              "secondary-fixed": "#d9e2ff",
              "on-error": "#ffffff",
              "surface": "#fef7ff",
              "primary": "#b7000c",
              "on-secondary-fixed": "#001945",
              "error": "#ba1a1a",
              "on-surface": "#1d1a22",
              "on-primary-container": "#fff7f6",
              "primary-container": "#e60012"
            },
            fontFamily: {
              "headline": ["Inter", "sans-serif"],
              "body": ["Inter", "sans-serif"],
              "label": ["Inter", "sans-serif"]
            },
            borderRadius: {"DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem"},
          },
        },
      }
    </script>
<style>
        body { font-family: 'Inter', sans-serif; background-color: #fef7ff; }
        .material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
        .glass-panel { background: rgba(254, 247, 255, 0.8); backdrop-filter: blur(12px); }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #f9f1fd; }
        ::-webkit-scrollbar-thumb { background: #e7e0eb; border-radius: 10px; }
    </style>
</head>
<body class="text-on-background">
<!-- TopAppBar -->
<header class="bg-[#E60012] text-white font-bold tracking-tight Inter docked full-width top-0 z-50 fixed flex justify-between items-center h-16 w-full px-6 no-border shadow-none">
<div class="flex items-center gap-4">
<img alt="HD Services Logo" class="h-8 w-8 object-contain" data-alt="professional company logo for HD Services with clean white lettering on red background circular icon" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDodueA27uLX0w6nz-RIv9843-C9QJrLAybUw1QEqmB62zBjyHk_s9qezX45zzoiosKOl2087AJtoPV0L2FOZ0tKVFeP0IQbfL2aoeQKCbE6m_pHtptKIjnIEZytSN8ehqI-Q4qgFu5K1q9dedKuQTGnmFo1fv0hIvKzLEO9yEZauAGnZrcoNXA2EpM0GAvQ_Tr7Sv3K5XFasIsX2oDEPEeFNYrF-lpMgq5Fl0uggoHy6CxeRs50KBViKEL13r7Sb4CCCcLgjAmsmzE"/>
<span class="text-xl font-black text-white px-4">HD Services Private Limited</span>
</div>
<div class="hidden md:flex items-center gap-8">
<div class="flex items-center gap-6">
<button class="text-white font-bold hover:bg-white/10 transition-colors px-3 py-2 rounded-lg">Dashboard</button>
<button class="text-white/80 hover:bg-white/10 transition-colors px-3 py-2 rounded-lg">Projects</button>
<button class="text-white/80 hover:bg-white/10 transition-colors px-3 py-2 rounded-lg">Reports</button>
</div>
<div class="flex items-center gap-4 ml-4">
<span class="material-symbols-outlined cursor-pointer hover:bg-white/10 p-2 rounded-full transition-colors" data-icon="notifications">notifications</span>
<span class="material-symbols-outlined cursor-pointer hover:bg-white/10 p-2 rounded-full transition-colors" data-icon="help">help</span>
<span class="material-symbols-outlined cursor-pointer hover:bg-white/10 p-2 rounded-full transition-colors" data-icon="account_circle">account_circle</span>
</div>
</div>
</header>
<!-- SideNavBar -->
<aside class="fixed left-0 top-16 h-[calc(100vh-64px)] w-64 flex flex-col pt-8 bg-[#f9f1fd] dark:bg-slate-900 tonal surface-container-low shift flat no shadows">
<div class="px-6 mb-8">
<h2 class="text-[#b7000c] dark:text-[#E60012] font-bold text-lg">Command Center</h2>
<p class="text-xs text-tertiary">QA Enterprise Suite</p>
</div>
<nav class="flex-1 space-y-1">
<a class="text-[#1d1a22] dark:text-slate-300 py-3 px-6 flex items-center gap-3 hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all label-md font-medium" href="#">
<span class="material-symbols-outlined" data-icon="cable">cable</span> Test Connection
            </a>
<a class="text-[#1d1a22] dark:text-slate-300 py-3 px-6 flex items-center gap-3 hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all label-md font-medium" href="#">
<span class="material-symbols-outlined" data-icon="assignment">assignment</span> Create Test Plan
            </a>
<a class="text-[#1d1a22] dark:text-slate-300 py-3 px-6 flex items-center gap-3 hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all label-md font-medium" href="#">
<span class="material-symbols-outlined" data-icon="edit_note">edit_note</span> Create Test Cases
            </a>
<a class="text-[#1d1a22] dark:text-slate-300 py-3 px-6 flex items-center gap-3 hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all label-md font-medium" href="#">
<span class="material-symbols-outlined" data-icon="schema">schema</span> Create Test Scenarios
            </a>
<a class="text-[#b7000c] font-bold bg-[#ffdad5] rounded-full mx-2 py-3 px-4 flex items-center gap-3 label-md Active: border-l-4 border-[#b7000c] transition-all" href="#">
<span class="material-symbols-outlined" data-icon="fact_check">fact_check</span> Review Test Cases
            </a>
<a class="text-[#1d1a22] dark:text-slate-300 py-3 px-6 flex items-center gap-3 hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all label-md font-medium" href="#">
<span class="material-symbols-outlined" data-icon="dashboard">dashboard</span> Zephyr Dashboard
            </a>
<a class="text-[#1d1a22] dark:text-slate-300 py-3 px-6 flex items-center gap-3 hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all label-md font-medium" href="#">
<span class="material-symbols-outlined" data-icon="settings_suggest">settings_suggest</span> Automation
            </a>
<a class="text-[#1d1a22] dark:text-slate-300 py-3 px-6 flex items-center gap-3 hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all label-md font-medium" href="#">
<span class="material-symbols-outlined" data-icon="settings">settings</span> Settings
            </a>
</nav>
</aside>
<!-- Main Content -->
<main class="ml-64 pt-24 pb-12 px-8 min-h-screen">
<!-- Hero Header -->
<div class="mb-12 max-w-4xl">
<h1 class="text-4xl font-bold tracking-tight text-primary-container mb-2">Test Case Review &amp; Coverage</h1>
<p class="text-on-surface-variant body-md leading-relaxed">
                Analyze your generated test cases against functional requirements to ensure 100% coverage and architectural precision.
            </p>
</div>
<!-- Dashboard Grid -->
<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
<!-- Left Column: Requirement Intake -->
<div class="lg:col-span-3 space-y-6">
<div class="bg-surface-container-lowest p-6 rounded-xl shadow-sm border-0 border-l-4 border-primary">
<h3 class="text-lg font-bold text-primary mb-4 flex items-center gap-2">
<span class="material-symbols-outlined" data-icon="input">input</span> Requirement Intake
                    </h3>
<div class="space-y-4">
<div>
<label class="text-xs font-bold text-secondary uppercase tracking-wider mb-2 block">JIRA Ticket ID</label>
<div class="flex gap-2">
<input class="w-full bg-surface-container-highest border-0 border-b-2 border-primary-container focus:ring-0 text-sm py-2 px-3" placeholder="e.g. HD-4092" type="text"/>
<button class="bg-surface-container-highest hover:bg-surface-container-high text-primary font-bold px-4 transition-colors">Fetch</button>
</div>
</div>
<div>
<label class="text-xs font-bold text-secondary uppercase tracking-wider mb-2 block">Requirement Document</label>
<div class="border-2 border-dashed border-outline-variant rounded-lg p-6 text-center hover:bg-surface-container-low transition-colors cursor-pointer group">
<span class="material-symbols-outlined text-4xl text-outline-variant group-hover:text-primary transition-colors" data-icon="cloud_upload">cloud_upload</span>
<p class="text-xs text-on-surface-variant mt-2">Drag &amp; drop functional specs here</p>
</div>
</div>
<div>
<label class="text-xs font-bold text-secondary uppercase tracking-wider mb-2 block">Manual Requirement Input</label>
<textarea class="w-full bg-surface-container-highest border-0 border-b-2 border-primary-container focus:ring-0 text-sm py-3 px-4 resize-none" placeholder="Paste complex business logic or architectural requirements here..." rows="6"></textarea>
</div>
<button class="w-full bg-gradient-to-br from-primary to-primary-container text-white font-bold py-4 rounded-md shadow-md hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2">
                            Analyze &amp; Compare Coverage
                            <span class="material-symbols-outlined" data-icon="analytics">analytics</span>
</button>
</div>
</div>
</div>
<!-- Center Column: Coverage Insights -->
<div class="lg:col-span-5 space-y-6">
<div class="bg-surface-container-lowest p-8 rounded-xl shadow-sm relative overflow-hidden">
<div class="flex justify-between items-start mb-8">
<div>
<h3 class="text-2xl font-black text-on-surface">Coverage Insights</h3>
<p class="text-sm text-tertiary">Real-time mapping analysis</p>
</div>
<div class="bg-secondary/10 text-secondary px-3 py-1 rounded-full text-xs font-bold">Live Status</div>
</div>
<div class="flex flex-col items-center justify-center py-6">
<!-- Progress Gauge Container -->
<div class="relative w-48 h-48 flex items-center justify-center">
<svg class="w-full h-full transform -rotate-90">
<circle class="text-surface-container-highest" cx="96" cy="96" fill="transparent" r="88" stroke="currentColor" stroke-width="12"></circle>
<circle class="text-primary" cx="96" cy="96" fill="transparent" r="88" stroke="currentColor" stroke-dasharray="553" stroke-dashoffset="33" stroke-width="12"></circle>
</svg>
<div class="absolute inset-0 flex flex-col items-center justify-center">
<span class="text-5xl font-black text-on-surface">94%</span>
<span class="text-xs font-bold text-secondary uppercase tracking-tighter">Overall Coverage</span>
</div>
</div>
</div>
<div class="mt-8 space-y-4">
<div class="flex items-center justify-between p-4 bg-surface-container-low rounded-lg">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-green-600" data-icon="check_circle" style="font-variation-settings: 'FILL' 1;">check_circle</span>
<span class="font-bold text-on-surface">Functional Pathways</span>
</div>
<span class="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">Optimized</span>
</div>
<div class="flex items-center justify-between p-4 bg-surface-container-low rounded-lg">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-amber-500" data-icon="warning" style="font-variation-settings: 'FILL' 1;">warning</span>
<span class="font-bold text-on-surface">Negative Scenarios</span>
</div>
<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">Partially Covered</span>
</div>
<div class="flex items-center justify-between p-4 bg-surface-container-low rounded-lg">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-primary" data-icon="error" style="font-variation-settings: 'FILL' 1;">error</span>
<span class="font-bold text-on-surface">Edge Case Matrix</span>
</div>
<span class="bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">High Risk</span>
</div>
</div>
</div>
<div class="bg-surface-container-highest p-6 rounded-xl border-l-4 border-secondary">
<div class="flex items-center gap-3 mb-4">
<span class="material-symbols-outlined text-secondary" data-icon="psychology">psychology</span>
<h4 class="font-bold text-on-surface">AI Strategic Insights</h4>
</div>
<p class="text-sm text-on-surface-variant italic leading-relaxed">
                        "Analysis identifies 3 critical edge cases detected in the checkout logic require additional scenarios. Payment gateway latency and session timeout during transaction state transitions are currently unmapped."
                    </p>
</div>
</div>
<!-- Right Column: Review Dashboard -->
<div class="lg:col-span-4 space-y-6">
<div class="bg-surface-container-lowest p-6 rounded-xl shadow-sm">
<div class="flex justify-between items-center mb-6">
<h3 class="text-lg font-bold text-on-surface">Generated Test Cases</h3>
<span class="text-xs font-bold text-tertiary">24 Total</span>
</div>
<div class="space-y-3 max-h-[480px] overflow-y-auto pr-2">
<!-- Test Case Card -->
<div class="group p-4 rounded-lg bg-surface border-0 hover:bg-surface-container-low transition-all cursor-pointer">
<div class="flex justify-between items-start mb-2">
<span class="text-xs font-black text-secondary">TC-881</span>
<span class="material-symbols-outlined text-sm text-on-surface-variant group-hover:text-primary transition-colors" data-icon="open_in_new">open_in_new</span>
</div>
<h4 class="font-bold text-sm text-on-surface mb-1">Verify multi-currency settlement</h4>
<p class="text-[11px] text-tertiary-container line-clamp-2">Alignment: 98%. Covers FR-12.2 automated conversion at checkout...</p>
</div>
<div class="group p-4 rounded-lg bg-surface border-0 hover:bg-surface-container-low transition-all cursor-pointer">
<div class="flex justify-between items-start mb-2">
<span class="text-xs font-black text-secondary">TC-882</span>
<span class="material-symbols-outlined text-sm text-on-surface-variant group-hover:text-primary transition-colors" data-icon="open_in_new">open_in_new</span>
</div>
<h4 class="font-bold text-sm text-on-surface mb-1">Validate session persistence on network drop</h4>
<p class="text-[11px] text-tertiary-container line-clamp-2">Alignment: 85%. Partially covers error handling states...</p>
</div>
<div class="group p-4 rounded-lg bg-surface border-0 hover:bg-surface-container-low transition-all cursor-pointer">
<div class="flex justify-between items-start mb-2">
<span class="text-xs font-black text-secondary">TC-883</span>
<span class="material-symbols-outlined text-sm text-on-surface-variant group-hover:text-primary transition-colors" data-icon="open_in_new">open_in_new</span>
</div>
<h4 class="font-bold text-sm text-on-surface mb-1">API Header Injection Prevention</h4>
<p class="text-[11px] text-tertiary-container line-clamp-2">Alignment: 100%. Critical security requirement mapping...</p>
</div>
<div class="group p-4 rounded-lg bg-surface border-0 hover:bg-surface-container-low transition-all cursor-pointer">
<div class="flex justify-between items-start mb-2">
<span class="text-xs font-black text-secondary">TC-884</span>
<span class="material-symbols-outlined text-sm text-on-surface-variant group-hover:text-primary transition-colors" data-icon="open_in_new">open_in_new</span>
</div>
<h4 class="font-bold text-sm text-on-surface mb-1">UI Responsive Breakpoint Test</h4>
<p class="text-[11px] text-tertiary-container line-clamp-2">Alignment: 92%. Cross-browser consistency check...</p>
</div>
</div>
<div class="mt-8 pt-6 border-t border-surface-container-highest">
<h4 class="text-xs font-bold text-secondary uppercase tracking-widest mb-4">Export Center</h4>
<div class="grid grid-cols-2 gap-3">
<button class="flex items-center justify-center gap-2 bg-surface-container-highest hover:bg-surface-container-high py-3 rounded-lg text-xs font-bold text-on-surface transition-all">
<span class="material-symbols-outlined text-lg" data-icon="picture_as_pdf">picture_as_pdf</span>
                                Review PDF
                            </button>
<button class="flex items-center justify-center gap-2 bg-surface-container-highest hover:bg-surface-container-high py-3 rounded-lg text-xs font-bold text-on-surface transition-all">
<span class="material-symbols-outlined text-lg" data-icon="table_view">table_view</span>
                                Trace Matrix
                            </button>
</div>
</div>
</div>
<!-- Requirement Status Summary -->
<div class="bg-surface-container-low p-6 rounded-xl">
<h3 class="font-bold text-on-surface mb-4">Requirement Status</h3>
<div class="space-y-4">
<div class="flex justify-between text-xs font-medium">
<span>Mapped Functional Requirements</span>
<span class="text-primary font-bold">18/20</span>
</div>
<div class="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden">
<div class="bg-primary h-full w-[90%]"></div>
</div>
<div class="flex justify-between text-xs font-medium">
<span>Non-Functional Mapping</span>
<span class="text-secondary font-bold">12/15</span>
</div>
<div class="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden">
<div class="bg-secondary h-full w-[80%]"></div>
</div>
</div>
</div>
</div>
</div>
<!-- Floating Action Component (Optional context) -->
<div class="fixed bottom-8 right-8">
<button class="w-14 h-14 bg-primary rounded-full shadow-2xl flex items-center justify-center text-white hover:scale-110 active:scale-95 transition-all">
<span class="material-symbols-outlined text-3xl" data-icon="chat_bubble" style="font-variation-settings: 'FILL' 1;">chat_bubble</span>
</button>
</div>
</main>
<!-- Footer Area -->
<footer class="ml-64 bg-surface-container p-8 text-on-surface-variant text-sm flex flex-col md:flex-row justify-between items-center border-t-0">
<div class="flex items-center gap-4 mb-4 md:mb-0">
<span class="font-bold text-secondary">HD Services Digital Architect</span>
<span class="text-tertiary-container">© 2024 HD Services Private Limited. All rights reserved.</span>
</div>
<div class="flex gap-6">
<a class="hover:text-primary transition-colors" href="#">Privacy Policy</a>
<a class="hover:text-primary transition-colors" href="#">Security Standards</a>
<a class="hover:text-primary transition-colors" href="#">System Health</a>
</div>
</footer>
</body></html>