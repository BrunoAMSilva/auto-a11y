import type { Impact, Violation } from '../checks/types.js';
import type { ReportData, IssueGroup, PageGroup } from './views.js';

const IMPACT_LABEL: Record<Impact, string> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
};

export function renderReport(data: ReportData): string {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8" />
<title>auto-a11y report — ${escapeHtml(new Date(data.generatedAt).toLocaleString())}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${STYLES}</style>
</head>
<body>
<header class="topbar">
  <h1 class="brand">auto-a11y</h1>
  <p class="meta">Generated ${escapeHtml(new Date(data.generatedAt).toLocaleString())} · ${data.totals.pages} page(s) · ${data.totals.violationNodes} failing instance(s)</p>
  <button type="button" class="theme-toggle" id="themeToggle">Switch to light theme</button>
</header>

<section class="summary" aria-label="Failing instances by impact">
  ${renderImpactPill('critical', data.totals.impacts.critical)}
  ${renderImpactPill('serious', data.totals.impacts.serious)}
  ${renderImpactPill('moderate', data.totals.impacts.moderate)}
  ${renderImpactPill('minor', data.totals.impacts.minor)}
</section>

<div class="tabs" role="tablist" aria-label="Report views">
  <button type="button" class="tab active" role="tab" id="tab-by-page" aria-selected="true" aria-controls="by-page" data-view="by-page">By page</button>
  <button type="button" class="tab" role="tab" id="tab-by-issue" aria-selected="false" aria-controls="by-issue" data-view="by-issue" tabindex="-1">By issue type</button>
</div>

<section class="filters" aria-label="Filters">
  <label><span>Impact:</span>
    <select id="impactFilter">
      <option value="">All</option>
      <option value="critical">Critical</option>
      <option value="serious">Serious</option>
      <option value="moderate">Moderate</option>
      <option value="minor">Minor</option>
    </select>
  </label>
  <label class="toggle"><input type="checkbox" id="hideClean"> hide clean pages</label>
  <label class="toggle"><input type="checkbox" id="expandAll" checked> expand all</label>
</section>

<main>
  <section id="by-page" class="view active" role="tabpanel" aria-labelledby="tab-by-page" tabindex="0">
    ${data.byPage.map(renderPage).join('\n')}
  </section>
  <section id="by-issue" class="view" role="tabpanel" aria-labelledby="tab-by-issue" tabindex="0">
    ${data.byIssue.map(renderIssue).join('\n')}
  </section>
</main>

<script>${SCRIPT}</script>
</body>
</html>`;
}

function renderImpactPill(impact: Impact, n: number): string {
  return `<div class="pill impact-${impact}"><span class="pill-label">${IMPACT_LABEL[impact]}</span><span class="pill-count">${n}</span></div>`;
}

function renderPage(group: PageGroup): string {
  const hasFindings = group.totalNodes > 0;
  const id = `page-${hash(group.url)}`;
  const summary = hasFindings
    ? `${group.totalNodes} failing instance(s) across ${group.findings.length} check run(s)`
    : 'No violations';
  // Default: open pages that have findings.
  const openAttr = hasFindings ? ' open' : '';
  return `<details class="page-group${hasFindings ? '' : ' clean'}" data-impacts="${impactsAttr(group.impacts)}" data-clean="${hasFindings ? 'false' : 'true'}"${openAttr}>
  <summary>
    <h2 class="page-title">${escapeHtml(group.pageTitle || group.url)}</h2>
    <div class="page-meta"><code>${escapeHtml(group.url)}</code></div>
    <div class="page-summary">${summary}</div>
  </summary>
  <div class="page-body" id="${id}">
    <p class="page-link"><a href="${escapeHtml(group.url)}" target="_blank" rel="noopener">Open page in new tab ↗</a></p>
    ${group.findings.map(renderFindingBlock).join('\n')}
  </div>
</details>`;
}

function renderFindingBlock(f: { command: string; violations: Violation[]; validations?: { nodes: { target: string; html: string; screenshotPath?: string }[]; description: string }[] }): string {
  const blocks: string[] = [];
  for (const v of f.violations) {
    blocks.push(renderViolation(v, f.command));
  }
  if (f.validations && f.validations.length > 0) {
    for (const val of f.validations) {
      blocks.push(`<div class="validation">
        <div class="validation-head"><span class="ok-badge">PASS</span> ${escapeHtml(val.description)} <span class="count">${val.nodes.length} node(s)</span></div>
        <ul class="nodes-flat">
          ${val.nodes.map((n) => `<li><code>${escapeHtml(n.target)}</code></li>`).join('')}
        </ul>
      </div>`);
    }
  }
  return blocks.join('\n');
}

function renderViolation(v: Violation, source: string): string {
  return `<div class="violation impact-${v.impact}" data-impact="${v.impact}" data-wcag="${v.wcag?.join(',') ?? ''}">
  <header class="violation-head">
    <span class="impact-badge impact-${v.impact}">${IMPACT_LABEL[v.impact]}</span>
    <span class="rule-id">${escapeHtml(v.id)}</span>
    <span class="source-badge">${escapeHtml(source)}</span>
    <span class="count">${v.nodes.length} failing instance(s)</span>
    ${v.wcag?.map((w) => `<span class="wcag-tag">WCAG ${escapeHtml(w)}</span>`).join('') ?? ''}
  </header>
  <p class="violation-help">${escapeHtml(v.help)}${v.helpUrl ? ` <a href="${escapeHtml(v.helpUrl)}" target="_blank" rel="noopener">learn more →</a>` : ''}</p>
  ${v.criteria && v.criteria.length > 0 ? `<ul class="criteria">${v.criteria.map((c) => `<li><a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.id)} ${escapeHtml(c.title)} (${c.level})</a></li>`).join('')}</ul>` : ''}
  <ol class="nodes">
    ${v.nodes.map((n, i) => renderNode(n, i + 1)).join('\n')}
  </ol>
