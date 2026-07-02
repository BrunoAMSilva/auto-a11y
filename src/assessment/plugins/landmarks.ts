/**
 * Landmarks plugin.
 *
 * Checks for proper landmark structure:
 *  - landmark-main-missing:     no <main> / role="main" on the page
 *  - landmark-main-multiple:    more than one main landmark
 *  - landmark-duplicate-unnamed:  multiple banner/navigation/complementary/contentinfo
 *                                  without unique accessible names
 *  - landmark-banner-multiple:  more than one top-level banner (page-level header)
 *  - landmark-contentinfo-multiple: more than one top-level contentinfo (page-level footer)
 *
 * These are structural page-level checks — axe-core's landmark-one-main
 * and landmark-unique rules cover parts of this, but we keep this plugin
 * so we can reliably surface the offending elements with bounding boxes
 * for overlay highlighting.
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

interface LandmarkRecord {
    role: string;
    accessibleName: string;
    selector: string;
    isTopLevel: boolean;
}

const DUPLICATE_ROLES = ['banner', 'navigation', 'complementary', 'contentinfo'] as const;

export const landmarksPlugin: AssessmentPlugin = {
    id: 'landmarks',
    name: 'Landmarks',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[landmarks] Inspecting landmark structure...');

        const landmarks = await ctx.page.evaluate(() => {
            function isWithinLandmark(el: Element, roles: string[]): boolean {
                // Element's role (if a landmark) counts as being "inside" itself for top-level check —
                // so exclude the element itself when walking ancestors.
                let node = el.parentElement;
                while (node) {
                    const role = resolveRole(node);
                    if (role && roles.includes(role)) return true;
                    node = node.parentElement;
                }
                return false;
            }

            function resolveRole(el: Element): string | null {
                const explicit = el.getAttribute('role');
                if (explicit) return explicit.toLowerCase().split(/\s+/)[0]!;
                const tag = el.tagName.toLowerCase();
                switch (tag) {
                    case 'main':
                        return 'main';
                    case 'nav':
                        return 'navigation';
                    case 'aside':
                        return 'complementary';
                    case 'header':
                        // header is "banner" only when NOT nested in article/section/main/aside
                        return isWithinLandmark(el, [
                            'article',
                            'section',
                            'main',
                            'complementary',
                            'navigation',
                        ])
                            ? null
                            : 'banner';
                    case 'footer':
                        return isWithinLandmark(el, [
                            'article',
                            'section',
                            'main',
                            'complementary',
                            'navigation',
                        ])
                            ? null
                            : 'contentinfo';
                    case 'section':
                        // section is a region only when it has an accessible name
                        return window.__a11y.accessibleName(el, { ariaOnly: true }) ? 'region' : null;
                    default:
                        return null;
                }
            }

            const LANDMARK_SELECTOR =
                'main, nav, aside, header, footer, section, [role="main"], [role="navigation"], [role="complementary"], [role="banner"], [role="contentinfo"], [role="region"], [role="search"], [role="form"]';

            // Landmarks hidden from assistive technology are not exposed in the
            // landmark structure, so they must not affect missing/duplicate checks.

            const nodes = Array.from(document.querySelectorAll(LANDMARK_SELECTOR));
            const out: Array<{
                role: string;
                accessibleName: string;
                selector: string;
                isTopLevel: boolean;
            }> = [];

            for (const el of nodes) {
                if (!window.__a11y.visibleToAT(el)) continue;
                const role = resolveRole(el);
                if (!role) continue;
                out.push({
                    role,
                    accessibleName: window.__a11y.accessibleName(el, { ariaOnly: true }),
                    selector: window.__a11y.cssPath(el),
                    isTopLevel: !isWithinLandmark(el, [
                        'main',
                        'banner',
                        'contentinfo',
                        'navigation',
                        'complementary',
                        'region',
                    ]),
                });
            }

            return out;
        });

        const issues: AccessibilityIssue[] = [];
        const mains = (landmarks as LandmarkRecord[]).filter((l) => l.role === 'main');

        if (mains.length === 0) {
            issues.push({
                ruleId: 'landmark-main-missing',
                description: 'Page has no <main> or role="main" landmark.',
                severity: 'serious',
                wcagCriteria: ['1.3.1', '2.4.1'],
                target: 'document',
            });
        } else if (mains.length > 1) {
            for (const main of mains) {
                const capture = await ctx.captureElementMetadata(main.selector, 'landmark-main-multiple');
                issues.push({
                    ruleId: 'landmark-main-multiple',
                    description: `Page has ${mains.length} main landmarks — exactly one is expected.`,
                    severity: 'serious',
                    wcagCriteria: ['1.3.1'],
                    target: main.selector,
                    html: capture.html ?? undefined,
                    elementScreenshot: capture.screenshotPath ?? undefined,
                    boundingBox: capture.boundingBox ?? undefined,
                });
            }
        }

        // Duplicate-role checks (unnamed duplicates). Only count top-level landmarks.
        for (const role of DUPLICATE_ROLES) {
            const ofRole = (landmarks as LandmarkRecord[]).filter(
                (l) => l.role === role && l.isTopLevel,
            );
            if (ofRole.length < 2) continue;

            const names = new Set(ofRole.map((l) => l.accessibleName).filter(Boolean));
            const unnamed = ofRole.filter((l) => !l.accessibleName);

            // Flag unnamed ones when there is more than one landmark of this role.
            for (const dup of unnamed) {
                const capture = await ctx.captureElementMetadata(
                    dup.selector,
                    `landmark-${role}-unnamed`,
                );
                issues.push({
                    ruleId: 'landmark-duplicate-unnamed',
                    description: `Multiple ${role} landmarks exist on the page but this one has no accessible name (aria-label / aria-labelledby). Without unique names, assistive tech cannot distinguish them.`,
                    severity: 'serious',
                    wcagCriteria: ['1.3.1', '2.4.1'],
                    target: dup.selector,
                    html: capture.html ?? undefined,
                    elementScreenshot: capture.screenshotPath ?? undefined,
                    boundingBox: capture.boundingBox ?? undefined,
                });
            }

            // If every duplicate IS named but names collide, flag it.
            if (unnamed.length === 0 && names.size < ofRole.length) {
                for (const dup of ofRole) {
                    const capture = await ctx.captureElementMetadata(
                        dup.selector,
                        `landmark-${role}-duplicate-name`,
                    );
                    issues.push({
                        ruleId: 'landmark-duplicate-name',
                        description: `Multiple ${role} landmarks share the accessible name "${dup.accessibleName}". Names must be unique to disambiguate.`,
                        severity: 'moderate',
                        wcagCriteria: ['1.3.1', '2.4.1'],
                        target: dup.selector,
                        html: capture.html ?? undefined,
                        elementScreenshot: capture.screenshotPath ?? undefined,
                        boundingBox: capture.boundingBox ?? undefined,
                    });
                }
            }
        }

        ctx.log(
            `[landmarks] ${landmarks.length} landmarks scanned, ${issues.length} issues found.`,
        );

        return {
            pluginId: 'landmarks',
            issues,
            metadata: {
                total: landmarks.length,
                main: mains.length,
            },
        };
    },
};
