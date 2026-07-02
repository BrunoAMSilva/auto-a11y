/**
 * AssessmentRunner — runs the ported engine plugins against a single page and
 * returns auto-a11y Findings.
 *
 * One instance is created per scan run so cross-page state (runStore, page-title
 * history, the per-page element-screenshot budget) is shared exactly as the
 * engine's AssessmentEngine shared it. Ported, minus the engine's DB-bound
 * concerns (component detection, artifact manager, WebP compression): screenshots
 * are written as PNGs into auto-a11y's `assets/screenshots/` directory.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { ElementHandle, Page } from 'playwright';
import { screenshotDirFor } from '../browser/launch.js';
import type { Finding } from '../checks/types.js';
import type { Logger } from '../services/Logger.js';
import type { StandardsService } from '../services/StandardsService.js';
import { preparePageForPlugins } from './ax-tree.js';
import { assessmentPlugins } from './plugins.js';
import { issuesToFinding } from './toFinding.js';
import type {
    AccessibilityResolver,
    AssessmentContext,
    AssessmentPlugin,
    AssessmentResult,
    BoundingBox,
    ElementCapture,
    ViewportMetadata,
    ViewportProfile,
} from './types.js';

const DEFAULT_VIEWPORT: ViewportMetadata = {
    viewportWidth: 1280,
    viewportHeight: 800,
    pixelRatio: 1,
};

const ELEMENT_HTML_TRUNCATE = 400;
const MAX_ELEMENT_SCREENSHOTS_PER_PAGE = 25;
/**
 * Hard ceiling on a single plugin's run. `page.evaluate` has no timeout of its
 * own, so a plugin that hangs (a never-resolving evaluate, a pathological page)
 * would stall the whole scan. Generous — normal plugins finish well under a second.
 */
const PLUGIN_TIMEOUT_MS = 60_000;

export interface AssessmentRunnerOptions {
    outputDir: string;
    standards: StandardsService;
    logger: Logger;
    viewportProfile?: ViewportProfile;
    plugins?: AssessmentPlugin[];
}

export class AssessmentRunner {
    private readonly plugins: AssessmentPlugin[];
    private readonly runId = randomUUID().slice(0, 8);
    private readonly runStore = new Map<string, unknown>();
    private readonly pageTitleHistory: string[] = [];
    private remainingElementScreenshotBudget = MAX_ELEMENT_SCREENSHOTS_PER_PAGE;

    constructor(private readonly opts: AssessmentRunnerOptions) {
        this.plugins = opts.plugins ?? assessmentPlugins;
    }

    /**
     * Run every applicable plugin against the current page and return a single
     * Finding (or null when nothing was flagged).
     *
     * @param stepNumber - 1-based ordinal used for the Finding label.
     */
    async assess(
        page: Page,
        url: string,
        pageTitle: string,
        stepNumber = 1,
    ): Promise<Finding | null> {
        const profile = this.opts.viewportProfile ?? 'desktop';
        const viewport = await this.captureViewport(page);
        this.remainingElementScreenshotBudget = MAX_ELEMENT_SCREENSHOTS_PER_PAGE;

        // Install in-page helpers (window.__a11y) and the CDP-backed accessibility
        // resolver every plugin depends on. Torn down in the finally below.
        const axTree = await preparePageForPlugins(page, (m) => this.opts.logger.debug(m));
        const acquiredHandles: ElementHandle<Element>[] = [];
        const context = this.buildContext(page, url, viewport, profile, axTree, acquiredHandles);

        const issues: AssessmentResult['issues'] = [];
        try {
            for (const plugin of this.plugins) {
                if (plugin.appliesToViewport && !plugin.appliesToViewport(profile)) {
                    this.opts.logger.debug(`Skipping plugin "${plugin.name}" for viewport ${profile}`);
                    continue;
                }
                try {
                    const result = await this.runWithTimeout(plugin.run(context));
                    for (const issue of result.issues) {
                        issue.source = issue.source ?? plugin.id;
                        issue.pixelRatio = issue.pixelRatio ?? viewport.pixelRatio;
                        issue.viewportWidth = issue.viewportWidth ?? viewport.viewportWidth;
                        issue.viewportHeight = issue.viewportHeight ?? viewport.viewportHeight;
                        issue.viewportProfile = issue.viewportProfile ?? profile;
                    }
                    issues.push(...result.issues);
                } catch (err) {
                    this.opts.logger.warn(`Plugin "${plugin.name}" failed on ${url}: ${err}`);
                } finally {
                    // Free element handles the plugin acquired via ctx.queryHandles.
                    const owned = acquiredHandles.splice(0);
                    if (owned.length > 0) {
                        await Promise.all(owned.map((h) => h.dispose().catch(() => {})));
                    }
                }
            }
        } finally {
            await axTree.dispose();
        }

        if (pageTitle) this.pageTitleHistory.push(pageTitle);

        return issuesToFinding({
            issues,
            url,
            pageTitle,
            stepNumber,
            standards: this.opts.standards,
        });
    }

