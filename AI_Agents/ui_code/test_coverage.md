<!DOCTYPE html>

<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Test Plan Generator | Hitachi Digital Services</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&amp;display=swap" rel="stylesheet"/>
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
                        "surface-container-high": "#f0f0f0",
                        "error-container": "#ffdad6",
                        "on-error": "#ffffff",
                        "background": "#ffffff",
                        "on-background": "#1a1a1a",
                        "surface-container-low": "#f8f8f8",
                        "on-secondary-container": "#51617e",
                        "surface-variant": "#eeeeee",
                        "surface-container": "#f5f5f5",
                        "surface": "#ffffff",
                        "on-tertiary-container": "#002113",
                        "outline-variant": "#d1d1d1",
                        "error": "#ba1a1a",
                        "tertiary-fixed": "#82f9be",
                        "inverse-on-surface": "#ffffff",
                        "secondary-fixed": "#d6e3ff",
                        "inverse-primary": "#b2c5ff",
                        "secondary-fixed-dim": "#b7c7e8",
                        "on-primary-fixed": "#001848",
                        "primary-container": "#E60012",
                        "surface-container-highest": "#e0e0e0",
                        "tertiary": "#004e32",
                        "primary": "#E60012",
                        "inverse-surface": "#1d3054",
                        "primary-fixed-dim": "#b2c5ff",
                        "on-error-container": "#93000a",
                        "on-surface": "#1a1a1a",
                        "outline": "#737685",
                        "surface-bright": "#ffffff",
                        "on-primary-fixed-variant": "#b7000c",
                        "on-secondary-fixed-variant": "#374763",
                        "secondary-container": "#f0f0f0",
                        "surface-dim": "#eeeeee",
                        "secondary": "#555555",
                        "surface-bright": "#ffffff",
                        "on-primary": "#ffffff",
                        "on-primary-container": "#ffffff",
                        "surface-container-lowest": "#ffffff",
                        "on-secondary-fixed": "#091c35",
                        "tertiary-container": "#006844",
                        "primary-fixed": "#ffdad5",
                        "on-tertiary-fixed-variant": "#005235"
                    },
                    fontFamily: {
                        "headline": ["Inter"],
                        "body": ["Inter"],
                        "label": ["Inter"]
                    },
                    borderRadius: {"DEFAULT": "0px", "lg": "2px", "xl": "4px", "full": "9999px"},
                },
            },
        }
    </script>
<style>
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        .nav-item-active {
            background-color: #ffdad5;
            color: #b7000c;
            border-radius: 4px;
            font-weight: 700;
        }
        @media (min-width: 1024px) {
            .persistent-drawer {
                transform: translateX(0) !important;
            }
            .main-content {
                margin-left: 20rem;
            }
        }
    </style>
