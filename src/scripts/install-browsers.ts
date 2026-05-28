import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLogger, type Logger } from '../services/Logger.js';

export interface InstallBrowsersOptions {
  projectRoot: string;
  browsers?: string[];
  logger?: Logger;
  withDeps?: boolean;
}

export async function installBrowsers(opts: InstallBrowsersOptions): Promise<void> {
  const logger = opts.logger ?? createLogger();
  const root = resolve(opts.projectRoot);
  const browsersPath = resolve(root, '.ms-playwright');
  if (!existsSync(browsersPath)) {
    mkdirSync(browsersPath, { recursive: true });
  }

  const browsers = opts.browsers && opts.browsers.length > 0 ? opts.browsers : ['chromium'];
  const args = ['playwright', 'install', ...browsers];
  if (opts.withDeps) args.push('--with-deps');

  logger.info(`Installing browsers to ${browsersPath}: ${browsers.join(', ')}`);
  const result = spawnSync('npx', args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
  });

  if (result.status !== 0) {
    throw new Error(`Browser install failed with exit code ${result.status}`);
  }
  logger.info('Browser install complete.');
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  installBrowsers({ projectRoot: process.cwd() }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