    /** Capture viewport metadata, falling back to reasonable defaults on error. */
    private async captureViewport(page: Page): Promise<ViewportMetadata> {
        try {
            const result = await page.evaluate(() => ({
                viewportWidth: Math.round(window.innerWidth || document.documentElement.clientWidth),
                viewportHeight: Math.round(window.innerHeight || document.documentElement.clientHeight),
                pixelRatio: window.devicePixelRatio || 1,
            }));
            if (!Number.isFinite(result.viewportWidth) || result.viewportWidth <= 0) {
                return DEFAULT_VIEWPORT;
            }
            return result;
        } catch (err) {
            this.opts.logger.debug(`Could not capture viewport metadata: ${err}`);
            return DEFAULT_VIEWPORT;
        }
    }

    /**
     * Race a plugin's run against a hard timeout so a hung plugin can't stall the
     * whole scan. On timeout the plugin promise is abandoned (Playwright can't
     * abort an in-flight evaluate); the loop moves on and records a failure.
     */
    private runWithTimeout<T>(promise: Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`plugin timed out after ${PLUGIN_TIMEOUT_MS}ms`)),
                PLUGIN_TIMEOUT_MS,
            );
        });
        return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
    }

    private buildContext(
        page: Page,
        url: string,
        viewport: ViewportMetadata,
        viewportProfile: ViewportProfile,
        ax: AccessibilityResolver,
        acquiredHandles: ElementHandle<Element>[],
    ): AssessmentContext {
        const dir = screenshotDirFor(this.opts.outputDir);

        const saveImage = async (buffer: Buffer, label: string): Promise<string> => {
            const filename = `${label.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60)}-${randomUUID().slice(0, 8)}.png`;
            await writeFile(join(dir, filename), buffer);
            return join('assets', 'screenshots', filename);
        };

        const captureElementMetadata = async (
            selector: string,
            label: string,
            options?: { captureScreenshot?: boolean },
        ): Promise<ElementCapture> => {
            try {
                const el = await page.$(selector);
                if (!el) return { screenshotPath: null, boundingBox: null, html: null };

                let boundingBox: BoundingBox | null = null;
                try {
                    const rect = await el.evaluate((node) => {
                        const r = (node as Element).getBoundingClientRect();
                        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
                    });
                    if (rect.width > 0 && rect.height > 0) {
                        boundingBox = {
                            x: Math.round(rect.x),
                            y: Math.round(rect.y),
                            width: Math.round(rect.width),
                            height: Math.round(rect.height),
                        };
                    }
                } catch {
                    /* rect unavailable (detached element, etc.) */
                }

                let html: string | null = null;
                try {
                    html = await el.evaluate(
                        (node, max) => (node as Element).outerHTML.slice(0, max),
                        ELEMENT_HTML_TRUNCATE,
                    );
                } catch {
                    /* HTML not accessible */
                }

                let screenshotPath: string | null = null;
                const shouldCapture = options?.captureScreenshot ?? true;
                if (boundingBox && shouldCapture && this.remainingElementScreenshotBudget > 0) {
                    try {
                        const buf = await el.screenshot();
                        screenshotPath = await saveImage(buf, label);
                        this.remainingElementScreenshotBudget -= 1;
                    } catch {
                        /* element not screenshottable (off-screen, detached, etc.) */
                    }
                }

                return { screenshotPath, boundingBox, html };
            } catch {
                return { screenshotPath: null, boundingBox: null, html: null };
            }
        };

        return {
            page,
            ax,
            queryHandles: async (selector: string) => {
                const handles = (await page.$$(selector)) as ElementHandle<Element>[];
                acquiredHandles.push(...handles);
                return handles;
            },
            url,
            viewport,
            viewportProfile,
            previousPageTitles: [...this.pageTitleHistory],
            runStore: this.runStore,
            runId: this.runId,
            takeElementScreenshot: async (selector, label) =>
                (await captureElementMetadata(selector, label)).screenshotPath,
            captureElementMetadata,
            takeFullPageScreenshot: async (label: string) => {
                const buf = await page.screenshot({ fullPage: true });
                return saveImage(buf, label);
            },
            saveArtifact: async (buffer: Buffer, filename: string) => saveImage(buffer, filename),
            log: (message: string) => this.opts.logger.debug(message),
        };
    }
}
