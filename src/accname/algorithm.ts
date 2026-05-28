/**
 * W3C accname-1.2 implementation that runs inside the page context.
 *
 * Exported as a single function ready to be passed to `evaluate()`. Helpers are
 * nested so the entire algorithm serializes cleanly when transferred into the
 * browser.
 *
 * Spec: https://www.w3.org/TR/accname-1.2/
 */

export interface AccnameOptions {
  mode: 'name' | 'description';
}

export const ACCNAME_PAGE_FN = (
  rootEl: Element,
  opts: { mode: 'name' | 'description' },
): string => {
  const NAME_FROM_CONTENT_ROLES = new Set([
    'button',
    'cell',
    'checkbox',
    'columnheader',
    'comment',
    'gridcell',
    'heading',
    'link',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'radio',
    'row',
    'rowgroup',
    'rowheader',
    'sectionhead',
    'suggestion',
    'switch',
    'tab',
    'tooltip',
    'treeitem',
  ]);

  const PROHIBITED_NAMING_ROLES = new Set([
    'caption',
    'code',
    'definition',
    'deletion',
    'emphasis',
    'generic',
    'insertion',
    'mark',
    'none',
    'paragraph',
    'presentation',
    'strong',
    'subscript',
    'superscript',
    'suggestion',
    'term',
    'time',
  ]);

  const EMBEDDED_CONTROL_ROLES = new Set([
    'textbox',
    'combobox',
    'listbox',
    'range',
    'progressbar',
    'scrollbar',
    'slider',
    'spinbutton',
    'meter',
  ]);

  const implicitRole = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'a':
      case 'area':
        return el.hasAttribute('href') ? 'link' : 'generic';
      case 'article': return 'article';
      case 'aside': return 'complementary';
      case 'button': return 'button';
      case 'datalist': return 'listbox';
      case 'dd': return 'definition';
      case 'details': return 'group';
      case 'dfn': return 'term';
      case 'dialog': return 'dialog';
      case 'dt': return 'term';
      case 'fieldset': return 'group';
      case 'figure': return 'figure';
      case 'footer': {
        const ancestor = el.closest('article,aside,main,nav,section');
        return ancestor ? 'generic' : 'contentinfo';
      }
      case 'form': return 'form';
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
      case 'header': {
        const ancestor = el.closest('article,aside,main,nav,section');
        return ancestor ? 'generic' : 'banner';
      }
      case 'hr': return 'separator';
      case 'img': {
        const alt = el.getAttribute('alt');
        if (alt === '') return 'presentation';
        return 'img';
      }
      case 'input': {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        switch (type) {
          case 'button': case 'image': case 'reset': case 'submit': return 'button';
          case 'checkbox': return 'checkbox';
          case 'radio': return 'radio';
          case 'range': return 'slider';
          case 'number': return 'spinbutton';
          case 'search': return 'searchbox';
          case 'email': case 'tel': case 'text': case 'url': case 'password': return 'textbox';
          default: return 'textbox';
        }
      }
      case 'li': return 'listitem';
      case 'main': return 'main';
      case 'menu': case 'ol': case 'ul': return 'list';
      case 'nav': return 'navigation';
      case 'option': return 'option';
      case 'output': return 'status';
      case 'progress': return 'progressbar';
      case 'search': return 'search';
      case 'section': {
        const labeled =
          el.hasAttribute('aria-label') ||
          el.hasAttribute('aria-labelledby') ||
          el.hasAttribute('title');
        return labeled ? 'region' : 'generic';
      }
      case 'select': {
        const size = parseInt(el.getAttribute('size') || '0', 10);
        return el.hasAttribute('multiple') || size > 1 ? 'listbox' : 'combobox';
      }
      case 'summary': return 'button';
      case 'svg': return 'graphics-document';
      case 'table': return 'table';
      case 'tbody': case 'tfoot': case 'thead': return 'rowgroup';
      case 'td': return 'cell';
      case 'textarea': return 'textbox';
      case 'th': {
        const scope = (el.getAttribute('scope') || '').toLowerCase();
        if (scope === 'row') return 'rowheader';
        return 'columnheader';
      }
      case 'tr': return 'row';
      default: return 'generic';
    }
  };

  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.trim().split(/\s+/)[0]!.toLowerCase();
    return implicitRole(el);
  };

  const isHidden = (el: Element): boolean => {
    if (el.hasAttribute('hidden')) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const style = window.getComputedStyle(el);
    if (style.display === 'none') return true;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
    return false;
  };

  const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

  const pseudoContent = (el: Element, pseudo: '::before' | '::after'): string => {
    const style = window.getComputedStyle(el, pseudo);
    const content = style.content;
    if (!content || content === 'none' || content === 'normal') return '';
    const m = content.match(/^"((?:[^"\\]|\\.)*)"$/) || content.match(/^'((?:[^'\\]|\\.)*)'$/);
    return m ? m[1]! : '';
  };

  const embeddedControlValue = (el: Element, role: string): string => {
    if (role === 'textbox') {
      const v = (el as HTMLInputElement | HTMLTextAreaElement).value;
      if (typeof v === 'string' && v.length > 0) return v;
      return (el as HTMLElement).textContent || '';
    }
    if (role === 'combobox' || role === 'listbox') {
      if (el.tagName.toLowerCase() === 'select') {
        const sel = el as HTMLSelectElement;
        const opts = Array.from(sel.selectedOptions).map((o) => o.label || o.textContent || '');
        return opts.join(' ');
      }
      const aria = el.getAttribute('aria-activedescendant');
      if (aria) {
        const target = el.ownerDocument!.getElementById(aria);
        if (target) return target.textContent || '';
      }
      return '';
    }
    if (
      role === 'range' ||
      role === 'progressbar' ||
      role === 'scrollbar' ||
      role === 'slider' ||
      role === 'spinbutton' ||
      role === 'meter'
    ) {
      const valueText = el.getAttribute('aria-valuetext');
      if (valueText) return valueText;
      const valueNow = el.getAttribute('aria-valuenow');
      if (valueNow) return valueNow;
      const inputValue = (el as HTMLInputElement).value;
      if (typeof inputValue === 'string') return inputValue;
      return '';
    }
    return '';
  };

  const labelForFormControl = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const role = roleOf(el);

    if (tag === 'img' || tag === 'area') {
      const alt = el.getAttribute('alt');
      if (alt !== null) return alt;
    }

    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'submit') return el.getAttribute('value') || 'Submit';
      if (type === 'reset') return el.getAttribute('value') || 'Reset';
      if (type === 'button') return el.getAttribute('value') || '';
      if (type === 'image') return el.getAttribute('alt') || el.getAttribute('value') || 'Submit';
    }

    if (tag === 'fieldset') {
      const legend = el.querySelector(':scope > legend');
      if (legend) return computeFromNode(legend, new Set([el]), true);
    }

    if (tag === 'table') {
      const caption = el.querySelector(':scope > caption');
      if (caption) return computeFromNode(caption, new Set([el]), true);
    }

    if (tag === 'figure') {
      const figcaption = el.querySelector(':scope > figcaption');
      if (figcaption) return computeFromNode(figcaption, new Set([el]), true);
    }

    // <label for="id"> or wrapping <label>
    if (
      role === 'textbox' ||
      role === 'searchbox' ||
      role === 'checkbox' ||
      role === 'radio' ||
      role === 'spinbutton' ||
      role === 'slider' ||
      role === 'combobox' ||
      role === 'listbox' ||
      role === 'meter' ||
      role === 'progressbar'
    ) {
      const id = el.id;
      let labelText = '';
      if (id) {
        const labels = el.ownerDocument!.querySelectorAll(
          `label[for="${CSS.escape(id)}"]`,
        );
        labels.forEach((lab) => {
          labelText += ' ' + computeFromNode(lab, new Set([el]), true);
        });
      }
      const wrapping = el.closest('label');
      if (wrapping && (!id || wrapping.getAttribute('for') !== id)) {
        labelText += ' ' + computeFromNode(wrapping, new Set([el]), true);
      }
      const result = flat(labelText);
      if (result) return result;
    }

    return '';
  };

  const subtreeContent = (el: Element, visited: Set<Element>): string => {
    if (visited.has(el)) return '';
    visited.add(el);
    let out = pseudoContent(el, '::before');
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        out += (child as Text).data;
      } else if (child.nodeType === 1) {
        const childEl = child as Element;
        if (!isHidden(childEl)) {
          out += ' ' + computeFromNode(childEl, visited, true);
        }
      }
    }
    out += pseudoContent(el, '::after');
    return out;
  };

  const computeFromNode = (
    el: Element,
    visited: Set<Element>,
    isRecursing: boolean,
  ): string => {
    if (!isRecursing && isHidden(el)) return '';

    // Step 2A: aria-labelledby (only on the root call to avoid infinite chains)
    if (!isRecursing) {
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const ids = labelledby.trim().split(/\s+/);
        const parts: string[] = [];
        for (const id of ids) {
          if (!id) continue;
          const ref = el.ownerDocument!.getElementById(id);
          if (ref && !visited.has(ref)) {
            const nextVisited = new Set(visited);
            nextVisited.add(el);
            parts.push(computeFromNode(ref, nextVisited, true));
          }
        }
        const joined = flat(parts.join(' '));
        if (joined) return joined;
      }
    }

    // Step 2B: aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      return flat(ariaLabel);
    }

    const role = roleOf(el);

    // Step 2C: prohibited naming — skip native + content steps
    if (PROHIBITED_NAMING_ROLES.has(role) && !isRecursing) {
      // Still allow title fallback in step 2I
    }

    // Step 2D: embedded control — when recursing into a form control referenced by a label,
    // use its value rather than its content (and never walk back up to a parent label,
    // that creates infinite recursion).
    if (isRecursing) {
      if (EMBEDDED_CONTROL_ROLES.has(role)) {
        const ec = embeddedControlValue(el, role);
        if (ec) return flat(ec);
      }
      // For checkbox / radio / button / link encountered while walking another
      // element's content, contribute the embedded value (if any) or empty —
      // do NOT recurse back into labelForFormControl which would loop.
      const tagLower = el.tagName.toLowerCase();
      if (tagLower === 'input' || tagLower === 'select' || tagLower === 'textarea') {
        return '';
      }
    }

    // Step 2E: native host-language labeling
    const nativeLabel = labelForFormControl(el);
    if (nativeLabel) return flat(nativeLabel);

    // Step 2F: name from content (for roles that allow it, or always when recursing)
    if (NAME_FROM_CONTENT_ROLES.has(role) || isRecursing) {
      const content = flat(subtreeContent(el, visited));
      if (content) return content;
    }

    // Step 2I: tooltip / title attribute
    const title = el.getAttribute('title');
    if (title && title.trim()) return flat(title);

    return '';
  };

  if (opts.mode === 'description') {
    const describedby = rootEl.getAttribute('aria-describedby');
    if (describedby) {
      const ids = describedby.trim().split(/\s+/);
      const parts: string[] = [];
      for (const id of ids) {
        const ref = rootEl.ownerDocument!.getElementById(id);
        if (ref) parts.push(computeFromNode(ref, new Set(), true));
      }
      return flat(parts.join(' '));
    }
    const ariaDesc = rootEl.getAttribute('aria-description');
    if (ariaDesc && ariaDesc.trim()) return flat(ariaDesc);
    const title = rootEl.getAttribute('title');
    if (title && title.trim()) return flat(title);
    return '';
  }

  return computeFromNode(rootEl, new Set(), false);
};
