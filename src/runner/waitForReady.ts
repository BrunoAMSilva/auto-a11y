import type { Page } from 'playwright';
import type { Logger } from '../services/Logger.js';

export interface WaitOptions {
  /** Selector that must be visible before scanning. */
  waitForSelector?: string;
  /** Wait for document.title to become non-empty as part of the rendered check. Default true. */
  waitForTitle?: boolean;
  /** Wait until no DOM mutations for this many ms. Default 500. */
  domStableForMs?: number;
  /** Cap for the DOM-stability wait. Default 5000. */
  domStableTimeoutMs?: number;
  /** Cap on the positive "rendered" wait (title + meaningful body content). Default 10000. */
  renderedTimeoutMs?: number;
  /** Fixed extra delay after readiness. Default 0. */
  extraWaitMs?: number;
  /** Cap for the networkidle wait. Default 4000. Set 0 to skip. */
  networkIdleTimeoutMs?: number;
  /** Hard ceiling for the entire waitForReady call. Default 20000. */
  overallTimeoutMs?: number;
}

export interface FrameworkInfo {
  framework: 'angular' | 'react' | 'vue' | 'svelte' | 'unknown';
  version?: string;
}

const DEFAULTS: Required<Omit<WaitOptions, 'waitForSelector'>> = {
  waitForTitle: true,
  domStableForMs: 500,
  domStableTimeoutMs: 5000,
  extraWaitMs: 0,
  networkIdleTimeoutMs: 4000,
  overallTimeoutMs: 20000,
  renderedTimeoutMs: 10000,
};

const BENIGN_RE = /(Target.*closed|Execution context was destroyed|frame was detached|context (?:was )?destroyed)/i;

function isBenign(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return BENIGN_RE.test(msg);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    p.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        if (isBenign(err)) {
          resolve(null);
        } else {
          // Swallow but log via the resolver returning null; caller decides.
          resolve(null);
        }
      },
    );
  });
}

/**
 * Best-effort SPA-aware wait. Every step is bounded; benign navigation-related
 * errors (execution-context destroyed, target closed) are absorbed so a
 * client-side route change never aborts the scan.
 */
export async function waitForReady(
  page: Page,
  opts: WaitOptions,
  logger: Logger,
): Promise<{ framework: FrameworkInfo; emptyContent: boolean }> {
  // Important: caller may pass `undefined` for unset flags; do NOT let those
  // override defaults via object spread.
  const cleanOpts = Object.fromEntries(
    Object.entries(opts).filter(([, v]) => v !== undefined),
  ) as Partial<WaitOptions>;
  const cfg: typeof DEFAULTS & Pick<WaitOptions, 'waitForSelector'> = {
    ...DEFAULTS,
    ...cleanOpts,
  };
  const started = Date.now();
  const remaining = () => Math.max(0, cfg.overallTimeoutMs - (Date.now() - started));

  // 1. networkidle — best effort, often never settles on SPAs.
  if (cfg.networkIdleTimeoutMs > 0) {
    await withTimeout(
      page.waitForLoadState('networkidle', { timeout: cfg.networkIdleTimeoutMs }),
      Math.min(cfg.networkIdleTimeoutMs, remaining()),
      'networkidle',
    );
  }

  // 2. Detect framework (cheap).
  let framework: FrameworkInfo = { framework: 'unknown' };
  try {
    framework = await detectFramework(page);
    if (framework.framework !== 'unknown') {
      logger.debug(
        `Detected framework: ${framework.framework}${framework.version ? ' ' + framework.version : ''}`,
      );
    }
  } catch (err) {
    if (!isBenign(err)) logger.debug(`detectFramework failed: ${(err as Error).message}`);
  }

  // 3. Wait for "rendered AND stable for N ms". A prerendered SPA shell satisfies
  //    title + content thresholds before the framework boots — and the framework
  //    will often clear/replace the title during hydration. So we require the
  //    rendered signal to hold continuously for a stability window before
  //    accepting it.
  if (remaining() > 0) {
    const requireTitle = cfg.waitForTitle !== false;
    const limit = Math.min(cfg.renderedTimeoutMs, remaining());
    const stableMs = Math.min(800, Math.max(400, cfg.domStableForMs));
    const t0 = Date.now();
    const rendered = await withTimeout(
      page.waitForFunction(
        ({ requireTitle, stableMs }) => {
          if (typeof document === 'undefined') return false;
          const body = document.body;
          if (!body) return false;
          const titleOk = !requireTitle || document.title.trim().length > 0;
          const meaningful = body.querySelectorAll(
            ':not(script):not(style):not(noscript):not(template)',
          ).length;
          const textLen = (body.innerText || '').trim().length;
          const isRendered = titleOk && meaningful >= 15 && textLen >= 100;
          const w = window as unknown as { __a11yReady?: { firstAt: number | null } };
          w.__a11yReady ??= { firstAt: null };
          if (!isRendered) {
            w.__a11yReady.firstAt = null;
            return false;
          }
          if (w.__a11yReady.firstAt === null) {
            w.__a11yReady.firstAt = performance.now();
            return false;
          }
          return performance.now() - w.__a11yReady.firstAt >= stableMs;
        },
        { requireTitle, stableMs },
        { timeout: limit, polling: 150 },
      ),
      limit + 500,
      'rendered',
    );
    const elapsed = Date.now() - t0;
    if (rendered === null) {
      logger.warn(`rendered-and-stable signal not met after ${elapsed}ms (continuing)`);
    } else {
      logger.info(`rendered-and-stable in ${elapsed}ms (stableMs=${stableMs})`);
    }
  }

  // 4. Optional selector gate.
  if (cfg.waitForSelector && remaining() > 0) {
    const got = await withTimeout(
      page.locator(cfg.waitForSelector).first().waitFor({ state: 'visible', timeout: Math.min(8000, remaining()) }),
      Math.min(8500, remaining()),
      'selector',
    );
    if (got === null) {
      logger.warn(`waitFor selector '${cfg.waitForSelector}' did not appear`);
    }
  }

  // 5. DOM stability — works for any framework.
  if (remaining() > 0) {
    await withTimeout(
      waitForDomStable(page, cfg.domStableForMs, Math.min(cfg.domStableTimeoutMs, remaining())),
      Math.min(cfg.domStableTimeoutMs + 500, remaining()),
      'dom-stable',
    );
  }

  // 6. Optional fixed padding.
  if (cfg.extraWaitMs > 0) {
    await page.waitForTimeout(cfg.extraWaitMs).catch(() => {});
  }

  // 7. Empty-content heuristic.
  let emptyContent = false;
  try {
    emptyContent = await isContentEffectivelyEmpty(page);
  } catch (err) {
    if (!isBenign(err)) logger.debug(`empty-content check failed: ${(err as Error).message}`);
  }
  if (emptyContent) {
    logger.warn(
      'Page rendered with very little content — SPA may not have hydrated. ' +
        'Try --wait-for "<selector>" or --wait-ms 1500.',
    );
  }

  return { framework, emptyContent };
}

