// Temp: dispatch a Level 3 add-to-cart job (numeric id) to the cloud workflow.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const gh = require('../api/_tools/github_agent');

const job = {
  jobId: 'L3-CART-' + Date.now(),
  project: 'SauceDemo',
  environment: 'QA',
  url: 'https://www.saucedemo.com',
  loginUrl: 'https://www.saucedemo.com',
  agent: 'AI Native Playwright Engineer',
  skill: 'New Automation',
  executionMode: 'GenerateAndExecute',
  level3: true,
  comments: 'Level 3 validation — add product to cart from inventory.',
  testCases: [
    {
      id: 'TC_501',
      title: 'Add a product to the cart from the inventory page',
      tags: '@smoke @AddProductToCart @Positive',
      complexity: 'Low',
      description: 'A standard user adds a product to the cart from the inventory page and the cart badge shows the item count.',
      preconditions: 'Standard user is logged in and on the inventory page.',
      testData: 'standard_user / secret_sauce; product: Sauce Labs Backpack',
      steps: '1. Log in as the standard user 2. On the inventory page, click Add to cart for the backpack 3. Observe the cart badge',
      expectedResults: 'The cart badge shows 1 and the button toggles to Remove.',
      comments: '',
    },
  ],
};

gh.dispatchWorkflow(job)
  .then((r) => console.log('DISPATCHED:', JSON.stringify(r)))
  .catch((e) => { console.error('DISPATCH FAILED:', e.message); process.exit(1); });
