/**
 * Adapts the engine's AccessibilityIssue[] into auto-a11y's Finding shape so the
 * existing HtmlReporter (grouped by page / by issue) consumes plugin output with
 * no reporter changes.
 *
 * Issues are grouped by ruleId into one Violation each (matching how axe results
 * are grouped), with one node per occurrence. WCAG success-criterion IDs the
 * plugins already emit (e.g. '1.4.10') resolve straight against the bundled
 * WCAG index — no standards package required.
 */

import type { BaseNode, Finding, Impact, Violation } from '../checks/types.js';
import type { StandardsService, WcagCriterion } from '../services/StandardsService.js';
import type { AccessibilityIssue } from './types.js';

export interface ToFindingInput {
    issues: AccessibilityIssue[];
    url: string;
    pageTitle: string;
    stepNumber: number;
    standards: StandardsService;
    /** Label distinguishing the assessed state (e.g. a recording step). */
    stepName?: string;
}

/**
 * Build a single Finding from a page's plugin issues, or null when there are
 * none (an empty Finding would only add noise to the report).
 */
export function issuesToFinding(input: ToFindingInput): Finding | null {
    const { issues, url, pageTitle, stepNumber, standards } = input;
    if (issues.length === 0) return null;

    // Group by rule so each rule becomes one Violation with N occurrence nodes.
    const byRule = new Map<string, AccessibilityIssue[]>();
    for (const issue of issues) {
        const group = byRule.get(issue.ruleId);
        if (group) group.push(issue);
        else byRule.set(issue.ruleId, [issue]);
    }

    const violations: Violation[] = [];
    for (const [ruleId, group] of byRule) {
        const first = group[0]!;
        const nodes: BaseNode[] = group.map((issue) => ({
            target: issue.target,
            html: issue.html ?? '',
            failureSummary: issue.description,
            screenshotPath: issue.elementScreenshot,
        }));

        violations.push({
            id: ruleId,
            impact: first.severity as Impact,
            description: first.description,
            help: '',
            helpUrl: first.helpUrl,
            wcag: first.wcagCriteria,
            criteria: resolveCriteria(group, standards),
            nodes,
        });
    }

    return {
        command: 'assessment',
        stepName: input.stepName ?? 'assessment',
        stepNumber,
        url,
        pageTitle,
        violations,
        validations: [],
    };
}

/** Union of the WCAG criteria referenced across a rule's occurrences. */
function resolveCriteria(
    issues: AccessibilityIssue[],
    standards: StandardsService,
): WcagCriterion[] {
    const out: WcagCriterion[] = [];
    const seen = new Set<string>();
    for (const issue of issues) {
        for (const id of issue.wcagCriteria) {
            if (seen.has(id)) continue;
            const crit = standards.criterion(id);
            if (!crit) continue;
            seen.add(id);
            out.push(crit);
        }
    }
    return out;
}
