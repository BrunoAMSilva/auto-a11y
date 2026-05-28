import type { ElementHandle, Locator, Page } from 'playwright';

export interface HiddenInfo {
  isHiddenAttribute: boolean;
  isAriaHidden: boolean;
  isDisplayNone: boolean;
  isVisibilityHidden: boolean;
  isOpacityZero: boolean;
  isHidden: boolean;
}

export type EvalTarget = ElementHandle | Locator;

// Locator.evaluate and ElementHandle.evaluate have the same runtime shape but
// incompatible static signatures. We type-erase at the call site.
type AnyEval = (fn: unknown, arg?: unknown) => Promise<unknown>;

function evalOnElementVoid<R>(
  target: EvalTarget,
  fn: (el: Element) => R,
): Promise<R> {
  return ((target as unknown as { evaluate: AnyEval }).evaluate(fn) as Promise<R>);
}

export async function isHiddenFromAT(target: EvalTarget): Promise<HiddenInfo> {
  return evalOnElementVoid(target, (el) => {
    const style = window.getComputedStyle(el);
    const isHiddenAttribute = el.hasAttribute('hidden');
    const isAriaHidden = el.getAttribute('aria-hidden') === 'true';
    const isDisplayNone = style.display === 'none';
    const isVisibilityHidden = style.visibility === 'hidden' || style.visibility === 'collapse';
    const isOpacityZero = parseFloat(style.opacity || '1') === 0;
    return {
      isHiddenAttribute,
      isAriaHidden,
      isDisplayNone,
      isVisibilityHidden,
      isOpacityZero,
      isHidden:
        isHiddenAttribute ||
        isAriaHidden ||
        isDisplayNone ||
        isVisibilityHidden ||
        isOpacityZero,
    };
  });
}

export async function getSelector(target: EvalTarget): Promise<string> {
  return evalOnElementVoid(target, (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let selector = cur.nodeName.toLowerCase();
      const cls = cur.getAttribute('class');
      if (cls) {
        const safe = cls
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((c) => `.${CSS.escape(c)}`)
          .join('');
        selector += safe;
      }
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.nodeName === cur!.nodeName,
        );
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
        }
      }
      parts.unshift(selector);
      cur = parent;
    }
    return parts.join(' > ');
  });
}

export function normalizeFlatString(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export async function getPageBrowserContext(page: Page): Promise<{ url: string; title: string }> {
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
  };
}
