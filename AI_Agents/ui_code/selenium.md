<!DOCTYPE html>

<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Hitachi Intelligent Test Agent - Selenium BDD Generator</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        .glass-panel {
            background: rgba(254, 247, 255, 0.8);
            backdrop-filter: blur(12px);
        }
        body {
            font-family: 'Inter', sans-serif;
            background-color: #fef7ff;
        }
        pre {
            font-family: 'ui-monospace', 'SFMono-Regular', Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }
        details summary::-webkit-details-marker {
            display: none;
        }
        .syntax-keyword { color: #b7000c; font-weight: 700; }
        .syntax-string { color: #2d5bb3; }
        .syntax-comment { color: #717274; font-style: italic; }
    </style>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "tertiary-container": "#717274",
              "surface-bright": "#fef7ff",
              "surface": "#fef7ff",
              "on-primary-container": "#fff7f6",
              "on-secondary-fixed-variant": "#04429a",
              "on-surface-variant": "#5f3f3b",
              "inverse-primary": "#ffb4aa",
              "surface-container-highest": "#e7e0eb",
              "secondary": "#2d5bb3",
              "secondary-fixed-dim": "#b0c6ff",
              "on-error": "#ffffff",
              "error-container": "#ffdad6",
              "secondary-fixed": "#d9e2ff",
              "secondary-container": "#79a1fe",
              "tertiary-fixed-dim": "#c6c6c8",
              "surface-tint": "#c0000d",
              "surface-container-lowest": "#ffffff",
              "inverse-on-surface": "#f6eefa",
              "on-tertiary-container": "#f9f8fa",
              "surface-dim": "#dfd7e3",
              "on-tertiary": "#ffffff",
              "inverse-surface": "#322f37",
              "primary": "#b7000c",
              "on-secondary": "#ffffff",
              "on-primary": "#ffffff",
              "on-background": "#1d1a22",
              "tertiary": "#595a5c",
              "surface-container-high": "#ede6f1",
              "on-surface": "#1d1a22",
              "surface-container": "#f3ebf7",
              "on-secondary-fixed": "#001945",
              "surface-variant": "#e7e0eb",
              "on-tertiary-fixed-variant": "#464749",
              "background": "#fef7ff",
              "on-secondary-container": "#003581",
              "on-primary-fixed": "#410001",
              "tertiary-fixed": "#e3e2e4",
              "surface-container-low": "#f9f1fd",
              "on-error-container": "#93000a",
              "on-primary-fixed-variant": "#930007",
              "error": "#ba1a1a",
              "primary-fixed": "#ffdad5",
              "primary-container": "#e60012",
              "outline-variant": "#e9bcb6",
              "on-tertiary-fixed": "#1a1c1d",
              "primary-fixed-dim": "#ffb4aa",
              "outline": "#946e69"
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
</head>
<body class="flex flex-col h-screen overflow-hidden text-on-surface">
<!-- TopAppBar (from COMPONENTS_26) -->
<header class="bg-[#b7000c] dark:bg-[#800006] text-white font-bold tracking-tight shadow-md flex justify-between items-center w-full px-6 h-16 z-50 fixed top-0">
<div class="text-xl font-black text-white">Hitachi Digital Architect</div>
<div class="flex items-center gap-4">
<div class="hidden md:flex items-center bg-white/10 rounded-full px-4 py-1.5 transition-colors hover:bg-white/20">
<span class="material-symbols-outlined text-sm mr-2" data-icon="search">search</span>
<input class="bg-transparent border-none focus:ring-0 text-sm placeholder-white/70 w-48" placeholder="Global Search" type="text"/>
</div>
<div class="flex gap-2">
<button class="p-2 hover:bg-white/10 transition-colors rounded-full duration-200 scale-95">
<span class="material-symbols-outlined" data-icon="notifications">notifications</span>
</button>
<button class="p-2 hover:bg-white/10 transition-colors rounded-full duration-200 scale-95">
<span class="material-symbols-outlined" data-icon="help">help</span>
</button>
<button class="p-2 hover:bg-white/10 transition-colors rounded-full duration-200 scale-95">
<span class="material-symbols-outlined" data-icon="account_circle">account_circle</span>
</button>
</div>
<div class="h-8 w-8 rounded-full bg-surface-container-highest border border-white/20 overflow-hidden">
<img alt="User Profile" class="h-full w-full object-cover" data-alt="Professional headshot of a software architect in a modern office setting, corporate aesthetic" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAJMnClBTfcYkSvLv7EO3XLQujSGT0Uh1-QDcHOOcQpP6hnLpTYGtiaw-zzj1CHt-alabQ92ovtQ5Ud7vLzBsDprcke_2icvmawIlOgdVdZTMu87WCyhQt0rcsRiPjNgHqUBpACVWRDtK8zr29dTXxw0FsA85MC84zLVRCErpLRkPp2ieHsQMlS699RTfCsk83VJO-mIAzlUfdPvvIi9z8825-XQKRQisNFgqVfrnrhSnd2a1EGqCWTKKYNx2Uz1Clx5jIqIgoL_d-Q"/>
</div>
</div>
</header>
<div class="flex flex-1 overflow-hidden mt-16">
<!-- SideNavBar (from COMPONENTS_26) -->
<aside class="bg-[#f9f1fd] dark:bg-[#1d1a22] fixed left-0 top-16 h-[calc(100vh-64px)] w-72 flex flex-col pt-8 pb-4 border-r-0 z-10 ease-in-out duration-200">
<div class="px-6 mb-6">
<h2 class="text-[#b7000c] dark:text-[#e60012] font-bold text-lg tracking-tight">Command Center</h2>
<p class="text-xs text-on-surface-variant font-medium uppercase tracking-widest">Testing Operations</p>
</div>
<nav class="flex-1 overflow-y-auto font-['Inter'] text-sm font-medium">
<a class="flex items-center gap-3 text-[#1d1a22] dark:text-[#e7e0eb] px-6 py-2.5 mb-1 hover:bg-[#e7e0eb] dark:hover:bg-[#2d5bb3]/10 transition-all" href="#">
<span class="material-symbols-outlined" data-icon="cable">cable</span>
                    Test Connection
                </a>
<a class="flex items-center gap-3 text-[#1d1a22] dark:text-[#e7e0eb] px-6 py-2.5 mb-1 hover:bg-[#e7e0eb] dark:hover:bg-[#2d5bb3]/10 transition-all" href="#">
<span class="material-symbols-outlined" data-icon="assignment">assignment</span>
                    Create Test Plan
                </a>
<a class="flex items-center gap-3 text-[#1d1a22] dark:text-[#e7e0eb] px-6 py-2.5 mb-1 hover:bg-[#e7e0eb] dark:hover:bg-[#2d5bb3]/10 transition-all" href="#">
<span class="material-symbols-outlined" data-icon="edit_note">edit_note</span>
                    Create Test Cases
                </a>
<a class="flex items-center gap-3 text-[#1d1a22] dark:text-[#e7e0eb] px-6 py-2.5 mb-1 hover:bg-[#e7e0eb] dark:hover:bg-[#2d5bb3]/10 transition-all" href="#">
<span class="material-symbols-outlined" data-icon="schema">schema</span>
                    Create Test Scenarios
                </a>
<a class="flex items-center gap-3 text-[#1d1a22] dark:text-[#e7e0eb] px-6 py-2.5 mb-1 hover:bg-[#e7e0eb] dark:hover:bg-[#2d5bb3]/10 transition-all" href="#">
<span class="material-symbols-outlined" data-icon="fact_check">fact_check</span>
                    Review Test Cases
                </a>
<a class="flex items-center gap-3 text-[#1d1a22] dark:text-[#e7e0eb] px-6 py-2.5 mb-1 hover:bg-[#e7e0eb] dark:hover:bg-[#2d5bb3]/10 transition-all" href="#">
<span class="material-symbols-outlined" data-icon="dashboard">dashboard</span>
                    Zephyr Dashboard
                </a>
<!-- Collapsible Automation Menu -->
<details class="group" open="">
<summary class="flex items-center justify-between gap-3 text-[#1d1a22] dark:text-[#e7e0eb] px-6 py-2.5 mb-1 hover:bg-[#e7e0eb] dark:hover:bg-[#2d5bb3]/10 transition-all cursor-pointer list-none">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined" data-icon="settings_suggest">settings_suggest</span>
                        Automation
                    </div>
<span class="material-symbols-outlined text-sm transition-transform duration-200 group-open:rotate-180">expand_more</span>
</summary>
<div class="pl-6 space-y-1">
<a class="flex items-center gap-3 text-[#b7000c] dark:text-[#ffdad5] bg-[#ffdad5]/50 dark:bg-[#b7000c]/20 border-l-4 border-[#b7000c] px-6 py-2.5 transition-all" href="#">
<span class="material-symbols-outlined" data-icon="terminal">terminal</span>
                        Selenium BDD
                    </a>
<a class="flex items-center gap-3 text-[#1d1a22] dark:text-[#e7e0eb] px-6 py-2.5 hover:bg-[#e7e0eb] dark:hover:bg-[#2d5bb3]/10 transition-all" href="#">
<span class="material-symbols-outlined" data-icon="javascript">javascript</span>
                        Playwright JS
                    </a>
</div>
</details>
</nav>
<div class="mt-auto border-t border-surface-container-highest/30 pt-4 px-2">
<a class="flex items-center gap-3 text-[#1d1a22] dark:text-[#e7e0eb] px-6 py-2.5 hover:bg-[#e7e0eb] transition-all" href="#">
<span class="material-symbols-outlined" data-icon="settings">settings</span>
                Settings
            </a>
<a class="flex items-center gap-3 text-[#1d1a22] dark:text-[#e7e0eb] px-6 py-2.5 hover:bg-[#e7e0eb] transition-all" href="#">
<span class="material-symbols-outlined" data-icon="dark_mode">dark_mode</span>
                Dark Mode
            </a>
<a class="flex items-center gap-3 text-[#1d1a22] dark:text-[#e7e0eb] px-6 py-2.5 hover:bg-[#e7e0eb] transition-all" href="#">
<span class="material-symbols-outlined" data-icon="logout">logout</span>
                Logout
            </a>
<button class="w-full mt-4 flex items-center justify-center gap-2 bg-[#b7000c] text-white py-3 rounded-lg font-bold shadow-md hover:bg-[#e60012] transition-all">
<span class="material-symbols-outlined">add</span>
<span>New Project</span>
</button>
</div>
</aside>
<!-- Main Content Area -->
<main class="flex-1 overflow-y-auto bg-surface p-8 ml-72">
<div class="max-w-6xl mx-auto space-y-8">
<!-- Header Section -->
<header class="space-y-2">
<div class="flex items-center gap-2 text-secondary font-semibold text-sm uppercase tracking-wider">
<span class="material-symbols-outlined text-sm" data-icon="auto_awesome">auto_awesome</span>
                        AI-POWERED ARCHITECT
                    </div>
<h1 class="text-4xl font-black text-[#b7000c] tracking-tight">Selenium BDD Generator</h1>
<p class="text-on-surface-variant max-w-2xl font-medium leading-relaxed">
                        Accelerate your quality engineering workflow by automatically generating Gherkin feature files from JIRA requirements or manual input.
                    </p>
</header>
<div class="grid grid-cols-12 gap-8">
<!-- Left Column: Inputs -->
<div class="col-span-12 lg:col-span-7 space-y-6">
<!-- Select Previous Test Cases (New Section) -->
<section class="bg-surface-container-low rounded-xl p-6 border border-transparent shadow-sm">
<h3 class="text-on-surface font-bold mb-4 flex items-center gap-2">
<span class="material-symbols-outlined text-secondary">history</span>
                                Select Imported Test Cases
                            </h3>
<div class="relative">
<select class="w-full bg-surface-container-highest border-b-2 border-primary focus:ring-0 focus:border-primary-container px-4 py-3 rounded-t-md text-on-surface font-medium appearance-none">
<option disabled="" selected="">Choose a previously imported test case...</option>
<option>TC-402: User Authentication Flow</option>
<option>TC-405: Inventory Search &amp; Filter</option>
<option>TC-412: Shopping Cart Checkout</option>
<option>TC-551: Profile Settings Update</option>
</select>
<div class="absolute inset-y-0 right-4 flex items-center pointer-events-none">
<span class="material-symbols-outlined text-on-surface-variant">expand_more</span>
</div>
<label class="absolute -top-2 left-2 px-1 bg-surface-container-low text-[10px] uppercase tracking-widest text-primary font-bold">Existing Test Cases</label>
</div>
</section>
<!-- JIRA Integration Card -->
<section class="bg-surface-container-low p-6 rounded-xl border border-transparent shadow-sm">
<h3 class="text-on-surface font-bold mb-4 flex items-center gap-2">
<span class="material-symbols-outlined text-secondary">confirmation_number</span>
                                Import from JIRA
                            </h3>
<div class="flex gap-3">
<div class="relative flex-1">
<input class="w-full bg-surface-container-highest border-b-2 border-primary focus:ring-0 focus:border-primary-container px-4 py-3 rounded-t-md text-on-surface font-medium placeholder-on-surface-variant/50" placeholder="e.g. QA-1234" type="text"/>
<label class="absolute -top-2 left-2 px-1 bg-surface-container-low text-[10px] uppercase tracking-widest text-primary font-bold">JIRA Ticket ID</label>
</div>
<button class="bg-secondary text-white px-6 py-3 rounded-lg font-bold hover:bg-on-secondary-fixed-variant transition-all flex items-center gap-2 shadow-sm">
<span class="material-symbols-outlined text-sm">download</span>
                                    Fetch &amp; Parse
                                </button>
</div>
</section>
<!-- Manual Input Card -->
<section class="bg-surface-container-low p-6 rounded-xl border border-transparent shadow-sm">
<h3 class="text-on-surface font-bold mb-4 flex items-center gap-2">
<span class="material-symbols-outlined text-secondary">description</span>
                                Manual Requirement Text
                            </h3>
<div class="relative">
<textarea class="w-full bg-surface-container-highest border-b-2 border-primary focus:ring-0 focus:border-primary-container px-4 py-3 rounded-t-md text-on-surface font-medium placeholder-on-surface-variant/50 resize-none" placeholder="Enter feature requirements, user stories, or acceptance criteria here..." rows="8"></textarea>
<label class="absolute -top-2 left-2 px-1 bg-surface-container-low text-[10px] uppercase tracking-widest text-primary font-bold">Requirement Specification</label>
</div>
</section>
<div class="pt-4">
<button class="w-full bg-gradient-to-r from-primary to-primary-container text-white py-4 rounded-xl font-black text-lg shadow-lg hover:shadow-primary/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3">
<span class="material-symbols-outlined">auto_awesome</span>
                                Generate Gherkin Feature File
                            </button>
</div>
</div>
<!-- Right Column: Preview -->
<div class="col-span-12 lg:col-span-5">
<div class="sticky top-24 bg-surface-container-lowest border border-outline-variant/10 rounded-xl shadow-xl overflow-hidden flex flex-col h-[calc(100vh-250px)]">
<div class="bg-surface-container-highest px-4 py-3 flex justify-between items-center border-b border-outline-variant/20">
<div class="flex items-center gap-2">
<div class="flex gap-1.5 mr-4">
<div class="w-3 h-3 rounded-full bg-red-400"></div>
<div class="w-3 h-3 rounded-full bg-yellow-400"></div>
<div class="w-3 h-3 rounded-full bg-green-400"></div>
</div>
<span class="text-xs font-bold text-tertiary-container uppercase tracking-widest">Gherkin Preview</span>
</div>
<button class="text-secondary hover:text-primary transition-colors">
<span class="material-symbols-outlined text-lg">content_copy</span>
</button>
</div>
<div class="flex-1 p-6 overflow-auto bg-[#fafafa]">
<pre class="font-mono text-sm leading-relaxed text-on-surface-variant"><code><span class="syntax-keyword">Feature:</span> User Authentication
  As a registered user
  I want to access my dashboard
  So that I can manage my test projects

  <span class="syntax-comment"># @TC-101 Primary Login Path</span>
  <span class="syntax-keyword">Scenario:</span> Successful login with valid credentials
    <span class="syntax-keyword">Given</span> I am on the <span class="syntax-string">"Login"</span> page
    <span class="syntax-keyword">When</span> I enter <span class="syntax-string">"standard_user"</span> in the username field
    <span class="syntax-keyword">And</span> I enter <span class="syntax-string">"secret_sauce"</span> in the password field
    <span class="syntax-keyword">And</span> I click the <span class="syntax-string">"Login"</span> button
    <span class="syntax-keyword">Then</span> I should be redirected to the <span class="syntax-string">"Dashboard"</span>
    <span class="syntax-keyword">And</span> the header should display <span class="syntax-string">"Welcome, Test Agent"</span>

  <span class="syntax-keyword">Scenario Outline:</span> Failed login attempts
    <span class="syntax-keyword">Given</span> I am on the <span class="syntax-string">"Login"</span> page
    <span class="syntax-keyword">When</span> I enter <span class="syntax-string">"&lt;username&gt;"</span> and <span class="syntax-string">"&lt;password&gt;"</span>
    <span class="syntax-keyword">Then</span> I should see an error message <span class="syntax-string">"&lt;error&gt;"</span>

    <span class="syntax-keyword">Examples:</span>
      | username | password | error |
      | locked_out | secret_sauce | User is locked out |
      | invalid_user | wrong_pass | Invalid credentials |</code></pre>
</div>
<div class="bg-surface-container-high p-4 flex justify-between items-center">
<span class="text-[10px] text-tertiary font-bold uppercase tracking-widest">v2.4 Engine Active</span>
<div class="flex gap-2">
<button class="px-3 py-1.5 bg-surface-container-lowest text-on-surface border border-outline-variant/30 rounded text-xs font-bold hover:bg-surface-variant transition-colors">
                                        Download .feature
                                    </button>
<button class="px-3 py-1.5 bg-secondary text-white rounded text-xs font-bold hover:bg-on-secondary-container transition-colors">
                                        Export to Selenium
                                    </button>
</div>
</div>
</div>
</div>
</div>
<!-- Footer / Status Bar -->
<footer class="mt-12 py-8 border-t border-outline-variant/20 flex flex-col md:flex-row justify-between items-center text-sm">
<div class="flex items-center gap-6 mb-4 md:mb-0">
<div class="flex items-center gap-2">
<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
<span class="text-tertiary font-medium">JIRA API Connected</span>
</div>
<div class="flex items-center gap-2">
<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
<span class="text-tertiary font-medium">Automation Engine Ready</span>
</div>
</div>
<div class="flex items-center gap-4 text-secondary font-bold">
<a class="hover:underline" href="#">Documentation</a>
<a class="hover:underline" href="#">Best Practices</a>
<a class="hover:underline" href="#">Support</a>
</div>
</footer>
</div>
</main>
</div>
</body></html>