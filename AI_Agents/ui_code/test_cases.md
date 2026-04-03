<!DOCTYPE html>

<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Test Case Generator | Hitachi Digital Services</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "surface-container-high": "#ede6f1",
                        "background": "#fef7ff",
                        "on-error": "#ffffff",
                        "tertiary": "#595a5c",
                        "secondary-fixed-dim": "#b0c6ff",
                        "primary-container": "#e60012",
                        "on-primary-container": "#fff7f6",
                        "secondary-container": "#79a1fe",
                        "tertiary-fixed-dim": "#c6c6c8",
                        "primary": "#b7000c",
                        "on-secondary-fixed-variant": "#04429a",
                        "on-primary-fixed": "#410001",
                        "inverse-surface": "#322f37",
                        "primary-fixed": "#ffdad5",
                        "surface-bright": "#fef7ff",
                        "secondary-fixed": "#d9e2ff",
                        "tertiary-fixed": "#e3e2e4",
                        "on-surface": "#1d1a22",
                        "on-tertiary-fixed": "#1a1c1d",
                        "on-error-container": "#93000a",
                        "primary-fixed-dim": "#ffb4aa",
                        "inverse-primary": "#ffb4aa",
                        "tertiary-container": "#717274",
                        "on-primary": "#ffffff",
                        "on-surface-variant": "#5f3f3b",
                        "on-primary-fixed-variant": "#930007",
                        "surface-container": "#f3ebf7",
                        "error": "#ba1a1a",
                        "on-secondary-container": "#003581",
                        "surface": "#fef7ff",
                        "on-tertiary-fixed-variant": "#464749",
                        "outline-variant": "#e9bcb6",
                        "outline": "#946e69",
                        "surface-container-low": "#f9f1fd",
                        "secondary": "#2d5bb3",
                        "on-tertiary": "#ffffff",
                        "inverse-on-surface": "#f6eefa",
                        "surface-tint": "#c0000d",
                        "on-secondary-fixed": "#001945",
                        "surface-container-highest": "#e7e0eb",
                        "surface-variant": "#e7e0eb",
                        "surface-container-lowest": "#ffffff",
                        "error-container": "#ffdad6",
                        "surface-dim": "#dfd7e3",
                        "on-background": "#1d1a22",
                        "on-tertiary-container": "#f9f8fa",
                        "on-secondary": "#ffffff"
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
        }
        .glass-panel {
            background: rgba(254, 247, 255, 0.8);
            backdrop-filter: blur(12px);
        }
        body { font-family: 'Inter', sans-serif; }
        
        /* Custom scrollbar for preview area */
        .preview-scroll::-webkit-scrollbar {
            width: 6px;
        }
        .preview-scroll::-webkit-scrollbar-track {
            background: #f1f1f1;
            border-radius: 10px;
        }
        .preview-scroll::-webkit-scrollbar-thumb {
            background: #ccc;
            border-radius: 10px;
        }
        .preview-scroll::-webkit-scrollbar-thumb:hover {
            background: #b7000c;
        }
    </style>
