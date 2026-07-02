/**
 * Browser-native accessibility resolution via the Chrome DevTools Protocol.
 *
 * The in-page `accessibleName` in dom-browser.ts is a pragmatic approximation of
 * the WCAG accessible-name computation. Chromium already computes the real one —
 * this module reads it straight from the browser's accessibility tree
 * (`Accessibility.getFullAXTree`). That is the hard, spec-heavy part, so it comes
 * from the browser; the far simpler "is the element rendered / exposed to AT?"
 * question stays with the in-page `visibleToAT` (not `display:none`,
 * `visibility:hidden`, `[hidden]`, or `aria-hidden`). Note this is deliberately
 * NOT the AX tree's `ignored` flag: `ignored` also removes still-rendered nodes
 * such as `role="presentation"` tables, which several plugins must still inspect.
 *
 * Design goals:
 *  - Authoritative names: computed by the same engine a screen reader sees.
 *  - Batched: O(1) CDP round-trips per call regardless of how many elements are
 *    resolved (the AX tree + the DOM tree, plus one in-page visibility pass).
 *  - Resilient: every CDP interaction degrades gracefully to the in-page
 *    approximation (`window.__a11y`) and, ultimately, to safe defaults — a scan
 *    never fails because the protocol hiccupped or the target isn't Chromium.
 *
 * Correlation: AX nodes reference DOM nodes by `backendDOMNodeId`, which page JS
 * cannot see. To attach a browser-computed name to a specific element we
 *   1. tag the elements with a private data-attribute in the page,
 *   2. pull the DOM tree once (`DOM.getDocument`, piercing iframes + shadow
 *      roots) to learn each tagged element's `backendNodeId`, and
 *   3. join that against the AX tree.
 * Two CDP calls, no per-element round-trips.
 */
import type { Page, CDPSession, ElementHandle } from 'playwright';
import type { AccessibilityResolver, AxInfo } from './types.js';
import { INSTALL_DOM_HELPERS } from './dom-browser.js';

/** Private attribute used to correlate elements to backend node ids. Removed after each resolve. */
const PROBE_ATTR = 'data-a11y-ax-probe';
/** Upper bound on any single CDP call so a hung protocol can't stall a scan. */
const CDP_TIMEOUT_MS = 8000;
/** Returned when accessibility facts can't be determined. `visibleToAT:true`
 *  (assume exposed) so a resolution gap never silently drops an element. */
const UNKNOWN: AxInfo = { name: '', role: '', visibleToAT: true };

// ---------------------------------------------------------------------------
// Pure correlation helpers (no browser / no CDP — unit-tested directly).
// Minimal structural shapes so tests can build fixtures without protocol types.
// ---------------------------------------------------------------------------

interface AxValueLike {
    value?: unknown;
}
interface AxNodeLike {
    backendDOMNodeId?: number;
    name?: AxValueLike;
    role?: AxValueLike;
}
interface DomNodeLike {
    backendNodeId: number;
    nodeType: number;
    attributes?: string[];
    children?: DomNodeLike[];
    contentDocument?: DomNodeLike;
    shadowRoots?: DomNodeLike[];
    pseudoElements?: DomNodeLike[];
}

