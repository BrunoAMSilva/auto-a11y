import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayRecording } from '../../src/recording/replay.js';
import type { Recording } from '../../src/recording/parser.js';
import { createLogger } from '../../src/services/Logger.js';
import type { Finding } from '../../src/checks/types.js';

const browsersPath = resolve(process.cwd(), '.ms-playwright');
const hasBrowsers =
  existsSync(browsersPath) && readdirSync(browsersPath).some((e) => e.startsWith('chromium'));

// Keep waitForReady fast — these fixtures are tiny and never reach the
// "rendered" content thresholds, so we cap every wait stage low.
const FAST_WAIT = {
  networkIdleTimeoutMs: 0,
  renderedTimeoutMs: 300,
  domStableTimeoutMs: 300,
  overallTimeoutMs: 1000,
};

const dataUrl = (html: string) => `data:text/html,${encodeURIComponent(html)}`;

describe.skipIf(!hasBrowsers)('replayRecording', () => {
  let browser: Browser;
  let context: BrowserContext;

  beforeAll(async () => {
    process.env['PLAYWRIGHT_BROWSERS_PATH'] = browsersPath;
    browser = await chromium.launch();
    context = await browser.newContext();
  });

  afterAll(async () => {
    await context?.close();
    await browser?.close();
  });

  // The check stub records the page title at each assessment so a test can
  // assert which element was actually interacted with.
  const titleCapturingChecks = (sink: string[]) => async (page: Page): Promise<Finding[]> => {
    sink.push(await page.title());
    return [];
  };

  it('clicks the visible match when an earlier match is hidden', async () => {
    const html = `<!doctype html><html><head><title>start</title></head><body>
      <button class="target" style="display:none" onclick="document.title='HIDDEN'">A</button>
      <button class="target" onclick="document.title='VISIBLE'">B</button>
    </body></html>`;

    const recording: Recording = {
      title: 'visible-first',
      steps: [
        { type: 'navigate', url: dataUrl(html), assertedEvents: [{ type: 'navigation' }] },
        // assertedEvents (non-navigation) makes this an overlay assessment point
        { type: 'click', selectors: [['.target']], assertedEvents: [{ type: 'click-asserted' }] },
      ],
    };

    const titles: string[] = [];
    const result = await replayRecording({
      context,
      recording,
      wait: FAST_WAIT,
      logger: createLogger({ level: 'error' }),
      runChecks: titleCapturingChecks(titles),
    });

    // The overlay assessment runs after the click; the title proves the visible
    // (second) button was clicked, not the hidden first one.
    expect(titles).toContain('VISIBLE');
    expect(titles).not.toContain('HIDDEN');
    // Two assessment points: the initial navigation and the overlay click.
    expect(result.urlsScanned.length).toBe(2);
  });

  it('resolves aria/<name> selectors via accessible role + name', async () => {
    const html = `<!doctype html><html><head><title>start</title></head><body>
      <button onclick="document.title='SUBMITTED'">Submit</button>
    </body></html>`;

    const recording: Recording = {
      title: 'aria',
      steps: [
        { type: 'navigate', url: dataUrl(html), assertedEvents: [{ type: 'navigation' }] },
        { type: 'click', selectors: [['aria/Submit']], assertedEvents: [{ type: 'click-asserted' }] },
      ],
    };

    const titles: string[] = [];
    await replayRecording({
      context,
      recording,
      wait: FAST_WAIT,
      logger: createLogger({ level: 'error' }),
      runChecks: titleCapturingChecks(titles),
    });

    expect(titles).toContain('SUBMITTED');
  });

  it('deduplicates assessments of the same URL', async () => {
    const html = `<!doctype html><html><head><title>same</title></head><body><a id="x">x</a></body></html>`;
    const url = dataUrl(html);

    const recording: Recording = {
      title: 'dedupe',
      steps: [
        { type: 'navigate', url, assertedEvents: [{ type: 'navigation' }] },
        // Re-navigating to the same URL should NOT produce a second assessment.
        { type: 'navigate', url, assertedEvents: [{ type: 'navigation' }] },
      ],
    };

    const titles: string[] = [];
    const result = await replayRecording({
      context,
      recording,
      wait: FAST_WAIT,
      logger: createLogger({ level: 'error' }),
      runChecks: titleCapturingChecks(titles),
    });

    expect(result.urlsScanned.length).toBe(1);
  });

  it('continues the journey when a step cannot find its element', async () => {
    const html = `<!doctype html><html><head><title>start</title></head><body>
      <button onclick="document.title='OK'">Go</button>
    </body></html>`;

    const recording: Recording = {
      title: 'resilient',
      steps: [
        { type: 'navigate', url: dataUrl(html), assertedEvents: [{ type: 'navigation' }] },
        // Selector that matches nothing — must not abort the run.
        { type: 'click', selectors: [['#does-not-exist']], assertedEvents: [{ type: 'click-asserted' }] },
      ],
    };

    const titles: string[] = [];
    const result = await expect(
      replayRecording({
        context,
        recording,
        wait: FAST_WAIT,
        logger: createLogger({ level: 'error' }),
        runChecks: titleCapturingChecks(titles),
      }),
    ).resolves.toBeDefined();
    void result;
    // The initial navigation was still assessed.
    expect(titles).toContain('start');
  });
});