</head>
<body class="bg-background text-on-background min-h-screen overflow-x-hidden transition-colors duration-200">
<!-- Navigation Drawer Overlay (Mobile Only) -->
<div class="fixed inset-0 bg-black/50 z-50 hidden transition-opacity duration-300 opacity-0 lg:hidden" id="drawer-overlay" onclick="toggleDrawer()"></div>
<!-- Persistent Navigation Drawer -->
<aside class="fixed left-0 top-0 h-full w-80 bg-surface-container-low dark:bg-slate-900 z-50 transform -translate-x-full lg:translate-x-0 transition-transform duration-300 ease-in-out border-r border-outline-variant/30 flex flex-col persistent-drawer" id="nav-drawer">
<div class="flex items-center justify-between px-6 h-16 border-b border-outline-variant/30 bg-white dark:bg-slate-900">
<h2 class="text-lg font-bold text-hitachi-red font-headline uppercase tracking-wider">Command Center</h2>
<button class="p-2 hover:bg-surface-variant dark:hover:bg-slate-800 rounded-full transition-colors lg:hidden" onclick="toggleDrawer()">
<span class="material-symbols-outlined">close</span>
</button>
</div>
<div class="flex-grow overflow-y-auto p-4 space-y-2">
<nav class="flex flex-col space-y-1">
<a class="flex items-center gap-4 px-4 py-3 text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800 transition-all rounded-sm" href="#">
<span class="material-symbols-outlined">hub</span>
<span class="text-sm">Test Connection</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 nav-item-active" href="#">
<span class="material-symbols-outlined">assignment</span>
<span class="text-sm">Create Test Plan</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800 transition-all rounded-sm" href="#">
<span class="material-symbols-outlined">edit_note</span>
<span class="text-sm">Create Test Cases</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800 transition-all rounded-sm" href="#">
<span class="material-symbols-outlined">schema</span>
<span class="text-sm">Create Test Scenarios</span>
</a>
<a class="flex items-center gap-4 px-4 py-3 text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800 transition-all rounded-sm" href="#">
<span class="material-symbols-outlined">fact_check</span>
<span class="text-sm">Review Test Cases</span>
</a>
</nav>
<div class="my-6 border-t border-outline-variant/30"></div>
<div class="px-4 mb-2">
<h3 class="text-[0.6875rem] font-bold uppercase tracking-widest text-secondary">Settings</h3>
</div>
<nav class="flex flex-col space-y-1">
<a class="flex items-center gap-4 px-4 py-3 text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800 transition-all rounded-sm" href="#">
<span class="material-symbols-outlined">settings</span>
<span class="text-sm">Configuration</span>
</a>
<button class="flex items-center gap-4 px-4 py-3 w-full text-on-surface-variant dark:text-slate-400 font-medium hover:bg-surface-container-high dark:hover:bg-slate-800 transition-all rounded-sm text-left" onclick="document.documentElement.classList.toggle('dark')">
<span class="material-symbols-outlined">dark_mode</span>
<span class="text-sm">Toggle Dark Mode</span>
</button>
</nav>
</div>
<div class="p-4 border-t border-outline-variant/30 bg-surface-container-lowest dark:bg-slate-900">
<div class="flex items-center gap-3">
<div class="w-10 h-10 rounded-full bg-hitachi-red flex items-center justify-center text-white font-bold">JD</div>
<div>
<p class="text-sm font-bold">John Doe</p>
<p class="text-[0.6875rem] text-secondary">QA Lead</p>
</div>
</div>
</div>
</aside>
<!-- TopAppBar -->
<header class="bg-hitachi-red dark:bg-hitachi-dark-red flex items-center w-full px-6 h-16 sticky top-0 z-40 main-content transition-all duration-300">
<div class="flex items-center gap-4">
<button class="p-2 hover:bg-white/10 rounded-full text-white transition-colors lg:hidden" onclick="toggleDrawer()">
<span class="material-symbols-outlined">menu</span>
</button>
<h1 class="text-xl font-bold text-white uppercase tracking-wider font-headline">Hitachi Digital Services</h1>
</div>
</header>
<main class="main-content min-h-screen px-6 pt-12 pb-32 transition-all duration-300">
<div class="max-w-6xl mx-auto">
<!-- Hero Metric & Intro -->
<div class="mb-12">
<span class="font-['Inter'] text-[0.6875rem] font-bold uppercase tracking-widest text-secondary block mb-2">Orchestration Module</span>
<h2 class="text-[2.25rem] font-black leading-tight tracking-tighter text-on-surface mb-4">Test Plan Generator</h2>
<p class="text-secondary max-w-2xl text-[0.875rem]">Transform JIRA user stories into comprehensive, machine-readable markdown test plans with editorial precision and automated edge-case detection.</p>
</div>
<div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
<!-- Left Column: Input & Controls -->
<div class="lg:col-span-4 space-y-6">
<!-- JIRA Input Card -->
<div class="bg-surface-container-lowest p-6 rounded-lg shadow-sm border border-outline-variant/30">
<label class="block text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant mb-3">Target JIRA Ticket ID</label>
<div class="flex gap-2">
<input class="w-full bg-surface-container-highest border-none rounded-sm px-4 py-3 text-[0.875rem] focus:ring-2 focus:ring-hitachi-red transition-all" placeholder="QA-8429" type="text"/>
<button class="bg-surface-container-high text-hitachi-red px-4 py-2 rounded-sm hover:bg-surface-container transition-colors flex items-center justify-center">
<span class="material-symbols-outlined">search</span>
</button>
</div>
</div>
<!-- Primary Actions -->
<div class="space-y-3">
<button class="w-full py-4 bg-hitachi-red hover:bg-hitachi-dark-red text-white rounded-sm font-bold text-[1rem] shadow-md flex items-center justify-center gap-3 active:scale-95 transition-all">
<span class="material-symbols-outlined">bolt</span>
                        Fetch Preview
                    </button>
