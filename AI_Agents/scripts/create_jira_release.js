const axios = require('axios');

const JIRA_URL = 'https://moreaitesting.atlassian.net';
const EMAIL = 'soma.moreshwar@gmail.com';
const TOKEN = 'ATATT3xFfGF0nI--50tQOL-5L-VD_r-VBt4oPv4Ap5vEu-DhuG4lHcxicalFR4TOg6UgyZYjrupjblnkYNzXl1PV9rzd-9uc8lKdZepkgBkKb--JJZEu0B6GwBD66i3G2wZPGW6N4U028Xm3Yb1hz96HvNTSpkqnCdwe8F_E6Hs6DEnnKaRv5rs=571A8909';
const PROJECT_ID = 10034;

const auth = Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
const headers = {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
};

const ALL_TICKETS = [
    'ATP-7', 'ATP-8', 'ATP-9', 'ATP-10',
    'ATP-11', 'ATP-12', 'ATP-13', 'ATP-14', 'ATP-15',
    'ATP-16', 'ATP-17', 'ATP-18'
];

const PRIORITIES = {
    'ATP-7': 'Highest',    // Initiative Epic
    'ATP-8': 'High',       // Auth Story
    'ATP-9': 'High',       // Inventory Story
    'ATP-10': 'High',      // Cart Story
    'ATP-11': 'Medium',    // Valid Login Subtask
    'ATP-12': 'Medium',    // Error Handling Subtask
    'ATP-13': 'Medium',    // Sort Products Subtask
    'ATP-14': 'Medium',    // Add to Cart Subtask
    'ATP-15': 'Medium',    // View/Remove Cart Subtask
    'ATP-16': 'Low',       // Test: Invalid Creds
    'ATP-17': 'Low',       // Test: Empty Username
    'ATP-18': 'Low'        // Test: Cart Badge
};

async function main() {
    console.log('=== Creating JIRA Release & Tagging Tickets ===\n');

    // ─── Step 1: Create Release Version ───
    console.log('--- Step 1: Creating Release Version ---');
    const versionPayload = {
        name: 'Release 1.0.0 — SauceDemo Core Shopping Flow',
        description: 'First release covering core shopping flow: Authentication, Product Inventory & Browsing, and Shopping Cart Management for SauceDemo E-Commerce platform. Covers BLAST framework test automation scope.',
        projectId: PROJECT_ID,
        startDate: '2026-04-12',
        releaseDate: '2026-05-30',
        released: false,
        archived: false
    };

    let versionName;
    try {
        const vRes = await axios.post(`${JIRA_URL}/rest/api/3/version`, versionPayload, { headers, timeout: 15000 });
        versionName = vRes.data.name;
        console.log(`  ✅ Created Version: ${vRes.data.name}`);
        console.log(`     ID: ${vRes.data.id}`);
        console.log(`     Start: ${vRes.data.startDate}`);
        console.log(`     Release Date: ${vRes.data.releaseDate}`);
        console.log(`     Released: ${vRes.data.released}`);
    } catch (err) {
        const errData = err.response?.data || err.message;
        console.error(`  ❌ Failed to create version: ${JSON.stringify(errData)}`);
        return;
    }

    // ─── Step 2: Tag all tickets with fixVersion ───
    console.log('\n--- Step 2: Tagging all tickets to release ---');
    for (const ticket of ALL_TICKETS) {
        try {
            await axios.put(`${JIRA_URL}/rest/api/3/issue/${ticket}`, {
                update: {
                    fixVersions: [{ add: { name: versionName } }]
                }
            }, { headers, timeout: 15000 });
            console.log(`  ✅ Tagged: ${ticket}`);
        } catch (err) {
            console.log(`  ❌ FAILED: ${ticket} — ${err.response?.status} ${JSON.stringify(err.response?.data || err.message)}`);
        }
    }

    // ─── Step 3: Set priorities for agile board ───
    console.log('\n--- Step 3: Setting priorities ---');
    for (const [ticket, priority] of Object.entries(PRIORITIES)) {
        try {
            await axios.put(`${JIRA_URL}/rest/api/3/issue/${ticket}`, {
                fields: { priority: { name: priority } }
            }, { headers, timeout: 15000 });
            console.log(`  ✅ ${ticket} → ${priority}`);
        } catch (err) {
            console.log(`  ⚠️  ${ticket} priority failed: ${err.response?.status}`);
        }
    }

    // ─── Step 4: Add labels for BLAST framework traceability ───
    console.log('\n--- Step 4: Adding labels ---');
    const labelMap = {
        'ATP-7': ['SauceDemo', 'Initiative', 'Release-1.0'],
        'ATP-8': ['Authentication', 'Login', 'Release-1.0'],
        'ATP-9': ['Inventory', 'Browsing', 'Release-1.0'],
        'ATP-10': ['Cart', 'Shopping', 'Release-1.0'],
        'ATP-11': ['Authentication', 'HappyPath', 'Release-1.0'],
        'ATP-12': ['Authentication', 'ErrorHandling', 'Release-1.0'],
        'ATP-13': ['Inventory', 'Sorting', 'Release-1.0'],
        'ATP-14': ['Cart', 'AddToCart', 'Release-1.0'],
        'ATP-15': ['Cart', 'RemoveFromCart', 'Release-1.0'],
        'ATP-16': ['Authentication', 'NegativeTest', 'Release-1.0'],
        'ATP-17': ['Authentication', 'NegativeTest', 'Release-1.0'],
        'ATP-18': ['Cart', 'BadgeTest', 'Release-1.0']
    };

    for (const [ticket, labels] of Object.entries(labelMap)) {
        try {
            const addOps = labels.map(l => ({ add: l }));
            await axios.put(`${JIRA_URL}/rest/api/3/issue/${ticket}`, {
                update: { labels: addOps }
            }, { headers, timeout: 15000 });
            console.log(`  ✅ ${ticket} → [${labels.join(', ')}]`);
        } catch (err) {
            console.log(`  ⚠️  ${ticket} labels failed: ${err.response?.status}`);
        }
    }

    // ─── Summary ───
    console.log('\n========================================');
    console.log('  RELEASE SETUP COMPLETE');
    console.log('========================================');
    console.log(`  Release:  ${versionName}`);
    console.log(`  Status:   Unreleased`);
    console.log(`  Start:    2026-04-12`);
    console.log(`  Target:   2026-05-30`);
    console.log(`  Tickets:  ${ALL_TICKETS.length} tagged`);
    console.log(`  Labels:   Applied for BLAST traceability`);
    console.log(`  Priorities: Set (Highest → Low)`);
    console.log('========================================');
    console.log(`  View: ${JIRA_URL}/projects/ATP/versions`);
}

main().catch(err => console.error('Script error:', err.message));