</head>
<body class="bg-surface text-on-surface selection:bg-primary-fixed selection:text-primary min-h-screen flex flex-col">
<!-- TopAppBar -->
<header class="flex justify-between items-center px-6 h-16 w-full z-50 fixed top-0 bg-[#b7000c] dark:bg-[#8b000a] text-white">
<div class="flex items-center gap-4">
<span class="text-xl font-black text-white font-['Inter'] font-bold tracking-tight">Hitachi Digital Services</span>
</div>
<div class="flex items-center gap-6">
<div class="hidden md:flex items-center gap-8">
<a class="text-white font-bold border-b-2 border-white font-['Inter'] tracking-tight hover:bg-white/10 transition-colors py-1 px-2" href="#">Dashboard</a>
<a class="text-white/80 font-medium font-['Inter'] tracking-tight hover:bg-white/10 transition-colors py-1 px-2" href="#">Projects</a>
<a class="text-white/80 font-medium font-['Inter'] tracking-tight hover:bg-white/10 transition-colors py-1 px-2" href="#">Analytics</a>
</div>
<div class="flex items-center gap-4">
<button class="material-symbols-outlined hover:bg-white/10 transition-colors p-2 rounded-full">notifications</button>
<button class="material-symbols-outlined hover:bg-white/10 transition-colors p-2 rounded-full">help</button>
<button class="material-symbols-outlined hover:bg-white/10 transition-colors p-2 rounded-full">account_circle</button>
</div>
</div>
</header>
<div class="flex flex-1 pt-16">
<!-- SideNavBar -->
<aside class="fixed left-0 top-16 h-[calc(100vh-64px)] flex flex-col py-4 bg-[#f9f1fd] dark:bg-slate-900 w-64 z-40 transition-all ease-in-out duration-200">
<div class="px-6 mb-8 flex items-center gap-3">
<div class="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white shadow-lg">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">architecture</span>
</div>
<div>
<h2 class="text-[#b7000c] font-bold font-['Inter'] text-sm">Test Agent</h2>
<p class="text-xs text-slate-500 font-['Inter']">Digital Architect</p>
</div>
</div>
<nav class="flex-1 space-y-1 overflow-y-auto">
<a class="flex items-center gap-3 px-6 py-3 text-slate-600 dark:text-slate-400 hover:text-[#b7000c] hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all font-['Inter'] text-sm font-medium" href="#">
<span class="material-symbols-outlined">lan</span>
<span>Test Connection</span>
</a>
<a class="flex items-center gap-3 px-6 py-3 text-slate-600 dark:text-slate-400 hover:text-[#b7000c] hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all font-['Inter'] text-sm font-medium" href="#">
<span class="material-symbols-outlined">assignment</span>
<span>Create Test Plan</span>
</a>
<a class="flex items-center gap-3 px-6 py-3 text-[#b7000c] dark:text-red-400 bg-[#ffdad5] dark:bg-red-900/30 rounded-r-full font-bold border-l-4 border-[#b7000c] transition-all font-['Inter'] text-sm" href="#">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">edit_note</span>
<span>Create Test Cases</span>
</a>
<a class="flex items-center gap-3 px-6 py-3 text-slate-600 dark:text-slate-400 hover:text-[#b7000c] hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all font-['Inter'] text-sm font-medium" href="#">
<span class="material-symbols-outlined">schema</span>
<span>Create Test Scenarios</span>
</a>
<a class="flex items-center gap-3 px-6 py-3 text-slate-600 dark:text-slate-400 hover:text-[#b7000c] hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all font-['Inter'] text-sm font-medium" href="#">
<span class="material-symbols-outlined">fact_check</span>
<span>Review Test Cases</span>
</a>
<a class="flex items-center gap-3 px-6 py-3 text-slate-600 dark:text-slate-400 hover:text-[#b7000c] hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all font-['Inter'] text-sm font-medium" href="#">
<span class="material-symbols-outlined">rocket_launch</span>
<span>Push to Zephyr</span>
</a>
<a class="flex items-center gap-3 px-6 py-3 text-slate-600 dark:text-slate-400 hover:text-[#b7000c] hover:bg-[#e7e0eb] dark:hover:bg-slate-800 transition-all font-['Inter'] text-sm font-medium" href="#">
<span class="material-symbols-outlined">auto_fix_high</span>
<span>Automation Hub</span>
</a>
</nav>
<div class="mt-auto px-6 space-y-1 border-t border-outline-variant/15 pt-4">
<a class="flex items-center gap-3 py-3 text-slate-600 dark:text-slate-400 hover:text-[#b7000c] hover:bg-[#e7e0eb] transition-all font-['Inter'] text-sm font-medium" href="#">
<span class="material-symbols-outlined">settings</span>
<span>Settings</span>
</a>
<a class="flex items-center gap-3 py-3 text-slate-600 dark:text-slate-400 hover:text-[#b7000c] hover:bg-[#e7e0eb] transition-all font-['Inter'] text-sm font-medium" href="#">
<span class="material-symbols-outlined">dark_mode</span>
<span>Dark Mode</span>
</a>
</div>
</aside>
<!-- Main Content Area -->
<main class="ml-64 flex-1 bg-surface p-8 lg:p-12 overflow-y-auto min-h-screen">
<!-- Header Section -->
<header class="mb-8 max-w-7xl">
<span class="text-secondary font-bold text-xs tracking-widest uppercase mb-2 block font-label">Quality Assurance Automation</span>
<h1 class="text-4xl lg:text-5xl font-black text-primary-container tracking-tighter mb-4 leading-tight font-headline">Test Case Architect</h1>
<p class="text-on-surface-variant text-lg max-w-3xl font-body leading-relaxed">
                    Generate detailed, structured test cases from JIRA tickets or manual requirements using a powerful anti-hallucination prompt and context-aware generation.
                </p>