/** The browser-computed name + role for one element (visibility is resolved separately). */
export interface NameInfo {
    name: string;
    role: string;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

/** `backendDOMNodeId → {name, role}`, from a `getFullAXTree` node list. */
export function indexAxNodesByBackendId(nodes: readonly AxNodeLike[]): Map<number, NameInfo> {
    const map = new Map<number, NameInfo>();
    for (const node of nodes) {
        if (typeof node.backendDOMNodeId !== 'number') continue;
        map.set(node.backendDOMNodeId, {
            name: asString(node.name?.value).replace(/\s+/g, ' ').trim(),
            role: asString(node.role?.value),
        });
    }
    return map;
}

/** Read one attribute value out of a `DOM.Node`'s flat `[name, value, …]` array. */
function readAttribute(node: DomNodeLike, attr: string): string | null {
    const attrs = node.attributes;
    if (!attrs) return null;
    for (let i = 0; i + 1 < attrs.length; i += 2) {
        if (attrs[i] === attr) return attrs[i + 1]!;
    }
    return null;
}

/**
 * `attribute-value → backendNodeId`, by walking a `DOM.getDocument` tree and
 * piercing iframe content documents, shadow roots and pseudo-elements.
 * Iterative to stay safe on very deep DOMs.
 */
export function mapAttributeToBackendId(root: DomNodeLike, attr: string): Map<string, number> {
    const out = new Map<string, number>();
    const stack: DomNodeLike[] = [root];
    while (stack.length > 0) {
        const node = stack.pop() as DomNodeLike;
        if (node.nodeType === 1) {
            const value = readAttribute(node, attr);
            if (value !== null) out.set(value, node.backendNodeId);
        }
        if (node.children) stack.push(...node.children);
        if (node.shadowRoots) stack.push(...node.shadowRoots);
        if (node.contentDocument) stack.push(node.contentDocument);
        if (node.pseudoElements) stack.push(...node.pseudoElements);
    }
    return out;
}

/**
 * Join tagged elements to their browser-computed name/role. An element present
 * in the DOM but absent from the AX tree resolves to an empty name. Tags never
 * found in the DOM walk are reported as `missing` so the caller can fall back
 * for just those.
 */
export function correlate(
    attrToBackendId: Map<string, number>,
    axByBackendId: Map<number, NameInfo>,
    expected: readonly string[],
): { resolved: Map<string, NameInfo>; missing: string[] } {
    const resolved = new Map<string, NameInfo>();
    for (const [tag, backendId] of attrToBackendId) {
        resolved.set(tag, axByBackendId.get(backendId) ?? { name: '', role: '' });
    }
    const missing = expected.filter((tag) => !resolved.has(tag));
    return { resolved, missing };
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

export class PageAccessibilityTree implements AccessibilityResolver {
    private session: CDPSession | null;
    private disposed = false;
    /**
     * Cached `getFullAXTree` result (backendNodeId → name/role). The accessibility
     * tree is stable across a page's assessment — no plugin modifies content or
     * aria — so the tree is fetched once and reused by every plugin, instead of
     * re-fetched on each resolve. (The DOM tree can't be cached: correlation reads
     * the fresh per-resolve probe tags.)
     */
    private cachedAxNames: Map<number, NameInfo> | null = null;

    private constructor(
        private readonly page: Page,
        session: CDPSession | null,
        private readonly log: (message: string) => void,
    ) {
        this.session = session;
    }

    /**
     * Create a resolver for `page`. Never throws: if a CDP session can't be
     * established (non-Chromium target, protocol error) the resolver is returned
     * in a degraded state that always uses the in-page fallback.
     *
     * Expects the in-page helpers (`window.__a11y`) to be installed — the AT
     * visibility pass and the name fallback both use them. Prefer
     * `preparePageForPlugins`, which installs them and creates the resolver
     * together; if they are absent, visibility degrades to "assume visible".
     */
    static async create(page: Page, log: (message: string) => void = () => {}): Promise<PageAccessibilityTree> {
        let session: CDPSession | null = null;
        try {
            session = await page.context().newCDPSession(page);
            await session.send('DOM.enable');
            await session.send('Accessibility.enable');
        } catch (err) {
            log(`[ax-tree] CDP unavailable, using in-page fallback: ${String(err)}`);
            if (session) await session.detach().catch(() => {});
            session = null;
        }
        return new PageAccessibilityTree(page, session, log);
    }

    /** Detach the CDP session. Idempotent; safe to call more than once. */
    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        const session = this.session;
        this.session = null;
        if (session) await session.detach().catch(() => {});
    }

    async resolveHandles(handles: readonly ElementHandle<Element>[]): Promise<AxInfo[]> {
        if (handles.length === 0) return [];

        // Tag each handle with its index (one round-trip for the whole batch).
        // The attribute literal must equal PROBE_ATTR — module constants can't be
        // referenced inside a serialised page function.
        try {
            await this.page.evaluate(
                (els) => (els as Element[]).forEach((el, i) => el.setAttribute('data-a11y-ax-probe', String(i))),
                handles as unknown as unknown[],
            );
        } catch {
            return this.fallbackHandles(handles);
        }

        const expected = handles.map((_, i) => String(i));
        try {
            const [names, visible] = await Promise.all([
                this.resolveNames(PROBE_ATTR, expected),
                this.resolveVisibility(PROBE_ATTR),
            ]);
            return expected.map((tag) => {
                const info = names.get(tag);
                return {
                    name: info?.name ?? '',
                    role: info?.role ?? '',
                    visibleToAT: visible.get(tag) ?? true,
                };
            });
        } finally {
            await this.removeProbes(PROBE_ATTR);
        }
    }

    /** The AX-tree name/role map, fetched once per page (see `cachedAxNames`) and reused. */
    private async axNamesByBackendId(): Promise<Map<number, NameInfo>> {
        if (this.cachedAxNames) return this.cachedAxNames;
        const axTree = await this.withTimeout(
            this.cdp<{ nodes: AxNodeLike[] }>('Accessibility.getFullAXTree', {}),
            'getFullAXTree',
        );
        this.cachedAxNames = indexAxNodesByBackendId(axTree.nodes);
        return this.cachedAxNames;
    }

    /**
     * Browser-computed name/role for every element carrying `attr`. Falls back
     * per-element for correlation misses and wholesale on CDP failure.
     */
    private async resolveNames(attr: string, expected: readonly string[]): Promise<Map<string, NameInfo>> {
        if (!this.session) return this.fallbackNames(attr, expected);
        try {
            const [axByBackendId, dom] = await Promise.all([
                this.axNamesByBackendId(),
                this.withTimeout(
                    this.cdp<{ root: DomNodeLike }>('DOM.getDocument', { depth: -1, pierce: true }),
                    'getDocument',
                ),
            ]);
            const attrToBackendId = mapAttributeToBackendId(dom.root, attr);
            const { resolved, missing } = correlate(attrToBackendId, axByBackendId, expected);

            if (missing.length > 0) {
                const recovered = await this.fallbackNames(attr, missing);
                for (const [tag, info] of recovered) resolved.set(tag, info);
            }
            return resolved;
        } catch (err) {
            this.log(`[ax-tree] AX-tree resolution failed, using in-page fallback: ${String(err)}`);
            return this.fallbackNames(attr, expected);
        }
    }

    /** In-page name fallback keyed by the correlation attribute (`window.__a11y`). */
    private async fallbackNames(attr: string, expected: readonly string[]): Promise<Map<string, NameInfo>> {
        let pairs: Array<[string, NameInfo]> = [];
        try {
            pairs = await this.page.evaluate((probe) => {
                const helpers = (window as unknown as {
                    __a11y?: { accessibleName?: (el: Element) => string };
                }).__a11y;
                const result: Array<[string, { name: string; role: string }]> = [];
                for (const el of Array.from(document.querySelectorAll(`[${probe}]`))) {
                    const tag = el.getAttribute(probe);
                    if (tag === null) continue;
                    result.push([tag, { name: helpers?.accessibleName ? helpers.accessibleName(el) : '', role: '' }]);
                }
                return result;
            }, attr);
        } catch {
            /* page gone — fall through to empty names */
        }
        const map = new Map<string, NameInfo>(pairs);
        for (const tag of expected) if (!map.has(tag)) map.set(tag, { name: '', role: '' });
        return map;
    }

    /** In-page AT visibility (`window.__a11y.visibleToAT`) keyed by the attribute. */
    private async resolveVisibility(attr: string): Promise<Map<string, boolean>> {
        try {
            const pairs = await this.page.evaluate((probe) => {
                const helpers = (window as unknown as {
                    __a11y?: { visibleToAT?: (el: Element) => boolean };
                }).__a11y;
                const result: Array<[string, boolean]> = [];
                for (const el of Array.from(document.querySelectorAll(`[${probe}]`))) {
                    const tag = el.getAttribute(probe);
                    if (tag === null) continue;
                    result.push([tag, helpers?.visibleToAT ? helpers.visibleToAT(el) : true]);
                }
                return result;
            }, attr);
            return new Map(pairs);
        } catch {
            return new Map();
        }
    }

    /** Full in-page fallback that resolves handles directly (used when tagging fails). */
    private async fallbackHandles(handles: readonly ElementHandle<Element>[]): Promise<AxInfo[]> {
        try {
            return await this.page.evaluate((els) => {
                const helpers = (window as unknown as { __a11y?: {
                    accessibleName?: (el: Element) => string;
                    visibleToAT?: (el: Element) => boolean;
                } }).__a11y;
                return (els as Element[]).map((el) => ({
                    name: helpers?.accessibleName ? helpers.accessibleName(el) : '',
                    role: '',
                    visibleToAT: helpers?.visibleToAT ? helpers.visibleToAT(el) : true,
                }));
            }, handles as unknown as unknown[]);
        } catch {
            return handles.map(() => UNKNOWN);
        }
    }

    /** Remove the correlation attribute from every element that still carries it. */
    private async removeProbes(attr: string): Promise<void> {
        try {
            await this.page.evaluate((probe) => {
                for (const el of Array.from(document.querySelectorAll(`[${probe}]`))) el.removeAttribute(probe);
            }, attr);
        } catch {
            /* page navigated or closed — nothing to clean up */
        }
    }

    /**
     * Loosely-typed CDP send. The generated `CDPSession.send` signature is a huge
     * protocol union that overflows TS's instantiation depth when composed (e.g.
     * inside `Promise.all`), so we bypass it and assert the small shape we read.
     */
    private cdp<T>(method: string, params: Record<string, unknown>): Promise<T> {
        const session = this.session as unknown as {
            send(method: string, params: Record<string, unknown>): Promise<unknown>;
        };
        return session.send(method, params) as Promise<T>;
    }

    private withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`CDP timeout: ${label}`)), CDP_TIMEOUT_MS);
        });
        return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
    }
}

/**
 * Prepare a freshly-loaded page for plugin execution: install the in-page helper
 * namespace (`window.__a11y`) and create the accessibility resolver. Every plugin
 * depends on both, so this MUST run before any plugin does.
 *
 * The single source of that setup, called by the assessment engine before each
 * plugin pass AND by the browser test harness — so tests exercise plugins exactly
 * as production does and the two cannot drift. Returns the resolver; dispose it
 * when the pass is done.
 */
export async function preparePageForPlugins(
    page: Page,
    log: (message: string) => void = () => {},
): Promise<PageAccessibilityTree> {
    try {
        await page.evaluate(INSTALL_DOM_HELPERS);
    } catch (err) {
        log(`Warning: Could not install in-page helpers: ${String(err)}`);
    }
    return PageAccessibilityTree.create(page, log);
}
