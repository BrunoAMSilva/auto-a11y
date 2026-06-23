import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderReport } from '../../src/reporter/template.js';
import { buildReport } from '../../src/reporter/views.js';
import type { Finding } from '../../src/checks/types.js';

const browsersPath = resolve(process.cwd(), '.ms-playwright');
const hasBrowsers =
  existsSync(browsersPath) && readdirSync(browsersPath).some((e) => e.startsWith('chromium'));

// A fixture exercising every impact badge, a screenshot image, and a validation.
const findings: Finding[] = [
  {
    command: 'axe-core',
    stepName: 'axe-core',
    stepNumber: 1,
    url: 'https://example.com/',
    pageTitle: 'Example Home',
    violations: (['critical', 'serious', 'moderate', 'minor'] as const).map((impact) => ({
      id: `rule-${impact}`,
      impact,
      description: `${impact} description`,
      help: `Fix the ${impact} issue`,
      helpUrl: 'https://example.com/help',
      wcag: ['1.1.1'],
      nodes: [{ target: `div.${impact}`, html: `<div class="${impact}">x</div>`, screenshotPath: 'shot.png' }],
    })),
    validations: [
      { type: 'iframe-title', description: 'iframes have titles', help: '', nodes: [{ target: 'iframe', html: '<iframe>' }] },
    ],
  },
];

const html = renderReport(buildReport(findings, ['https://example.com/'], { 'https://example.com/': 'Example Home' }));

describe('renderReport — structure', () => {
  it('has exactly one h1', () => {
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
  });

  it('never nests an interactive link inside a <summary>', () => {
    const summaries = html.match(/<summary>[\s\S]*?<\/summary>/g) ?? [];
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) expect(s).not.toMatch(/<a\b/);
  });

  it('wires tabs to their panels (aria-controls + role=tabpanel + aria-labelledby)', () => {
    expect(html).toContain('role="tab" id="tab-by-page" aria-selected="true" aria-controls="by-page"');
    expect(html).toContain('id="by-page" class="view active" role="tabpanel" aria-labelledby="tab-by-page"');
  });

  it('gives screenshots descriptive alt text', () => {
    expect(html).toContain('alt="Screenshot of the failing element div.critical"');
    expect(html).not.toContain('alt="screenshot"');
  });

  it('keeps the theme toggle label and accessible name in sync (no overriding aria-label)', () => {
    expect(html).toContain('id="themeToggle">Switch to light theme</button>');
    expect(html).not.toMatch(/themeToggle"[^>]*aria-label/);
  });
});

describe.skipIf(!hasBrowsers)('renderReport — axe-core self-audit', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    process.env['PLAYWRIGHT_BROWSERS_PATH'] = browsersPath;
    browser = await chromium.launch();
    context = await browser.newContext();
    page = await context.newPage();
  });

  afterAll(async () => {
    await context?.close();
    await browser?.close();
  });

  it('keeps tabs and theme toggle working even when localStorage is blocked', async () => {
    await page.setContent(html);
    // setContent yields an opaque origin where localStorage throws — the script
    // must survive that so the whole interactive layer doesn't die.
    await page.click('#tab-by-issue');
    expect(await page.evaluate(() => document.querySelector('.view.active')?.id)).toBe('by-issue');
    await page.click('#themeToggle');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  });

  it.each(['dark', 'light'])('the generated report has no WCAG A/AA violations (%s theme)', async (theme) => {
    await page.setContent(html);
    // Disable transitions so we audit the settled theme colors, not a frame
    // mid-way through the toggle's 150ms cross-fade.
    await page.addStyleTag({ content: '*,*::before,*::after{transition:none !important;animation:none !important}' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    // Surface the rule ids if this ever regresses.
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
