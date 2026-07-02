/**
 * Consistent navigation & identification plugin.
 *
 * Cross-page checks (WCAG 3.2.3, 3.2.4 / RAWeb 12.2) that axe-core cannot do —
 * they require comparing a page against earlier pages in the same run. State is
 * accumulated in the run-scoped `ctx.runStore`:
 *
 *  - inconsistent-navigation     — a navigation landmark repeated across pages
 *                                  presents its common items in a different
 *                                  relative order (3.2.3 Consistent Navigation).
 *  - inconsistent-identification — a link to the same destination is given a
 *                                  different accessible name on different pages
 *                                  (3.2.4 Consistent Identification).
 *
 * Navigation is extracted in a single in-page pass. Link/landmark names use a
 * compact accessible-name computation inlined for performance across many pages
 * (landmarks take their name only from aria-label/aria-labelledby; links may
 * additionally take it from contents / img alt / title).
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

const STORE_KEY = 'consistent-navigation';

interface NavLink {
    name: string;
    href: string;
    resolved: string;
    selector: string;
}
interface NavSnapshot {
    key: string;
    selector: string;
    items: string[];
    links: NavLink[];
}
interface NavState {
    /** navKey → the first-seen order of its items + the page it came from. */
    navRefs: Record<string, { items: string[]; url: string }>;
    /** normalized href → first-seen accessible name + the page it came from. */
    linkNames: Record<string, { name: string; url: string }>;
}

function extractNavigation(): NavSnapshot[] {
    const out: NavSnapshot[] = [];
    const navEls = Array.from(document.querySelectorAll('nav, [role="navigation"]'));
    navEls.forEach((nav, i) => {
        if (!window.__a11y.isShown(nav, { atAware: true })) return;
        // Landmarks are named only by aria-label/aria-labelledby, not contents.
        const key = window.__a11y.accessibleName(nav, { ariaOnly: true }) || `nav#${i + 1}`;
        const links: NavLink[] = [];
        for (const a of Array.from(nav.querySelectorAll('a[href]')).slice(0, 60)) {
            if (!window.__a11y.isShown(a, { atAware: true })) continue;
            const href = a.getAttribute('href') ?? '';
            if (/^(#|mailto:|tel:|javascript:|sms:)/i.test(href.trim())) continue;
            const name = window.__a11y.accessibleName(a);
            if (!name) continue;
            links.push({ name, href, resolved: (a as HTMLAnchorElement).href, selector: window.__a11y.cssPath(a) });
        }
        if (links.length) out.push({ key, selector: window.__a11y.cssPath(nav), items: links.map((l) => l.name), links });
    });
    return out;
}

function normalizeHref(resolved: string, raw: string): string {
    // Prefer the resolved absolute URL, but fall back to the raw attribute when
    // the document has no usable base (e.g. about:blank), parsing relative paths
    // against a sentinel origin so distinct paths stay distinct keys.
    const SENTINEL = 'https://nav.invalid';
    const candidate = /^https?:\/\//i.test(resolved) ? resolved : raw.trim();
    try {
        const u = new URL(candidate, `${SENTINEL}/`);
        u.hash = '';
        const origin = u.origin === SENTINEL ? '' : u.origin;
        return (origin + u.pathname.replace(/\/+$/, '') + (u.search || '')).toLowerCase();
    } catch {
        return candidate.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
    }
}

/** True when the items common to both lists appear in a different relative order. */
function commonOrderDiffers(current: string[], ref: string[]): boolean {
    const refSet = new Set(ref);
    const curSet = new Set(current);
    const a = current.filter((x) => refSet.has(x));
    const b = ref.filter((x) => curSet.has(x));
    if (a.length < 2) return false; // need 2+ shared items to have an order
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
    return false;
}

export const consistentNavigationPlugin: AssessmentPlugin = {
    id: 'consistent-navigation',
    name: 'Consistent Navigation',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[consistent-navigation] Comparing navigation against earlier pages...');

        const issues: AccessibilityIssue[] = [];
        const navs = await ctx.page.evaluate(extractNavigation);

        const state = (ctx.runStore.get(STORE_KEY) as NavState | undefined) ?? {
            navRefs: {},
            linkNames: {},
        };

        const emit = async (
            selector: string,
            ruleId: string,
            description: string,
            wcag: string,
            helpUrl: string,
        ) => {
            const capture = await ctx.captureElementMetadata(selector, ruleId);
            issues.push({
                ruleId,
                description,
                severity: 'moderate',
                wcagCriteria: [wcag],
                helpUrl,
                target: selector,
                html: capture.html ?? undefined,
                elementScreenshot: capture.screenshotPath ?? undefined,
                boundingBox: capture.boundingBox ?? undefined,
                source: 'consistent-navigation',
            });
        };

        for (const nav of navs) {
            // 3.2.3 — order of a repeated navigation landmark.
            const ref = state.navRefs[nav.key];
            if (ref) {
                if (commonOrderDiffers(nav.items, ref.items)) {
                    await emit(
                        nav.selector,
                        'inconsistent-navigation',
                        `Navigation "${nav.key}" lists its items in a different relative order than on ` +
                            `${ref.url}. Repeated navigation must keep the same relative order across pages.`,
                        '3.2.3',
                        'https://www.w3.org/WAI/WCAG21/Techniques/general/G61',
                    );
                }
            } else {
                state.navRefs[nav.key] = { items: nav.items, url: ctx.url };
            }

            // 3.2.4 — consistent name for the same destination.
            for (const link of nav.links) {
                const h = normalizeHref(link.resolved, link.href);
                const seen = state.linkNames[h];
                if (seen) {
                    if (seen.name !== link.name) {
                        await emit(
                            link.selector,
                            'inconsistent-identification',
                            `Link to ${link.href} is labelled "${link.name}" here but "${seen.name}" on ` +
                                `${seen.url}. The same destination should be identified consistently across pages.`,
                            '3.2.4',
                            'https://www.w3.org/WAI/WCAG21/Techniques/general/G197',
                        );
                    }
                } else {
                    state.linkNames[h] = { name: link.name, url: ctx.url };
                }
            }
        }

        ctx.runStore.set(STORE_KEY, state);
        ctx.log(`[consistent-navigation] ${navs.length} nav landmark(s), ${issues.length} issues`);

        return {
            pluginId: 'consistent-navigation',
            issues,
            metadata: { navLandmarks: navs.length },
        };
    },
};
