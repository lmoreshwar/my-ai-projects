const axios = require('axios');

const JIRA_URL = 'https://moreaitesting.atlassian.net';
const EMAIL = 'soma.moreshwar@gmail.com';
const TOKEN = 'ATATT3xFfGF0nI--50tQOL-5L-VD_r-VBt4oPv4Ap5vEu-DhuG4lHcxicalFR4TOg6UgyZYjrupjblnkYNzXl1PV9rzd-9uc8lKdZepkgBkKb--JJZEu0B6GwBD66i3G2wZPGW6N4U028Xm3Yb1hz96HvNTSpkqnCdwe8F_E6Hs6DEnnKaRv5rs=571A8909';
const PROJECT_KEY = 'ATP';

const auth = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const headers = {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
};

// Issue type IDs from the ATP project
const TYPES = {
    Epic: '10044',
    Story: '10078',
    Task: '10043',
    Subtask: '10045'
};

// Helper: create ADF (Atlassian Document Format) description from plain text
function toAdf(text) {
    const lines = text.split('\n');
    const content = lines.map(line => ({
        type: 'paragraph',
        content: line.trim() ? [{ type: 'text', text: line }] : [{ type: 'text', text: ' ' }]
    }));
    return { type: 'doc', version: 1, content };
}

async function createIssue(summary, description, issueTypeId, parentKey = null) {
    const fields = {
        project: { key: PROJECT_KEY },
        summary,
        description: toAdf(description),
        issuetype: { id: issueTypeId }
    };

    if (parentKey) {
        fields.parent = { key: parentKey };
    }

    try {
        const res = await axios.post(`${JIRA_URL}/rest/api/3/issue`, { fields }, { headers, timeout: 20000 });
        const key = res.data.key;
        console.log(`  ✅ Created: ${key} — ${summary}`);
        return key;
    } catch (err) {
        const errData = err.response?.data || err.message;
        console.error(`  ❌ FAILED: ${summary}`);
        console.error(`     Error: ${JSON.stringify(errData)}`);
        return null;
    }
}

