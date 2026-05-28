import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLogger, type Logger } from '../services/Logger.js';

export interface BundleOptions {
  projectRoot: string;
  outPath: string;
  logger?: Logger;
}

export async function bundleOffline(opts: BundleOptions): Promise<void> {
  const logger = opts.logger ?? createLogger();
  const root = resolve(opts.projectRoot);
  const out = resolve(opts.outPath);

  const required = ['dist', 'node_modules', '.ms-playwright', 'bin', 'package.json'];
  for (const r of required) {
    if (!existsSync(resolve(root, r))) {
      throw new Error(
        `Missing '${r}'. Run 'npm ci', 'npm run install-browsers', and 'npm run build' before bundling.`,
      );
    }
  }

  logger.info(`Bundling -> ${out}`);
  const args = [
    '-czf',
    out,
    '--exclude=node_modules/.cache',
    '--exclude=*.map',
    '--exclude=.DS_Store',
    'dist',
    'node_modules',
    '.ms-playwright',
    'bin',
    'package.json',
  ];
  const result = spawnSync('tar', args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`tar failed with exit code ${result.status}`);
  }
  logger.info(`Bundle ready: ${out}`);
  logger.info('To deploy: extract into a fresh dir, then run ./bin/auto-a11y scan ...');
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const outArg = process.argv.find((a, i) => i > 1 && !a.startsWith('-'));
  bundleOffline({
    projectRoot: process.cwd(),
    outPath: outArg ?? './auto-a11y-offline.tgz',
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
