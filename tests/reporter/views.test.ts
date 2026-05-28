import { describe, it, expect } from 'vitest';
import { buildReport } from '../../src/reporter/views.js';
import type { Finding } from '../../src/checks/types.js';

const mkFinding = (overrides: Partial<Finding>): Finding => ({
  command: 'axe',
  stepName: 'axe',
  stepNumber: 1,
  url: 'https://example.com',
  pageTitle: 'Example',
  violations: [],
  validations: [],
  images: [],
  ...overrides,
});

describe('buildReport', () => {
  it('groups by page and aggregates impacts', () => {
    const findings: Finding[] = [
      mkFinding({
        violations: [
          {
            id: 'image-alt',
            impact: 'critical',
            description: 'Images must have alt text',
            help: 'Add alt',
            nodes: [
              { target: 'img.a', html: '<img class="a">' },
              { target: 'img.b', html: '<img class="b">' },
            ],
          },
        ],
      }),
    ];
    const report = buildReport(findings, ['https://example.com']);
    expect(report.byPage).toHaveLength(1);
    expect(report.byPage[0]!.totalNodes).toBe(2);
    expect(report.byPage[0]!.impacts.critical).toBe(2);
    expect(report.totals.violationNodes).toBe(2);
    expect(report.totals.impacts.critical).toBe(2);
  });

  it('groups by issue across pages', () => {
    const findings: Finding[] = [
      mkFinding({
        url: 'https://example.com/a',
        violations: [
          {
            id: 'iframe-title',
            impact: 'serious',
            description: 'd',
            help: 'h',
            nodes: [{ target: 'iframe', html: '<iframe>' }],
          },
        ],
      }),
      mkFinding({
        url: 'https://example.com/b',
        violations: [
          {
            id: 'iframe-title',
            impact: 'serious',
            description: 'd',
            help: 'h',
            nodes: [
              { target: 'iframe.x', html: '<iframe class="x">' },
              { target: 'iframe.y', html: '<iframe class="y">' },
            ],
          },
        ],
      }),
    ];
    const report = buildReport(findings, ['https://example.com/a', 'https://example.com/b']);
    expect(report.byIssue).toHaveLength(1);
    expect(report.byIssue[0]!.totalNodes).toBe(3);
    expect(report.byIssue[0]!.occurrences).toHaveLength(2);
  });

  it('includes pages with no findings', () => {
    const report = buildReport([], ['https://example.com/clean']);
    expect(report.byPage).toHaveLength(1);
    expect(report.byPage[0]!.totalNodes).toBe(0);
  });
});
