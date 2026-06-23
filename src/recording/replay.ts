/**
 * Replays a Chrome DevTools Recorder recording in a single Playwright page and
 * runs the accessibility checks at each meaningful page state.
 *
 * Assessment points:
 *  - after the initial navigation and after every step that navigates
 *    (deduplicated by URL, hash ignored);
 *  - after an interaction that opens an overlay (modal/slide-over): a step with
 *    assertedEvents but no `navigation` event — assessed as a distinct state.
 *
 * Element finding is deliberately more robust than a naive `waitForSelector`:
 *  - each Chrome selector chain is resolved in the order Chrome ranked them;
 *  - among multiple matches we prefer the first *visible* one (responsive sites
 *    routinely duplicate nav/buttons, leaving the first match hidden);
 *  - `aria/` selectors map to `getByRole` across interactive roles rather than a
 *    brittle attribute string;
 *  - `text/` selectors match as a substring rather than an exact string.
 */

import type { BrowserContext, Locator, Page } from 'playwright';
import type { Finding } from '../checks/types.js';
import type { Logger } from '../services/Logger.js';
import { waitForReady, type WaitOptions } from '../runner/waitForReady.js';
import {
  hasNavigationEvent,
  isOverlayInteraction,
  stepLabel,
  toPwSelector,
  type InteractionStep,
  type Recording,
  type RecordingStep,
} from './parser.js';

/** Per-selector wait for an element to attach (ms). */
const ATTACH_TIMEOUT = 4_000;
/** Cap on actionable interactions (ms). */
const ACTION_TIMEOUT = 10_000;
/** Navigation wait after a navigating step (ms). */
const NAV_TIMEOUT = 15_000;
/** Upper bound on how many matches we scan for a visible one. */
const MAX_MATCH_SCAN = 20;

/** Interactive ARIA roles tried when resolving an `aria/<name>` selector. */
const ARIA_ROLES = [
  'link',
  'button',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'searchbox',
  'spinbutton',
  'slider',
  'heading',
] as const satisfies ReadonlyArray<Parameters<Page['getByRole']>[0]>;

export interface ReplayArgs {
  context: BrowserContext;
  recording: Recording;
  wait: WaitOptions;
  logger: Logger;
  /** Runs the full check suite on the current page; returns the findings. */
  runChecks: (page: Page, url: string, pageTitle: string, stepIndex: number) => Promise<Finding[]>;
}

export interface ReplayResult {
  findings: Finding[];
  urlsScanned: string[];
  pageTitles: Record<string, string>;
}

export async function replayRecording(args: ReplayArgs): Promise<ReplayResult> {
  const { context, recording, wait, logger, runChecks } = args;
  const page = await context.newPage();

  const findings: Finding[] = [];
  const urlsScanned: string[] = [];
  const pageTitles: Record<string, string> = {};
  const assessedUrls = new Set<string>();

  /** Run the checks against the current page under `groupKey`. */
  const record = async (groupKey: string, stepIndex: number): Promise<void> => {
    await waitForReady(page, wait, logger);
    const title = await page.title().catch(() => '');
    pageTitles[groupKey] = title;
    if (!urlsScanned.includes(groupKey)) urlsScanned.push(groupKey);
    const found = await runChecks(page, groupKey, title, stepIndex);
    findings.push(...found);
  };

  /** Assess a navigated page, deduplicated by URL (hash ignored). */
  const assessPage = async (stepIndex: number): Promise<void> => {
    const url = page.url();
    const key = stripHash(url);
    if (assessedUrls.has(key)) {
      logger.debug(`Skipping already-assessed page: ${key}`);
      return;
    }
    assessedUrls.add(key);
    logger.info(`Assessing page: ${url}`);
    await record(url, stepIndex);
  };

  /** Assess an overlay state as a distinct, labelled group. */
  const assessOverlay = async (stepIndex: number, label: string): Promise<void> => {
    const groupKey = `${page.url()} » ${label}`;
    logger.info(`Assessing overlay state: ${groupKey}`);
    await record(groupKey, stepIndex);
  };

  try {
    for (let i = 0; i < recording.steps.length; i++) {
      const step = recording.steps[i]!;
      const label = stepLabel(step);
      const urlBefore = page.url();
      logger.info(`Step ${i + 1}/${recording.steps.length}: ${label}`);

      try {
        await executeStep(page, step, logger);
      } catch (err) {
        // Best-effort: a single failed step should not abort the whole journey.
        logger.warn(`Step ${i + 1} (${step.type}) failed: ${(err as Error).message}`);
        continue;
      }

      const urlAfter = page.url();
      const navigated =
        step.type === 'navigate' || hasNavigationEvent(step) || stripHash(urlBefore) !== stripHash(urlAfter);

      if (navigated) {
        await assessPage(i);
      } else if (isOverlayInteraction(step)) {
        await assessOverlay(i, label);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return { findings, urlsScanned, pageTitles };
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

async function executeStep(page: Page, step: RecordingStep, logger: Logger): Promise<void> {
  switch (step.type) {
    case 'setViewport':
      await page.setViewportSize({ width: step.width, height: step.height });
      return;

    case 'navigate':
      await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      return;

    case 'click':
    case 'doubleClick': {
      const el = await findTarget(page, step);
      if (step.type === 'doubleClick') await el.dblclick({ timeout: ACTION_TIMEOUT });
      else await el.click({ timeout: ACTION_TIMEOUT });
      if (hasNavigationEvent(step)) await waitForNavigation(page);
      return;
    }

    case 'change': {
      const el = await findTarget(page, step);
      const tag = await el.evaluate((n) => (n as Element).tagName.toLowerCase());
      if (tag === 'select') await el.selectOption(step.value ?? '', { timeout: ACTION_TIMEOUT });
      else await el.fill(step.value ?? '', { timeout: ACTION_TIMEOUT });
      return;
    }

    case 'keyDown':
      await page.keyboard.down(step.key ?? '');
      if (hasNavigationEvent(step)) await waitForNavigation(page);
      return;

    case 'keyUp':
      await page.keyboard.up(step.key ?? '');
      return;

    case 'hover': {
      const el = await findTarget(page, step);
      await el.hover({ timeout: ACTION_TIMEOUT });
      return;
    }

    case 'scroll': {
      if (step.selectors && step.selectors.length > 0) {
        const el = await findTarget(page, step);
        await el.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT });
      } else {
        await page.mouse.wheel(step.offsetX ?? 0, step.offsetY ?? 600);
      }
      return;
    }

    case 'waitForElement': {
      const el = await findTarget(page, step);
      await el.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT });
      return;
    }

    case 'waitForExpression':
      if (step.expression) await page.waitForFunction(step.expression, { timeout: ACTION_TIMEOUT });
      return;

    default:
      logger.warn(`Unknown step type: ${(step as RecordingStep).type}`);
  }
}