</div>`;
}

function renderNode(n: { target: string; html: string; failureSummary?: string; screenshotPath?: string }, idx: number): string {
  return `<li class="node">
  <div class="node-head">
    <span class="node-index">#${idx}</span>
    <code class="selector">${escapeHtml(n.target)}</code>
  </div>
  ${n.failureSummary ? `<p class="failure">${escapeHtml(n.failureSummary)}</p>` : ''}
  <pre class="snippet"><code>${escapeHtml(n.html.slice(0, 1500))}${n.html.length > 1500 ? '…' : ''}</code></pre>
  ${n.screenshotPath ? `<a href="${escapeHtml(n.screenshotPath)}" target="_blank" rel="noopener"><img class="shot" src="${escapeHtml(n.screenshotPath)}" alt="Screenshot of the failing element ${escapeHtml(n.target)}" loading="lazy" /></a>` : ''}
</li>`;
}

function renderIssue(issue: IssueGroup): string {
  return `<details class="issue-group" data-impact="${issue.impact}" data-wcag="${issue.wcag.join(',')}" open>
  <summary>
    <span class="impact-badge impact-${issue.impact}">${IMPACT_LABEL[issue.impact]}</span>
    <h2>${escapeHtml(issue.ruleId)}</h2>
    <span class="count">${issue.totalNodes} failing instance(s) on ${issue.occurrences.length} page(s)</span>
    ${issue.wcag.map((w) => `<span class="wcag-tag">WCAG ${escapeHtml(w)}</span>`).join('')}
  </summary>
  <p class="issue-help">${escapeHtml(issue.help)}${issue.helpUrl ? ` <a href="${escapeHtml(issue.helpUrl)}" target="_blank" rel="noopener">learn more →</a>` : ''}</p>
  ${issue.occurrences.map((occ) => `<div class="occurrence">
    <h3><a href="${escapeHtml(occ.url)}" target="_blank" rel="noopener">${escapeHtml(occ.pageTitle || occ.url)}</a> <span class="count">${occ.nodes.length} instance(s)</span></h3>
    <ol class="nodes">${occ.nodes.map((n, i) => renderNode(n, i + 1)).join('')}</ol>
  </div>`).join('')}
