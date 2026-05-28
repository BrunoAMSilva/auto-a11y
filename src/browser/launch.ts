import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface LaunchConfig {
  projectRoot: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  ignoreHTTPSErrors?: boolean;
}

export function configureBrowsersPath(projectRoot: string): string {
  const local = resolve(projectRoot, '.ms-playwright');
  if (!existsSync(local)) {
    mkdirSync(local, { recursive: true });
  }
  return local;
}

function browsersInstalled(browsersDir: string): boolean {
  try {
    return readdirSync(browsersDir).some((e) => /^(chromium|firefox|webkit)/.test(e));
  } catch {
    return false;
  }
}

export async function launchBrowser(cfg: LaunchConfig): Promise<Browser> {
  const dir = configureBrowsersPath(cfg.projectRoot);
  if (!browsersInstalled(dir)) {
    throw new Error(
      `No browsers found in ${dir}.\n` +
        `Run 'npm run install-browsers' (or 'auto-a11y install-browsers') first.\n` +
        `In a hermetic environment, extract the offline bundle first so .ms-playwright is populated.`,
    );
  }
  const launchOptions: LaunchOptions = {
    headless: cfg.headless ?? true,
  };
  return chromium.launch(launchOptions);
}

export async function newContext(
  browser: Browser,
  cfg: LaunchConfig,
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: cfg.viewport ?? { width: 1280, height: 800 },
    userAgent: cfg.userAgent,
    ignoreHTTPSErrors: cfg.ignoreHTTPSErrors ?? false,
  });
}

export function screenshotDirFor(outputDir: string): string {
  const dir = join(outputDir, 'assets', 'screenshots');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
