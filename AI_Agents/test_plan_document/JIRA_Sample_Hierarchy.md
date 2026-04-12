# Sample JIRA Hierarchy — SauceDemo E-Commerce Testing

Create these tickets in your JIRA project in the order below. Replace `HD` with your actual project key.

---

## Level 1: Initiative (Parent)

### HD-100 — Initiative
| Field | Value |
|-------|-------|
| **Type** | Initiative (or Epic if your project doesn't have Initiative) |
| **Summary** | SauceDemo E-Commerce Platform — Core Shopping Flow |
| **Description** | Strategic initiative to validate the complete end-to-end shopping experience on SauceDemo (https://www.saucedemo.com). This covers authentication, product browsing, cart management, and checkout workflows across web and mobile browsers. |

---

## Level 2: Epics (Features) — Link to HD-100 as Parent

### HD-101 — Epic
| Field | Value |
|-------|-------|
| **Type** | Epic |
| **Summary** | User Authentication & Login |
| **Parent** | HD-100 |
| **Description** | **Feature:** User Authentication & Login Module<br><br>**App URL:** https://www.saucedemo.com<br><br>**Scope:**<br>• Login page with username and password fields<br>• Login button functionality<br>• Valid credentials: username `standard_user`, password `secret_sauce`<br>• Error handling for invalid/empty credentials<br><br>**Acceptance Criteria:**<br>AC1: User should be able to login with valid credentials (standard_user / secret_sauce)<br>AC2: On successful login, user should be redirected to inventory page (/inventory.html)<br>AC3: Error message "Epic sadface: Username and password do not match any user in this service" should display for invalid credentials<br>AC4: Error message "Epic sadface: Username is required" should display when username is empty<br>AC5: Error message "Epic sadface: Password is required" should display when password is empty<br>AC6: Login page should display username field, password field, and login button |

### HD-102 — Epic
| Field | Value |
|-------|-------|
| **Type** | Epic |
| **Summary** | Product Inventory & Browsing |
| **Parent** | HD-100 |
| **Description** | **Feature:** Product Inventory Page & Browsing<br><br>**Scope:**<br>• Product listing page after login<br>• 6 products displayed with name, description, price, image, and "Add to cart" button<br>• Sort functionality (A-Z, Z-A, Price Low-High, Price High-Low)<br><br>**Acceptance Criteria:**<br>AC1: Inventory page should display 6 products after successful login<br>AC2: Each product should show name, description, price, and an image<br>AC3: Each product should have an "Add to cart" button<br>AC4: User should be able to sort products by Name (A to Z)<br>AC5: User should be able to sort products by Name (Z to A)<br>AC6: User should be able to sort products by Price (Low to High)<br>AC7: User should be able to sort products by Price (High to Low)<br>AC8: Default sort should be Name (A to Z) |

### HD-103 — Epic
| Field | Value |
|-------|-------|
| **Type** | Epic |
| **Summary** | Shopping Cart Management |
| **Parent** | HD-100 |
| **Description** | **Feature:** Shopping Cart — Add, View, Remove Products<br><br>**Scope:**<br>• Add products to cart from inventory page<br>• Cart badge counter in header<br>• Cart page with product details<br>• Remove products from cart<br><br>**Acceptance Criteria:**<br>AC1: Clicking "Add to cart" should change the button text to "Remove"<br>AC2: Cart badge icon should update with the correct count of items added<br>AC3: Clicking the cart icon should navigate to the cart page (/cart.html)<br>AC4: Cart page should display product name, quantity (1), and price for each added item<br>AC5: Clicking "Remove" on cart page should remove the item from the cart<br>AC6: After removing all items, cart badge should disappear<br>AC7: "Continue Shopping" button on cart page should navigate back to inventory page |

---

## Level 3: User Stories — Link to their respective Epics as Parent

### HD-201 — Story (Under HD-101: Authentication Epic)
| Field | Value |
|-------|-------|
| **Type** | Story |
| **Summary** | Successful Login with Valid Credentials |
| **Parent** | HD-101 |
| **Description** | **As a** registered user,<br>**I want to** log in using my valid username and password,<br>**so that** I can access the product inventory page.<br><br>**Acceptance Criteria:**<br>1. User enters `standard_user` in the username field<br>2. User enters `secret_sauce` in the password field<br>3. User clicks the "Login" button<br>4. User is redirected to `/inventory.html`<br>5. Products page is visible with 6 products listed |

### HD-202 — Story (Under HD-101: Authentication Epic)
| Field | Value |
|-------|-------|
| **Type** | Story |
| **Summary** | Login Error Handling for Invalid & Empty Credentials |
| **Parent** | HD-101 |
| **Description** | **As a** user,<br>**I want to** see clear error messages when I enter wrong credentials or leave fields empty,<br>**so that** I know what went wrong and can correct it.<br><br>**Acceptance Criteria:**<br>1. Entering invalid username/password and clicking Login should show: "Epic sadface: Username and password do not match any user in this service"<br>2. Leaving username empty and clicking Login should show: "Epic sadface: Username is required"<br>3. Leaving password empty and clicking Login should show: "Epic sadface: Password is required"<br>4. Error message should be displayed in a red error container below the login form<br>5. Error message should have a close (X) button to dismiss it |

### HD-203 — Story (Under HD-102: Inventory Epic)
| Field | Value |
|-------|-------|
| **Type** | Story |
| **Summary** | View and Sort Products on Inventory Page |
| **Parent** | HD-102 |
| **Description** | **As a** logged-in user,<br>**I want to** see all products and sort them by name or price,<br>**so that** I can find what I'm looking for quickly.<br><br>**Acceptance Criteria:**<br>1. Inventory page displays exactly 6 products<br>2. Each product card shows: product image, name, description, price, "Add to cart" button<br>3. Sort dropdown is available with options: Name (A to Z), Name (Z to A), Price (low to high), Price (high to low)<br>4. Selecting "Name (Z to A)" should reorder products in reverse alphabetical order<br>5. Selecting "Price (low to high)" should show cheapest product first ($7.99)<br>6. Selecting "Price (high to low)" should show most expensive product first ($49.99) |

### HD-204 — Story (Under HD-103: Cart Epic)
| Field | Value |
|-------|-------|
| **Type** | Story |
| **Summary** | Add Product to Cart and Verify Cart Badge |
| **Parent** | HD-103 |
| **Description** | **As a** user browsing products,<br>**I want to** add items to my cart and see the cart count update,<br>**so that** I know how many items I've selected before checking out.<br><br>**Acceptance Criteria:**<br>1. Clicking "Add to cart" on "Sauce Labs Backpack" ($29.99) should change button to "Remove"<br>2. Cart badge should show "1" after adding one product<br>3. Adding a second product ("Sauce Labs Bike Light" $9.99) should update badge to "2"<br>4. Clicking "Remove" on a product should change button back to "Add to cart"<br>5. Cart badge should decrement accordingly when an item is removed |

### HD-205 — Story (Under HD-103: Cart Epic)
| Field | Value |
|-------|-------|
| **Type** | Story |
| **Summary** | View and Remove Products from Cart Page |
| **Parent** | HD-103 |
| **Description** | **As a** user who has added items to the cart,<br>**I want to** view my cart and remove unwanted items,<br>**so that** I can finalize what I want to purchase.<br><br>**Acceptance Criteria:**<br>1. Clicking the cart icon navigates to `/cart.html`<br>2. Cart page displays each added product with: name, quantity (1), price<br>3. Each product has a "Remove" button<br>4. Clicking "Remove" removes the product from the cart page<br>5. After removing all items, the cart badge disappears from the header<br>6. "Continue Shopping" button navigates back to `/inventory.html` |

---

## Level 4: Sub-tasks — Link to their respective Stories as Parent

### HD-301 — Sub-task (Under HD-202: Error Handling Story)
| Field | Value |
|-------|-------|
| **Type** | Sub-task |
| **Summary** | Validate Error Message for Invalid Credentials |
| **Parent** | HD-202 |
| **Description** | **Test Scenario:** Verify that entering invalid username/password shows the correct error message.<br><br>**Steps:**<br>1. Navigate to https://www.saucedemo.com<br>2. Enter username: `invalid_user`<br>3. Enter password: `wrong_password`<br>4. Click "Login" button<br><br>**Expected:** Error message displayed: "Epic sadface: Username and password do not match any user in this service" |

### HD-302 — Sub-task (Under HD-202: Error Handling Story)
| Field | Value |
|-------|-------|
| **Type** | Sub-task |
| **Summary** | Validate Error Message for Empty Username |
| **Parent** | HD-202 |
| **Description** | **Test Scenario:** Verify error when username field is left empty.<br><br>**Steps:**<br>1. Navigate to https://www.saucedemo.com<br>2. Leave username field empty<br>3. Enter password: `secret_sauce`<br>4. Click "Login" button<br><br>**Expected:** Error message displayed: "Epic sadface: Username is required" |

### HD-303 — Sub-task (Under HD-204: Add to Cart Story)
| Field | Value |
|-------|-------|
| **Type** | Sub-task |
| **Summary** | Verify Cart Badge Updates When Adding Multiple Products |
| **Parent** | HD-204 |
| **Description** | **Test Scenario:** Verify cart badge count increments correctly when adding multiple products.<br><br>**Steps:**<br>1. Login with valid credentials<br>2. Click "Add to cart" on "Sauce Labs Backpack"<br>3. Verify cart badge shows "1"<br>4. Click "Add to cart" on "Sauce Labs Bike Light"<br>5. Verify cart badge shows "2"<br><br>**Expected:** Cart badge should show accurate count of items added |

---

## Visual Hierarchy Tree

```
HD-100 (Initiative) — SauceDemo E-Commerce Platform
│
├── HD-101 (Epic) — User Authentication & Login
│   ├── HD-201 (Story) — Successful Login with Valid Credentials
│   └── HD-202 (Story) — Login Error Handling
│       ├── HD-301 (Sub-task) — Validate Error for Invalid Credentials
│       └── HD-302 (Sub-task) — Validate Error for Empty Username
│
├── HD-102 (Epic) — Product Inventory & Browsing
│   └── HD-203 (Story) — View and Sort Products
│
└── HD-103 (Epic) — Shopping Cart Management
    ├── HD-204 (Story) — Add Product to Cart
    │   └── HD-303 (Sub-task) — Verify Cart Badge for Multiple Products
    └── HD-205 (Story) — View and Remove from Cart
```

---

## How B.L.A.S.T. Should Use This Hierarchy

| When user searches for | What B.L.A.S.T. should fetch | Test case scope |
|------------------------|------------------------------|-----------------|
| **HD-100** (Initiative) | All 3 Epics + all Stories + all Sub-tasks | Full regression suite for entire platform |
| **HD-101** (Epic) | Epic description + HD-201, HD-202, HD-301, HD-302 | All authentication test cases |
| **HD-202** (Story) | Story description + HD-301, HD-302 (sub-tasks) | Error handling test cases |
| **HD-301** (Sub-task) | Sub-task description + parent HD-202 context | Single focused test case |

### Key Behavior:
1. **Search an Epic** → Fetch the Epic + all child Stories + all Sub-tasks under those stories → Combine all acceptance criteria → Generate comprehensive test cases
2. **Search a Story** → Fetch the Story + its Sub-tasks + parent Epic context (for background) → Generate test cases for that story
3. **Search a Sub-task** → Fetch the Sub-task + parent Story context → Generate focused test case(s)
