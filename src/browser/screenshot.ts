import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { CheckContext, CommandParams } from '../checks/types.js';
import { screenshotDirFor } from './launch.js';

export interface ScreenshotResult {
  path: string;
  relativePath: string;
}

export async function takeScreenshot(
  page: Page,
  ctx: CheckContext,
  label: string,
): Promise<ScreenshotResult> {
  const dir = screenshotDirFor(ctx.outputDir);
  const filename = `${label.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60)}-${randomUUID().slice(0, 8)}.png`;
  const fullPath = join(dir, filename);
  await page.screenshot({ path: fullPath, fullPage: false });
  return {
    path: fullPath,
    relativePath: join('assets', 'screenshots', filename),
  };
}

/**
 * Compatibility shim matching the user-provided `checkIframes` example: lets
 * custom checks call `screenshot({ page, instruction, context, stepIndex, ... })`
 * with the same signature their existing codebase uses.
 */
export async function screenshot(params: CommandParams): Promise<ScreenshotResult> {
  const label = `${params.instruction.type}-${params.stepIndex}`;
  return takeScreenshot(params.page, params.context, label);
}
