/**
 * Motion & animation plugin.
 *
 * Continuously moving/blinking content must be pausable, stoppable, or hideable
 * (WCAG 2.2.2 / RAWeb 13.8). axe-core does not cover this. Two checks:
 *
 *  - motion-deprecated-element        — <marquee>/<blink>: auto-animating with no
 *                                       pause mechanism.
 *  - motion-no-reduced-motion-support — visible elements with an infinite CSS
 *                                       animation that keep animating even when
 *                                       prefers-reduced-motion: reduce is set.
 *
 * The reduced-motion check is verified, not guessed: the page media feature is
 * emulated and the same elements are re-measured. Honouring reduced-motion is
 * one valid pause mechanism; an element that ignores it AND has no visible
 * control is the high-confidence failure this surfaces.
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
    IssueSeverity,
} from '../types.js';

interface MotionCandidate {
    motionId: number;
    kind: 'deprecated' | 'animation';
    tag: string;
    selector: string;
    outerHTML: string;
}

/** Collect deprecated auto-animating elements + infinite-animation elements.
 *  Tags animation candidates with a data attribute so they can be re-measured
 *  under emulated reduced-motion. Returns the candidate list. */
function collectMotion(): MotionCandidate[] {
    function infiniteAnimation(el: Element): boolean {
        const s = window.getComputedStyle(el);
        return (
            s.animationName !== 'none' &&
            /infinite/.test(s.animationIterationCount) &&
            parseFloat(s.animationDuration) > 0.01
        );
    }

    const out: MotionCandidate[] = [];
    let motionId = 0;

    for (const el of Array.from(document.querySelectorAll('marquee, blink'))) {
        if (!window.__a11y.isShown(el, { minPx: 2 })) continue;
        out.push({
            motionId: motionId++,
            kind: 'deprecated',
            tag: el.tagName.toLowerCase(),
            selector: window.__a11y.cssPath(el),
            outerHTML: el.outerHTML.slice(0, 300),
        });
    }

    for (const el of Array.from(document.querySelectorAll('*'))) {
        if (!infiniteAnimation(el) || !window.__a11y.isShown(el, { minPx: 2 })) continue;
        // Exclude loaders/spinners and tiny decorative motion.
        const role = el.getAttribute('role');
        const cls = typeof el.className === 'string' ? el.className : '';
        if (role === 'progressbar' || el.getAttribute('aria-busy') === 'true' || /spinner|loader|loading/i.test(cls)) {
            continue;
        }
        const r = el.getBoundingClientRect();
        if (r.width < 16 || r.height < 16) continue;

        const id = motionId++;
        el.setAttribute('data-a11y-motion', String(id));
        out.push({
            motionId: id,
            kind: 'animation',
            tag: el.tagName.toLowerCase(),
            selector: window.__a11y.cssPath(el),
            outerHTML: el.outerHTML.slice(0, 300),
        });
    }

    return out;
}

/** Under emulated reduced-motion, return the ids of tagged elements still
 *  animating, and clean up the temporary attribute. */
function measureUnderReducedMotion(): number[] {
    const stillAnimating: number[] = [];
    for (const el of Array.from(document.querySelectorAll('[data-a11y-motion]'))) {
        const s = window.getComputedStyle(el);
        const still =
            s.animationName !== 'none' &&
            /infinite/.test(s.animationIterationCount) &&
            parseFloat(s.animationDuration) > 0.01;
        if (still) stillAnimating.push(Number(el.getAttribute('data-a11y-motion')));
        el.removeAttribute('data-a11y-motion');
    }
    return stillAnimating;
}

const MAX_REPORTED = 15;

export const motionPlugin: AssessmentPlugin = {
    id: 'motion',
    name: 'Motion & Animation',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[motion] Scanning for moving/animated content...');

        const issues: AccessibilityIssue[] = [];
        const candidates = await ctx.page.evaluate(collectMotion);

        // Verify whether infinite animations honour prefers-reduced-motion.
        let stillAnimating = new Set<number>();
        if (candidates.some((c) => c.kind === 'animation')) {
            try {
                await ctx.page.emulateMedia({ reducedMotion: 'reduce' });
                stillAnimating = new Set(await ctx.page.evaluate(measureUnderReducedMotion));
            } finally {
                await ctx.page.emulateMedia({ reducedMotion: null });
            }
        }

        const push = (
            c: MotionCandidate,
            ruleId: string,
            description: string,
            severity: IssueSeverity,
            helpUrl: string,
        ) => {
            issues.push({
                ruleId,
                description,
                severity,
                wcagCriteria: ['2.2.2'],
                helpUrl,
                target: c.selector,
                html: c.outerHTML,
                source: 'motion',
            });
        };

        let reported = 0;
        for (const c of candidates) {
            if (reported >= MAX_REPORTED) break;
            if (c.kind === 'deprecated') {
                push(
                    c,
                    'motion-deprecated-element',
                    `<${c.tag}> animates content automatically and provides no way to pause, stop, or hide it. ` +
                        `Replace it with markup that the user can control.`,
                    'serious',
                    'https://www.w3.org/WAI/WCAG21/Techniques/failures/F50',
                );
                reported++;
            } else if (stillAnimating.has(c.motionId)) {
                push(
                    c,
                    'motion-no-reduced-motion-support',
                    `Element animates continuously (infinite CSS animation) and keeps animating when ` +
                        `prefers-reduced-motion: reduce is set. Provide a pause/stop control or honour the ` +
                        `reduced-motion preference.`,
                    'moderate',
                    'https://www.w3.org/WAI/WCAG21/Techniques/css/C39',
                );
                reported++;
            }
        }

        const animating = candidates.filter((c) => c.kind === 'animation').length;
        if (candidates.length > MAX_REPORTED) {
            ctx.log(`[motion] capped report at ${MAX_REPORTED} of ${candidates.length} candidates`);
        }
        ctx.log(`[motion] ${candidates.length} candidates (${animating} animations), ${issues.length} issues`);

        return {
            pluginId: 'motion',
            issues,
            metadata: { candidates: candidates.length, animations: animating },
        };
    },
};
