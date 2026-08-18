// Temporary smoke test: dispatch the cloud workflow with a minimal job.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const gh = require('../api/_tools/github_agent');

const job = {
  jobId: 'CLOUD-SMOKE-' + Date.now(),
  project: 'SauceDemo',
  environment: 'QA',
  url: 'https://www.saucedemo.com',
  agent: 'AI Native Playwright Engineer',
  skill: 'New Automation',
  executionMode: 'GenerateAndExecute',
  comments: 'Cloud pipeline smoke test.',
  testCases: [
    {
      id: 'TC_SMOKE',
      title: 'Standard user can log in',
      tags: '@smoke',
      complexity: 'Low',
      description: 'Verify a standard user logs into SauceDemo and lands on inventory.',
      preconditions: 'App reachable',
      testData: 'standard_user / secret_sauce',
      steps: '1. Open site 2. Enter username 3. Enter password 4. Click Login',
      expectedResults: 'Inventory page is shown',
      comments: '',
    },
  ],
};

gh.dispatchWorkflow(job)
  .then((r) => console.log('DISPATCHED:', JSON.stringify(r)))
  .catch((e) => { console.error('DISPATCH FAILED:', e.message); process.exit(1); });
