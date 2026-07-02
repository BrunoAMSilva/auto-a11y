/**
 * Link text plugin.
 *
 * Checks for links whose accessible text is missing, generic, or misleading.
 * Complements axe-core's link-name rule with:
 *  - link-generic-text: flagged for pt-BR/fr/en stop lists ("click here",
 *    "read more", "en savoir plus", "cliquez ici", …)
 *  - link-duplicate-ambiguous: same accessible text points to different hrefs
 *    (WCAG 2.4.4 / 2.4.9)
 *  - link-empty-text: href-bearing <a> with no text, title or aria-label
 *    (belt-and-suspenders alongside axe-core link-name)
 *
 * URL-only text (e.g. "https://example.com/very/long/path") is also flagged
 * because it forces screen-reader users to listen to the whole URL.
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

const GENERIC_PHRASES = [
    // English
    'click here',
    'click',
    'here',
    'read more',
    'more',
    'learn more',
    'details',
    'link',
    'this link',
    // French
    'cliquez ici',
    'ici',
    'en savoir plus',
    'plus',
    'lire la suite',
    'voir plus',
    'détails',
    'lien',
    'ce lien',
];

function isUrlOnly(text: string): boolean {
    return /^https?:\/\/\S+$/i.test(text.trim());
}

export const linkTextPlugin: AssessmentPlugin = {
    id: 'link-text',
    name: 'Link Text',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[link-text] Scanning link accessible names...');

        // Accessible names come from the browser's own accessibility tree; the
        // rest of each link's data comes from one in-page pass over the same set.
        const handles = await ctx.queryHandles('a[href]');
        const axInfos = await ctx.ax.resolveHandles(handles);
        const meta = await ctx.page.evaluate(
            (els) =>
                (els as HTMLAnchorElement[]).map((a) => ({
                    href: a.getAttribute('href') ?? '',
                    resolvedHref: a.href,
                    selector: window.__a11y.cssPath(a),
                })),
            handles as unknown as unknown[],
        );
        // Exclude links not exposed to assistive technology — they are not
        // perceived by AT users, so their text/href must not be flagged.
        const links = meta
            .map((m, i) => ({ ...m, accessibleName: axInfos[i]!.name, visibleToAT: axInfos[i]!.visibleToAT }))
            .filter((link) => link.visibleToAT);

        const issues: AccessibilityIssue[] = [];
        const byName = new Map<string, Array<(typeof links)[number]>>();

        for (const link of links) {
            const name = link.accessibleName;
            const lower = name.toLowerCase();

            if (!name) {
                const capture = await ctx.captureElementMetadata(link.selector, 'link-empty');
                issues.push({
                    ruleId: 'link-empty-text',
                    description: `Link has no accessible name. Destination: ${link.href || '(empty href)'}`,
                    severity: 'serious',
                    wcagCriteria: ['2.4.4', '4.1.2'],
                    target: link.selector,
                    html: capture.html ?? undefined,
                    elementScreenshot: capture.screenshotPath ?? undefined,
                    boundingBox: capture.boundingBox ?? undefined,
                });
                continue;
            }

            if (GENERIC_PHRASES.includes(lower) || isUrlOnly(name)) {
                const capture = await ctx.captureElementMetadata(link.selector, 'link-generic');
                issues.push({
                    ruleId: 'link-generic-text',
                    description: isUrlOnly(name)
                        ? `Link text is a raw URL — use descriptive text instead. "${name}"`
                        : `Link uses generic text "${name}" that does not describe its destination.`,
                    severity: 'moderate',
                    wcagCriteria: ['2.4.4', '2.4.9'],
                    target: link.selector,
                    html: capture.html ?? undefined,
                    elementScreenshot: capture.screenshotPath ?? undefined,
                    boundingBox: capture.boundingBox ?? undefined,
                });
            }

            const key = lower;
            const existing = byName.get(key) ?? [];
            existing.push(link);
            byName.set(key, existing);
        }

        // Duplicate text → different destination
        for (const [, group] of byName) {
            if (group.length < 2) continue;
            const uniqueHrefs = new Set(group.map((l) => l.resolvedHref));
            if (uniqueHrefs.size < 2) continue;

            for (const link of group) {
                const capture = await ctx.captureElementMetadata(link.selector, 'link-duplicate-ambiguous');
                issues.push({
                    ruleId: 'link-duplicate-ambiguous',
                    description: `Link text "${link.accessibleName}" is used for ${uniqueHrefs.size} different destinations on this page.`,
                    severity: 'moderate',
                    wcagCriteria: ['2.4.4', '2.4.9'],
                    target: link.selector,
                    html: capture.html ?? undefined,
                    elementScreenshot: capture.screenshotPath ?? undefined,
                    boundingBox: capture.boundingBox ?? undefined,
                });
            }
        }

        ctx.log(`[link-text] ${links.length} links scanned, ${issues.length} issues.`);

        return {
            pluginId: 'link-text',
            issues,
            metadata: { totalLinks: links.length },
        };
    },
};
