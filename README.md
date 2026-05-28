# auto-a11y

Automated accessibility audits powered by Playwright + axe-core, with custom check support, a W3C accname-1.2 utility, HTML reports grouped by page or issue type, and hermetic-offline deploy.

## Quick start

```bash
npm ci
npm run install-browsers          # downloads Chromium to ./.ms-playwright
npm run build
./bin/auto-a11y scan https://example.com
open a11y-report/report.html
```

## CLI

```
auto-a11y scan <url>                                    single URL
auto-a11y scan --urls urls.txt                          newline-delimited file
auto-a11y scan --crawl <url> --depth 2 --max-pages 50   crawl
auto-a11y scan --checks-dir ./checks                    add custom checks
auto-a11y scan --output ./report                        output dir (default: ./a11y-report)
auto-a11y scan --tags wcag2a,wcag2aa,wcag22aa           override axe tags
auto-a11y scan --disable-rules color-contrast           disable specific axe rules
auto-a11y scan --no-axe                                 disable axe (custom checks only)
auto-a11y scan --no-builtins                            disable built-in checks entirely
auto-a11y scan --wait-for "main h1"                     wait for selector before scanning (SPAs)
auto-a11y scan --wait-ms 1500                           extra fixed delay after readiness
auto-a11y scan --no-wait-title                          don't require document.title before scanning
auto-a11y scan --rendered-timeout 15000                 cap for the title+content wait (default 10000)
auto-a11y scan --render-budget 25000                    overall wait ceiling per page (default 20000)
auto-a11y scan --dom-stable-ms 700                      no-mutation window for "stable" (default 500)
auto-a11y install-browsers                              install Chromium locally
auto-a11y bundle --out ./offline.tgz                    offline tarball
```

Exit codes: `0` clean · `1` violations found · `2` runtime error.

## Custom checks

A check is any module that default-exports an object satisfying the `Check` interface:

```ts
// my-checks/no-empty-heading.js  (compile from TS to JS before loading)
export default {
  id: 'no-empty-heading',
  description: 'Headings must not be empty.',
  source: 'custom',
  run: async (ctx) => {
    const headings = await ctx.page.locator('h1, h2, h3, h4, h5, h6').all();
    for (const h of headings) {
      const text = (await h.textContent())?.trim() ?? '';
      if (text === '') {
        ctx.accessibilityFindings.push({
          command: 'no-empty-heading',
          stepName: 'no-empty-heading',
          stepNumber: ctx.stepIndex + 1,
          url: ctx.url,
          pageTitle: ctx.pageTitle,
          violations: [{
            id: 'no-empty-heading',
            impact: 'serious',
            description: 'Heading element is empty.',
            help: 'Provide text content or remove the heading.',
            wcag: ['1.3.1', '2.4.6'],
            criteria: ctx.standards.criteriaFromTags(['wcag1.3.1', 'wcag2.4.6'], ctx.wcagIndex),
            nodes: [{ target: 'h*', html: await h.evaluate(n => (n as Element).outerHTML) }],
          }],
        });
      }
    }
  },
};
```

Then: `auto-a11y scan https://example.com --checks-dir ./my-checks`

## accname utility

```ts
import { computeAccessibleName, computeAccessibleDescription } from 'auto-a11y/accname';

const handle = await page.locator('#submit').elementHandle();
const name = await computeAccessibleName(handle);
const desc = await computeAccessibleDescription(handle);
```

Implements the priority order from [W3C accname-1.2](https://www.w3.org/TR/accname-1.2/): `aria-labelledby` → `aria-label` → native host language label → name from content (for roles that allow it) → `title`.

## Hermetic / offline deploy

Two-phase:

1. **Online build machine**:
   ```bash
   npm ci
   npm run install-browsers          # vendors Chromium into ./.ms-playwright
   npm run build
   npm run bundle                    # writes auto-a11y-offline.tgz
   ```

2. **Sealed environment** (no network):
   ```bash
   tar -xzf auto-a11y-offline.tgz -C /opt/auto-a11y
   cd /opt/auto-a11y
   ./bin/auto-a11y scan https://internal-host/path
   ```

The CLI sets `PLAYWRIGHT_BROWSERS_PATH` to the project-local `.ms-playwright` automatically — no env-var management needed.

## Reports

`report.html` is self-contained. Two views toggled at the top:

- **By page** — every URL with its findings, grouped by impact.
- **By issue type** — every rule ID with the pages it occurred on.

Filters: impact (critical/serious/moderate/minor), WCAG level. `findings.json` is also emitted for machine consumption.

## SPA support (Angular, React, Vue, Svelte)

Single-page apps don't render their route content at `domcontentloaded` — the framework boots, resolves the route, loads chunks, then mounts the component. auto-a11y waits for a *stable-rendered* signal before running checks:

1. `networkidle` (best effort, capped — SPAs often never settle)
2. Framework detection (Angular `[ng-version]`, React DevTools hook, Vue `[data-v-app]`)
3. **Stable-rendered**: `document.title` non-empty AND body has ≥15 meaningful elements + ≥100 chars of text, and that state has held for at least 500ms. The stability window prevents a prerendered SPA shell (which already satisfies the thresholds) from short-circuiting the wait — frameworks frequently clear the title during hydration before resetting it to the route's title.
4. DOM mutation-stability (best effort)
5. Empty-content warning if the page still looks empty after all waits

If a route consistently misses the rendered signal, point `--wait-for` at a known-after-mount selector, or bump `--render-budget` / `--rendered-timeout`.

## Limitations

Automated checks catch ~30% of accessibility issues. Manual testing with screen readers and keyboard navigation remains essential.
