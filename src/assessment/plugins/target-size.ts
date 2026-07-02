/**
 * Target size plugin.
 *
 * WCAG 2.2 Success Criterion 2.5.8 Target Size (Minimum), AA — not covered by
 * axe-core. Pointer targets should be at least 24×24 CSS px, with exceptions
 * implemented here so the check stays spec-accurate (and low-noise):
 *
 *  - Spacing: an undersized target is exempt when no other target's centre is
 *    within 24px (its 24px circle does not overlap another target's).
 *  - Inline: targets rendered `display: inline` (links in a sentence) are exempt.
 *  - User agent: native checkbox/radio inputs are exempt (UA-sized).
 *  - Disabled targets are not actionable and are skipped.
 *
 * Note: 2.5.8 is WCAG 2.2 only; RGAA 4.1 / RAWeb (WCAG 2.1) do not include it.
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

interface TargetOffender {
    tag: string;
    selector: string;
    width: number;
    height: number;
    outerHTML: string;
}

function probeTargetSize(): TargetOffender[] {
    const MIN = 23.5; // 24px with a sub-pixel tolerance
    const SPACING = 24;
    const INTERACTIVE_ROLES = new Set([
        'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem',
        'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton',
        'combobox', 'textbox', 'treeitem',
    ]);

    function isTarget(el: Element): boolean {
        if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        if (tag === 'a') return el.hasAttribute('href');
        if (tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary') return true;
        if (tag === 'input') {
            const t = (el.getAttribute('type') || 'text').toLowerCase();
            return !['hidden', 'checkbox', 'radio'].includes(t); // UA-sized checkbox/radio exempt
        }
        if (role && INTERACTIVE_ROLES.has(role)) return true;
        const ti = el.getAttribute('tabindex');
        return ti !== null && parseInt(ti, 10) >= 0;
    }

    const all = Array.from(
        document.querySelectorAll('a[href], button, input, select, textarea, summary, [role], [tabindex]'),
    );
    const targets = all.filter((el) => isTarget(el) && window.__a11y.isShown(el, { minPx: 0, atAware: true }));
    const centers = targets.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

    const offenders: TargetOffender[] = [];
    for (let i = 0; i < targets.length; i++) {
        const el = targets[i]!;
        const r = el.getBoundingClientRect();
        if (r.width >= MIN && r.height >= MIN) continue; // large enough
        if (window.getComputedStyle(el).display === 'inline') continue; // inline-in-text exception

        // Spacing exception: exempt unless another target's centre is within 24px.
        const c = centers[i]!;
        let crowded = false;
        for (let j = 0; j < targets.length; j++) {
            if (j === i) continue;
            const o = centers[j]!;
            if (Math.hypot(c.x - o.x, c.y - o.y) < SPACING) {
                crowded = true;
                break;
            }
        }
        if (!crowded) continue;

        offenders.push({
            tag: el.tagName.toLowerCase(),
            selector: window.__a11y.cssPath(el),
            width: Math.round(r.width),
            height: Math.round(r.height),
            outerHTML: el.outerHTML.slice(0, 300),
        });
        if (offenders.length >= 25) break;
    }
    return offenders;
}

export const targetSizePlugin: AssessmentPlugin = {
    id: 'target-size',
    name: 'Target Size',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[target-size] Measuring pointer target sizes...');

        const offenders = await ctx.page.evaluate(probeTargetSize);
        const issues: AccessibilityIssue[] = offenders.map((o) => ({
            ruleId: 'target-size-minimum',
            description:
                `Interactive target (<${o.tag}>) is ${o.width}×${o.height}px — below the 24×24px minimum — ` +
                `and sits within 24px of another target. Enlarge it or increase spacing (WCAG 2.2, AA).`,
            severity: 'moderate',
            wcagCriteria: ['2.5.8'],
            helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
            target: o.selector,
            html: o.outerHTML,
            source: 'target-size',
        }));

        ctx.log(`[target-size] ${issues.length} undersized target(s)`);

        return {
            pluginId: 'target-size',
            issues,
            metadata: { undersizedTargets: issues.length },
        };
    },
};
