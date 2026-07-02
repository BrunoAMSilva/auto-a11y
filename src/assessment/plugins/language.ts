/**
 * Language plugin.
 *
 * WCAG 3.1.1 — Language of Page, 3.1.2 — Language of Parts.
 *
 * Rules:
 *  - lang-missing: <html> has no lang attribute
 *  - lang-empty: <html lang=""> is empty
 *  - lang-invalid: lang value is not a valid BCP-47 primary language subtag
 *  - lang-part-invalid: an element's lang attribute is malformed
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

/**
 * Minimal BCP-47 check — full validation is out of scope here; we just want
 * to catch the common typos like "english" or "french" instead of "en" / "fr".
 * Accepts: primary-subtag (2 or 3 letters), optionally followed by subtags
 * delimited by hyphens. Examples: "en", "en-US", "fr-CA", "zh-Hant-TW".
 */
const BCP47_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

export const languagePlugin: AssessmentPlugin = {
    id: 'language',
    name: 'Language',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[language] Inspecting language declarations...');

        const snapshot = await ctx.page.evaluate(() => {
            const html = document.documentElement;
            const htmlLang = html.getAttribute('lang');

            const langParts = Array.from(document.querySelectorAll('[lang]'))
                .filter((el) => el !== html)
                .map((el) => ({
                    lang: el.getAttribute('lang') ?? '',
                    selector: window.__a11y.cssPath(el),
                }));

            return {
                htmlLang,
                langParts,
            };
        });

        const issues: AccessibilityIssue[] = [];

        if (snapshot.htmlLang === null) {
            issues.push({
                ruleId: 'lang-missing',
                description: 'The <html> element has no lang attribute.',
                severity: 'serious',
                wcagCriteria: ['3.1.1'],
                target: 'html',
            });
        } else if (snapshot.htmlLang.trim() === '') {
            issues.push({
                ruleId: 'lang-empty',
                description: 'The <html> lang attribute is empty.',
                severity: 'serious',
                wcagCriteria: ['3.1.1'],
                target: 'html',
            });
        } else if (!BCP47_RE.test(snapshot.htmlLang.trim())) {
            issues.push({
                ruleId: 'lang-invalid',
                description: `The <html> lang value "${snapshot.htmlLang}" is not a valid BCP-47 language tag (e.g. "en", "fr-CA").`,
                severity: 'serious',
                wcagCriteria: ['3.1.1'],
                target: 'html',
            });
        }

        for (const part of snapshot.langParts) {
            if (part.lang.trim() === '') {
                const capture = await ctx.captureElementMetadata(part.selector, 'lang-part-empty');
                issues.push({
                    ruleId: 'lang-part-empty',
                    description: 'Element has an empty lang attribute.',
                    severity: 'moderate',
                    wcagCriteria: ['3.1.2'],
                    target: part.selector,
                    html: capture.html ?? undefined,
                    elementScreenshot: capture.screenshotPath ?? undefined,
                    boundingBox: capture.boundingBox ?? undefined,
                });
            } else if (!BCP47_RE.test(part.lang.trim())) {
                const capture = await ctx.captureElementMetadata(part.selector, 'lang-part-invalid');
                issues.push({
                    ruleId: 'lang-part-invalid',
                    description: `Element lang value "${part.lang}" is not a valid BCP-47 tag.`,
                    severity: 'moderate',
                    wcagCriteria: ['3.1.2'],
                    target: part.selector,
                    html: capture.html ?? undefined,
                    elementScreenshot: capture.screenshotPath ?? undefined,
                    boundingBox: capture.boundingBox ?? undefined,
                });
            }
        }

        ctx.log(
            `[language] html.lang="${snapshot.htmlLang}", ${snapshot.langParts.length} parts, ${issues.length} issues.`,
        );

        return {
            pluginId: 'language',
            issues,
            metadata: {
                htmlLang: snapshot.htmlLang,
                partCount: snapshot.langParts.length,
            },
        };
    },
};
