import type { Page } from 'playwright';
import type { Logger } from '../services/Logger.js';
import type { StandardsService, WcagCriterion, WcagIndex } from '../services/StandardsService.js';

export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';

export interface BaseNode {
  target: string;
  html: string;
  failureSummary?: string;
  screenshotPath?: string;
}

export interface Violation {
  id: string;
  impact: Impact;
  description: string;
  help: string;
  helpUrl?: string;
  wcag?: string[];
  criteria?: WcagCriterion[];
  nodes: BaseNode[];
}

export interface Validation {
  type: string;
  description: string;
  help: string;
  helpUrl?: string;
  wcag?: string[];
  criteria?: WcagCriterion[];
  nodes: BaseNode[];
}

export interface Finding {
  command: string;
  stepName: string;
  stepNumber: number;
  url: string;
  pageTitle: string;
  violations: Violation[];
  validations?: Validation[];
  images?: string[];
}

export interface CheckContext {
  page: Page;
  url: string;
  pageTitle: string;
  stepIndex: number;
  accessibilityFindings: Finding[];
  wcagIndex: WcagIndex;
  standards: StandardsService;
  logger: Logger;
  outputDir: string;
  source: 'axe' | 'custom';
}

export interface Check {
  id: string;
  description: string;
  source?: 'axe' | 'custom';
  run: (ctx: CheckContext) => Promise<void>;
}

export interface CommandParams {
  page: Page;
  instruction: { type: string };
  context: CheckContext;
  stepIndex: number;
  variables: Record<string, unknown>;
  resolveVariables: (s: string) => string;
}
