import type { Finding, Impact, Violation } from '../checks/types.js';

export interface PageGroup {
  url: string;
  pageTitle: string;
  findings: Finding[];
  totalViolations: number;
  totalNodes: number;
  impacts: Record<Impact, number>;
}

export interface IssueGroup {
  ruleId: string;
  description: string;
  help: string;
  helpUrl?: string;
  impact: Impact;
  wcag: string[];
  totalNodes: number;
  occurrences: Array<{
    url: string;
    pageTitle: string;
    nodes: Violation['nodes'];
  }>;
}

export interface ReportData {
  generatedAt: string;
  urlsScanned: string[];
  byPage: PageGroup[];
  byIssue: IssueGroup[];
  totals: {
    pages: number;
    findings: number;
    violationNodes: number;
    impacts: Record<Impact, number>;
  };
}

const IMPACTS: Impact[] = ['critical', 'serious', 'moderate', 'minor'];

export function buildReport(
  findings: Finding[],
  urlsScanned: string[],
  pageTitles: Record<string, string> = {},
): ReportData {
  const byPageMap = new Map<string, PageGroup>();
  const byIssueMap = new Map<string, IssueGroup>();
  const impactTotals: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  let violationNodes = 0;

  for (const url of urlsScanned) {
    if (!byPageMap.has(url)) {
      byPageMap.set(url, {
        url,
        pageTitle: pageTitles[url] ?? '',
        findings: [],
        totalViolations: 0,
        totalNodes: 0,
        impacts: { critical: 0, serious: 0, moderate: 0, minor: 0 },
      });
    }
  }

  for (const finding of findings) {
    let group = byPageMap.get(finding.url);
    if (!group) {
      group = {
        url: finding.url,
        pageTitle: finding.pageTitle,
        findings: [],
        totalViolations: 0,
        totalNodes: 0,
        impacts: { critical: 0, serious: 0, moderate: 0, minor: 0 },
      };
      byPageMap.set(finding.url, group);
    }
    if (!group.pageTitle && finding.pageTitle) group.pageTitle = finding.pageTitle;
    group.findings.push(finding);
    group.totalViolations += finding.violations.length;

    for (const violation of finding.violations) {
      group.totalNodes += violation.nodes.length;
      violationNodes += violation.nodes.length;
      group.impacts[violation.impact] += violation.nodes.length;
      impactTotals[violation.impact] += violation.nodes.length;

      const issue = byIssueMap.get(violation.id) ?? {
        ruleId: violation.id,
        description: violation.description,
        help: violation.help,
        helpUrl: violation.helpUrl,
        impact: violation.impact,
        wcag: violation.wcag ?? [],
        totalNodes: 0,
        occurrences: [],
      };
      issue.totalNodes += violation.nodes.length;
      issue.occurrences.push({
        url: finding.url,
        pageTitle: finding.pageTitle,
        nodes: violation.nodes,
      });
      byIssueMap.set(violation.id, issue);
    }
  }

  const byPage = Array.from(byPageMap.values()).sort(
    (a, b) => b.totalNodes - a.totalNodes,
  );
  const byIssue = Array.from(byIssueMap.values()).sort((a, b) => {
    const orderA = IMPACTS.indexOf(a.impact);
    const orderB = IMPACTS.indexOf(b.impact);
    if (orderA !== orderB) return orderA - orderB;
    return b.totalNodes - a.totalNodes;
  });

  return {
    generatedAt: new Date().toISOString(),
    urlsScanned,
    byPage,
    byIssue,
    totals: {
      pages: byPage.length,
      findings: findings.length,
      violationNodes,
      impacts: impactTotals,
    },
  };
}