async function detectFramework(page: Page): Promise<FrameworkInfo> {
  return page.evaluate((): FrameworkInfo => {
    const ngVersion = document.querySelector('[ng-version]');
    if (ngVersion) {
      return { framework: 'angular', version: ngVersion.getAttribute('ng-version') || undefined };
    }
    const w = window as unknown as Record<string, unknown>;
    if (typeof w['ng'] !== 'undefined' || typeof w['getAllAngularRootElements'] === 'function') {
      return { framework: 'angular' };
    }
    if (
      document.querySelector('[data-reactroot]') ||
      typeof w['React'] !== 'undefined' ||
      w['__REACT_DEVTOOLS_GLOBAL_HOOK__']
    ) {
      return { framework: 'react' };
    }
    if (typeof w['__VUE__'] !== 'undefined' || document.querySelector('[data-v-app]')) {
      return { framework: 'vue' };
    }
    if (document.querySelector('[class*="svelte-"]')) {
      return { framework: 'svelte' };
    }
    return { framework: 'unknown' };
  });
}

async function waitForDomStable(page: Page, stableForMs: number, timeoutMs: number): Promise<void> {
  await page.evaluate(
    ({ stableForMs, timeoutMs }) =>
      new Promise<void>((resolve) => {
        let lastMutation = performance.now();
        const start = performance.now();
        // Throttle: many SPAs fire constant mutations; we only need to know the
        // most recent timestamp, not every individual mutation.
        const observer = new MutationObserver(() => {
          lastMutation = performance.now();
        });
        try {
          observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });
        } catch {
          resolve();
          return;
        }
        const tick = () => {
          const now = performance.now();
          if (now - lastMutation >= stableForMs || now - start >= timeoutMs) {
            try { observer.disconnect(); } catch {}
            resolve();
            return;
          }
          setTimeout(tick, 100);
        };
        setTimeout(tick, Math.min(stableForMs, 200));
      }),
    { stableForMs, timeoutMs },
  );
}

async function isContentEffectivelyEmpty(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const body = document.body;
    if (!body) return true;
    const meaningful = body.querySelectorAll(
      ':not(script):not(style):not(noscript):not(template)',
    ).length;
    const textLen = (body.innerText || '').trim().length;
    return meaningful < 10 && textLen < 50;
  });
}
