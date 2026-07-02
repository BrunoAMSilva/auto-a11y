/**
 * Reflow & zoom plugin.
 *
 * Two AA checks that axe-core does not perform, mapped to RAWeb topic 10:
 *
 *  - viewport-zoom-disabled  — <meta name="viewport"> blocks pinch-zoom
 *                              (user-scalable=no or maximum-scale < 2).
 *                              (1.4.4 Resize Text / RAWeb 10.4)
 *  - content-not-reflowable  — at a 320 CSS-px viewport width, content overflows
 *                              horizontally (excluding content that legitimately
 *                              requires two dimensions: tables, images, figures,
 *                              pre/code, and horizontal scroll containers).
 *                              (1.4.10 Reflow / RAWeb 10.11)
 *
 * The reflow check temporarily resizes the page to 320px, measures, then
 * restores the original viewport. This plugin is registered LAST so its
 * viewport mutation cannot affect other plugins; the restore is belt-and-braces.
 * Reflow findings omit element screenshots/bounding boxes because they are
 * measured in the 320px layout, which would not match the full-page screenshot.
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

const REFLOW_WIDTH = 320;

interface ZoomFinding {
    content: string;
    outerHTML: string;
}

interface ReflowOffender {
    tag: string;
    selector: string;
    overflowPx: number;
    width: number;
    outerHTML: string;
}

/** Inspect <meta name="viewport"> for zoom-blocking directives. */
function probeViewportMeta(): ZoomFinding | null {
    const meta = document.querySelector('meta[name="viewport" i]');
    if (!meta) return null;
    const content = (meta.getAttribute('content') || '').toLowerCase();
    const userScalableNo = /user-scalable\s*=\s*(no|0)\b/.test(content);
    const maxMatch = content.match(/maximum-scale\s*=\s*([0-9.]+)/);
    const maxScale = maxMatch ? parseFloat(maxMatch[1]!) : null;
    if (!userScalableNo && !(maxScale !== null && maxScale < 2)) return null;
    return { content: meta.getAttribute('content') || '', outerHTML: meta.outerHTML.slice(0, 300) };
}

/** Find elements overflowing the right edge at the current (narrow) width,
 *  excluding content allowed to require two dimensions. */
function probeReflow(): ReflowOffender[] {
    const TOL = 8;
    const root = document.documentElement;
    const vw = root.clientWidth;
    if (root.scrollWidth <= vw + TOL) return [];

    const ALLOWED_TAGS = new Set(['IMG', 'SVG', 'VIDEO', 'IFRAME', 'CANVAS', 'OBJECT', 'EMBED', 'MAP']);
    // Container types whose descendants are part of the 2D content.
    const CONTAINER_2D = 'table, pre, code, figure, svg, map, [role="table"], [role="grid"], [role="img"], [role="figure"]';

    function allowed(el: Element): boolean {
        if (ALLOWED_TAGS.has(el.tagName)) return true;
        if (el.closest(CONTAINER_2D)) return true; // descendant of 2D content
        const ox = window.getComputedStyle(el).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true; // its own horizontal scroller
        // inside a horizontal scroll container?
        let p: Element | null = el.parentElement;
        while (p) {
            const pox = window.getComputedStyle(p).overflowX;
            if (pox === 'auto' || pox === 'scroll') return true;
            p = p.parentElement;
        }
        return false;
    }

    const body = document.body || root;
    const raw: Element[] = [];
    for (const el of Array.from(body.querySelectorAll('*'))) {
        if (el.getBoundingClientRect().right <= vw + TOL) continue;
        if (!window.__a11y.isShown(el, { minPx: 0 }) || allowed(el)) continue;
        raw.push(el);
    }

    // Keep only the outermost offender in each ancestor chain.
    const set = new Set(raw);
    const offenders = raw.filter((el) => {
        let p: Element | null = el.parentElement;
        while (p) {
            if (set.has(p)) return false;
            p = p.parentElement;
        }
        return true;
    });

    return offenders.slice(0, 10).map((el) => {
        const r = el.getBoundingClientRect();
        return {
            tag: el.tagName.toLowerCase(),
            selector: window.__a11y.cssPath(el),
            overflowPx: Math.round(r.right - vw),
            width: Math.round(r.width),
            outerHTML: el.outerHTML.slice(0, 300),
        };
    });
}

export const reflowPlugin: AssessmentPlugin = {
    id: 'reflow',
    name: 'Reflow & Zoom',

    // Reflow resizes the viewport to 320px itself, so its result is identical
    // regardless of the run's profile — run it once (on desktop) to avoid a
    // duplicate, wasted pass on mobile.
    appliesToViewport: (profile) => profile === 'desktop',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[reflow] Checking viewport zoom and 320px reflow...');

        const issues: AccessibilityIssue[] = [];

        // 1. Zoom-blocking viewport meta (no viewport mutation).
        const zoom = await ctx.page.evaluate(probeViewportMeta);
        if (zoom) {
            issues.push({
                ruleId: 'viewport-zoom-disabled',
                description:
                    `<meta name="viewport"> disables zoom (content="${zoom.content}"). Remove ` +
                    `user-scalable=no and any maximum-scale below 2 so users can zoom.`,
                severity: 'serious',
                wcagCriteria: ['1.4.4', '1.4.10'],
                helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/failures/F69',
                target: 'meta[name="viewport"]',
                html: zoom.outerHTML,
                source: 'reflow',
            });
        }

        // 2. Reflow at 320px — resize, measure, restore. Fall back to ctx.viewport
        // when the context has no fixed viewport (viewportSize() === null) so the
        // page is ALWAYS restored and never left at 320px for later pages.
        const original = ctx.page.viewportSize()
            ?? { width: ctx.viewport.viewportWidth, height: ctx.viewport.viewportHeight };
        try {
            await ctx.page.setViewportSize({
                width: REFLOW_WIDTH,
                height: original.height,
            });
            await ctx.page.waitForTimeout(250); // let responsive layout / resize listeners settle
            const offenders = await ctx.page.evaluate(probeReflow);

            for (const o of offenders) {
                issues.push({
                    ruleId: 'content-not-reflowable',
                    description:
                        `At a 320px viewport width, <${o.tag}> overflows horizontally by ~${o.overflowPx}px ` +
                        `(element width ${o.width}px), forcing two-dimensional scrolling. Make it fluid ` +
                        `(max-width, wrapping, responsive units) or allow it to wrap.`,
                    severity: 'serious',
                    wcagCriteria: ['1.4.10'],
                    helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/reflow.html',
                    target: o.selector,
                    html: o.outerHTML,
                    source: 'reflow',
                    // No boundingBox/screenshot: measured in the 320px layout, which
                    // would not align with the full-page screenshot.
                });
            }
        } finally {
            await ctx.page.setViewportSize(original);
        }

        ctx.log(`[reflow] ${issues.length} issues`);

        return {
            pluginId: 'reflow',
            issues,
            metadata: { reflowWidth: REFLOW_WIDTH },
        };
    },
};
