<!DOCTYPE html>
<html class="light" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Playwright TypeScript Architect | Hitachi Digital Services</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<script>
tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "primary": "#b7000c",
        "primary-container": "#e60012",
        "on-primary": "#ffffff",
        "secondary": "#2d5bb3",
        "on-secondary": "#ffffff",
        "secondary-container": "#79a1fe",
        "surface": "#fef7ff",
        "surface-container-low": "#f9f1fd",
        "surface-container-highest": "#e7e0eb",
        "on-surface": "#1d1a22",
        "on-surface-variant": "#5f3f3b",
        "outline-variant": "#e9bcb6",
        "background": "#fef7ff",
      },
      fontFamily: { "headline": ["Inter"], "body": ["Inter"], "label": ["Inter"] },
    },
  },
}
</script>
<style>
body { font-family: 'Inter', sans-serif; }
.material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20; }
</style>
</head>
<body class="bg-surface text-on-surface min-h-screen">
<div class="max-w-7xl mx-auto space-y-8 px-6 pt-8 pb-16">

<!-- Header -->
<header class="space-y-2">
  <span class="text-secondary font-bold text-xs tracking-widest uppercase block">Automation Conversion Engine</span>
  <h1 class="text-4xl font-black text-primary-container tracking-tight mb-2">Playwright TypeScript Architect</h1>
  <p class="text-on-surface-variant max-w-3xl font-medium leading-relaxed">
    Auto-filter <strong>Automation</strong>-tagged test cases, group by feature, and generate
    production-ready <strong>Playwright TypeScript + BDD (Gherkin)</strong> scripts compatible with
    <code class="bg-surface-container-highest px-1.5 py-0.5 rounded text-xs font-mono font-bold">npx playwright test</code>.
  </p>
</header>

