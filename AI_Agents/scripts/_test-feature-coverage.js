const mod = require('../api/_tools/local_agent.js');

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + msg); if (!cond) failures++; };

// A realistic sharded capabilities testIndex: { TC_id: [{ domain, spec, title }] }.
const testIndex = {
  TC_008: [{ domain: 'ProfileMenu', spec: 'src/tests/profilemenulogoutdropdown.spec.ts', title: 'Logout via user profile dropdown' }],
  TC_003: [{ domain: 'Cart', spec: 'src/tests/viewcart.spec.ts', title: 'View Cart contents' }],
  TC_001: [{ domain: 'Login', spec: 'src/tests/login.spec.ts', title: 'Login with valid standard user' }],
};

// 1. A feature that IS already automated is detected, with its id/title/spec recovered.
const logout = mod.featureCoverageInIndex(testIndex, 'Logout');
ok(!!logout, 'Logout is detected as already automated');
ok(logout && logout.specPath === 'src/tests/profilemenulogoutdropdown.spec.ts', 'Logout resolves to its real spec path');
ok(logout && logout.testId === 'TC_008', 'Logout recovers the TC id (TC_008)');
ok(logout && /Logout via/.test(logout.title), 'Logout recovers the matching test title');

// 2. "View Cart" matches the "View Cart contents" test.
const cart = mod.featureCoverageInIndex(testIndex, 'View Cart');
ok(cart && cart.specPath === 'src/tests/viewcart.spec.ts', 'View Cart is detected as already automated');

// 3. A genuinely NEW feature returns null (no false positive → explore proceeds).
ok(mod.featureCoverageInIndex(testIndex, 'Add Coupon Code') === null, 'a brand-new feature is NOT flagged as automated');

// 4. Robustness: empty/missing inputs never throw and return null.
ok(mod.featureCoverageInIndex(null, 'Logout') === null, 'null index → null');
ok(mod.featureCoverageInIndex(testIndex, '') === null, 'empty feature → null');
ok(mod.featureCoverageInIndex(testIndex, '   ') === null, 'whitespace feature → null');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
