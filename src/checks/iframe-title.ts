import { getSelector, isHiddenFromAT } from '../accname/utils.js';
import type { BaseNode, Check, CheckContext, Finding, Validation, Violation } from './types.js';

export const iframeTitleCheck: Check = {
  id: 'iframe-title',
  description: 'Iframes must have an accessible name (title, aria-label, or aria-labelledby).',
  source: 'custom',
  run: async (ctx: CheckContext) => {
    ctx.logger.info('Checking iframes for accessible names...');
    const iframes = await ctx.page.locator('iframe').all();
    ctx.logger.info(`Found ${iframes.length} iframe(s).`);

    const violationNodes: BaseNode[] = [];
    const validationNodes: BaseNode[] = [];

    for (const iframe of iframes) {
      const hidden = await isHiddenFromAT(iframe);
      if (hidden.isHidden) {
        const selector = await getSelector(iframe);
        ctx.logger.debug(
          `Iframe "${selector}" hidden from AT (hidden=${hidden.isHiddenAttribute}, aria-hidden=${hidden.isAriaHidden}, display:none=${hidden.isDisplayNone}, visibility:hidden=${hidden.isVisibilityHidden}). Skipping.`,
        );
        continue;
      }

      const [title, ariaLabel, ariaLabelledBy, selector, html] = await Promise.all([
        iframe.getAttribute('title'),
        iframe.getAttribute('aria-label'),
        iframe.getAttribute('aria-labelledby'),
        getSelector(iframe),
        iframe.evaluate((n) => (n as Element).outerHTML),
      ]);

      const hasName =
        (title && title.trim() !== '') ||
        (ariaLabel && ariaLabel.trim() !== '') ||
        (ariaLabelledBy && ariaLabelledBy.trim() !== '');

      if (hasName) {
        validationNodes.push({ target: selector, html });
      } else {
        violationNodes.push({
          target: selector,
          html,
          failureSummary: 'The iframe has no accessible name. Screen reader users cannot identify it.',
        });
      }
    }

    if (violationNodes.length === 0 && validationNodes.length === 0) {
      return;
    }

    const violations: Violation[] = violationNodes.length
      ? [
          {
            id: 'iframe-title',
            impact: 'serious',
            description: 'Iframes must have a title attribute.',
            help: 'Provide a descriptive title for all iframes.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/iframe-title',
            wcag: ['4.1.2'],
            criteria: ctx.standards.criteriaFromTags(['wcag4.1.2'], ctx.wcagIndex),
            nodes: violationNodes,
          },
        ]
      : [];

    const validations: Validation[] = validationNodes.length
      ? [
          {
            type: 'iframe-title',
            description: 'Iframe accessible name must be relevant and descriptive.',
            help: 'The iframe exposes an accessible name via title, aria-label, or aria-labelledby. Confirm it is descriptive.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/iframe-title',
            wcag: ['4.1.2'],
            criteria: ctx.standards.criteriaFromTags(['wcag4.1.2'], ctx.wcagIndex),
            nodes: validationNodes,
          },
        ]
      : [];

    ctx.accessibilityFindings.push({
      command: 'iframe-title',
      stepName: 'iframe-title',
      stepNumber: ctx.stepIndex + 1,
      url: ctx.url,
      pageTitle: ctx.pageTitle,
      violations,
      validations,
    } satisfies Finding);

    if (violationNodes.length) {
      ctx.logger.warn(`${violationNodes.length} iframe(s) without an accessible name.`);
    }
  },
};
