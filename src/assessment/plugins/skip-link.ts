/**
 * Skip-link plugin.
 *
 * WCAG 2.4.1 "Bypass Blocks" — pages should offer a way to bypass repeated
 * content. The most common technique is a same-page skip link that becomes
 * visible on focus.
 *
 * Rules:
 *  - skip-link-missing: no obvious skip link detected
 *  - skip-link-broken: first same-page anchor target does not exist
 *  - skip-link-not-focusable: first focusable item is not on or before any
 *    skip link (i.e. the skip link is not the first tabstop)
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

const SKIP_PHRASES = [
    'skip to main',
    'skip to content',
    'skip navigation',
    'skip to',
    'jump to content',
    'aller au contenu',
    'aller au contenu principal',
    'passer au contenu',
    'sauter la navigation',
];

export const skipLinkPlugin: AssessmentPlugin = {
    id: 'skip-link',
    name: 'Skip Link',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[skip-link] Detecting skip link...');

        const data = await ctx.page.evaluate((phrases) => {
            // Same-page anchor links (href starts with #), excluding plain "#"
            const candidates = Array.from(
                document.querySelectorAll('a[href^="#"]'),
            ) as HTMLAnchorElement[];

            const results = candidates
                .map((a) => {
                    const href = a.getAttribute('href') ?? '';
                    const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
                    const lower = text.toLowerCase();
                    const looksLikeSkip = phrases.some((p) => lower.includes(p));
                    const targetId = href.startsWith('#') ? href.slice(1) : '';
                    const targetExists = !!targetId && !!document.getElementById(targetId);
                    return {
                        selector: window.__a11y.cssPath(a),
                        text,
                        href,
                        targetId,
                        targetExists,
                        looksLikeSkip,
                        // Position in source order — first-focusable proxy.
                        sourceIndex: Array.from(
                            document.querySelectorAll(
                                'a[href],button,input:not([type=hidden]),select,textarea,[tabindex]',
                            ),
                        ).indexOf(a),
                    };
                })
                .filter((x) => x.href !== '#' && x.targetId.length > 0);

            return {
                firstFocusableIndex: 0,
                candidates: results,
            };
        }, SKIP_PHRASES);

        const issues: AccessibilityIssue[] = [];

        const skipLinks = data.candidates.filter((c) => c.looksLikeSkip);

        if (skipLinks.length === 0) {
            // Only flag if there's meaningful navigation on the page — if it's a simple
            // form page with 2 controls, a skip link is unnecessary.
            const navCount = await ctx.page.evaluate(
                () => document.querySelectorAll('nav, [role="navigation"]').length,
            );
            if (navCount > 0) {
                issues.push({
                    ruleId: 'skip-link-missing',
                    description: 'No skip link was detected. Pages with navigation should provide a visible-on-focus link to the main content.',
                    severity: 'moderate',
                    wcagCriteria: ['2.4.1'],
                    target: 'document',
                });
            }
        } else {
            for (const link of skipLinks) {
                if (!link.targetExists) {
                    const capture = await ctx.captureElementMetadata(link.selector, 'skip-link-broken');
                    issues.push({
                        ruleId: 'skip-link-broken',
                        description: `Skip link "${link.text}" points to "#${link.targetId}" but no element with that id exists on the page.`,
                        severity: 'serious',
                        wcagCriteria: ['2.4.1'],
                        target: link.selector,
                        html: capture.html ?? undefined,
                        elementScreenshot: capture.screenshotPath ?? undefined,
                        boundingBox: capture.boundingBox ?? undefined,
                    });
                }
            }

            // Check that at least one skip link is the first focusable element, or very close to it.
            const firstSkip = skipLinks[0]!;
            if (firstSkip.sourceIndex > 2) {
                const capture = await ctx.captureElementMetadata(
                    firstSkip.selector,
                    'skip-link-not-first',
                );
                issues.push({
                    ruleId: 'skip-link-not-first',
                    description: 'Skip link exists but is not one of the first focusable elements on the page — keyboard users must tab through other controls first.',
                    severity: 'moderate',
                    wcagCriteria: ['2.4.1', '2.4.3'],
                    target: firstSkip.selector,
                    html: capture.html ?? undefined,
                    elementScreenshot: capture.screenshotPath ?? undefined,
                    boundingBox: capture.boundingBox ?? undefined,
                });
            }
        }

        ctx.log(`[skip-link] ${skipLinks.length} candidate(s), ${issues.length} issues.`);

        return {
            pluginId: 'skip-link',
            issues,
            metadata: { skipLinkCount: skipLinks.length },
        };
    },
};
