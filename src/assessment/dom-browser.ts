/**
 * In-page (browser-context) helpers shared across assessment plugins.
 *
 * These functions run INSIDE the page, so they must be self-contained (no
 * module-scope references) for Playwright to serialise them. Several plugins
 * need them from WITHIN their own `page.evaluate` / `ElementHandle.evaluate`
 * closures, where a normal import
 * would be `undefined` in the page. So instead of importing them, the assessment
 * engine installs them once per page on `window.__a11y` (see
 * `INSTALL_DOM_HELPERS` and assessment-engine.ts), and plugin closures call
 * `window.__a11y.cssPath(el)` etc.
 *
 * They are also exported as normal functions so the install string can be built
 * from their source and so they can be unit-tested. Keep every function here
 * free of references to anything outside its own body.
 */

/**
 * A short, reasonably-stable CSS selector for `node`: walk up to five ancestors,
 * short-circuiting on the first `id` (ids are unique), otherwise disambiguating
 * each tag with `:nth-of-type` among its same-tag siblings.
 */
export function cssPath(node: Element): string {
    const parts: string[] = [];
    let cur: Element | null = node;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
        let sel = cur.nodeName.toLowerCase();
        if (cur.id) {
            sel += `#${CSS.escape(cur.id)}`;
            parts.unshift(sel);
            break;
        }
        const parent: Element | null = cur.parentElement;
        if (parent) {
            const sameTag = Array.from(parent.children).filter((c) => c.nodeName === cur!.nodeName);
            if (sameTag.length > 1) sel += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
        }
        parts.unshift(sel);
        cur = parent;
    }
    return parts.join(' > ');
}

/**
 * Whether `el` is exposed to assistive technology: `false` when the element or
 * any ancestor is `display:none`, `visibility:hidden`, `[hidden]`, or
 * `aria-hidden="true"` — i.e. the pruning browsers apply to the AT tree.
 */
export function visibleToAT(el: Element): boolean {
    let node: Element | null = el;
    while (node) {
        const s = window.getComputedStyle(node);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        if (node.hasAttribute('hidden')) return false;
        if (node.getAttribute('aria-hidden') === 'true') return false;
        node = node.parentElement;
    }
    return true;
}

/**
 * Whether `el` is rendered. Always requires it not be `display:none` /
 * `visibility:hidden`. When `minPx` is given, also requires a bounding box
 * strictly larger than `minPx` on both axes; when `atAware`, also excludes
 * elements inside an `aria-hidden` subtree. The options are set per call site to
 * preserve each plugin's original predicate exactly.
 */
export function isShown(el: Element, opts: { minPx?: number; atAware?: boolean } = {}): boolean {
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (opts.atAware && el.closest('[aria-hidden="true"]')) return false;
    if (opts.minPx !== undefined) {
        const r = el.getBoundingClientRect();
        if (!(r.width > opts.minPx && r.height > opts.minPx)) return false;
    }
    return true;
}

/**
 * The computed accessible name of `el`, trimmed (`''` when it has none). A
 * pragmatic implementation of the WCAG accessible-name computation — enough for
 * the cases this engine needs, deliberately not a byte-for-byte accname.
 *
 * Order: `aria-labelledby` (resolved, recursing once) → `aria-label` → host-language
 * mechanisms (img/area `alt`, form-control `<label>`/title/placeholder, `<legend>`,
 * `<figcaption>`, `<caption>`) → name from contents for elements/roles that take
 * one (with a descendant-`alt` fallback for icon-only links/buttons) → `title`.
 *
 * `aria-labelledby` intentionally wins over `aria-label`, per the accname spec —
 * this is the single place that policy lives, so every plugin agrees.
 *
 * With `{ ariaOnly: true }` the computation stops after `aria-label`: used for
 * landmarks and navigation regions, whose name comes only from ARIA (never from
 * their text content).
 */
