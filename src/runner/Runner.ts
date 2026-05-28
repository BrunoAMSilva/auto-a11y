import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Browser, BrowserContext } from 'playwright';
import { launchBrowser, newContext } from '../browser/launch.js';
import { buildRegistry, type RegistryOptions } from '../checks/registry.js';
import type { Check, CheckContext, Finding } from '../checks/types.js';
import { HtmlReporter } from '../reporter/HtmlReporter.js';
import { createLogger, type Logger } from '../services/Logger.js';
import { StandardsService } from '../services/StandardsService.js';
import { resolveTargets, type TargetSpec } from './TargetResolver.js';
import { waitForReady, type WaitOptions } from './waitForReady.js';

export interface RunOptions {
  projectRoot: string;
  outputDir: string;
  target: TargetSpec;
  checksDir?: string;
  axeTags?: string[];
  axeDisableRules?: string[];
  builtins?: boolean;
  headless?: boolean;
  logger?: Logger;
  wait?: WaitOptions;
}

export interface RunResult {
  outputDir: string;
  reportPath: string;
  findings: Finding[];
  urlsScanned: string[];
  pageTitles: Record<string, string>;
  totalViolations: number;
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const logger = opts.logger ?? createLogger();
  const outputDir = resolve(opts.outputDir);
  await mkdir(outputDir, { recursive: true });

  const standards = StandardsService.load();
  const wcagIndex = standards.wcagIndex;

  const registryOpts: RegistryOptions = {
    axe: opts.axeTags || opts.axeDisableRules
      ? { tags: opts.axeTags, disableRules: opts.axeDisableRules }
      : {},
    builtins: opts.builtins,
    checksDir: opts.checksDir,
    logger,
  };
  const checks = await buildRegistry(registryOpts);
  logger.info(`Registered ${checks.length} check(s): ${checks.map((c) => c.id).join(', ')}`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  const allFindings: Finding[] = [];
  let urlsScanned: string[] = [];
  const pageTitles: Record<string, string> = {};

  try {
    browser = await launchBrowser({ projectRoot: opts.projectRoot, headless: opts.headless ?? true });
    context = await newContext(browser, { projectRoot: opts.projectRoot });

    urlsScanned = await resolveTargets(
      { ...opts.target, wait: opts.wait },
      context,
      logger,
    );
    logger.info(`Scanning ${urlsScanned.length} URL(s).`);

    for (let i = 0; i < urlsScanned.length; i++) {
      const url = urlsScanned[i]!;
      const scopedLogger = logger.child(`page:${i + 1}/${urlsScanned.length}`);
      const page = await context.newPage();
      try {
        scopedLogger.info(`Navigating: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await waitForReady(page, opts.wait ?? {}, scopedLogger);

        const pageTitle = await page.title().catch(() => '');
        pageTitles[url] = pageTitle;
        const findingsBuf: Finding[] = [];
        for (let ci = 0; ci < checks.length; ci++) {
          const check = checks[ci]!;
          const ctx: CheckContext = {
            page,
            url,
            pageTitle,
            stepIndex: ci,
            accessibilityFindings: findingsBuf,
            wcagIndex,
            standards,
            logger: scopedLogger.child(check.id),
            outputDir,
            source: check.source ?? 'custom',
          };
          try {
            await check.run(ctx);
          } catch (err) {
            scopedLogger.error(`Check '${check.id}' threw on ${url}`, err);
            findingsBuf.push(buildRunnerErrorFinding(check, url, pageTitle, ci, err));
          }
        }
        allFindings.push(...findingsBuf);
      } catch (err) {
        scopedLogger.error(`Failed to scan ${url}`, err);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  const reporter = new HtmlReporter(outputDir, logger.child('reporter'));
  const reportPath = await reporter.write(allFindings, urlsScanned, pageTitles);

  const totalViolations = allFindings.reduce(
    (acc, f) => acc + f.violations.reduce((a, v) => a + v.nodes.length, 0),
    0,
  );
  logger.info(`Done. ${totalViolations} violation node(s) across ${urlsScanned.length} page(s).`);
  logger.info(`Report: ${reportPath}`);

  return {
    outputDir,
    reportPath,
    findings: allFindings,
    urlsScanned,
    pageTitles,
    totalViolations,
  };
}

function buildRunnerErrorFinding(
  check: Check,
  url: string,
  pageTitle: string,
  stepIndex: number,
  err: unknown,
): Finding {
  const message = err instanceof Error ? err.message : String(err);
  return {
    command: check.id,
    stepName: check.id,
    stepNumber: stepIndex + 1,
    url,
    pageTitle,
    violations: [
      {
        id: 'runner-error',
        impact: 'serious',
        description: `Check '${check.id}' threw an error.`,
        help: 'Investigate the custom check implementation or the target page.',
        nodes: [
          {
            target: ':root',
            html: '',
            failureSummary: message,
          },
        ],
      },
    ],
  };
}
