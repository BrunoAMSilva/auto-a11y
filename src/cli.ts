#!/usr/bin/env node
import './preinit.js';
import { Command } from 'commander';
import { resolve } from 'node:path';
import { run } from './runner/Runner.js';
import { createLogger, type LogLevel } from './services/Logger.js';
import { installBrowsers } from './scripts/install-browsers.js';
import { bundleOffline } from './scripts/bundle-offline.js';

const program = new Command();
program
  .name('auto-a11y')
  .description('Automated accessibility audits powered by Playwright + axe-core.')
  .version('0.1.0');

program
  .command('scan')
  .description('Scan one or more URLs for accessibility issues.')
  .argument('[url]', 'URL to scan (omit when using --urls or --crawl)')
  .option('--urls <file>', 'newline-delimited file of URLs to scan')
  .option('--crawl <url>', 'seed URL to crawl from')
  .option('--depth <n>', 'max crawl depth', (v) => parseInt(v, 10), 2)
  .option('--max-pages <n>', 'max pages to visit when crawling', (v) => parseInt(v, 10), 50)
  .option('--include <pattern...>', 'crawl include regex(es)')
  .option('--exclude <pattern...>', 'crawl exclude regex(es)')
  .option('--cross-origin', 'allow crawl across origins', false)
  .option('--checks-dir <path>', 'directory of additional custom checks (.js/.mjs)')
  .option('--no-builtins', 'disable built-in checks (axe + iframe-title)')
  .option('--no-axe', 'disable axe-core check only')
  .option('--tags <list>', 'comma-separated axe tags', (v) => v.split(',').map((s) => s.trim()))
  .option('--disable-rules <list>', 'comma-separated axe rule ids to disable', (v) => v.split(',').map((s) => s.trim()))
  .option('--output <dir>', 'output directory for report', './a11y-report')
  .option('--headed', 'run browser headed', false)
  .option('--wait-for <selector>', 'wait for this selector to be visible before scanning')
  .option('--wait-ms <n>', 'extra fixed wait (ms) after readiness checks', (v) => parseInt(v, 10))
  .option('--no-wait-title', 'do not wait for document.title to become non-empty')
  .option('--dom-stable-ms <n>', 'consider DOM stable after N ms with no mutations (default 500)', (v) => parseInt(v, 10))
  .option('--dom-stable-timeout <n>', 'cap on DOM-stability wait in ms (default 5000)', (v) => parseInt(v, 10))
  .option('--rendered-timeout <n>', 'cap on "rendered" wait — title + body content appears (default 10000)', (v) => parseInt(v, 10))
  .option('--render-budget <n>', 'overall waitForReady ceiling in ms (default 20000)', (v) => parseInt(v, 10))
  .option('--log-level <level>', 'debug | info | warn | error', 'info')
  .action(async (url, opts) => {
    const logger = createLogger({ level: opts.logLevel as LogLevel });
    const projectRoot = resolve(process.cwd());

    try {
      const result = await run({
        projectRoot,
        outputDir: opts.output,
        target: {
          url,
          urlsFile: opts.urls,
          crawlSeed: opts.crawl,
          maxDepth: opts.depth,
          maxPages: opts.maxPages,
          include: opts.include,
          exclude: opts.exclude,
          sameOrigin: !opts.crossOrigin,
        },
        checksDir: opts.checksDir,
        axeTags: opts.tags,
        axeDisableRules: opts.disableRules,
        builtins: opts.builtins !== false ? (opts.axe === false ? false : undefined) : false,
        headless: !opts.headed,
        logger,
        wait: {
          waitForSelector: opts.waitFor,
          waitForTitle: opts.waitTitle !== false,
          extraWaitMs: opts.waitMs,
          domStableForMs: opts.domStableMs,
          domStableTimeoutMs: opts.domStableTimeout,
          renderedTimeoutMs: opts.renderedTimeout,
          overallTimeoutMs: opts.renderBudget,
        },
      });
      // Exit nonzero when violations are present so CI gates correctly
      if (result.totalViolations > 0) process.exit(1);
    } catch (err) {
      logger.error('scan failed', err);
      process.exit(2);
    }
  });

program
  .command('install-browsers')
  .description('Install Playwright browsers into the project-local .ms-playwright directory.')
  .option('--browsers <list>', 'comma-separated browsers (chromium,firefox,webkit)', (v) => v.split(',').map((s) => s.trim()), ['chromium'])
  .action(async (opts) => {
    const logger = createLogger();
    await installBrowsers({
      projectRoot: process.cwd(),
      browsers: opts.browsers,
      logger,
    });
  });

program
  .command('bundle')
  .description('Produce an offline-ready tarball containing dist, node_modules, and browsers.')
  .option('--out <path>', 'output tarball path', './auto-a11y-offline.tgz')
  .action(async (opts) => {
    const logger = createLogger();
    await bundleOffline({
      projectRoot: process.cwd(),
      outPath: opts.out,
      logger,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(2);
});