export function accessibleName(el: Element, opts: { ariaOnly?: boolean } = {}): string {
    const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

    const NAME_FROM_CONTENT_TAGS = new Set([
        'a', 'button', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'td', 'th', 'label', 'legend', 'caption', 'option', 'figcaption', 'dt',
    ]);
    const NAME_FROM_CONTENT_ROLES = new Set([
        'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'option', 'tab', 'treeitem', 'heading', 'cell', 'gridcell', 'columnheader', 'rowheader',
    ]);
    const takesNameFromContent = (node: Element): boolean =>
        NAME_FROM_CONTENT_TAGS.has(node.tagName.toLowerCase()) ||
        NAME_FROM_CONTENT_ROLES.has(node.getAttribute('role') ?? '');

    const compute = (node: Element, visited: Set<Element>): string => {
        if (visited.has(node)) return '';
        const tag = node.tagName.toLowerCase();

        // 1. aria-labelledby — resolve each referenced element (recursing once).
        const labelledBy = node.getAttribute('aria-labelledby');
        if (labelledBy) {
            visited.add(node);
            const parts = labelledBy
                .split(/\s+/)
                .map((id) => {
                    const ref = id ? document.getElementById(id) : null;
                    if (!ref) return '';
                    return compute(ref, visited) || collapse(ref.textContent ?? '');
                })
                .filter(Boolean);
            if (parts.length) return collapse(parts.join(' '));
        }

        // 2. aria-label
        const ariaLabel = node.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

        // Landmarks / navigation regions take their name only from ARIA.
        if (opts.ariaOnly) return '';

        // 3. Host-language labelling mechanisms.
        if (tag === 'img' || tag === 'area' || (tag === 'input' && node.getAttribute('type') === 'image')) {
            const alt = node.getAttribute('alt');
            if (alt !== null) return alt.trim(); // alt="" is an intentional empty (decorative) name
        }
        if (tag === 'input' || tag === 'select' || tag === 'textarea') {
            const labels = (node as unknown as { labels?: NodeListOf<HTMLLabelElement> | null }).labels;
            if (labels && labels.length) {
                const text = collapse(Array.from(labels).map((l) => l.textContent ?? '').join(' '));
                if (text) return text;
            }
            const title = node.getAttribute('title');
            if (title && title.trim()) return title.trim();
            const placeholder = node.getAttribute('placeholder');
            if (placeholder && placeholder.trim()) return placeholder.trim();
            return '';
        }
        if (tag === 'fieldset') {
            const legend = node.querySelector(':scope > legend');
            if (legend) { const t = collapse(legend.textContent ?? ''); if (t) return t; }
        }
        if (tag === 'figure') {
            const cap = node.querySelector('figcaption');
            if (cap) { const t = collapse(cap.textContent ?? ''); if (t) return t; }
        }
        if (tag === 'table') {
            const cap = node.querySelector(':scope > caption');
            if (cap) { const t = collapse(cap.textContent ?? ''); if (t) return t; }
        }

        // 4. Name from contents (for tags/roles that allow it).
        if (takesNameFromContent(node)) {
            const text = collapse(node.textContent ?? '');
            if (text) return text;
            // Icon-only link/button: fall back to descendant image alt text.
            const imgAlts = Array.from(node.querySelectorAll('img[alt], [role="img"][aria-label]'))
                .map((img) => (img.getAttribute('alt') ?? img.getAttribute('aria-label') ?? '').trim())
                .filter(Boolean);
            if (imgAlts.length) return collapse(imgAlts.join(' '));
        }

        // 5. title attribute — the fallback, and the primary source for iframe/frame.
        const title = node.getAttribute('title');
        if (title && title.trim()) return title.trim();

        return '';
    };

    return compute(el, new Set<Element>());
}

/**
 * Focus-ring fingerprint: the computed styles a visible focus indicator can
 * change (outline, box-shadow, border, background, colour, text-decoration) for
 * the element and its ::before / ::after. The focus-visible plugin diffs a
 * resting snapshot against a focused one, so both MUST use identical logic —
 * which is exactly why this lives in one place.
 */
export function focusStyleSnapshot(el: Element): string {
    const s = window.getComputedStyle(el);
    const main = [
        s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.backgroundColor,
        s.borderTopColor, s.borderBottomColor, s.borderLeftColor, s.borderRightColor,
        s.borderTopWidth, s.borderBottomWidth, s.color, s.textDecorationLine,
    ].join('|');
    const pseudo = (which: string): string => {
        const p = window.getComputedStyle(el, which);
        return [p.content, p.boxShadow, p.outlineStyle, p.outlineColor, p.backgroundColor, p.borderTopColor].join('|');
    };
    return `${main}||${pseudo('::before')}||${pseudo('::after')}`;
}

/**
 * JS source (an IIFE expression) that installs the helpers on `window.__a11y`.
 * Built from each function's `.toString()` — under Bun that returns type-stripped
 * JS — so there is a single definition of each helper. Run once per page via
 * `page.evaluate(INSTALL_DOM_HELPERS)` before plugins execute.
 */
export const INSTALL_DOM_HELPERS = `(() => {
  window.__a11y = {
    cssPath: ${cssPath.toString()},
    visibleToAT: ${visibleToAT.toString()},
    isShown: ${isShown.toString()},
    accessibleName: ${accessibleName.toString()},
    focusStyleSnapshot: ${focusStyleSnapshot.toString()},
  };
})()`;

declare global {
    interface Window {
        /** In-page assessment helpers, installed by the engine (see dom-browser.ts). */
        __a11y: {
            cssPath: (node: Element) => string;
            visibleToAT: (el: Element) => boolean;
            isShown: (el: Element, opts?: { minPx?: number; atAware?: boolean }) => boolean;
            accessibleName: (el: Element, opts?: { ariaOnly?: boolean }) => string;
            focusStyleSnapshot: (el: Element) => string;
        };
    }
}