<button class="w-full py-4 bg-surface-container-high text-on-surface rounded-sm font-bold text-[1rem] flex items-center justify-center gap-3 hover:bg-surface-container transition-colors active:scale-95">
<span class="material-symbols-outlined">description</span>
                        Generate .md Plan
                    </button>
<button class="w-full py-4 bg-surface-container-high text-on-surface rounded-sm font-bold text-[1rem] flex items-center justify-center gap-3 hover:bg-surface-container transition-colors active:scale-95">
<span class="material-symbols-outlined">cloud_upload</span>
                        Push to Confluence
                    </button>
</div>
<!-- Export Options -->
<div class="bg-surface-container-low p-5 rounded-lg border border-outline-variant/30">
<h3 class="text-[0.6875rem] font-bold uppercase tracking-widest text-secondary mb-4">Export Options</h3>
<div class="flex items-center justify-between p-3 bg-surface-container-lowest rounded-sm mb-2 border border-outline-variant/20">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined text-hitachi-red">download</span>
<span class="text-[0.875rem] font-bold">test_plan_v2.md</span>
</div>
<button class="text-hitachi-red text-[0.875rem] font-bold hover:underline">Download</button>
</div>
</div>
</div>
<!-- Right Column: Document Preview -->
<div class="lg:col-span-8">
<div class="bg-surface-container-lowest rounded-lg shadow-sm min-h-[600px] overflow-hidden flex flex-col border border-outline-variant/30">
<!-- Preview Header -->
<div class="px-8 py-6 bg-surface-container-low flex justify-between items-center border-b border-outline-variant/20">
<div class="flex items-center gap-4">
<div class="bg-hitachi-red text-white px-3 py-1 rounded-full text-[0.6875rem] font-bold uppercase tracking-wider">
                                Ticket Parsed
                            </div>
