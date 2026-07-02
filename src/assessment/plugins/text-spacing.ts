/**
 * Text-spacing plugin.
 *
 * WCAG 1.4.12 Text Spacing (AA) / RAWeb 10.12 — not covered by axe-core. Users
 * must be able to override text spacing without loss of content. This applies
 * the standard 1.4.12 override (line-height 1.5, paragraph spacing 2em,
 * letter-spacing 0.12em, word-spacing 0.16em) and reports text containers that
 * become CLIPPED as a result — i.e. content that fits before is cut off after.
 *
 * Method: tag clip-candidate text boxes (overflow hidden/clip) and record
 * whether they already overflow, inject the override stylesheet, re-measure,
 * then remove the stylesheet. Only boxes that were NOT clipped before but ARE
 * clipped after are reported, so intentionally-truncated content (e.g. an
 * existing ellipsis) is not flagged. Registered before reflow; the injected
 * style is always removed in a finally.
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

const OVERRIDE_CSS = `
  *, *::before, *::after {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p { margin-bottom: 2em !important; }
`;

interface ClipCandidate {
    id: number;
    selector: string;
    html: string;
    beforeClipped: boolean;
}

/** Tag overflow-clipping text boxes and record whether they already overflow. */
function tagAndMeasureBefore(): ClipCandidate[] {
    const TOL = 2;
    function clipped(el: Element): boolean {
        return el.scrollHeight > el.clientHeight + TOL || el.scrollWidth > el.clientWidth + TOL;
    }
    function hasDirectText(el: Element): boolean {
        return Array.from(el.childNodes).some(
            (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0,
        );
    }

    const out: ClipCandidate[] = [];
    let id = 0;
    for (const el of Array.from(document.body ? document.body.querySelectorAll('*') : [])) {
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        const ox = s.overflowX;
        const oy = s.overflowY;
        const clips = ox === 'hidden' || ox === 'clip' || oy === 'hidden' || oy === 'clip';
        if (!clips || !hasDirectText(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;

        const myId = id++;
        el.setAttribute('data-a11y-ts', String(myId));
        out.push({ id: myId, selector: window.__a11y.cssPath(el), html: el.outerHTML.slice(0, 300), beforeClipped: clipped(el) });
    }
    return out;
}

/** Re-measure tagged elements under the override, then remove the tags. */
function measureAfter(): Array<{ id: number; afterClipped: boolean }> {
    const TOL = 2;
    const out: Array<{ id: number; afterClipped: boolean }> = [];
    for (const el of Array.from(document.querySelectorAll('[data-a11y-ts]'))) {
        const afterClipped =
            el.scrollHeight > el.clientHeight + TOL || el.scrollWidth > el.clientWidth + TOL;
        out.push({ id: Number(el.getAttribute('data-a11y-ts')), afterClipped });
        el.removeAttribute('data-a11y-ts');
    }
    return out;
}

const MAX_REPORTED = 25;

export const textSpacingPlugin: AssessmentPlugin = {
    id: 'text-spacing',
    name: 'Text Spacing',

    // Applies fixed spacing overrides independent of the run profile; run once.
    appliesToViewport: (profile) => profile === 'desktop',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[text-spacing] Applying 1.4.12 spacing override and checking for clipping...');

        const issues: AccessibilityIssue[] = [];
        const candidates = await ctx.page.evaluate(tagAndMeasureBefore);

        if (candidates.length === 0) {
            ctx.log('[text-spacing] no clip-candidate text boxes');
            return { pluginId: 'text-spacing', issues, metadata: { candidates: 0 } };
        }

        let styleHandle: Awaited<ReturnType<typeof ctx.page.addStyleTag>> | null = null;
        let afterById = new Map<number, boolean>();
        try {
            styleHandle = await ctx.page.addStyleTag({ content: OVERRIDE_CSS });
            const after = await ctx.page.evaluate(measureAfter);
            afterById = new Map(after.map((a) => [a.id, a.afterClipped]));
        } finally {
            if (styleHandle) await styleHandle.evaluate((el) => (el as Element).remove());
        }

        for (const c of candidates) {
            if (issues.length >= MAX_REPORTED) break;
            // Newly clipped only: fit before, cut off after the spacing override.
            if (!c.beforeClipped && afterById.get(c.id)) {
                issues.push({
                    ruleId: 'text-spacing-clipping',
                    description:
                        `<${c.selector.split(' > ').pop()}> clips its text when user text-spacing is applied ` +
                        `(line-height 1.5, letter 0.12em, word 0.16em, paragraph 2em). Avoid fixed heights on ` +
                        `text containers; let them grow.`,
                    severity: 'moderate',
                    wcagCriteria: ['1.4.12'],
                    helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/text-spacing.html',
                    target: c.selector,
                    html: c.html,
                    source: 'text-spacing',
                });
            }
        }

        ctx.log(`[text-spacing] ${candidates.length} candidates, ${issues.length} clipped`);
        return {
            pluginId: 'text-spacing',
            issues,
            metadata: { candidates: candidates.length, clipped: issues.length },
        };
    },
};
