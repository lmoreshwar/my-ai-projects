const path = require('path');
const fs = require('fs');
const os = require('os');

// Throwaway framework dir: an empty testData.json (exactly what the provisioned template ships) and a
// spec that READS testData.checkout.{firstName,lastName,postalCode} + testData.search.query, plus a
// method-call (users.find) and an array-index (records[0]) that MUST be skipped, not corrupted.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-testdata-'));
fs.mkdirSync(path.join(root, 'src', 'tests'), { recursive: true });
fs.mkdirSync(path.join(root, 'src', 'testdata'), { recursive: true });

fs.writeFileSync(path.join(root, 'src', 'testdata', 'testData.json'),
  JSON.stringify({ existing: { keep: 'me' } }, null, 2) + '\n');

const spec = `import { test, expect } from '../fixtures';
import testData from '../testdata/testData.json';

test('checkout', async ({ page }) => {
  await enter(testData.checkout.firstName, testData.checkout.lastName, testData.checkout.postalCode);
  await page.getByPlaceholder('Search').fill(testData.search.query);
  const admin = testData.users.find((u) => u.role === 'admin'); // method call → users must be skipped
  const first = testData.records[0];                            // array index → records must be skipped
});
`;
fs.writeFileSync(path.join(root, 'src', 'tests', 'checkout.spec.ts'), spec);

const mod = require('../api/_tools/local_agent.js');
if (!mod.ensureReferencedTestData) { console.log('SKIP: helper not exported'); process.exit(2); }

const written = [{ path: 'src/tests/checkout.spec.ts', layer: 'spec' }];
const res = mod.ensureReferencedTestData(root, written);
const data = JSON.parse(fs.readFileSync(path.join(root, 'src', 'testdata', 'testData.json'), 'utf8'));
console.log('=== testData.json after ===\n' + JSON.stringify(data, null, 2));

const checkoutFilled = !!data.checkout && ['firstName', 'lastName', 'postalCode'].every((k) => typeof data.checkout[k] === 'string' && data.checkout[k].length > 0);
const postalNumeric = data.checkout && data.checkout.postalCode === '12345';
const searchFilled = !!data.search && typeof data.search.query === 'string' && data.search.query.length > 0;
const existingKept = data.existing && data.existing.keep === 'me';
const usersSkipped = !('users' in data);       // method call testData.users.find(...) not backfilled
const recordsSkipped = !('records' in data);   // array index testData.records[0] not backfilled
const changed = res.changed === true;

// idempotence: a second run must add nothing and report changed:false
const res2 = mod.ensureReferencedTestData(root, written);
const data2 = JSON.parse(fs.readFileSync(path.join(root, 'src', 'testdata', 'testData.json'), 'utf8'));
const idempotent = res2.changed === false && JSON.stringify(data2) === JSON.stringify(data);

// non-object block: a string at checkout must NOT be clobbered into an object
const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-testdata2-'));
fs.mkdirSync(path.join(root2, 'src', 'tests'), { recursive: true });
fs.mkdirSync(path.join(root2, 'src', 'testdata'), { recursive: true });
fs.writeFileSync(path.join(root2, 'src', 'testdata', 'testData.json'), JSON.stringify({ checkout: 'already-a-string' }) + '\n');
fs.writeFileSync(path.join(root2, 'src', 'tests', 'checkout.spec.ts'), spec);
mod.ensureReferencedTestData(root2, [{ path: 'src/tests/checkout.spec.ts', layer: 'spec' }]);
const blockData = JSON.parse(fs.readFileSync(path.join(root2, 'src', 'testdata', 'testData.json'), 'utf8'));
const nonObjectPreserved = blockData.checkout === 'already-a-string';

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(root2, { recursive: true, force: true });

const checks = { changed, checkoutFilled, postalNumeric, searchFilled, existingKept, usersSkipped, recordsSkipped, idempotent, nonObjectPreserved };
console.log(checks);
const pass = Object.values(checks).every(Boolean);
console.log('RESULT:', pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
