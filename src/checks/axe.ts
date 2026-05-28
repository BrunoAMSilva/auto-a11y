import AxeBuilder from '@axe-core/playwright';
import type { Check, CheckContext, Finding, Impact, Violation } from './types.js';

export interface AxeCheckOptions {
  tags?: string[];
  disableRules?: string[];
}

const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export function createAxeCheck(opts: AxeCheckOptions = {}): Check {
  const tags = opts.tags && opts.tags.length > 0 ? opts.tags : DEFAULT_TAGS;
  return {
    id: 'axe-core',
    description: `axe-core baseline scan (tags: ${tags.join(', ')})`,
    source: 'axe',
    run: async (ctx: CheckContext) => {
      const builder = new AxeBuilder({ page: ctx.page }).withTags(tags);
      if (opts.disableRules && opts.disableRules.length > 0) {
        builder.disableRules(opts.disableRules);
      }

      let results;
      try {
        results = await builder.analyze();
      } catch (err) {
        ctx.logger.error('axe analyze() failed', err);
        return;
      }

      if (results.violations.length === 0) {
        ctx.logger.info(`axe: no violations on ${ctx.url}`);
        return;
      }

      const violations: Violation[] = results.violations.map((v) => ({
        id: v.id,
        impact: normalizeImpact(v.impact),
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        wcag: extractWcagTags(v.tags),
        criteria: ctx.standards.criteriaFromTags(v.tags, ctx.wcagIndex),
        nodes: v.nodes.map((n) => ({
          target: Array.isArray(n.target) ? n.target.join(' ') : String(n.target),
          html: n.html,
          failureSummary: n.failureSummary,
        })),
      }));

      ctx.accessibilityFindings.push({
        command: 'axe-core',
        stepName: 'axe-core',
        stepNumber: ctx.stepIndex + 1,
        url: ctx.url,
        pageTitle: ctx.pageTitle,
        violations,
        validations: [],
        images: [],
      } satisfies Finding);

      ctx.logger.warn(
        `axe: ${violations.length} rule violation(s) (${violations.reduce((acc, v) => acc + v.nodes.length, 0)} nodes) on ${ctx.url}`,
      );
    },
  };
}

function normalizeImpact(impact: string | null | undefined): Impact {
  if (impact === 'critical' || impact === 'serious' || impact === 'moderate' || impact === 'minor') {
    return impact;
  }
  return 'minor';
}

function extractWcagTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const m = t.match(/^wcag(\d)(\d)(\d{1,2})$/i);
    if (m) out.push(`${m[1]}.${m[2]}.${parseInt(m[3]!, 10)}`);
  }
  return out;
}
