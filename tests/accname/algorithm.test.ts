import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeAccessibleName } from '../../src/accname/index.js';

const browsersPath = resolve(process.cwd(), '.ms-playwright');
const browsersInstalled = existsSync(browsersPath) && hasAnyBrowser(browsersPath);

function hasAnyBrowser(dir: string): boolean {
  try {
    const fs = require('node:fs');
    const entries = fs.readdirSync(dir);
    return entries.some((e: string) => e.startsWith('chromium'));
  } catch {
    return false;
  }
}

describe.skipIf(!browsersInstalled)('computeAccessibleName', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    process.env['PLAYWRIGHT_BROWSERS_PATH'] = browsersPath;
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  const cases: Array<{ name: string; html: string; selector: string; expected: string }> = [
    {
      name: 'aria-label wins over content',
      html: `<button id="t" aria-label="Close dialog">×</button>`,
      selector: '#t',
      expected: 'Close dialog',
    },
    {
      name: 'aria-labelledby walks IDREFs',
      html: `<span id="lbl">Save</span><span id="lbl2">changes</span><button id="t" aria-labelledby="lbl lbl2">x</button>`,
      selector: '#t',
      expected: 'Save changes',
    },
    {
      name: 'name from content for button',
      html: `<button id="t">Submit</button>`,
      selector: '#t',
      expected: 'Submit',
    },
    {
      name: 'native label[for] for input',
      html: `<label for="t">Email address</label><input id="t" type="email">`,
      selector: '#t',
      expected: 'Email address',
    },
    {
      name: 'wrapping label for input',
      html: `<label><input id="t" type="checkbox"> I agree</label>`,
      selector: '#t',
      expected: 'I agree',
    },
    {
      name: 'img alt attribute',
      html: `<img id="t" src="x" alt="Company logo">`,
      selector: '#t',
      expected: 'Company logo',
    },
    {
      name: 'title fallback',
      html: `<span id="t" role="button" title="hint"></span>`,
      selector: '#t',
      expected: 'hint',
    },
    {
      name: 'hidden node has no name',
      html: `<button id="t" aria-hidden="true">Hidden</button>`,
      selector: '#t',
      expected: '',
    },
    {
      name: 'figure with figcaption',
      html: `<figure id="t"><img src="x" alt=""><figcaption>Chart</figcaption></figure>`,
      selector: '#t',
      expected: 'Chart',
    },
  ];

  for (const tc of cases) {
    it(tc.name, async () => {
      await page.setContent(`<!doctype html><html><body>${tc.html}</body></html>`);
      const handle = await page.locator(tc.selector).elementHandle();
      expect(handle).not.toBeNull();
      const name = await computeAccessibleName(handle!);
      expect(name).toBe(tc.expected);
    });
  }
});
