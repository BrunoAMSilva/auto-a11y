/**
 * Focus-not-obscured plugin.
 *
 * WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum), AA — not covered by axe-core.
 * When a control receives keyboard focus it must not be entirely hidden by
 * author-created content (typically a sticky/fixed header or footer).
 *
 * Approach: Tab through focusable controls (so real scroll-into-view happens),
 * then test occlusion — sample a grid over the control's visible area and check
 * what is painted on top via elementFromPoint. A control is reported only when
 * NONE of its visible area is the topmost element AND it is covered by a
 * position: fixed / sticky element. This is deliberately conservative (it
 * targets the sticky-overlay failure and ignores partially-visible controls,
 * which satisfy the "Minimum" criterion).
 *
 * Note: 2.4.11 is WCAG 2.2 only; RGAA/RAWeb (WCAG 2.1) do not include it.
 * Registered last (focuses/scrolls the page); state is reset in a finally.
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

const MAX_TABS = 50;
const MAX_REPORTED = 25;

interface FocusTarget {
    id: number;
    selector: string;
    html: string;
}

function tagCandidates(): FocusTarget[] {
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

    const out: FocusTarget[] = [];
    let id = 0;
    const els = document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]');
    for (const el of Array.from(els)) {
        if (!focusable(el) || !window.__a11y.isShown(el, { minPx: 0 })) continue;
        el.setAttribute('data-a11y-fo', String(id));
        out.push({ id, selector: window.__a11y.cssPath(el), html: el.outerHTML.slice(0, 300) });
        id++;
    }
    return out;
}

/** For the currently focused tagged control, decide whether it is entirely
 *  covered by a fixed/sticky element within the viewport. */
function probeOcclusion(): { id: number | null; obscured: boolean } {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { id: null, obscured: false };
    const idAttr = el.getAttribute('data-a11y-fo');
    if (idAttr === null) return { id: null, obscured: false };
    const id = Number(idAttr);

    const r = el.getBoundingClientRect();
    const left = Math.max(0, r.left);
    const right = Math.min(window.innerWidth, r.right);
    const top = Math.max(0, r.top);
    const bottom = Math.min(window.innerHeight, r.bottom);
    // Not within the viewport → don't judge (can't distinguish from un-scrolled).
    if (right - left < 1 || bottom - top < 1) return { id, obscured: false };

    const isFixedOrSticky = (start: Element): boolean => {
        let p: Element | null = start;
        while (p) {
            const pos = window.getComputedStyle(p).position;
            if (pos === 'fixed' || pos === 'sticky') return true;
            p = p.parentElement;
        }
        return false;
    };

    let anySelfVisible = false;
    let coveredByOverlay = false;
    const cols = 3;
    const rows = 3;
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const x = left + ((right - left) * (i + 0.5)) / cols;
            const y = top + ((bottom - top) * (j + 0.5)) / rows;
            const topEl = document.elementFromPoint(x, y);
            if (!topEl) continue;
            if (topEl === el || el.contains(topEl) || topEl.contains(el)) {
                anySelfVisible = true;
            } else if (isFixedOrSticky(topEl)) {
                coveredByOverlay = true;
            }
        }
    }
    return { id, obscured: !anySelfVisible && coveredByOverlay };
}

function cleanup(): void {
    document.querySelectorAll('[data-a11y-fo]').forEach((el) => el.removeAttribute('data-a11y-fo'));
    const a = document.activeElement as HTMLElement | null;
    if (a && typeof a.blur === 'function') a.blur();
    window.scrollTo(0, 0);
}

export const focusObscuredPlugin: AssessmentPlugin = {
    id: 'focus-obscured',
    name: 'Focus Not Obscured',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[focus-obscured] Tabbing through controls to check for occluded focus...');

        const issues: AccessibilityIssue[] = [];
        const candidates = await ctx.page.evaluate(tagCandidates);
        if (candidates.length === 0) {
            return { pluginId: 'focus-obscured', issues, metadata: { candidates: 0 } };
        }
        const byId = new Map(candidates.map((c) => [c.id, c]));
        const obscuredIds = new Set<number>();

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
                const r = await ctx.page.evaluate(probeOcclusion);
                if (r.id === null) {
                    if (++untagged >= 3) break;
                    continue;
                }
                untagged = 0;
                if (visited.has(r.id)) break; // cycled
                visited.add(r.id);
                if (r.obscured) obscuredIds.add(r.id);
            }
        } finally {
            await ctx.page.evaluate(cleanup);
        }

        for (const id of obscuredIds) {
            if (issues.length >= MAX_REPORTED) break;
            const c = byId.get(id);
            if (!c) continue;
            issues.push({
                ruleId: 'focus-obscured',
                description:
                    `<${c.selector.split(' > ').pop()}> is entirely hidden by a sticky/fixed element when it ` +
                    `receives keyboard focus. Ensure focused controls remain at least partially visible ` +
                    `(e.g. scroll-margin to clear sticky headers).`,
                severity: 'moderate',
                wcagCriteria: ['2.4.11'],
                helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html',
                target: c.selector,
                html: c.html,
                source: 'focus-obscured',
            });
        }

        ctx.log(`[focus-obscured] ${candidates.length} controls, ${issues.length} obscured on focus`);
        return {
            pluginId: 'focus-obscured',
            issues,
            metadata: { candidates: candidates.length, obscured: issues.length },
        };
    },
};