async function waitForNavigation(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Element finding (the robust part)
// ---------------------------------------------------------------------------

/**
 * Resolve the element an interaction step targets, trying Chrome's selector
 * chains in order and preferring the first *visible* match.
 */
async function findTarget(page: Page, step: InteractionStep): Promise<Locator> {
  const chains = step.selectors ?? [];
  if (chains.length === 0) throw new Error(`Step "${step.type}" has no selectors`);

  const tried: string[] = [];
  for (const chain of chains) {
    const loc = chainToLocator(page, chain);
    if (!loc) continue;
    const desc = chain.join(' >> ');
    try {
      await loc.first().waitFor({ state: 'attached', timeout: ATTACH_TIMEOUT });
    } catch {
      tried.push(`${desc} (not found)`);
      continue;
    }
    const resolved = await preferVisible(loc);
    if (resolved) return resolved;
    tried.push(`${desc} (no usable match)`);
  }

  throw new Error(`Could not find element for "${step.type}". Tried:\n  ${tried.join('\n  ')}`);
}

/**
 * Build a Playwright Locator for one Chrome selector chain.
 * A chain with >1 entry pierces nested scopes (shadow DOM / frames) — each entry
 * is resolved within the previous one. `aria/` is only supported as a standalone
 * chain (it cannot scope sub-locators).
 */
function chainToLocator(page: Page, chain: string[]): Locator | null {
  if (chain.length === 0) return null;
  if (chain.length === 1 && chain[0]!.startsWith('aria/')) {
    return ariaLocator(page, chain[0]!.slice('aria/'.length));
  }
  let current: Locator | null = null;
  for (const raw of chain) {
    if (raw.startsWith('aria/')) return null; // can't use accessible-name as a scope
    const sel = toPwSelector(raw);
    current = current ? current.locator(sel) : page.locator(sel);
  }
  return current;
}

/**
 * Match an element by accessible name across interactive roles. Chrome records
 * `aria/<accessible name>` without a role, so we OR the common roles together.
 */
function ariaLocator(page: Page, rawName: string): Locator {
  const name = rawName.trim();
  let loc = page.getByRole(ARIA_ROLES[0], { name, exact: false });
  for (let i = 1; i < ARIA_ROLES.length; i++) {
    loc = loc.or(page.getByRole(ARIA_ROLES[i]!, { name, exact: false }));
  }
  return loc;
}

/**
 * Return the first visible match, falling back to the first attached match when
 * none are visible. This is the key fix over a plain `waitForSelector`, which
 * returns the first attached element even when it is a hidden duplicate.
 */
async function preferVisible(loc: Locator): Promise<Locator | null> {
  const total = await loc.count();
  if (total === 0) return null;
  const scan = Math.min(total, MAX_MATCH_SCAN);
  for (let i = 0; i < scan; i++) {
    const nth = loc.nth(i);
    try {
      if (await nth.isVisible()) return nth;
    } catch {
      /* element churned during resolution — try the next */
    }
  }
  return loc.first();
}

function stripHash(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}
