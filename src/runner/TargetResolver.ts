import { readFile } from 'node:fs/promises';
import type { BrowserContext } from 'playwright';
import { crawl } from './Crawler.js';
import type { Logger } from '../services/Logger.js';
import type { WaitOptions } from './waitForReady.js';

export interface TargetSpec {
  url?: string;
  urlsFile?: string;
  crawlSeed?: string;
  maxDepth?: number;
  maxPages?: number;
  include?: string[];
  exclude?: string[];
  sameOrigin?: boolean;
  wait?: WaitOptions;
}

export async function resolveTargets(
  spec: TargetSpec,
  context: BrowserContext,
  logger: Logger,
): Promise<string[]> {
  if (spec.url) {
    return [spec.url];
  }
  if (spec.urlsFile) {
    const raw = await readFile(spec.urlsFile, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#'));
  }
  if (spec.crawlSeed) {
    return crawl(context, {
      seed: spec.crawlSeed,
      maxDepth: spec.maxDepth ?? 2,
      maxPages: spec.maxPages ?? 50,
      sameOrigin: spec.sameOrigin ?? true,
      include: spec.include?.map((p) => new RegExp(p)),
      exclude: spec.exclude?.map((p) => new RegExp(p)),
      logger: logger.child('crawl'),
      wait: spec.wait,
    });
  }
  throw new Error('No target specified. Provide --url, --urls, or --crawl.');
}