<h3 class="text-[1rem] font-bold">QA-8429: Checkout Logic Overhaul</h3>
</div>
<div class="flex gap-2">
<button class="p-2 hover:bg-surface-variant rounded-full transition-colors">
<span class="material-symbols-outlined text-secondary text-sm">content_copy</span>
</button>
<button class="p-2 hover:bg-surface-variant rounded-full transition-colors">
<span class="material-symbols-outlined text-secondary text-sm">edit</span>
</button>
</div>
</div>
<!-- Markdown Content Canvas -->
<div class="p-10 flex-grow font-mono text-[0.875rem] leading-relaxed text-on-surface-variant bg-surface-container-lowest overflow-y-auto max-h-[700px]">
<div class="space-y-6">
<section>
<h1 class="text-[1.5rem] font-bold text-on-surface font-headline mb-4"># Test Plan: Checkout Logic</h1>
<p class="text-secondary italic mb-4">&gt; Generated by Hitachi Digital Services | 2023-11-24</p>
</section>
<section>
<h2 class="text-[1rem] font-bold text-hitachi-red mb-2 uppercase tracking-wide">## 1. Objectives</h2>
<p>Validate the atomic integrity of the new multi-currency checkout pipeline. Ensure zero-regression on legacy Stripe connectors while enabling the new Adyen flow for EMEA regions.</p>
</section>
<section>
<h2 class="text-[1rem] font-bold text-hitachi-red mb-2 uppercase tracking-wide">## 2. Scope &amp; Boundaries</h2>
<ul class="list-disc pl-5 space-y-2">
<li><span class="font-bold">In-Scope:</span> FX Calculation logic, EMEA region routing, 3DS 2.0 validation.</li>
<li><span class="font-bold">Out-of-Scope:</span> UI/UX styling of the success page, non-EMEA routing logic.</li>
</ul>
</section>
<section>
<h2 class="text-[1rem] font-bold text-hitachi-red mb-2 uppercase tracking-wide">## 3. Test Scenarios</h2>
<div class="bg-surface-container-low p-4 rounded-sm border border-outline-variant/10 space-y-4">
<div>
<p class="font-bold text-on-surface">SC-01: Valid Checkout (EUR)</p>
<p class="text-secondary text-[0.75rem]">Verify that a German user can complete a purchase using EUR with 100% FX accuracy.</p>
</div>
<div class="h-[1px] bg-outline-variant/20"></div>
<div>
<p class="font-bold text-on-surface">SC-02: Boundary Failure (GBP to USD)</p>
<p class="text-secondary text-[0.75rem]">Test logic rejection when a session currency mismatch occurs during the final callback.</p>
</div>
</div>
</section>
<section>
<h2 class="text-[1rem] font-bold text-hitachi-red mb-2 uppercase tracking-wide">## 4. Automated Triggers</h2>
<code class="block bg-on-surface text-surface-container p-4 rounded-sm">
                                    cypress run --spec "cypress/e2e/checkout/emea-routing.cy.js" --env region=EMEA
                                </code>
</section>
</div>
</div>
</div>
</div>
</div>
</div>
</main>
<!-- BottomNavBar (Mobile Only) -->
<nav class="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 py-3 bg-[#004098] dark:bg-[#002d6b] z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.1)] lg:hidden">
<a class="flex flex-col items-center justify-center text-white/70 hover:text-white hover:bg-white/5 transition-all scale-95 active:scale-90" href="#">
<span class="material-symbols-outlined">dashboard</span>
<span class="text-[11px] font-medium tracking-wide mt-1">Dashboard</span>
</a>
<a class="flex flex-col items-center justify-center text-white bg-white/15 rounded-xl px-4 py-1 transition-all scale-95 active:scale-90" href="#">
<span class="material-symbols-outlined">analytics</span>
<span class="text-[11px] font-medium tracking-wide mt-1">Analytics</span>
</a>
<a class="flex flex-col items-center justify-center text-white/70 hover:text-white hover:bg-white/5 transition-all scale-95 active:scale-90" href="#">
<span class="material-symbols-outlined">description</span>
<span class="text-[11px] font-medium tracking-wide mt-1">Reports</span>
</a>
<a class="flex flex-col items-center justify-center text-white/70 hover:text-white hover:bg-white/5 transition-all scale-95 active:scale-90" href="#">
<span class="material-symbols-outlined">help_outline</span>
<span class="text-[11px] font-medium tracking-wide mt-1">Support</span>
</a>
</nav>
<script>
    function toggleDrawer() {
        const drawer = document.getElementById('nav-drawer');
        const overlay = document.getElementById('drawer-overlay');
        const isOpen = !drawer.classList.contains('-translate-x-full');
        
        if (isOpen) {
            drawer.classList.add('-translate-x-full');
            overlay.classList.add('hidden');
            overlay.classList.remove('opacity-100');
            overlay.classList.add('opacity-0');
        } else {
            drawer.classList.remove('-translate-x-full');
            overlay.classList.remove('hidden');
            setTimeout(() => {
                overlay.classList.remove('opacity-0');
                overlay.classList.add('opacity-100');
            }, 10);
        }
    }
</script>
</body></html>