/**
 * Forms plugin.
 *
 * Complements axe-core (which flags bare missing labels) with the form checks
 * axe does not perform, mapped to RAWeb topic 11 / RGAA / WCAG:
 *
 *  - form-control-no-accessible-name  — control exposed to AT with no name
 *                                       (1.3.1, 4.1.2, 3.3.2 / RAWeb 11.1)
 *  - form-placeholder-as-label        — name comes only from `placeholder`
 *                                       (1.3.1, 4.1.2 / RAWeb 11.1)
 *  - form-group-missing-fieldset      — radio/checkbox group not grouped with
 *                                       fieldset+legend or a named group
 *                                       (1.3.1 / RAWeb 11.5)
 *  - form-missing-autocomplete        — likely personal-data field without an
 *                                       autocomplete token (1.3.5 / RAWeb 11.13)
 *  - form-autocomplete-mismatch       — autocomplete token contradicts the input
 *                                       type, e.g. type=email + autocomplete=tel
 *                                       (1.3.5 / RAWeb 11.13)
 *  - form-required-not-programmatic   — visible "required" marker but no
 *                                       required/aria-required (3.3.2 / RAWeb 11.10)
 *  - form-invalid-without-error       — aria-invalid="true" with no associated
 *                                       error message (3.3.1, 3.3.3 / RAWeb 11.10–11.11)
 *
 * The accessible name and AT-visibility come from the browser's own
 * accessibility tree via the shared resolver (ctx.ax), so form-control name
 * computation (implicit/explicit/wrapping labels, aria) matches what a screen
 * reader announces.
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
    IssueSeverity,
} from '../types.js';

/** Input types that are not user-fillable fields (handled elsewhere or nameless by design). */
const NON_FIELD_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button', 'image']);

/** Structural facts collected in-page for one form control. */
interface ControlData {
    tag: string;
    type: string;
    selector: string;
    nameAttr: string | null;
    /** Has a real labelling mechanism other than placeholder. */
    hasNonPlaceholderName: boolean;
    /** placeholder is present and is the ONLY potential naming source. */
    placeholderOnly: boolean;
    /** Associated label / aria-label text shows a required marker (* / "required"). */
    visibleRequiredMarker: boolean;
    hasRequiredAttr: boolean;
    autocomplete: string | null;
    /** Looks like it collects the user's own personal data (1.3.5). */
    looksPersonalData: boolean;
    /** autocomplete token clearly contradicts the input type (1.3.5). */
    autocompleteMismatch: boolean;
    ariaInvalid: boolean;
    /** aria-errormessage / aria-describedby resolves to non-empty text. */
    hasErrorAssociation: boolean;
    /** radio/checkbox is inside a fieldset+legend or a named role=group/radiogroup. */
    inNamedGroup: boolean;
    outerHTML: string;
}