<!-- Main Grid -->
<div class="grid grid-cols-12 gap-6">

  <!-- LEFT: Feature Groups + Controls -->
  <div class="col-span-12 lg:col-span-4 space-y-6">

    <!-- Stats Bar -->
    <div class="grid grid-cols-3 gap-3">
      <div class="bg-surface-container-low rounded-xl p-4 text-center">
        <div class="text-2xl font-black text-primary">34</div>
        <div class="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Total TCs</div>
      </div>
      <div class="bg-surface-container-low rounded-xl p-4 text-center">
        <div class="text-2xl font-black text-green-600">18</div>
        <div class="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Automation</div>
      </div>
      <div class="bg-surface-container-low rounded-xl p-4 text-center">
        <div class="text-2xl font-black text-secondary">4</div>
        <div class="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Groups</div>
      </div>
    </div>

    <!-- Feature Group Selection -->
    <section class="bg-white rounded-xl border border-outline-variant/20 shadow-sm overflow-hidden">
      <div class="p-4 border-b border-outline-variant/10 bg-surface-container-low flex justify-between items-center">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-xl">category</span>
          <h3 class="font-bold text-on-surface text-sm">Feature Groups</h3>
          <span class="text-[10px] bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">3/4</span>
        </div>
        <div class="flex gap-2">
          <button class="text-[10px] font-bold text-secondary hover:underline uppercase">All</button>
          <button class="text-[10px] font-bold text-on-surface-variant hover:underline uppercase">None</button>
        </div>
      </div>
      <div class="divide-y divide-outline-variant/10">
        <!-- Selected group -->
        <button class="w-full flex items-center gap-3 px-4 py-3 text-left bg-primary/5 border-l-4 border-primary">
          <span class="material-symbols-outlined text-lg text-primary">check_box</span>
          <div class="flex-1">
            <div class="font-bold text-sm text-on-surface">Cart</div>
            <div class="text-[10px] text-on-surface-variant">6 test cases</div>
          </div>
          <span class="text-xs font-mono text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded">TC_001, TC_002...</span>
        </button>
        <!-- Selected group -->
        <button class="w-full flex items-center gap-3 px-4 py-3 text-left bg-primary/5 border-l-4 border-primary">
          <span class="material-symbols-outlined text-lg text-primary">check_box</span>
          <div class="flex-1">
            <div class="font-bold text-sm text-on-surface">Payment</div>
            <div class="text-[10px] text-on-surface-variant">5 test cases</div>
          </div>
          <span class="text-xs font-mono text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded">TC_008, TC_009...</span>
        </button>
        <!-- Selected group -->
        <button class="w-full flex items-center gap-3 px-4 py-3 text-left bg-primary/5 border-l-4 border-primary">
          <span class="material-symbols-outlined text-lg text-primary">check_box</span>
          <div class="flex-1">
            <div class="font-bold text-sm text-on-surface">Coupon</div>
            <div class="text-[10px] text-on-surface-variant">4 test cases</div>
          </div>
          <span class="text-xs font-mono text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded">TC_014, TC_015...</span>
        </button>
        <!-- Unselected group -->
        <button class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-container-highest border-l-4 border-transparent">
          <span class="material-symbols-outlined text-lg text-on-surface-variant">check_box_outline_blank</span>
          <div class="flex-1">
            <div class="font-bold text-sm text-on-surface">Authentication</div>
            <div class="text-[10px] text-on-surface-variant">3 test cases</div>
          </div>
          <span class="text-xs font-mono text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded">TC_020, TC_021...</span>
        </button>
      </div>
    </section>

    <!-- Selected Summary -->
    <div class="bg-blue-50 border border-blue-200 rounded-xl p-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="material-symbols-outlined text-secondary text-sm">info</span>
        <span class="text-xs font-bold text-secondary uppercase">Ready to Generate</span>
      </div>
      <p class="text-sm text-blue-800">
        <strong>15</strong> test cases across <strong>3</strong> feature groups selected.
        This will produce <strong>3</strong> .feature + <strong>3</strong> .spec.ts + 1 playwright.config.ts files.
      </p>
    </div>

    <!-- Generate Button -->
    <button class="w-full py-4 bg-primary text-white font-bold rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-primary/20 hover:bg-primary-container transition-all active:scale-[0.98]">
      <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">bolt</span>
      Generate Playwright TS + BDD (15 TCs)
    </button>

    <!-- Output Actions -->
    <div class="grid grid-cols-2 gap-3">
      <button class="py-3 bg-surface-container-highest text-on-surface font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-surface-container-high transition-all text-sm">
        <span class="material-symbols-outlined text-base">download</span>
        Download ZIP
      </button>
      <button class="py-3 bg-secondary text-white font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-secondary/80 transition-all text-sm">
        <span class="material-symbols-outlined text-base">cloud_upload</span>
        Push to GitHub
      </button>
    </div>
  </div>

  <!-- RIGHT: Code Editor -->
  <div class="col-span-12 lg:col-span-8">
    <div class="bg-[#1e1e1e] rounded-xl overflow-hidden flex flex-col shadow-2xl ring-1 ring-white/10 min-h-[600px]">

      <!-- Tab bar -->
      <div class="bg-[#2d2d2d] flex items-center overflow-x-auto">
        <div class="flex gap-1.5 px-4 py-2.5 mr-3">
          <div class="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
          <div class="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
          <div class="w-3 h-3 rounded-full bg-[#27c93f]"></div>
        </div>
        <button class="flex items-center gap-2 px-4 py-2.5 text-xs font-medium bg-[#1e1e1e] text-white border-b-2 border-primary">
          <span class="material-symbols-outlined text-sm text-green-400">description</span>
          cart.feature
        </button>
        <button class="flex items-center gap-2 px-4 py-2.5 text-xs text-white/50 hover:text-white/70 hover:bg-white/5">
          <span class="material-symbols-outlined text-sm text-blue-400">code</span>
          cart.spec.ts
        </button>
        <button class="flex items-center gap-2 px-4 py-2.5 text-xs text-white/50 hover:text-white/70 hover:bg-white/5">
          <span class="material-symbols-outlined text-sm text-green-400">description</span>
          payment.feature
        </button>
        <button class="flex items-center gap-2 px-4 py-2.5 text-xs text-white/50 hover:text-white/70 hover:bg-white/5">
          <span class="material-symbols-outlined text-sm text-blue-400">code</span>
          payment.spec.ts
        </button>
        <button class="flex items-center gap-2 px-4 py-2.5 text-xs text-white/50 hover:text-white/70 hover:bg-white/5">
          <span class="material-symbols-outlined text-sm text-yellow-400">settings</span>
          playwright.config.ts
        </button>
        <button class="ml-auto mr-4 text-white/40 hover:text-white">
          <span class="material-symbols-outlined text-lg">content_copy</span>
        </button>
      </div>

      <!-- Code area -->
      <div class="flex-1 p-6 overflow-auto font-mono text-sm leading-relaxed text-[#d4d4d4] min-h-[500px]">
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">1</span><span class="text-[#dcdcaa]">@cart</span></div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">2</span><span class="text-[#c586c0]">Feature:</span> Cart Management</div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">3</span></div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">4</span>  <span class="text-[#dcdcaa]">@TC_001</span> <span class="text-[#dcdcaa]">@Functional</span></div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">5</span>  <span class="text-[#c586c0]">Scenario:</span> Verify cart displays added products</div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">6</span>    <span class="text-[#569cd6]">Given</span> user has products in the cart</div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">7</span>    <span class="text-[#569cd6]">When</span> user navigates to the cart page</div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">8</span>    <span class="text-[#569cd6]">Then</span> all added products should be visible</div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">9</span>    <span class="text-[#569cd6]">And</span> the cart total should match the sum of prices</div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">10</span></div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">11</span>  <span class="text-[#dcdcaa]">@TC_002</span> <span class="text-[#dcdcaa]">@Negative</span></div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">12</span>  <span class="text-[#c586c0]">Scenario:</span> Verify cart quantity cannot exceed maximum</div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">13</span>    <span class="text-[#569cd6]">Given</span> a product is in the cart with quantity 10</div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">14</span>    <span class="text-[#569cd6]">When</span> user tries to increase quantity beyond 10</div>
        <div><span class="text-white/20 w-10 inline-block text-right pr-3 select-none text-xs">15</span>    <span class="text-[#569cd6]">Then</span> an error message <span class="text-[#ce9178]">"Maximum quantity reached"</span> should appear</div>
      </div>

      <!-- Status bar -->
      <div class="bg-[#007acc] px-4 py-1 flex items-center justify-between text-[10px] text-white/80 font-medium">
        <div class="flex items-center gap-4">
          <span>TypeScript + Gherkin</span>
          <span>15 lines</span>
        </div>
        <div class="flex items-center gap-4">
          <span>Playwright CLI Ready</span>
          <span>UTF-8</span>
          <span class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-green-400"></span>
            7 files
          </span>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- File Structure -->
<section class="bg-white rounded-xl border border-outline-variant/20 shadow-sm overflow-hidden">
  <div class="p-4 border-b border-outline-variant/10 bg-surface-container-low flex items-center gap-2">
    <span class="material-symbols-outlined text-primary text-xl">folder_open</span>
    <h3 class="font-bold text-on-surface text-sm">Generated File Structure</h3>
    <span class="ml-auto text-xs text-on-surface-variant">7 files</span>
  </div>
  <div class="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
    <button class="flex items-center gap-3 p-3 rounded-lg border border-primary bg-primary/5 text-left">
      <span class="material-symbols-outlined text-green-400">description</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-bold text-on-surface truncate">tests/features/cart.feature</div>
        <div class="text-[10px] text-on-surface-variant">15 lines</div>
      </div>
      <span class="text-[9px] font-black uppercase px-1.5 py-0.5 bg-surface-container-highest rounded">BDD</span>
    </button>
    <button class="flex items-center gap-3 p-3 rounded-lg border border-outline-variant/20 hover:bg-surface-container-highest text-left">
      <span class="material-symbols-outlined text-blue-400">code</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-bold text-on-surface truncate">tests/specs/cart.spec.ts</div>
        <div class="text-[10px] text-on-surface-variant">45 lines</div>
      </div>
      <span class="text-[9px] font-black uppercase px-1.5 py-0.5 bg-surface-container-highest rounded">TS</span>
    </button>
    <button class="flex items-center gap-3 p-3 rounded-lg border border-outline-variant/20 hover:bg-surface-container-highest text-left">
      <span class="material-symbols-outlined text-green-400">description</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-bold text-on-surface truncate">tests/features/payment.feature</div>
        <div class="text-[10px] text-on-surface-variant">22 lines</div>
      </div>
      <span class="text-[9px] font-black uppercase px-1.5 py-0.5 bg-surface-container-highest rounded">BDD</span>
    </button>
    <button class="flex items-center gap-3 p-3 rounded-lg border border-outline-variant/20 hover:bg-surface-container-highest text-left">
      <span class="material-symbols-outlined text-blue-400">code</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-bold text-on-surface truncate">tests/specs/payment.spec.ts</div>
        <div class="text-[10px] text-on-surface-variant">58 lines</div>
      </div>
      <span class="text-[9px] font-black uppercase px-1.5 py-0.5 bg-surface-container-highest rounded">TS</span>
    </button>
    <button class="flex items-center gap-3 p-3 rounded-lg border border-outline-variant/20 hover:bg-surface-container-highest text-left">
      <span class="material-symbols-outlined text-green-400">description</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-bold text-on-surface truncate">tests/features/coupon.feature</div>
        <div class="text-[10px] text-on-surface-variant">18 lines</div>
      </div>
      <span class="text-[9px] font-black uppercase px-1.5 py-0.5 bg-surface-container-highest rounded">BDD</span>
    </button>
    <button class="flex items-center gap-3 p-3 rounded-lg border border-outline-variant/20 hover:bg-surface-container-highest text-left">
      <span class="material-symbols-outlined text-blue-400">code</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-bold text-on-surface truncate">tests/specs/coupon.spec.ts</div>
        <div class="text-[10px] text-on-surface-variant">40 lines</div>
      </div>
      <span class="text-[9px] font-black uppercase px-1.5 py-0.5 bg-surface-container-highest rounded">TS</span>
    </button>
    <button class="flex items-center gap-3 p-3 rounded-lg border border-outline-variant/20 hover:bg-surface-container-highest text-left">
      <span class="material-symbols-outlined text-yellow-400">settings</span>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-bold text-on-surface truncate">playwright.config.ts</div>
        <div class="text-[10px] text-on-surface-variant">28 lines</div>
      </div>
      <span class="text-[9px] font-black uppercase px-1.5 py-0.5 bg-surface-container-highest rounded">CFG</span>
    </button>
  </div>
</section>

<!-- Trust Banner -->
<div class="bg-[#f8f9ff] border border-blue-100 rounded-xl p-4 flex items-center gap-4">
  <div class="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-secondary">
    <span class="material-symbols-outlined">verified_user</span>
  </div>
  <div class="flex-1">
    <p class="text-sm font-medium text-on-surface">
      <span class="font-bold text-secondary">Anti-Hallucination Shield</span> — Scripts are grounded in your verified test cases only.
      No invented URLs, selectors, or behavior. Missing details are flagged with
      <code class="bg-surface-container-highest px-1 py-0.5 rounded text-xs font-mono">// TODO</code> markers.
    </p>
  </div>
</div>

</div>
</body></html>
