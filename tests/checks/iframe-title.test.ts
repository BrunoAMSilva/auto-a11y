import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { iframeTitleCheck } from '../../src/checks/iframe-title.js';
import { StandardsService } from '../../src/services/StandardsService.js';
import { createLogger } from '../../src/services/Logger.js';
import type { CheckContext, Finding } from '../../src/checks/types.js';

const browsersPath = resolve(process.cwd(), '.ms-playwright');
const hasBrowsers =
  existsSync(browsersPath) &&
  readdirSync(browsersPath).some((e) => e.startsWith('chromium'));

describe.skipIf(!hasBrowsers)('iframeTitleCheck', () => {
  let browser: Browser;
  let page: Page;
  const outputDir = mkdtempSync(join(tmpdir(), 'a11y-test-'));

  beforeAll(async () => {
    process.env['PLAYWRIGHT_BROWSERS_PATH'] = browsersPath;
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  const buildCtx = (findings: Finding[]): CheckContext => {
    const standards = StandardsService.load();
    return {
      page,
      url: 'about:blank',
      pageTitle: 'test',
      stepIndex: 0,
      accessibilityFindings: findings,
      wcagIndex: standards.wcagIndex,
      standards,
      logger: createLogger({ level: 'error' }),
      outputDir,
      source: 'custom',
    };
  };

  it('flags iframe without an accessible name', async () => {
    await page.setContent(`<iframe src="about:blank"></iframe>`);
    const findings: Finding[] = [];
    await iframeTitleCheck.run(buildCtx(findings));
    expect(findings.length).toBe(1);
    expect(findings[0]!.violations[0]!.id).toBe('iframe-title');
    expect(findings[0]!.violations[0]!.nodes).toHaveLength(1);
  });

  it('passes an iframe with a title', async () => {
    await page.setContent(`<iframe src="about:blank" title="Help video"></iframe>`);
    const findings: Finding[] = [];
    await iframeTitleCheck.run(buildCtx(findings));
    expect(findings.length).toBe(1);
    expect(findings[0]!.violations).toHaveLength(0);
    expect(findings[0]!.validations).toHaveLength(1);
  });

  it('skips hidden iframes', async () => {
    await page.setContent(`<iframe src="about:blank" aria-hidden="true"></iframe>`);
    const findings: Finding[] = [];
    await iframeTitleCheck.run(buildCtx(findings));
    expect(findings.length).toBe(0);
  });
});
