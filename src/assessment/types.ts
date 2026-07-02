/**
 * Types for the assessment-plugin layer, ported from the open-path engine
 * (apps/api/src/engine/types.ts). This is the plugin-facing subset only —
 * recording/replay, scope tracking and persistence live in auto-a11y's own
 * modules and are intentionally omitted.
 *
 * Every plugin depends only on this file (plus Playwright), which is what makes
 * the layer portable. Keep it self-contained.
 */

/** Severity of an accessibility issue */
export type IssueSeverity = 'critical' | 'serious' | 'moderate' | 'minor';

/** Device emulation profile a page is assessed under. */
export type ViewportProfile = 'desktop' | 'mobile';

/**
 * Axis-aligned rectangle in *document* CSS pixels (viewport scroll included),
 * used to place a highlight overlay on a full-page screenshot.
 */
export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A single accessibility issue found by a plugin */
export interface AccessibilityIssue {
    /** Plugin-defined rule/check identifier (e.g. axe rule ID) */
    ruleId: string;
    /** Human-readable description */
    description: string;
    /** Severity level */
    severity: IssueSeverity;
    /** WCAG success criteria IDs this maps to (e.g. ['1.1.1', '4.1.2']) */
    wcagCriteria: string[];
    /** CSS selector or description of the affected element */
    target: string;
    /** HTML snippet of the problematic element */
    html?: string;
    /** How to fix it */
    helpUrl?: string;
    /** Path to element screenshot (filled by engine after capture) */
    elementScreenshot?: string;
    /**
     * Element bounding box in document CSS pixels, captured together with the
     * element screenshot. Used to render an overlay rect on the full-page
     * screenshot in the review UI. Undefined when the element was not
     * located or not visible.
     */
    boundingBox?: BoundingBox;
    /** devicePixelRatio at capture time (maps CSS pixels → image pixels). */
    pixelRatio?: number;
    /** innerWidth at capture time, in CSS pixels. */
    viewportWidth?: number;
    /** innerHeight at capture time, in CSS pixels. */
    viewportHeight?: number;
    /** The plugin id that emitted the issue — redundant but simplifies UI joins. */
    source?: string;
    /** Viewport profile this issue was observed under. */
    viewportProfile?: ViewportProfile;
}

/** An image found on the page (for the image inventory plugin) */
export interface ImageInfo {
    /** Element type: img, svg, canvas, object, embed, [role="img"] */
    tagName: string;
    /** src or equivalent URL */
    src: string;
    /** alt attribute value (null if missing) */
    alt: string | null;
    /** Whether the element has role="presentation" or role="none" */
    isDecorative: boolean;
    /** CSS selector path to the element */
    selector: string;
    /** Path to the saved screenshot of this image */
    screenshotPath?: string;
}

/** Return value from an assessment plugin */
export interface AssessmentResult {
    /** Plugin identifier */
    pluginId: string;
    /** Issues found */
    issues: AccessibilityIssue[];
    /** Image inventory (only from image-inventory plugin) */
    images?: ImageInfo[];
    /** Plugin-specific metadata */
    metadata?: Record<string, unknown>;
}

/** Result of capturing an element's screenshot and bounding box together. */
export interface ElementCapture {
    /** Saved screenshot path, or null when the element is not screenshottable. */
    screenshotPath: string | null;
    /** Element rect in *document* CSS pixels, or null when not resolvable. */
    boundingBox: BoundingBox | null;
    /** outerHTML of the element, truncated; null when element is not found. */
    html: string | null;
}

/** Viewport + rendering metadata captured once per page. */
export interface ViewportMetadata {
    viewportWidth: number;
    viewportHeight: number;
    pixelRatio: number;
}

/** Browser-computed accessibility facts for a single element. */
export interface AxInfo {
    /** Accessible name exactly as the browser's accessibility tree computed it
     *  (`''` when the element has none). */
    name: string;
    /** Resolved ARIA role (`''` when unknown, e.g. via the in-page fallback). */
    role: string;
    /**
     * Whether the element is exposed to assistive technology — i.e. not
     * `display:none`, `visibility:hidden`, `[hidden]`, or under `aria-hidden`.
     * This is rendered-ness, deliberately NOT the AX tree's `ignored` flag (which
     * also prunes still-rendered nodes such as `role="presentation"` tables that
     * plugins must still inspect). Defaults to `true` (assume exposed) when
     * unknown, so a resolution gap never silently drops an element from scope.
     */
    visibleToAT: boolean;
}

