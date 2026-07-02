/**
 * Consistent help plugin.
 *
 * WCAG 2.2 SC 3.2.6 Consistent Help (A) — not covered by axe-core, and a
 * cross-page check: when a set of pages provides help mechanisms (a contact
 * link, phone number, email, help/support link, or a contact form), those that
 * recur must appear in the same relative order on each page. State accumulates
 * in the run-scoped `ctx.runStore`, mirroring the consistent-navigation plugin.
 *
 *  - inconsistent-help — a help mechanism present on an earlier page appears in a
 *    different relative order here (3.2.6).
 *
 * Detection is conservative: it recognises tel:/mailto: links and links/buttons
 * whose accessible name matches common help/contact wording. Pages with fewer
 * than two shared help items cannot violate the relative-order requirement.
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
} from '../types.js';

const STORE_KEY = 'consistent-help';

interface HelpItem {
    /** Stable identity for the mechanism: scheme (tel/mailto) or a normalized label. */
    key: string;
    label: string;
    selector: string;
}
interface HelpState {
    /** First-seen ordered help-item keys + the page they came from. */
    ref: { keys: string[]; url: string } | null;
}

function extractHelp(): HelpItem[] {
    const HELP_WORDING =
        /\b(help|support|contact|contact us|get in touch|customer service|customer support|assistance|need help|chat with us|live chat|aide|contactez|assistance|support technique)\b/i;

    const out: HelpItem[] = [];
    const seen = new Set<string>();
    const candidates = Array.from(document.querySelectorAll('a[href], button, [role="link"], [role="button"]'));
    for (const el of candidates) {
        if (!window.__a11y.isShown(el, { minPx: 0, atAware: true })) continue;
        const href = (el.getAttribute('href') || '').trim().toLowerCase();
        let key: string | null = null;
        if (href.startsWith('tel:')) key = 'tel';
        else if (href.startsWith('mailto:')) key = 'mailto';
        else {
            const name = window.__a11y.accessibleName(el);
            if (name && HELP_WORDING.test(name)) key = `label:${name.toLowerCase()}`;
        }
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ key, label: window.__a11y.accessibleName(el) || key, selector: window.__a11y.cssPath(el) });
        if (out.length >= 30) break;
    }
    return out;
}

/** True when the items common to both ordered lists appear in a different order. */
function commonOrderDiffers(current: string[], ref: string[]): boolean {
    const refSet = new Set(ref);
    const curSet = new Set(current);
    const a = current.filter((x) => refSet.has(x));
    const b = ref.filter((x) => curSet.has(x));
    if (a.length < 2) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
    return false;
}

export const consistentHelpPlugin: AssessmentPlugin = {
    id: 'consistent-help',
    name: 'Consistent Help',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[consistent-help] Comparing help mechanisms against earlier pages...');

        const issues: AccessibilityIssue[] = [];
        const items = await ctx.page.evaluate(extractHelp);

        const state = (ctx.runStore.get(STORE_KEY) as HelpState | undefined) ?? { ref: null };

        if (items.length > 0) {
            if (state.ref) {
                if (commonOrderDiffers(items.map((i) => i.key), state.ref.keys)) {
                    const capture = await ctx.captureElementMetadata(items[0]!.selector, 'inconsistent-help');
                    issues.push({
                        ruleId: 'inconsistent-help',
                        description:
                            `Help mechanisms (e.g. "${items[0]!.label}") appear in a different relative order than ` +
                            `on ${state.ref.url}. When help is available across pages it must appear in the same ` +
                            `relative order (WCAG 2.2 Consistent Help).`,
                        severity: 'moderate',
                        wcagCriteria: ['3.2.6'],
                        helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html',
                        target: items[0]!.selector,
                        html: capture.html ?? undefined,
                        elementScreenshot: capture.screenshotPath ?? undefined,
                        boundingBox: capture.boundingBox ?? undefined,
                        source: 'consistent-help',
                    });
                }
            } else {
                // First page with help establishes the reference order.
                state.ref = { keys: items.map((i) => i.key), url: ctx.url };
            }
        }

        ctx.runStore.set(STORE_KEY, state);
        ctx.log(`[consistent-help] ${items.length} help mechanism(s), ${issues.length} issues`);

        return {
            pluginId: 'consistent-help',
            issues,
            metadata: { helpMechanisms: items.length },
        };
    },
};
