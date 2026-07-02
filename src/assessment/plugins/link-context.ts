/**
 * Link context plugin.
 *
 * Checks link-purpose context that axe-core does not cover, mapped to
 * RAWeb topic 13 / WCAG 2.4.4, 3.2.5:
 *
 *  - link-new-window-no-warning — link opens a new window/tab (target=_blank)
 *    with no indication in its accessible name/title/description (3.2.5, G201 —
 *    advisory; unexpected context changes disorient screen-reader and cognitive
 *    users). RAWeb 13.2.
 *  - link-download-no-format — link downloads a document whose accessible name
 *    does not mention the file format (2.4.4, knowing the format is part of the
 *    link purpose). RAWeb 13.x.
 *
 * The accessible name comes from the browser's accessibility tree (ctx.ax).
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

/** Office / media document extensions whose downloads should state their format. */
const DOC_EXTENSION = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv|zip|rar|7z|epub|mp3|mp4|dmg|exe|apk)(?:[?#]|$)/i;
const NEW_WINDOW_HINT =
    /(new window|new tab|opens in|nouvelle fen[eê]tre|nouvel onglet|s'ouvre|external link)/i;

interface LinkData {
    selector: string;
    href: string;
    resolvedHref: string;
    opensNew: boolean;
    hasDownloadAttr: boolean;
    title: string;
    describedByText: string;
    outerHTML: string;
}

function collectLinkData(el: HTMLAnchorElement): LinkData {
    const target = (el.getAttribute('target') || '').toLowerCase();
    const describedBy = el.getAttribute('aria-describedby');
    const describedByText = describedBy
        ? describedBy
              .split(/\s+/)
              .map((id) => (id ? document.getElementById(id)?.textContent ?? '' : ''))
              .join(' ')
        : '';

    return {
        selector: window.__a11y.cssPath(el),
        href: el.getAttribute('href') ?? '',
        resolvedHref: el.href,
        opensNew: target === '_blank' || target === '_new',
        hasDownloadAttr: el.hasAttribute('download'),
        title: el.getAttribute('title') ?? '',
        describedByText,
        outerHTML: el.outerHTML.slice(0, 300),
    };
}

/** Skip non-navigational schemes for the download check. */
function isNavigational(href: string): boolean {
    return !/^(#|mailto:|tel:|javascript:|sms:)/i.test(href.trim());
}

export const linkContextPlugin: AssessmentPlugin = {
    id: 'link-context',
    name: 'Link Context',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[link-context] Scanning links for new-window / download context...');

        const issues: AccessibilityIssue[] = [];
        const handles = await ctx.queryHandles('a[href]');
        const axInfos = await ctx.ax.resolveHandles(handles);
        let evaluated = 0;

        for (let i = 0; i < handles.length; i++) {
            const handle = handles[i]!;
            const { name, visibleToAT } = axInfos[i]!;
            if (!visibleToAT) continue; // not exposed to AT → out of scope
            const data = await handle.evaluate(collectLinkData);
            evaluated++;

            const context = `${name} ${data.title} ${data.describedByText}`;

            // 1. Opens a new window/tab without telling the user.
            if (data.opensNew && !NEW_WINDOW_HINT.test(context)) {
                issues.push({
                    ruleId: 'link-new-window-no-warning',
                    description:
                        `Link opens in a new window/tab (target="_blank") without warning the user. Add the ` +
                        `cue to the link text or via a visually-hidden span / aria-describedby ` +
                        `(e.g. "(opens in a new window)").`,
                    severity: 'minor',
                    wcagCriteria: ['3.2.5'],
                    helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/general/G201',
                    target: data.selector,
                    html: data.outerHTML,
                    source: 'link-context',
                });
            }

            // 2. Downloads a document without naming the format. Match the raw
            // href first (reliable for the extension), then the resolved URL.
            const extMatch = isNavigational(data.href)
                ? DOC_EXTENSION.exec(data.href) ?? DOC_EXTENSION.exec(data.resolvedHref)
                : null;
            if (extMatch) {
                const ext = extMatch[1]!.toLowerCase();
                if (!new RegExp(`\\b${ext}\\b`, 'i').test(context)) {
                    issues.push({
                        ruleId: 'link-download-no-format',
                        description:
                            `Link downloads a .${ext} file but its accessible name does not mention the ` +
                            `format (and ideally size). Include it, e.g. "Annual report (PDF, 1.2 MB)".`,
                        severity: 'moderate',
                        wcagCriteria: ['2.4.4'],
                        helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/general/G91',
                        target: data.selector,
                        html: data.outerHTML,
                        source: 'link-context',
                    });
                }
            }
        }

        ctx.log(`[link-context] ${evaluated} links evaluated, ${issues.length} issues`);

        return {
            pluginId: 'link-context',
            issues,
            metadata: { totalLinks: handles.length, evaluatedLinks: evaluated },
        };
    },
};