</details>`;
}

function impactsAttr(impacts: Record<Impact, number>): string {
  return Object.entries(impacts)
    .filter(([, n]) => n > 0)
    .map(([k]) => k)
    .join(',');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

const STYLES = `
:root {
  color-scheme: dark light;
}
html[data-theme="dark"] {
  --bg: #0d1117;
  --bg-elev: #161b22;
  --bg-elev2: #1c2230;
  --fg: #e6edf3;
  --muted: #8b949e;
  --border: #30363d;
  --accent: #58a6ff;
  --crit: #f85149;
  --serious: #f0883e;
  --moderate: #d29922;
  --minor: #8b949e;
  --ok: #3fb950;
  --tag-bg: rgba(56, 139, 253, 0.18);
  --tag-fg: #79c0ff;
  --code-bg: #010409;
  --code-fg: #c9d1d9;
  --shadow: 0 1px 2px rgba(0,0,0,0.4);
}
html[data-theme="light"] {
  --bg: #f6f7f9;
  --bg-elev: #ffffff;
  --bg-elev2: #f1f3f7;
  --fg: #1a1f2c;
  --muted: #5b6478;
  --border: #d8dde6;
  --accent: #2563eb;
  --crit: #b91c1c;
  --serious: #c2410c;
  --moderate: #b45309;
  --minor: #475569;
  --ok: #166534;
  --tag-bg: #e0e7ff;
  --tag-fg: #3730a3;
  --code-bg: #0f172a;
  --code-fg: #e2e8f0;
  --shadow: 0 1px 2px rgba(0,0,0,0.06);
}
* { box-sizing: border-box; }
body { font: 14px/1.5 -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif; margin: 0; background: var(--bg); color: var(--fg); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
summary:focus-visible, .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; scroll-behavior: auto !important; }
}
.topbar { display: flex; align-items: center; gap: 16px; padding: 14px 24px; background: var(--bg-elev); border-bottom: 1px solid var(--border); }
.brand { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: 0.5px; color: var(--accent); }
.meta { margin: 0; color: var(--muted); font-size: 13px; flex: 1; }
.theme-toggle { background: var(--bg-elev2); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; cursor: pointer; font: inherit; font-size: 12px; }
.theme-toggle:hover { border-color: var(--accent); }
.summary { display: flex; gap: 12px; padding: 16px 24px; background: var(--bg-elev); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.pill { display: flex; flex-direction: column; align-items: center; padding: 10px 18px; border-radius: 8px; min-width: 110px; background: var(--bg-elev2); border: 1px solid var(--border); }
.pill-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; }
.pill-count { font-size: 24px; font-weight: 700; margin-top: 2px; }
.pill.impact-critical .pill-count { color: var(--crit); }
.pill.impact-serious .pill-count { color: var(--serious); }
.pill.impact-moderate .pill-count { color: var(--moderate); }
.pill.impact-minor .pill-count { color: var(--minor); }
.tabs { display: flex; padding: 0 24px; background: var(--bg-elev); border-bottom: 1px solid var(--border); }
.tab { background: none; border: 0; padding: 12px 18px; font: inherit; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
.tab:hover { color: var(--fg); }
.tab.active { color: var(--accent); border-color: var(--accent); font-weight: 600; }
.filters { display: flex; gap: 20px; padding: 12px 24px; background: var(--bg-elev); border-bottom: 1px solid var(--border); flex-wrap: wrap; align-items: center; }
.filters label { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
.filters select { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-elev2); color: var(--fg); font: inherit; font-size: 13px; }
.filters .toggle input { accent-color: var(--accent); }
main { padding: 24px; max-width: 1280px; margin: 0 auto; }
.view { display: none; }
.view.active { display: block; }
.page-group, .issue-group { background: var(--bg-elev); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 16px; overflow: hidden; box-shadow: var(--shadow); }
.page-group summary, .issue-group summary { padding: 16px 20px; cursor: pointer; list-style: none; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; user-select: none; }
.page-group summary::marker, .issue-group summary::marker { display: none; }
.page-group summary::before, .issue-group summary::before { content: "▶"; color: var(--muted); font-size: 10px; transition: transform 0.15s; display: inline-block; }
.page-group[open] summary::before, .issue-group[open] summary::before { transform: rotate(90deg); }
.page-group summary h2, .issue-group summary h2 { font-size: 16px; margin: 0; color: var(--fg); }
.page-link { margin: 0 0 12px; }
.page-link a { color: var(--accent); font-size: 13px; }
.page-group .page-meta { width: 100%; color: var(--muted); font-size: 12px; padding-left: 16px; }
.page-group .page-meta code { background: transparent; padding: 0; }
.page-group .page-summary { font-size: 12px; color: var(--muted); margin-left: auto; }
.page-group.clean .page-summary { color: var(--ok); }
.page-body { padding: 8px 20px 16px; }
.violation { border-top: 1px solid var(--border); padding: 18px 0; }
.violation:first-child { border-top: 0; }
.violation-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
/* Badge backgrounds are fixed (theme-independent) and dark enough for white
   text to clear WCAG 1.4.3 AA (>=4.5:1) in both themes. */
.impact-badge { padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.5px; }
.impact-badge.impact-critical { background: #b3261d; }
.impact-badge.impact-serious { background: #b2540e; }
.impact-badge.impact-moderate { background: #8c5a00; }
.impact-badge.impact-minor { background: #475569; }
.ok-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; background: #1a7f37; color: #fff; text-transform: uppercase; letter-spacing: 0.5px; }
.rule-id { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; font-weight: 600; color: var(--fg); }
.source-badge { font-size: 11px; padding: 2px 8px; background: var(--bg-elev2); border: 1px solid var(--border); border-radius: 4px; color: var(--muted); }
.count { font-size: 12px; color: var(--muted); font-weight: 500; margin-left: auto; }
.wcag-tag { font-size: 11px; padding: 2px 8px; background: var(--tag-bg); color: var(--tag-fg); border-radius: 4px; }
.violation-help { color: var(--muted); margin: 10px 0; font-size: 13px; }
.violation-help a, .issue-help a { color: var(--accent); }
.criteria { font-size: 12px; color: var(--muted); padding-left: 20px; margin: 6px 0; }
.criteria a { color: var(--accent); text-decoration: none; }
.criteria a:hover { text-decoration: underline; }
.nodes { padding-left: 0; list-style: none; counter-reset: node; margin: 12px 0 0; }
.nodes-flat { padding-left: 20px; color: var(--muted); font-size: 12px; margin: 6px 0; }
.node { background: var(--bg-elev2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 10px; }
.node-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.node-index { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; color: var(--muted); background: var(--bg); padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); }
.selector { display: inline-block; font-family: ui-monospace, SFMono-Regular, monospace; padding: 3px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; color: var(--fg); word-break: break-all; }
.failure { color: var(--serious); font-size: 13px; margin: 6px 0; }
.snippet { background: var(--code-bg); color: var(--code-fg); padding: 10px 12px; border-radius: 6px; overflow: auto; font-size: 12px; max-height: 220px; line-height: 1.45; margin: 6px 0 0; }
.snippet code { font-family: ui-monospace, SFMono-Regular, monospace; }
.shot { display: block; max-width: 360px; margin-top: 10px; border: 1px solid var(--border); border-radius: 6px; }
.validation { padding: 12px 0; border-top: 1px dashed var(--border); }
.validation-head { font-size: 13px; color: var(--ok); display: flex; align-items: center; gap: 8px; }
.issue-group summary h2 { font-family: ui-monospace, SFMono-Regular, monospace; color: var(--fg); }
.issue-help { padding: 0 20px 12px; color: var(--muted); font-size: 13px; }
.occurrence { padding: 12px 20px; border-top: 1px solid var(--border); }
.occurrence h3 { font-size: 14px; margin: 0 0 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.occurrence h3 a { color: var(--accent); text-decoration: none; }
.occurrence h3 a:hover { text-decoration: underline; }
.hidden { display: none !important; }
@media (max-width: 720px) {
  main { padding: 12px; }
  .summary { gap: 8px; padding: 12px; }
  .pill { min-width: 72px; padding: 8px 10px; }
  .topbar { padding: 12px; }
  .filters { padding: 10px 12px; gap: 12px; }
}
`;

const SCRIPT = `
(function() {
  const html = document.documentElement;
  const stored = localStorage.getItem('a11yTheme');
  if (stored) html.setAttribute('data-theme', stored);
  const themeBtn = document.getElementById('themeToggle');
  const syncBtn = () => themeBtn.textContent = html.getAttribute('data-theme') === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  syncBtn();
  themeBtn.addEventListener('click', () => {
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('a11yTheme', next);
    syncBtn();
  });

  const tabs = Array.from(document.querySelectorAll('.tab'));
  const views = document.querySelectorAll('.view');
  function activateTab(tab, setFocus) {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.classList.toggle('active', selected);
      t.setAttribute('aria-selected', selected ? 'true' : 'false');
      t.tabIndex = selected ? 0 : -1;
    });
    const target = tab.getAttribute('data-view');
    views.forEach((v) => v.classList.toggle('active', v.id === target));
    if (setFocus) tab.focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activateTab(tab, false));
    tab.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) { e.preventDefault(); activateTab(next, true); }
    });
  });

  const impactFilter = document.getElementById('impactFilter');
  const hideClean = document.getElementById('hideClean');
  const expandAll = document.getElementById('expandAll');

  function applyFilters() {
    const impact = impactFilter.value;
    document.querySelectorAll('.violation').forEach((node) => {
      const ni = node.getAttribute('data-impact') || '';
      node.classList.toggle('hidden', impact && ni !== impact);
    });
    document.querySelectorAll('.issue-group').forEach((node) => {
      const ni = node.getAttribute('data-impact') || '';
      node.classList.toggle('hidden', impact && ni !== impact);
    });
    document.querySelectorAll('.page-group').forEach((p) => {
      const isClean = p.getAttribute('data-clean') === 'true';
      let hidden = false;
      if (hideClean.checked && isClean) hidden = true;
      if (impact) {
        const impacts = (p.getAttribute('data-impacts') || '').split(',');
        if (!impacts.includes(impact)) hidden = true;
      }
      p.classList.toggle('hidden', hidden);
    });
  }
  impactFilter.addEventListener('change', applyFilters);
  hideClean.addEventListener('change', applyFilters);

  expandAll.addEventListener('change', () => {
    const on = expandAll.checked;
    document.querySelectorAll('.page-group, .issue-group').forEach((d) => {
      d.open = on;
    });
  });
})();
`;
