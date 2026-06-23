/**
 * Chrome DevTools Recorder parsing utilities.
 *
 * Converts the JSON produced by Chrome's "Recorder" panel into a typed
 * `Recording` and provides pure helpers for selector handling and labels.
 * All functions here are browser-free so they can be unit-tested directly.
 */

/** Viewport configuration step. */
export interface SetViewportStep {
  type: 'setViewport';
  width: number;
  height: number;
}

/** Navigation step. */
export interface NavigateStep {
  type: 'navigate';
  url: string;
  assertedEvents?: AssertedEvent[];
}

/** Interaction / wait steps. */
export interface InteractionStep {
  type:
    | 'click'
    | 'doubleClick'
    | 'change'
    | 'keyDown'
    | 'keyUp'
    | 'scroll'
    | 'hover'
    | 'waitForElement'
    | 'waitForExpression';
  /** Ordered list of alternative selector chains (Chrome ranks them best-first). */
  selectors?: string[][];
  value?: string;
  key?: string;
  offsetX?: number;
  offsetY?: number;
  expression?: string;
  assertedEvents?: AssertedEvent[];
}

export interface AssertedEvent {
  type: string;
  url?: string;
  title?: string;
}

export type RecordingStep = SetViewportStep | NavigateStep | InteractionStep;

export interface Recording {
  title: string;
  steps: RecordingStep[];
}

/**
 * Parse a Chrome DevTools Recorder JSON string into a typed Recording.
 * @throws Error if the JSON is malformed or missing a non-empty `steps` array.
 */
export function parseRecording(json: string): Recording {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`Recording is not valid JSON: ${(err as Error).message}`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Recording must be a JSON object.');
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj['steps']) || obj['steps'].length === 0) {
    throw new Error('Recording must contain a non-empty "steps" array.');
  }
  return {
    title: typeof obj['title'] === 'string' && obj['title'] ? obj['title'] : 'Untitled Recording',
    steps: obj['steps'] as RecordingStep[],
  };
}

/** True when the step asserts a navigation event. */
export function hasNavigationEvent(step: RecordingStep): boolean {
  const events = (step as InteractionStep | NavigateStep).assertedEvents;
  return Array.isArray(events) && events.some((e) => e.type === 'navigation');
}

/**
 * True when an interaction changed page state without navigating (modal open,
 * slide-over, SPA panel) — i.e. it carries assertedEvents but none are a
 * navigation. These are worth assessing as a distinct page state.
 */
export function isOverlayInteraction(step: RecordingStep): boolean {
  if (
    step.type !== 'click' &&
    step.type !== 'doubleClick' &&
    step.type !== 'keyDown' &&
    step.type !== 'change'
  ) {
    return false;
  }
  const events = step.assertedEvents;
  return Array.isArray(events) && events.length > 0 && !events.some((e) => e.type === 'navigation');
}

/**
 * Convert a single Chrome selector to a Playwright-compatible selector string.
 * Chrome prefixes selectors with the engine: `aria/`, `xpath/`, `pierce/`, `text/`;
 * an unprefixed value is a CSS selector.
 *
 * Note: `aria/` is handled separately by the replay locator builder (it maps to
 * `getByRole`), but we keep a defensive attribute fallback here.
 */
export function toPwSelector(raw: string): string {
  if (raw.startsWith('xpath/')) {
    // `xpath//html/...` and `xpath///*[@id]` both keep their leading slashes.
    return `xpath=${raw.slice('xpath/'.length)}`;
  }
  if (raw.startsWith('pierce/')) {
    // Playwright's CSS engine already pierces open shadow DOM.
    return raw.slice('pierce/'.length);
  }
  if (raw.startsWith('text/')) {
    // Substring, whitespace-normalised, case-insensitive — forgiving by design.
    return `text=${raw.slice('text/'.length).trim()}`;
  }
  if (raw.startsWith('aria/')) {
    return `[aria-label="${raw.slice('aria/'.length).trim()}"]`;
  }
  return raw; // plain CSS
}

/**
 * Choose the most human-readable selector for labels.
 * Priority: aria > data-test-id > #id > text > first non-xpath/pierce > first.
 */
export function bestSelector(selectors?: string[][]): string {
  if (!selectors || selectors.length === 0) return '(unknown)';
  const flat = selectors.flat();
  return (
    flat.find((s) => s.startsWith('aria/')) ??
    flat.find((s) => s.includes('data-test')) ??
    flat.find((s) => s.startsWith('#')) ??
    flat.find((s) => s.startsWith('text/')) ??
    flat.find((s) => !s.startsWith('xpath/') && !s.startsWith('pierce/')) ??
    flat[0] ??
    '(unknown)'
  );
}

/** Generate a human-readable label for a recording step. */
export function stepLabel(step: RecordingStep): string {
  switch (step.type) {
    case 'setViewport':
      return `Set viewport to ${step.width}×${step.height}`;
    case 'navigate':
      return `Navigate to ${step.url}`;
    case 'click':
    case 'doubleClick': {
      const verb = step.type === 'doubleClick' ? 'Double-click' : 'Click';
      return `${verb} on ${readable(bestSelector(step.selectors))}`;
    }
    case 'change': {
      // Mask all but the first characters in case the value is a secret.
      const v = step.value ?? '';
      const masked = v.length > 3 ? `${v.slice(0, 2)}***` : v;
      return `Set value "${masked}" on ${readable(bestSelector(step.selectors))}`;
    }
    case 'keyDown':
      return `Press ${step.key ?? ''}`;
    case 'keyUp':
      return `Release ${step.key ?? ''}`;
    case 'scroll':
      return `Scroll ${step.selectors ? readable(bestSelector(step.selectors)) : 'page'}`;
    case 'hover':
      return `Hover on ${readable(bestSelector(step.selectors))}`;
    case 'waitForElement':
      return `Wait for ${readable(bestSelector(step.selectors))}`;
    case 'waitForExpression':
      return 'Wait for expression';
    default:
      return `Unknown step: ${(step as RecordingStep).type}`;
  }
}

/** Strip the engine prefix from a selector for display. */
function readable(sel: string): string {
  const slash = sel.indexOf('/');
  if (slash > 0 && /^(aria|text|xpath|pierce)\//.test(sel)) return sel.slice(slash + 1);
  return sel;
}