</header>
<!-- Main Workspace -->
<div class="max-w-7xl space-y-6">
<div class="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
<!-- Requirement Intake (Requirement Source) -->
<section class="bg-white rounded-xl border border-outline-variant/20 shadow-sm flex flex-col overflow-hidden">
<div class="p-4 border-b border-outline-variant/10 bg-surface-container-low flex items-center gap-2">
<span class="material-symbols-outlined text-primary text-xl">assignment_late</span>
<h3 class="font-bold text-on-surface font-headline text-sm">Requirement Source</h3>
</div>
<div class="p-6 space-y-4 flex-grow">
<div>
<label class="block text-[10px] font-bold text-secondary uppercase tracking-wider mb-2 font-label">JIRA Ticket ID</label>
<div class="flex gap-2">
<input class="flex-1 bg-white border border-outline-variant rounded px-3 py-2 outline-none focus:border-primary transition-all font-body text-sm" placeholder="e.g. atp-1" type="text"/>
<button class="bg-primary text-white p-2 rounded flex items-center justify-center hover:bg-primary-container transition-colors">
<span class="material-symbols-outlined text-lg">search</span>
</button>
<button class="border border-outline-variant text-on-surface-variant p-2 rounded flex items-center justify-center hover:bg-surface-container-highest transition-colors">
<span class="material-symbols-outlined text-lg">close</span>
</button>
</div>
<div class="mt-2 bg-green-50 border border-green-200 rounded px-3 py-2 flex justify-between items-center">
<div class="flex items-center gap-2 text-green-700 text-xs font-medium">
<span class="material-symbols-outlined text-sm">check_circle</span>
<span>ATP-1: E-Commerce - Seamless Checkout Experience</span>
</div>
<span class="material-symbols-outlined text-green-600 text-sm cursor-pointer">close</span>
</div>
</div>
<div class="relative py-2 flex items-center">
<div class="flex-grow border-t border-outline-variant/20"></div>
<span class="flex-shrink mx-4 text-[10px] font-bold text-slate-400 uppercase">OR PASTE BELOW</span>
<div class="flex-grow border-t border-outline-variant/20"></div>
</div>
<div>
<label class="block text-[10px] font-bold text-secondary uppercase tracking-wider mb-2 font-label">Manual Requirement / PRD</label>
<textarea class="w-full h-32 bg-white border border-outline-variant rounded p-3 outline-none focus:border-primary transition-all font-body text-sm resize-none" placeholder="Paste requirement text, user stories, acceptance criteria..."></textarea>
</div>
<div class="bg-[#f0f4ff] border border-blue-100 rounded-lg p-4">
<div class="flex justify-between items-center mb-2">
<div class="flex items-center gap-2 text-secondary font-bold text-xs uppercase tracking-tight">
<span class="material-symbols-outlined text-sm">tune</span>
<span>Generation Instructions</span>
</div>
<button class="text-[10px] font-bold text-primary hover:underline uppercase">Overrides default behavior</button>
</div>
<textarea class="w-full h-24 bg-white border border-outline-variant/50 rounded p-2 outline-none focus:border-primary transition-all font-body text-xs resize-none" placeholder="e.g. Generate only Functional test cases, focus on Negative scenarios..."></textarea>
<div class="mt-2 flex items-start gap-2">
<span class="material-symbols-outlined text-[#b7000c] text-sm">lightbulb</span>
<p class="text-[10px] text-on-surface-variant italic">Control what gets generated: specify test case types (Functional, UI, Negative, Boundary, Security), count limits, or focus areas. Leave empty for full coverage.</p>
</div>
</div>
</div>
</section>
<!-- Requirement Preview (Fixed height matching intake, scrolling enabled) -->
<section class="bg-white rounded-xl border border-outline-variant/20 shadow-sm flex flex-col h-full overflow-hidden">
<div class="p-4 border-b border-outline-variant/10 bg-surface-container-low flex justify-between items-center">
<div class="flex items-center gap-2">
<span class="material-symbols-outlined text-primary text-xl">preview</span>
<h3 class="font-bold text-on-surface font-headline text-sm">Requirement Preview</h3>
</div>
<button class="text-[10px] font-bold text-slate-500 flex items-center gap-1 hover:text-primary transition-colors">
<span class="material-symbols-outlined text-sm">clear_all</span>
<span>Clear</span>
</button>
</div>
<!-- Fixed Height Scrollable Container -->
<div class="preview-scroll overflow-y-auto flex-grow p-6 h-[500px]">
<div class="space-y-6">
<div class="flex items-center gap-3">
<span class="bg-primary text-white text-[10px] font-black px-2 py-1 rounded">ATP-1</span>
<h2 class="font-bold text-on-surface text-lg">E-Commerce - Seamless Checkout Experience</h2>
</div>
<p class="text-xs text-slate-500 font-medium -mt-4">AI Testing Project â€” To Do</p>
<div class="bg-surface-container-highest/30 rounded-lg p-5 font-body text-sm text-on-surface leading-relaxed">
<p class="mb-1"><span class="font-bold">Title:</span> Seamless Checkout Experience</p>
<p class="mb-1"><span class="font-bold">Type:</span> Story</p>
<p class="mb-1"><span class="font-bold">Priority:</span> High</p>
<p class="mb-4"><span class="font-bold">Status:</span> Open</p>
<h4 class="font-bold flex items-center gap-2 mb-2">
<span class="material-symbols-outlined text-sm">person</span>
                                        Description
                                    </h4>