async function main() {
    console.log('=== Creating JIRA Tickets for SauceDemo Hierarchy ===\n');

    // ─── LEVEL 1: Initiative (as Epic since no Initiative type) ───
    console.log('--- Level 1: Initiative (Epic) ---');
    const HD100 = await createIssue(
        'SauceDemo E-Commerce Platform — Core Shopping Flow',
        `Strategic initiative to validate the complete end-to-end shopping experience on SauceDemo (https://www.saucedemo.com). This covers authentication, product browsing, cart management, and checkout workflows across web and mobile browsers.`,
        TYPES.Epic
    );
    if (!HD100) { console.error('Cannot continue without top-level epic.'); return; }

    // ─── LEVEL 2: Epics (as Stories under the Initiative-Epic) ───
    console.log('\n--- Level 2: Feature Epics (as Stories under Initiative) ---');

    const HD101 = await createIssue(
        'User Authentication & Login',
        `Feature: User Authentication & Login Module

App URL: https://www.saucedemo.com

Scope:
• Login page with username and password fields
• Login button functionality
• Valid credentials: username standard_user, password secret_sauce
• Error handling for invalid/empty credentials

Acceptance Criteria:
AC1: User should be able to login with valid credentials (standard_user / secret_sauce)
AC2: On successful login, user should be redirected to inventory page (/inventory.html)
AC3: Error message "Epic sadface: Username and password do not match any user in this service" should display for invalid credentials
AC4: Error message "Epic sadface: Username is required" should display when username is empty
AC5: Error message "Epic sadface: Password is required" should display when password is empty
AC6: Login page should display username field, password field, and login button`,
        TYPES.Story,
        HD100
    );

    const HD102 = await createIssue(
        'Product Inventory & Browsing',
        `Feature: Product Inventory Page & Browsing

Scope:
• Product listing page after login
• 6 products displayed with name, description, price, image, and "Add to cart" button
• Sort functionality (A-Z, Z-A, Price Low-High, Price High-Low)

Acceptance Criteria:
AC1: Inventory page should display 6 products after successful login
AC2: Each product should show name, description, price, and an image
AC3: Each product should have an "Add to cart" button
AC4: User should be able to sort products by Name (A to Z)
AC5: User should be able to sort products by Name (Z to A)
AC6: User should be able to sort products by Price (Low to High)
AC7: User should be able to sort products by Price (High to Low)
AC8: Default sort should be Name (A to Z)`,
        TYPES.Story,
        HD100
    );

    const HD103 = await createIssue(
        'Shopping Cart Management',
        `Feature: Shopping Cart — Add, View, Remove Products

Scope:
• Add products to cart from inventory page
• Cart badge counter in header
• Cart page with product details
• Remove products from cart

Acceptance Criteria:
AC1: Clicking "Add to cart" should change the button text to "Remove"
AC2: Cart badge icon should update with the correct count of items added
AC3: Clicking the cart icon should navigate to the cart page (/cart.html)
AC4: Cart page should display product name, quantity (1), and price for each added item
AC5: Clicking "Remove" on cart page should remove the item from the cart
AC6: After removing all items, cart badge should disappear
AC7: "Continue Shopping" button on cart page should navigate back to inventory page`,
        TYPES.Story,
        HD100
    );

    // ─── LEVEL 3: User Stories (as Sub-tasks under their Feature Stories) ───
    console.log('\n--- Level 3: User Stories (as Sub-tasks) ---');

    const HD201 = await createIssue(
        'Successful Login with Valid Credentials',
        `As a registered user,
I want to log in using my valid username and password,
so that I can access the product inventory page.

Acceptance Criteria:
1. User enters standard_user in the username field
2. User enters secret_sauce in the password field
3. User clicks the "Login" button
4. User is redirected to /inventory.html
5. Products page is visible with 6 products listed`,
        TYPES.Subtask,
        HD101
    );

    const HD202 = await createIssue(
        'Login Error Handling for Invalid & Empty Credentials',
        `As a user,
I want to see clear error messages when I enter wrong credentials or leave fields empty,
so that I know what went wrong and can correct it.

Acceptance Criteria:
1. Entering invalid username/password and clicking Login should show: "Epic sadface: Username and password do not match any user in this service"
2. Leaving username empty and clicking Login should show: "Epic sadface: Username is required"
3. Leaving password empty and clicking Login should show: "Epic sadface: Password is required"
4. Error message should be displayed in a red error container below the login form
5. Error message should have a close (X) button to dismiss it`,
        TYPES.Subtask,
        HD101
    );

    const HD203 = await createIssue(
        'View and Sort Products on Inventory Page',
        `As a logged-in user,
I want to see all products and sort them by name or price,
so that I can find what I'm looking for quickly.

Acceptance Criteria:
1. Inventory page displays exactly 6 products
2. Each product card shows: product image, name, description, price, "Add to cart" button
3. Sort dropdown is available with options: Name (A to Z), Name (Z to A), Price (low to high), Price (high to low)
4. Selecting "Name (Z to A)" should reorder products in reverse alphabetical order
5. Selecting "Price (low to high)" should show cheapest product first ($7.99)
6. Selecting "Price (high to low)" should show most expensive product first ($49.99)`,
        TYPES.Subtask,
        HD102
    );

    const HD204 = await createIssue(
        'Add Product to Cart and Verify Cart Badge',
        `As a user browsing products,
I want to add items to my cart and see the cart count update,
so that I know how many items I've selected before checking out.

Acceptance Criteria:
1. Clicking "Add to cart" on "Sauce Labs Backpack" ($29.99) should change button to "Remove"
2. Cart badge should show "1" after adding one product
3. Adding a second product ("Sauce Labs Bike Light" $9.99) should update badge to "2"
4. Clicking "Remove" on a product should change button back to "Add to cart"
5. Cart badge should decrement accordingly when an item is removed`,
        TYPES.Subtask,
        HD103
    );

    const HD205 = await createIssue(
        'View and Remove Products from Cart Page',
        `As a user who has added items to the cart,
I want to view my cart and remove unwanted items,
so that I can finalize what I want to purchase.

Acceptance Criteria:
1. Clicking the cart icon navigates to /cart.html
2. Cart page displays each added product with: name, quantity (1), price
3. Each product has a "Remove" button
4. Clicking "Remove" removes the product from the cart page
5. After removing all items, the cart badge disappears from the header
6. "Continue Shopping" button navigates back to /inventory.html`,
        TYPES.Subtask,
        HD103
    );

    // ─── LEVEL 4: Sub-tasks (as Sub-tasks under User Story Sub-tasks) ───
    // Note: JIRA doesn't allow sub-tasks under sub-tasks. These will be created as Tasks linked to parent stories.
    console.log('\n--- Level 4: Detailed Test Sub-tasks (as Tasks) ---');

    // HD-301 under HD-202 (Error Handling Story) — since HD-202 is a subtask, we create as Task and link
    const HD301 = await createIssue(
        'Validate Error Message for Invalid Credentials',
        `Test Scenario: Verify that entering invalid username/password shows the correct error message.

Parent Context: Login Error Handling for Invalid & Empty Credentials

Steps:
1. Navigate to https://www.saucedemo.com
2. Enter username: invalid_user
3. Enter password: wrong_password
4. Click "Login" button

Expected: Error message displayed: "Epic sadface: Username and password do not match any user in this service"`,
        TYPES.Task,
        HD100
    );

    const HD302 = await createIssue(
        'Validate Error Message for Empty Username',
        `Test Scenario: Verify error when username field is left empty.

Parent Context: Login Error Handling for Invalid & Empty Credentials

Steps:
1. Navigate to https://www.saucedemo.com
2. Leave username field empty
3. Enter password: secret_sauce
4. Click "Login" button

Expected: Error message displayed: "Epic sadface: Username is required"`,
        TYPES.Task,
        HD100
    );

    const HD303 = await createIssue(
        'Verify Cart Badge Updates When Adding Multiple Products',
        `Test Scenario: Verify cart badge count increments correctly when adding multiple products.

Parent Context: Add Product to Cart and Verify Cart Badge

Steps:
1. Login with valid credentials
2. Click "Add to cart" on "Sauce Labs Backpack"
3. Verify cart badge shows "1"
4. Click "Add to cart" on "Sauce Labs Bike Light"
5. Verify cart badge shows "2"

Expected: Cart badge should show accurate count of items added`,
        TYPES.Task,
        HD100
    );

    // ─── Summary ───
    console.log('\n=== DONE ===');
    console.log('Created tickets:');
    console.log(`  Initiative (Epic):  ${HD100}`);
    console.log(`  Feature Stories:    ${HD101}, ${HD102}, ${HD103}`);
    console.log(`  User Story Subtasks: ${HD201}, ${HD202}, ${HD203}, ${HD204}, ${HD205}`);
    console.log(`  Test Tasks:         ${HD301}, ${HD302}, ${HD303}`);

    console.log('\nHierarchy:');
    console.log(`  ${HD100} (Epic — Initiative)`);
    console.log(`    ├── ${HD101} (Story — Authentication)`);
    console.log(`    │   ├── ${HD201} (Subtask — Valid Login)`);
    console.log(`    │   └── ${HD202} (Subtask — Error Handling)`);
    console.log(`    ├── ${HD102} (Story — Inventory)`);
    console.log(`    │   └── ${HD203} (Subtask — View & Sort)`);
    console.log(`    ├── ${HD103} (Story — Cart)`);
    console.log(`    │   ├── ${HD204} (Subtask — Add to Cart)`);
    console.log(`    │   └── ${HD205} (Subtask — View/Remove Cart)`);
    console.log(`    ├── ${HD301} (Task — Test Invalid Creds)`);
    console.log(`    ├── ${HD302} (Task — Test Empty Username)`);
    console.log(`    └── ${HD303} (Task — Test Cart Badge)`);
}

main().catch(err => console.error('Script error:', err));
