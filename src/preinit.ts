import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// MUST run before any module that imports `playwright`. Playwright resolves
// PLAYWRIGHT_BROWSERS_PATH once at import time via an IIFE in its registry; if
// we set the env var later (e.g. inside launchBrowser) it has no effect.
const local = resolve(process.cwd(), '.ms-playwright');
if (!existsSync(local)) {
  mkdirSync(local, { recursive: true });
}
if (!process.env['PLAYWRIGHT_BROWSERS_PATH']) {
  process.env['PLAYWRIGHT_BROWSERS_PATH'] = local;
}