/**
 * Resolves browser-native accessibility facts for elements on the current page.
 * Backed by the Chrome DevTools Protocol accessibility tree, with a resilient
 * fallback to the in-page approximation — see ax-tree.ts.
 */
export interface AccessibilityResolver {
    /**
     * Accessible name + AT-exposure for each handle, in the same order. Batched
     * (independent of element count) and never throws — on any failure it
     * degrades to the in-page computation and, ultimately, safe defaults.
     */
    resolveHandles(
        handles: readonly import('playwright').ElementHandle<Element>[],
    ): Promise<AxInfo[]>;
}

/**
 * Context provided to each assessment plugin by the engine.
 * Gives plugins access to the Playwright page and artifact utilities.
 */
export interface AssessmentContext {
    /** The Playwright Page object */
    page: import('playwright').Page;
    /**
     * Browser-native accessibility resolver for this page (accessible name +
     * AT-exposure), shared across plugins. Prefer this over recomputing names
     * in-page when you already hold element handles.
     */
    ax: AccessibilityResolver;
    /**
     * `page.$$(selector)` whose returned handles are tracked by the engine and
     * disposed automatically after the plugin finishes. Use this instead of
     * `ctx.page.$$` so element handles don't accumulate across a page's plugins.
     */
    queryHandles: (selector: string) => Promise<import('playwright').ElementHandle<Element>[]>;
    /** Current page URL */
    url: string;
    /**
     * Viewport metadata captured once when the engine started assessing this
     * page. Plugins should attach these to every issue so the review UI can
     * translate boundingBox CSS-pixels → screenshot image-pixels.
     */
    viewport: ViewportMetadata;
    /** Device profile this assessment is running under (desktop | mobile). */
    viewportProfile: ViewportProfile;
    /**
     * Titles of pages previously assessed in this run, oldest first.
     * Used by the page-title plugin to detect SPA routes that forget to
     * update document.title. Does not include the current page.
     */
    previousPageTitles: string[];
    /**
     * A mutable key-value store scoped to the whole run and shared (by
     * reference) across every page the engine assesses. Lets plugins accumulate
     * cross-page state — e.g. the consistent-navigation plugin compares each
     * page's navigation against earlier pages. Namespace your keys (there is no
     * isolation between plugins) and treat absence as "first page".
     */
    runStore: Map<string, unknown>;
    /**
     * Take a screenshot of the first element matching `selector` and return
     * the saved path. Legacy helper — prefer captureElementMetadata, which
     * also returns the bounding box needed for overlay highlighting.
     */
    takeElementScreenshot: (selector: string, label: string) => Promise<string | null>;
    /**
     * Capture an element's screenshot *and* its bounding box (in document
     * CSS pixels) in a single pass. Returns nulls for any field that can't
     * be produced — never throws.
     */
    captureElementMetadata: (
        selector: string,
        label: string,
        options?: { captureScreenshot?: boolean },
    ) => Promise<ElementCapture>;
    /** Take a full-page screenshot and return the saved path */
    takeFullPageScreenshot: (label: string) => Promise<string>;
    /** Save an arbitrary buffer as an artifact and return the path */
    saveArtifact: (buffer: Buffer, filename: string) => Promise<string>;
    /** The run ID (for organizing artifacts) */
    runId: string;
    /** Logger */
    log: (message: string) => void;
}

/**
 * Interface every assessment plugin must implement.
 */
export interface AssessmentPlugin {
    /** Unique identifier for this plugin */
    id: string;
    /** Human-readable name */
    name: string;
    /** Run the assessment on the current page */
    run: (context: AssessmentContext) => Promise<AssessmentResult>;
    /**
     * Optional gate: return false to skip this plugin for a given viewport
     * profile. Defaults to running on every profile. Used so viewport-specific
     * checks (reflow, target-size, ...) only run where they are meaningful and
     * are not double-counted across profiles.
     */
    appliesToViewport?: (profile: ViewportProfile) => boolean;
}