<p class="mb-4 text-on-surface-variant">
                                        As a registered or guest user,<br/>
                                        I want to place an order from my cart<br/>
                                        So that I can purchase products easily.
                                    </p>
<h4 class="font-bold flex items-center gap-2 mb-2">
<span class="material-symbols-outlined text-sm text-green-600">task_alt</span>
                                        Acceptance Criteria
                                    </h4>
<div class="space-y-4 text-on-surface-variant">
<div>
<p class="font-bold text-xs uppercase mb-1">ðŸ›’ Cart</p>
<ul class="list-disc pl-5 space-y-1">
<li>User can view added products in cart</li>
<li>User can update quantity (min: 1, max: 10)</li>
<li>User can remove items</li>
<li>Cart total updates dynamically</li>
</ul>
</div>
<div>
<p class="font-bold text-xs uppercase mb-1">ðŸŽŸï¸ Coupon</p>
<ul class="list-disc pl-5 space-y-1">
<li>Valid coupon applies discount</li>
<li>Invalid coupon shows error</li>
<li>Expired coupon is rejected</li>
<li>Coupon cannot be applied twice</li>
</ul>
</div>
<div>
<p class="font-bold text-xs uppercase mb-1">ðŸ’³ Payment</p>
<ul class="list-disc pl-5 space-y-1">
<li>Supports Credit Card, PayPal, and Apple Pay</li>
<li>CVV validation required for cards</li>
<li>Redirect to secure payment gateway for third-party options</li>
</ul>
</div>
</div>
</div>
</div>
</div>
</section>
</div>
<!-- Primary Action Buttons -->
<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
<button class="w-full py-4 bg-primary text-white font-bold rounded-lg flex items-center justify-center gap-3 shadow-lg hover:bg-primary-container transition-all active:scale-[0.98]">
<span class="material-symbols-outlined">troubleshoot</span>
                        Analyze Gaps First
                    </button>
