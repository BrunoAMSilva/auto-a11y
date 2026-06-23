import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchBrowser, newContext } from '../browser/launch.js';
import { buildRegistry, type RegistryOptions } from '../checks/registry.js';
import type { Check, CheckContext, Finding } from '../checks/types.js';
import { HtmlReporter } from '../reporter/HtmlReporter.js';
import { createLogger, type Logger } from '../services/Logger.js';
import { StandardsService, type WcagIndex } from '../services/StandardsService.js';
import { resolveTargets, type TargetSpec } from './TargetResolver.js';
import { waitForReady, type WaitOptions } from './waitForReady.js';
import { parseRecording } from '../recording/parser.js';
import { replayRecording } from '../recording/replay.js';

export interface RunOptions {
  projectRoot: string;
  outputDir: string;
  target: TargetSpec;
  /** Replay a Chrome DevTools Recorder JSON file instead of scanning URLs. */
  recordingFile?: string;
  checksDir?: string;
  axeTags?: string[];
  axeDisableRules?: string[];
  builtins?: boolean;
  headless?: boolean;
  logger?: Logger;
  wait?: WaitOptions;
}

/** Shared inputs every check invocation needs. */
interface CheckShared {
  checks: Check[];
  wcagIndex: WcagIndex;
  standards: StandardsService;
  outputDir: string;
  logger: Logger;
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

  const shared: CheckShared = { checks, wcagIndex, standards, outputDir, logger };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  const allFindings: Finding[] = [];
  let urlsScanned: string[] = [];
  const pageTitles: Record<string, string> = {};

  try {
    browser = await launchBrowser({ projectRoot: opts.projectRoot, headless: opts.headless ?? true });
    context = await newContext(browser, { projectRoot: opts.projectRoot });

    if (opts.recordingFile) {
      const recording = parseRecording(await readFile(opts.recordingFile, 'utf8'));
      logger.info(`Replaying recording "${recording.title}" (${recording.steps.length} step(s)).`);
      const result = await replayRecording({
        context,
        recording,
        wait: opts.wait ?? {},
        logger: logger.child('replay'),
        runChecks: (page, url, pageTitle) => runChecksOnPage(page, url, pageTitle, shared),
      });
      allFindings.push(...result.findings);
      urlsScanned = result.urlsScanned;
      Object.assign(pageTitles, result.pageTitles);
    } else {
      urlsScanned = await resolveTargets({ ...opts.target, wait: opts.wait }, context, logger);
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
          const findingsBuf = await runChecksOnPage(page, url, pageTitle, {
            ...shared,
            logger: scopedLogger,
          });
          allFindings.push(...findingsBuf);
        } catch (err) {
          scopedLogger.error(`Failed to scan ${url}`, err);
        } finally {
          await page.close().catch(() => {});
        }
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

/** Run every registered check against a page and collect its findings. */
async function runChecksOnPage(
  page: Page,
  url: string,
  pageTitle: string,
  shared: CheckShared,
): Promise<Finding[]> {
  const findingsBuf: Finding[] = [];
  for (let ci = 0; ci < shared.checks.length; ci++) {
    const check = shared.checks[ci]!;
    const ctx: CheckContext = {
      page,
      url,
      pageTitle,
      stepIndex: ci,
      accessibilityFindings: findingsBuf,
      wcagIndex: shared.wcagIndex,
      standards: shared.standards,
      logger: shared.logger.child(check.id),
      outputDir: shared.outputDir,
      source: check.source ?? 'custom',
    };
    try {
      await check.run(ctx);
    } catch (err) {
      shared.logger.error(`Check '${check.id}' threw on ${url}`, err);
      findingsBuf.push(buildRunnerErrorFinding(check, url, pageTitle, ci, err));
    }
  }
  return findingsBuf;
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
