/**
 * codegen-doc-comments.test.ts — the DOC-COMMENT gate makes intent comments MECHANICAL, not best-effort.
 *
 * assertDocComments requires a one-line JSDoc header on each Page/Module class, a one-line JSDoc on each PUBLIC
 * Module method, and a one-line // scenario comment above each test(). Symbols already present on disk are
 * grandfathered so APPEND-ONLY extends never deadlock the self-repair loop — only NEWLY added ones are enforced.
 *
 * Runs with the Node built-in test runner via tsx: `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertDocComments } from '../codegen';

type Artifact = { file: string; content: string };
type Candidate = { domain: string; page: Artifact; module: Artifact; spec: Artifact };

const makeFw = (): string => mkdtempSync(join(tmpdir(), 'blast-doc-comments-'));
const cleanup = (fw: string): void => rmSync(fw, { recursive: true, force: true });

function writeFile(fw: string, rel: string, content: string): void {
  const abs = join(fw, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

// Every artifact defaults to empty content (a layer with empty content is skipped by the gate).
const mkCandidate = (over: Partial<Candidate>): Candidate => ({
  domain: 'example.com',
  page: { file: 'src/pages/WidgetPage.ts', content: '' },
  module: { file: 'src/modules/WidgetModule.ts', content: '' },
  spec: { file: 'src/tests/widget.spec.ts', content: '' },
  ...over,
});

const goodPage = `import { type Page, type Locator } from '@playwright/test';
/** Widget screen — locators only. */
export class WidgetPage {
  constructor(private readonly page: Page) {}
  readonly title = (): Locator => this.page.locator('h1');
}
`;

const goodModule = `import { type Page } from '@playwright/test';
import { WidgetPage } from '../pages/WidgetPage';
/** Widget workflow: open the screen and submit the form. */
export class WidgetModule {
  private readonly widget: WidgetPage;
  constructor(page: Page) { this.widget = new WidgetPage(page); }
  /** Open the widget page. */
  async goto(): Promise<void> { await this.widget.title().waitFor(); }
  /** Submit the widget form. */
  async submit(): Promise<void> { await this.widget.title().click(); }
}
`;

const goodSpec = `import { test, expect } from '@playwright/test';
test.describe('Widget', () => {
  // Submitting valid data lands on the success screen.
  test('TC_001 submit succeeds', async ({ page }) => {
    expect(page).toBeTruthy();
  });
});
`;

test('fully-commented Page + Module + Spec passes', () => {
  const fw = makeFw();
  try {
    assert.doesNotThrow(() =>
      assertDocComments(fw, mkCandidate({
        page: { file: 'src/pages/WidgetPage.ts', content: goodPage },
        module: { file: 'src/modules/WidgetModule.ts', content: goodModule },
        spec: { file: 'src/tests/widget.spec.ts', content: goodSpec },
      })));
  } finally {
    cleanup(fw);
  }
});

test('missing Page class header fails', () => {
  const fw = makeFw();
  try {
    const badPage = goodPage.replace('/** Widget screen — locators only. */\n', '');
    assert.throws(
      () => assertDocComments(fw, mkCandidate({ page: { file: 'src/pages/WidgetPage.ts', content: badPage } })),
      /class WidgetPage needs a one-line JSDoc header/,
    );
  } finally {
    cleanup(fw);
  }
});

test('missing Module method comment fails (only the uncommented method is flagged)', () => {
  const fw = makeFw();
  try {
    const badModule = goodModule.replace('  /** Submit the widget form. */\n', '');
    assert.throws(
      () => assertDocComments(fw, mkCandidate({ module: { file: 'src/modules/WidgetModule.ts', content: badModule } })),
      (err: Error) => /method submit\(\) needs a one-line JSDoc/.test(err.message) && !/method goto\(\)/.test(err.message),
    );
  } finally {
    cleanup(fw);
  }
});

test('missing Spec test() scenario comment fails', () => {
  const fw = makeFw();
  try {
    const badSpec = `import { test, expect } from '@playwright/test';
test('TC_001 submit succeeds', async ({ page }) => {
  expect(page).toBeTruthy();
});
`;
    assert.throws(
      () => assertDocComments(fw, mkCandidate({ spec: { file: 'src/tests/widget.spec.ts', content: badSpec } })),
      /test\('TC_001 submit succeeds'\) needs a one-line \/\/ comment/,
    );
  } finally {
    cleanup(fw);
  }
});

test('grandfathering: an EXISTING uncommented test on disk is not enforced; a NEW commented test passes', () => {
  const fw = makeFw();
  try {
    const diskSpec = `import { test, expect } from '@playwright/test';
test('TC_001 legacy', async ({ page }) => { expect(page).toBeTruthy(); });
`;
    writeFile(fw, 'src/tests/widget.spec.ts', diskSpec);
    const extendGood = `import { test, expect } from '@playwright/test';
test('TC_001 legacy', async ({ page }) => { expect(page).toBeTruthy(); });
// Invalid data keeps the user on the form with an error.
test('TC_002 invalid', async ({ page }) => { expect(page).toBeTruthy(); });
`;
    assert.doesNotThrow(() =>
      assertDocComments(fw, mkCandidate({ spec: { file: 'src/tests/widget.spec.ts', content: extendGood } })));
  } finally {
    cleanup(fw);
  }
});

test('grandfathering: a NEW uncommented test IS enforced while the legacy one is left alone', () => {
  const fw = makeFw();
  try {
    const diskSpec = `import { test, expect } from '@playwright/test';
test('TC_001 legacy', async ({ page }) => { expect(page).toBeTruthy(); });
`;
    writeFile(fw, 'src/tests/widget.spec.ts', diskSpec);
    const extendBad = `import { test, expect } from '@playwright/test';
test('TC_001 legacy', async ({ page }) => { expect(page).toBeTruthy(); });
test('TC_002 invalid', async ({ page }) => { expect(page).toBeTruthy(); });
`;
    assert.throws(
      () => assertDocComments(fw, mkCandidate({ spec: { file: 'src/tests/widget.spec.ts', content: extendBad } })),
      (err: Error) => /test\('TC_002 invalid'\) needs a one-line \/\/ comment/.test(err.message)
        && !/TC_001 legacy/.test(err.message),
    );
  } finally {
    cleanup(fw);
  }
});