<button class="w-full py-4 border-2 border-primary text-primary font-bold rounded-lg flex items-center justify-center gap-3 hover:bg-primary/5 transition-all active:scale-[0.98]">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">bolt</span>
                        Generate Directly
                    </button>
</div>
<!-- Footer / Trust Banner -->
<div class="bg-[#f8f9ff] border border-blue-100 rounded-xl p-4 flex items-center gap-4">
<div class="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-secondary">
<span class="material-symbols-outlined">verified_user</span>
</div>
<div class="flex-1">
<p class="text-sm font-medium text-on-surface">
<span class="font-bold text-secondary">Quality Assurance Shield</span> â€” Grounded in verified facts only. Incomplete details are explicitly flagged. Structured test coverage methodology applied.
                        </p>
</div>
</div>
</div>
<!-- Preview Area (Secondary generation results) -->
<section class="mt-12 max-w-7xl">
<div class="bg-white rounded-xl border border-outline-variant/15 overflow-hidden shadow-sm">
<div class="p-6 bg-surface-container-low flex justify-between items-center">
<div class="flex items-center gap-4">
<span class="material-symbols-outlined text-primary">visibility</span>
<h3 class="font-bold text-on-surface">Live Generation Preview</h3>
</div>
<div class="flex gap-2">
<span class="px-3 py-1 bg-surface-container-highest text-secondary text-xs font-bold rounded-full">3 Cases Found</span>
<span class="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full">Ready to Export</span>
</div>
</div>
<div class="divide-y divide-outline-variant/10">
<!-- Case Item -->
<div class="p-6 hover:bg-surface-container-lowest transition-colors flex gap-6">
<div class="w-12 h-12 rounded-lg bg-surface-container-highest flex-shrink-0 flex items-center justify-center font-black text-primary">01</div>
<div class="flex-1">
<h4 class="font-bold text-on-surface mb-2">TC_LOGIN_VAL_001: Validate User Authentication with Multi-Factor</h4>
<p class="text-sm text-on-surface-variant mb-4 font-body">As a secure user, I want to ensure that MFA triggers only after primary credentials are verified.</p>
<div class="flex gap-4">
<span class="text-[10px] font-bold text-secondary uppercase tracking-wider">Priority: High</span>
<span class="text-[10px] font-bold text-secondary uppercase tracking-wider">Component: Auth-Gate</span>
</div>
</div>
<button class="text-primary hover:bg-primary/5 p-2 rounded-full h-fit self-center">
<span class="material-symbols-outlined">edit</span>
</button>
</div>
<!-- Case Item -->
<div class="p-6 hover:bg-surface-container-lowest transition-colors flex gap-6">
<div class="w-12 h-12 rounded-lg bg-surface-container-highest flex-shrink-0 flex items-center justify-center font-black text-primary">02</div>
<div class="flex-1">
<h4 class="font-bold text-on-surface mb-2">TC_UI_LAYOUT_004: Responsive Grid Behavior on Mobile Viewport</h4>
<p class="text-sm text-on-surface-variant mb-4 font-body">Verify that the bento-grid components collapse into a single column at the 768px breakpoint.</p>
<div class="flex gap-4">
<span class="text-[10px] font-bold text-secondary uppercase tracking-wider">Priority: Medium</span>
<span class="text-[10px] font-bold text-secondary uppercase tracking-wider">Component: UI-Core</span>
</div>
</div>
<button class="text-primary hover:bg-primary/5 p-2 rounded-full h-fit self-center">
<span class="material-symbols-outlined">edit</span>
</button>
</div>
</div>
<div class="p-4 bg-surface-container-lowest text-center">
<button class="text-secondary font-bold text-sm hover:underline">View All Generated Cases</button>
</div>
</div>
</section>
</main>
</div>
<!-- Background Pattern -->
<div class="fixed inset-0 pointer-events-none z-[-1] opacity-40">
<div class="absolute top-0 right-0 w-[800px] h-[800px] bg-gradient-to-bl from-primary/5 to-transparent rounded-full blur-[120px] -mr-96 -mt-96"></div>
<div class="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-secondary/5 to-transparent rounded-full blur-[100px] -ml-64 -mb-64"></div>
</div>
</body></html>
