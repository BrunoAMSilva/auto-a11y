import type { BrowserContext } from 'playwright';
import type { Logger } from '../services/Logger.js';
import { waitForReady, type WaitOptions } from './waitForReady.js';

export interface CrawlOptions {
  seed: string;
  maxDepth: number;
  maxPages: number;
  sameOrigin?: boolean;
  include?: RegExp[];
  exclude?: RegExp[];
  logger: Logger;
  wait?: WaitOptions;
}

export async function crawl(
  context: BrowserContext,
  opts: CrawlOptions,
): Promise<string[]> {
  const seedUrl = normalizeUrl(opts.seed);
  const seenNormalized = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }];
  seenNormalized.add(seedUrl);

  const visited: string[] = [];
  const seedOrigin = new URL(seedUrl).origin;

  while (queue.length > 0 && visited.length < opts.maxPages) {
    const { url, depth } = queue.shift()!;
    if (!shouldVisit(url, opts)) {
      opts.logger.debug(`Skipping (filtered): ${url}`);
      continue;
    }

    visited.push(url);
    opts.logger.info(`Crawl visit [${visited.length}/${opts.maxPages}] depth=${depth}: ${url}`);

    if (depth >= opts.maxDepth) continue;

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      // Same wait as the audit phase, so SPAs expose route-rendered links.
      await waitForReady(page, opts.wait ?? {}, opts.logger);
      const hrefs = await page
        .locator('a[href]')
        .evaluateAll((anchors) =>
          anchors.map((a) => (a as HTMLAnchorElement).href).filter(Boolean),
        );

      for (const raw of hrefs) {
        let absolute: string;
        try {
          absolute = normalizeUrl(new URL(raw, url).toString());
        } catch {
          continue;
        }
        if (opts.sameOrigin !== false) {
          try {
            if (new URL(absolute).origin !== seedOrigin) continue;
          } catch {
            continue;
          }
        }
        if (seenNormalized.has(absolute)) continue;
        seenNormalized.add(absolute);
        queue.push({ url: absolute, depth: depth + 1 });
      }
    } catch (err) {
      opts.logger.warn(`Crawl failed to load ${url}: ${(err as Error).message}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  return visited;
}

function shouldVisit(url: string, opts: CrawlOptions): boolean {
  if (opts.exclude?.some((re) => re.test(url))) return false;
  if (opts.include && opts.include.length > 0) {
    if (!opts.include.some((re) => re.test(url))) return false;
  }
  return true;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Trim trailing slash for non-root paths
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return url;
  }
}
