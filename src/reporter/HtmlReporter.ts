import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Finding } from '../checks/types.js';
import type { Logger } from '../services/Logger.js';
import { renderReport } from './template.js';
import { buildReport } from './views.js';

export class HtmlReporter {
  constructor(
    private readonly outputDir: string,
    private readonly logger: Logger,
  ) {}

  async write(
    findings: Finding[],
    urlsScanned: string[],
    pageTitles: Record<string, string> = {},
  ): Promise<string> {
    const data = buildReport(findings, urlsScanned, pageTitles);
    const html = renderReport(data);
    const path = join(this.outputDir, 'report.html');
    await writeFile(path, html, 'utf8');
    this.logger.info(`Wrote report: ${path}`);

    const jsonPath = join(this.outputDir, 'findings.json');
    await writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8');
    this.logger.info(`Wrote JSON: ${jsonPath}`);

    return path;
  }
}
