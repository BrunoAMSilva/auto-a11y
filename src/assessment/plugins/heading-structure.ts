/**
 * Heading structure plugin.
 *
 * Checks for common heading-related WCAG violations that axe-core covers
 * incompletely (it flags empty headings and skipped levels individually
 * per-element but does not diagnose page-level structure issues like
 * "no h1" or the specific preceding/following level).
 *
 * Rules:
 *  - heading-missing-h1:      page has no <h1> or role="heading" level=1
 *  - heading-multiple-h1:     page has more than one top-level heading
 *  - heading-skipped-level:   a heading jumps more than one level down
 *  - heading-empty:           heading element has no accessible text
 *  - heading-invalid-aria-level:  role="heading" without a valid aria-level
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

interface HeadingRecord {
    level: number;
    text: string;
    selector: string;
    ariaLevelMissing: boolean;
    isRoleHeading: boolean;
}

export const headingStructurePlugin: AssessmentPlugin = {
    id: 'heading-structure',
    name: 'Heading Structure',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[heading-structure] Inspecting heading outline...');

        const headings = await ctx.page.evaluate(() => {
            // Headings hidden from assistive technology are not part of the
            // exposed document outline, so they must not drive empty/skipped-level
            // findings.

            const out: Array<{
                level: number;
                text: string;
                selector: string;
                ariaLevelMissing: boolean;
                isRoleHeading: boolean;
            }> = [];

            // Native h1–h6
            for (const el of Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
                if (!window.__a11y.visibleToAT(el)) continue;
                const level = Number(el.tagName.charAt(1));
                out.push({
                    level,
                    text: (el.textContent ?? '').trim(),
                    selector: window.__a11y.cssPath(el),
                    ariaLevelMissing: false,
                    isRoleHeading: false,
                });
            }

            // ARIA headings
            for (const el of Array.from(document.querySelectorAll('[role="heading"]'))) {
                if (!window.__a11y.visibleToAT(el)) continue;
                const ariaLevelRaw = el.getAttribute('aria-level');
                const parsed = ariaLevelRaw ? parseInt(ariaLevelRaw, 10) : NaN;
                const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 6;
                out.push({
                    level: valid ? parsed : 0,
                    text: (el.textContent ?? '').trim(),
                    selector: window.__a11y.cssPath(el),
                    ariaLevelMissing: !valid,
                    isRoleHeading: true,
                });
            }

            return out;
        });

        const issues: AccessibilityIssue[] = [];
        const h1Count = headings.filter((h) => h.level === 1).length;

        // Missing h1
        if (h1Count === 0 && headings.length > 0) {
            issues.push({
                ruleId: 'heading-missing-h1',
                description: 'Page has headings but no top-level heading (h1 or role="heading" aria-level=1).',
                severity: 'serious',
                wcagCriteria: ['1.3.1', '2.4.6'],
                target: 'document',
                html: undefined,
            });
        }

        // Multiple h1 — warn (moderate: not strictly an error, but usually unintended)
        if (h1Count > 1) {
            issues.push({
                ruleId: 'heading-multiple-h1',
                description: `Page has ${h1Count} top-level headings — exactly one h1 is recommended.`,
                severity: 'moderate',
                wcagCriteria: ['1.3.1'],
                target: 'document',
            });
        }

        let previousLevel = 0;
        for (const h of headings as HeadingRecord[]) {
            // Empty heading
            if (!h.ariaLevelMissing && h.text === '') {
                const capture = await ctx.captureElementMetadata(h.selector, 'heading-empty');
                issues.push({
                    ruleId: 'heading-empty',
                    description: 'Heading element has no accessible text content.',
                    severity: 'serious',
                    wcagCriteria: ['1.3.1', '2.4.6'],
                    target: h.selector,
                    html: capture.html ?? undefined,
                    elementScreenshot: capture.screenshotPath ?? undefined,
                    boundingBox: capture.boundingBox ?? undefined,
                });
            }

            // role="heading" without aria-level 1–6
            if (h.ariaLevelMissing) {
                const capture = await ctx.captureElementMetadata(h.selector, 'heading-invalid-level');
                issues.push({
                    ruleId: 'heading-invalid-aria-level',
                    description: 'Element has role="heading" without a valid aria-level (1–6).',
                    severity: 'serious',
                    wcagCriteria: ['1.3.1', '4.1.2'],
                    target: h.selector,
                    html: capture.html ?? undefined,
                    elementScreenshot: capture.screenshotPath ?? undefined,
                    boundingBox: capture.boundingBox ?? undefined,
                });
                continue;
            }

            // Skipped level (e.g. h1 → h3). Only flag when previousLevel > 0.
            if (previousLevel > 0 && h.level > previousLevel + 1) {
                const capture = await ctx.captureElementMetadata(h.selector, 'heading-skipped');
                issues.push({
                    ruleId: 'heading-skipped-level',
                    description: `Heading level jumps from h${previousLevel} to h${h.level}, skipping level(s).`,
                    severity: 'moderate',
                    wcagCriteria: ['1.3.1'],
                    target: h.selector,
                    html: capture.html ?? undefined,
                    elementScreenshot: capture.screenshotPath ?? undefined,
                    boundingBox: capture.boundingBox ?? undefined,
                });
            }
            previousLevel = h.level;
        }

        ctx.log(`[heading-structure] ${headings.length} headings scanned, ${issues.length} issues.`);

        return {
            pluginId: 'heading-structure',
            issues,
            metadata: {
                totalHeadings: headings.length,
                h1Count,
            },
        };
    },
};
