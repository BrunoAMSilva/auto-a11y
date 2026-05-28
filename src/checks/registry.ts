import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Check } from './types.js';
import { createAxeCheck, type AxeCheckOptions } from './axe.js';
import { iframeTitleCheck } from './iframe-title.js';
import type { Logger } from '../services/Logger.js';

export interface RegistryOptions {
  axe?: AxeCheckOptions | false;
  builtins?: boolean;
  checksDir?: string;
  logger: Logger;
}

export async function buildRegistry(opts: RegistryOptions): Promise<Check[]> {
  const checks: Check[] = [];
  const includeBuiltins = opts.builtins !== false;

  if (includeBuiltins) {
    if (opts.axe !== false) {
      checks.push(createAxeCheck(opts.axe || {}));
    }
    checks.push(iframeTitleCheck);
  }

  if (opts.checksDir) {
    const dir = resolve(opts.checksDir);
    if (!existsSync(dir)) {
      opts.logger.warn(`Checks dir not found: ${dir}`);
      return checks;
    }
    const loaded = await loadFromDir(dir, opts.logger);
    checks.push(...loaded);
  }

  // De-dup by id (later registrations win)
  const byId = new Map<string, Check>();
  for (const c of checks) byId.set(c.id, c);
  return Array.from(byId.values());
}

const SUPPORTED_EXTS = new Set(['.js', '.mjs', '.cjs']);

async function loadFromDir(dir: string, logger: Logger): Promise<Check[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: Check[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!SUPPORTED_EXTS.has(extname(entry.name))) {
      if (extname(entry.name) === '.ts') {
        logger.warn(
          `Skipping ${entry.name} — TypeScript checks must be compiled to .js first.`,
        );
      }
      continue;
    }
    const fullPath = join(dir, entry.name);
    try {
      const mod = await import(pathToFileURL(fullPath).href);
      const candidate = mod.default ?? mod.check;
      if (isCheck(candidate)) {
        out.push(candidate);
        logger.info(`Loaded custom check '${candidate.id}' from ${entry.name}`);
      } else {
        logger.warn(
          `${entry.name} does not export a valid Check (need default export or 'check' named export).`,
        );
      }
    } catch (err) {
      logger.error(`Failed to import ${fullPath}`, err);
    }
  }
  return out;
}

function isCheck(value: unknown): value is Check {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['id'] === 'string' && typeof v['run'] === 'function';
}