function collectControlData(el: Element): ControlData {
    const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const labels = (el as unknown as { labels?: NodeListOf<HTMLLabelElement> | null }).labels;
    const labelText = labels ? collapse(Array.from(labels).map((l) => l.textContent ?? '').join(' ')) : '';
    const ariaLabel = el.getAttribute('aria-label') ?? '';
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    const labelledByText = ariaLabelledBy
        ? ariaLabelledBy
              .split(/\s+/)
              .map((id) => (id ? document.getElementById(id)?.textContent ?? '' : ''))
              .join(' ')
        : '';
    const title = el.getAttribute('title') ?? '';
    const placeholder = el.getAttribute('placeholder') ?? '';

    const hasNonPlaceholderName = Boolean(
        labelText.trim() ||
            ariaLabel.trim() ||
            collapse(labelledByText) ||
            title.trim(),
    );
    const placeholderOnly = Boolean(placeholder.trim()) && !hasNonPlaceholderName;

    // Required: visible marker in the label/aria-label vs programmatic state.
    const labelBlob = `${labelText} ${ariaLabel}`;
    const visibleRequiredMarker = /\*|\b(required|requis|mandatory|obligatoire)\b/i.test(labelBlob);
    const hasRequiredAttr =
        el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';

    // Personal-data heuristic for Identify Input Purpose (1.3.5).
    const autocomplete = el.getAttribute('autocomplete');
    const purposeBlob = `${el.getAttribute('name') || ''} ${el.id} ${type} ${autocomplete || ''}`;
    const PERSONAL =
        /(^|[-_ ])(name|fname|firstname|first-name|lastname|last-name|surname|lname|email|e-mail|mail|tel|telephone|phone|mobile|address|addr|street|city|town|postal|postcode|zip|country|company|organi[sz]ation|cc-|card(number)?|cardnum|ccnum|cvc|cvv|username|bday|birthday|dob)/i;
    const fillableType = ['', 'text', 'email', 'tel', 'url', 'number', 'search'].includes(type);
    const looksPersonalData =
        (tag === 'input' && (type === 'email' || type === 'tel')) ||
        ((tag === 'input' && fillableType) && PERSONAL.test(purposeBlob));

    // Autocomplete token contradicts the input type (1.3.5). Scoped to the
    // unambiguous cases — type=email / type=tel with a *known* field token from
    // a different category — to keep false positives near zero. The field token
    // is the last word (handles "shipping email", "section-x billing tel").
    const KNOWN_AUTOCOMPLETE_FIELDS = new Set([
        'name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name', 'honorific-suffix',
        'nickname', 'username', 'new-password', 'current-password', 'organization-title', 'organization',
        'street-address', 'address-line1', 'address-line2', 'address-line3', 'address-level4',
        'address-level3', 'address-level2', 'address-level1', 'country', 'country-name', 'postal-code',
        'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name', 'cc-number', 'cc-exp',
        'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type', 'transaction-currency', 'transaction-amount',
        'language', 'bday', 'bday-day', 'bday-month', 'bday-year', 'sex', 'url', 'photo',
        'email', 'tel', 'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local', 'tel-extension', 'impp',
    ]);
    const acToken = (autocomplete || '').toLowerCase().trim().split(/\s+/).pop() || '';
    const isTelToken = acToken === 'tel' || acToken.startsWith('tel-');
    let autocompleteMismatch = false;
    if (tag === 'input' && KNOWN_AUTOCOMPLETE_FIELDS.has(acToken)) {
        if (type === 'email' && acToken !== 'email') autocompleteMismatch = true;
        else if (type === 'tel' && !isTelToken) autocompleteMismatch = true;
    }

    // Error-message association.
    const ariaInvalid = el.getAttribute('aria-invalid') === 'true';
    const resolvesToText = (attr: string | null): boolean => {
        if (!attr) return false;
        return attr
            .split(/\s+/)
            .some((id) => collapse(document.getElementById(id)?.textContent ?? '').length > 0);
    };
    const hasErrorAssociation =
        resolvesToText(el.getAttribute('aria-errormessage')) ||
        resolvesToText(el.getAttribute('aria-describedby'));

    // Grouping for radio/checkbox.
    let inNamedGroup = false;
    if (tag === 'input' && (type === 'radio' || type === 'checkbox')) {
        let cur: Element | null = el.parentElement;
        while (cur) {
            if (cur.tagName.toLowerCase() === 'fieldset') {
                const legend = cur.querySelector(':scope > legend');
                if (legend && collapse(legend.textContent ?? '')) { inNamedGroup = true; break; }
            }
            const role = cur.getAttribute('role');
            if (role === 'group' || role === 'radiogroup') {
                if (cur.getAttribute('aria-label')?.trim() || cur.getAttribute('aria-labelledby')) {
                    inNamedGroup = true;
                    break;
                }
            }
            cur = cur.parentElement;
        }
    }

    return {
        tag,
        type,
        selector: window.__a11y.cssPath(el),
        nameAttr: el.getAttribute('name'),
        hasNonPlaceholderName,
        placeholderOnly,
        visibleRequiredMarker,
        hasRequiredAttr,
        autocomplete,
        looksPersonalData,
        autocompleteMismatch,
        ariaInvalid,
        hasErrorAssociation,
        inNamedGroup,
        outerHTML: el.outerHTML.slice(0, 300),
    };
}

