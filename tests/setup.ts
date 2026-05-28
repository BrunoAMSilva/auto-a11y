import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Must execute before any module imports `playwright` — Playwright's registry
// resolves PLAYWRIGHT_BROWSERS_PATH once at import time.
const local = resolve(process.cwd(), '.ms-playwright');
if (!existsSync(local)) mkdirSync(local, { recursive: true });
if (!process.env['PLAYWRIGHT_BROWSERS_PATH']) {
  process.env['PLAYWRIGHT_BROWSERS_PATH'] = local;
}
