/**
 * Focus-visible plugin.
 *
 * WCAG 2.4.7 Focus Visible (AA) / RAWeb 10.7 — not covered by axe-core. Every
 * keyboard-focusable control must show a visible focus indicator.
 *
 * Approach (measured, not heuristic): record each candidate's resting computed
 * style, then drive focus with the KEYBOARD (Tab) so the browser applies its
 * real :focus-visible behaviour, and diff the focused style against resting. The
 * snapshot covers the element AND its ::before/::after pseudo-elements, so
 * outline-, box-shadow-, border-, background- and pseudo-element focus rings are
 * all detected. A control reached by Tab whose appearance does not change is
 * reported. Controls never reached within the Tab budget are not judged.
 *
 * Registered LAST: it focuses/scrolls the page and may trigger focus handlers,
 * and nothing downstream depends on it. Focus and scroll are reset at the end.
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

const MAX_TABS = 60;
const MAX_REPORTED = 25;

interface FocusCandidate {
    id: number;
    selector: string;
    html: string;
    resting: string;
}

/** Tag every keyboard-focusable control and snapshot its resting style. */
function tagCandidates(): FocusCandidate[] {
    function focusable(el: Element): boolean {
        if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
        const ti = el.getAttribute('tabindex');
        if (ti !== null && parseInt(ti, 10) < 0) return false;
        const tag = el.tagName.toLowerCase();
        if (tag === 'a') return el.hasAttribute('href');
        if (tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary') return true;
        if (tag === 'input') return (el.getAttribute('type') || 'text').toLowerCase() !== 'hidden';
        if (ti !== null) return true;
        return (el as HTMLElement).isContentEditable;
    }

    const out: FocusCandidate[] = [];
    let id = 0;
    const els = document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]');
    for (const el of Array.from(els)) {
        if (!focusable(el) || !window.__a11y.isShown(el, { minPx: 0 })) continue;
        el.setAttribute('data-a11y-fv', String(id));
        out.push({ id, selector: window.__a11y.cssPath(el), html: el.outerHTML.slice(0, 300), resting: window.__a11y.focusStyleSnapshot(el) });
        id++;
    }
    return out;
}

/** Read the currently focused tagged element + its (focused) style snapshot. */
function captureActive(): { id: number | null; snap: string | null } {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { id: null, snap: null };
    const idAttr = el.getAttribute('data-a11y-fv');
    if (idAttr === null) return { id: null, snap: null };
    return { id: Number(idAttr), snap: window.__a11y.focusStyleSnapshot(el) };
}

function cleanup(): void {
    document.querySelectorAll('[data-a11y-fv]').forEach((el) => el.removeAttribute('data-a11y-fv'));
    const a = document.activeElement as HTMLElement | null;
    if (a && typeof a.blur === 'function') a.blur();
    window.scrollTo(0, 0);
}

export const focusVisiblePlugin: AssessmentPlugin = {
    id: 'focus-visible',
    name: 'Focus Visible',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[focus-visible] Tabbing through controls to check focus indicators...');

        const issues: AccessibilityIssue[] = [];
        const candidates = await ctx.page.evaluate(tagCandidates);
        if (candidates.length === 0) {
            return { pluginId: 'focus-visible', issues, metadata: { candidates: 0 } };
        }
        const restingById = new Map(candidates.map((c) => [c.id, c.resting]));
        const focusedById = new Map<number, string>();

        try {
            await ctx.page.evaluate(() => {
                const a = document.activeElement as HTMLElement | null;
                if (a && typeof a.blur === 'function') a.blur();
                window.scrollTo(0, 0);
            });

            const visited = new Set<number>();
            let untagged = 0;
            for (let i = 0; i < MAX_TABS; i++) {
                await ctx.page.keyboard.press('Tab');
                const r = await ctx.page.evaluate(captureActive);
                if (r.id === null) {
                    if (++untagged >= 3) break; // wandered off the interactive set
                    continue;
                }
                untagged = 0;
                if (visited.has(r.id)) break; // cycled back — full loop covered
                visited.add(r.id);
                if (r.snap !== null) focusedById.set(r.id, r.snap);
            }
        } finally {
            await ctx.page.evaluate(cleanup);
        }

        for (const c of candidates) {
            if (issues.length >= MAX_REPORTED) break;
            const focused = focusedById.get(c.id);
            if (focused !== undefined && focused === restingById.get(c.id)) {
                issues.push({
                    ruleId: 'focus-not-visible',
                    description:
                        `<${c.selector.split(' > ').pop()}> shows no visible focus indicator when focused with ` +
                        `the keyboard (no change to outline, box-shadow, border, or background). Provide a visible ` +
                        `:focus-visible style.`,
                    severity: 'serious',
                    wcagCriteria: ['2.4.7'],
                    helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/focus-visible.html',
                    target: c.selector,
                    html: c.html,
                    source: 'focus-visible',
                });
            }
        }

        ctx.log(`[focus-visible] ${focusedById.size}/${candidates.length} controls tabbed, ${issues.length} without a visible indicator`);
        return {
            pluginId: 'focus-visible',
            issues,
            metadata: { candidates: candidates.length, tabbed: focusedById.size },
        };
    },
};