export const formsPlugin: AssessmentPlugin = {
    id: 'forms',
    name: 'Forms',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[forms] Scanning form controls...');

        const issues: AccessibilityIssue[] = [];
        const handles = await ctx.queryHandles('input, select, textarea');
        const axInfos = await ctx.ax.resolveHandles(handles);

        // Track radio/checkbox groups: name → members (for group-fieldset check).
        const groups = new Map<string, ControlData[]>();
        let evaluated = 0;

        const push = (
            data: ControlData,
            ruleId: string,
            description: string,
            severity: IssueSeverity,
            wcagCriteria: string[],
            helpUrl?: string,
        ) => {
            issues.push({
                ruleId,
                description,
                severity,
                wcagCriteria,
                helpUrl,
                target: data.selector,
                html: data.outerHTML,
                source: 'forms',
            });
        };

        for (let i = 0; i < handles.length; i++) {
            const handle = handles[i]!;
            const data = await handle.evaluate(collectControlData);

            // Skip non-field inputs (buttons/submit/hidden/image are handled elsewhere).
            if (data.tag === 'input' && NON_FIELD_INPUT_TYPES.has(data.type)) continue;

            const { name, visibleToAT } = axInfos[i]!;
            if (!visibleToAT) continue; // not exposed to AT → not in scope
            evaluated++;

            // Collect radio/checkbox group membership for the grouping rule.
            if (data.tag === 'input' && (data.type === 'radio' || data.type === 'checkbox') && data.nameAttr) {
                const key = `${data.type}:${data.nameAttr}`;
                let members = groups.get(key);
                if (!members) {
                    members = [];
                    groups.set(key, members);
                }
                members.push(data);
            }

            // 1. No accessible name at all.
            if (name.trim() === '') {
                push(
                    data,
                    'form-control-no-accessible-name',
                    `Form control (<${data.tag}${data.type ? ` type="${data.type}"` : ''}>) has no accessible name. ` +
                        `Associate a <label>, or add aria-label / aria-labelledby.`,
                    'serious',
                    ['1.3.1', '3.3.2', '4.1.2'],
                    'https://www.w3.org/WAI/WCAG21/Techniques/html/H44',
                );
            } else if (data.placeholderOnly) {
                // 2. Named only by placeholder (disappears on input, weak AT support).
                push(
                    data,
                    'form-placeholder-as-label',
                    `Form control is labelled only by its placeholder. A placeholder is not a substitute ` +
                        `for a persistent <label> (it disappears on input).`,
                    'moderate',
                    ['1.3.1', '4.1.2'],
                    'https://www.w3.org/WAI/WCAG21/Techniques/failures/F82',
                );
            }

            // 4. Likely personal-data field with no autocomplete token.
            if (data.looksPersonalData && (data.autocomplete === null || data.autocomplete.trim() === '')) {
                push(
                    data,
                    'form-missing-autocomplete',
                    `Field appears to collect the user's personal data but has no autocomplete attribute. ` +
                        `Add an appropriate token (e.g. autocomplete="email") to support auto-fill.`,
                    'moderate',
                    ['1.3.5'],
                    'https://www.w3.org/WAI/WCAG21/Techniques/html/H98',
                );
            } else if (data.autocompleteMismatch) {
                // 4b. autocomplete token contradicts the input type.
                push(
                    data,
                    'form-autocomplete-mismatch',
                    `Field type="${data.type}" has autocomplete="${data.autocomplete}", which identifies a ` +
                        `different kind of data. Use the matching token (e.g. autocomplete="${data.type}").`,
                    'moderate',
                    ['1.3.5'],
                    'https://www.w3.org/WAI/WCAG21/Techniques/html/H98',
                );
            }

            // 5. Visible required marker but not programmatically required.
            if (data.visibleRequiredMarker && !data.hasRequiredAttr) {
                push(
                    data,
                    'form-required-not-programmatic',
                    `Field is visually marked as required but is not programmatically required. ` +
                        `Add the required attribute (or aria-required="true").`,
                    'moderate',
                    ['3.3.2'],
                    'https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA2',
                );
            }

            // 6. Marked invalid but no associated error message.
            if (data.ariaInvalid && !data.hasErrorAssociation) {
                push(
                    data,
                    'form-invalid-without-error',
                    `Field has aria-invalid="true" but no associated error message. ` +
                        `Reference the message with aria-errormessage (or aria-describedby).`,
                    'moderate',
                    ['3.3.1', '3.3.3'],
                    'https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA21',
                );
            }
        }

        // 3. Radio/checkbox groups (2+ members) not wrapped in a named group.
        for (const members of groups.values()) {
            if (members.length < 2) continue;
            if (members.some((m) => m.inNamedGroup)) continue;
            const first = members[0]!;
            push(
                first,
                'form-group-missing-fieldset',
                `${members.length} "${first.nameAttr}" ${first.type} controls are not grouped with a ` +
                    `<fieldset>/<legend> (or a named role="group"/"radiogroup"). Group related controls so their ` +
                    `shared question is announced.`,
                'serious',
                ['1.3.1'],
                'https://www.w3.org/WAI/WCAG21/Techniques/html/H71',
            );
        }

        ctx.log(`[forms] ${evaluated} controls evaluated, ${issues.length} issues`);

        return {
            pluginId: 'forms',
            issues,
            metadata: { totalControls: handles.length, evaluatedControls: evaluated },
        };
    },
};
