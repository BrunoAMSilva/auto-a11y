/**
 * Page title plugin.
 *
 * WCAG 2.4.2 — "Web pages have titles that describe topic or purpose."
 *
 * Rules:
 *  - page-title-missing: <title> element absent or empty
 *  - page-title-default: title is a known generic placeholder
 *    (e.g. "Untitled", "New tab", "Document")
 *  - page-title-equals-url: title is the URL itself
 *  - page-title-unchanged: SPA route changed but title matches the most
 *    recent page title captured in this run (uses previousPageTitles)
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

const GENERIC_TITLES = new Set(
    ['untitled', 'new tab', 'document', 'home', 'page', 'index', 'sans titre', 'nouvelle page'].map(
        (s) => s.toLowerCase(),
    ),
);

export const pageTitlePlugin: AssessmentPlugin = {
    id: 'page-title',
    name: 'Page Title',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[page-title] Checking <title>...');

        const title = (await ctx.page.title()).trim();
        const issues: AccessibilityIssue[] = [];

        if (!title) {
            issues.push({
                ruleId: 'page-title-missing',
                description: 'Page has no <title> element or the title is empty.',
                severity: 'serious',
                wcagCriteria: ['2.4.2'],
                target: 'head > title',
            });
        } else {
            const lower = title.toLowerCase();
            if (GENERIC_TITLES.has(lower)) {
                issues.push({
                    ruleId: 'page-title-default',
                    description: `Page title "${title}" is a generic placeholder and does not describe the page's topic.`,
                    severity: 'serious',
                    wcagCriteria: ['2.4.2'],
                    target: 'head > title',
                });
            }

            // URL-as-title
            try {
                const urlObj = new URL(ctx.url);
                if (
                    lower === ctx.url.toLowerCase() ||
                    lower === urlObj.hostname.toLowerCase() ||
                    lower === urlObj.pathname.toLowerCase()
                ) {
                    issues.push({
                        ruleId: 'page-title-equals-url',
                        description: `Page title ("${title}") mirrors the URL — titles should describe the page's topic.`,
                        severity: 'moderate',
                        wcagCriteria: ['2.4.2'],
                        target: 'head > title',
                    });
                }
            } catch {
                // Ignore URL parse errors.
            }

            // SPA: route changed but title unchanged vs. the most recent assessed page.
            const lastTitle = ctx.previousPageTitles[ctx.previousPageTitles.length - 1];
            if (lastTitle && lastTitle.trim() === title) {
                issues.push({
                    ruleId: 'page-title-unchanged',
                    description: `Page title matches the previously assessed page — SPA route transitions should update <title>.`,
                    severity: 'moderate',
                    wcagCriteria: ['2.4.2'],
                    target: 'head > title',
                });
            }
        }

        ctx.log(`[page-title] title="${title}", ${issues.length} issues.`);

        return {
            pluginId: 'page-title',
            issues,
            metadata: { title },
        };
    },
};
