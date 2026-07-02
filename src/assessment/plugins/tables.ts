/**
 * Tables plugin.
 *
 * Complements axe-core (which checks header/cell relationships and scope value
 * validity) with the structural table checks axe does not perform, mapped to
 * RAWeb topic 5 / WCAG 1.3.1. Each rule keys off a strong "this is a data
 * table" signal to avoid flagging layout tables:
 *
 *  - table-layout-with-semantics  — role=presentation/none table that still
 *                                   uses th/caption/scope/headers/summary
 *                                   (RAWeb 5.8)
 *  - table-missing-name           — data table (has headers) with no caption /
 *                                   accessible name (RAWeb 5.4)
 *  - table-missing-headers        — table that signals data intent (caption /
 *                                   thead / summary) but has no header cells
 *                                   (RAWeb 5.6)
 *  - table-complex-no-association — complex data table (spanned or two-axis
 *                                   headers) with no scope or headers/id
 *                                   association (RAWeb 5.7)
 *
 * The accessible name and AT-visibility come from the browser's accessibility
 * tree via the shared resolver (ctx.ax).
 */

import type {
    AssessmentPlugin,
    AssessmentContext,
    AssessmentResult,
    AccessibilityIssue,
    IssueSeverity,
} from '../types.js';

/** Structural facts collected in-page for one <table>. */
interface TableData {
    selector: string;
    isPresentation: boolean;
    rowCount: number;
    colCount: number;
    headerCount: number;
    hasCaption: boolean;
    hasThead: boolean;
    hasSummary: boolean;
    /** Any data markup that is illegitimate on a layout table. */
    hasDataMarkup: boolean;
    isComplex: boolean;
    /** All headers carry scope, or cells use the headers attribute. */
    fullAssociation: boolean;
    outerHTML: string;
}

function collectTableData(el: HTMLTableElement): TableData {
    const role = (el.getAttribute('role') || '').toLowerCase();
    const isPresentation = role === 'presentation' || role === 'none';

    // `el.rows` / `row.cells` only walk THIS table (not nested tables) → safe.
    const rows = Array.from(el.rows);
    const headerCells: HTMLTableCellElement[] = [];
    let colCount = 0;
    let columnHeaderPresent = false;
    let rowHeaderPresent = false;
    let hasSpan = false;
    let hasHeadersAttr = false;

    rows.forEach((row, rIdx) => {
        let cols = 0;
        Array.from(row.cells).forEach((cell, cIdx) => {
            cols += cell.colSpan;
            const cellRole = (cell.getAttribute('role') || '').toLowerCase();
            const isHeader = cell.tagName === 'TH' || cellRole === 'columnheader' || cellRole === 'rowheader';
            if (isHeader) {
                headerCells.push(cell);
                if (cell.colSpan > 1 || cell.rowSpan > 1) hasSpan = true;
                const scope = (cell.getAttribute('scope') || '').toLowerCase();
                if (rIdx === 0 || scope === 'col' || scope === 'colgroup' || cellRole === 'columnheader') {
                    columnHeaderPresent = true;
                }
                if (cIdx === 0 || scope === 'row' || scope === 'rowgroup' || cellRole === 'rowheader') {
                    rowHeaderPresent = true;
                }
            }
            if (cell.hasAttribute('headers')) hasHeadersAttr = true;
        });
        if (cols > colCount) colCount = cols;
    });

    const hasCaption = Boolean(el.querySelector(':scope > caption'));
    const hasThead = Boolean(el.querySelector(':scope > thead'));
    const hasSummary = el.hasAttribute('summary');
    const hasScope = headerCells.some((c) => c.hasAttribute('scope'));
    const allHeadersScoped = headerCells.length > 0 && headerCells.every((c) => c.hasAttribute('scope'));
    const isComplex = hasSpan || (columnHeaderPresent && rowHeaderPresent);

    return {
        selector: window.__a11y.cssPath(el),
        isPresentation,
        rowCount: rows.length,
        colCount,
        headerCount: headerCells.length,
        hasCaption,
        hasThead,
        hasSummary,
        hasDataMarkup: headerCells.length > 0 || hasCaption || hasSummary || hasScope || hasHeadersAttr,
        isComplex,
        fullAssociation: allHeadersScoped || hasHeadersAttr,
        outerHTML: el.outerHTML.slice(0, 300),
    };
}

export const tablesPlugin: AssessmentPlugin = {
    id: 'tables',
    name: 'Tables',

    async run(ctx: AssessmentContext): Promise<AssessmentResult> {
        ctx.log('[tables] Scanning tables...');

        const issues: AccessibilityIssue[] = [];
        const handles = await ctx.queryHandles('table');
        const axInfos = await ctx.ax.resolveHandles(handles);
        let evaluated = 0;

        const push = (
            data: TableData,
            ruleId: string,
            description: string,
            severity: IssueSeverity,
            helpUrl: string,
        ) => {
            issues.push({
                ruleId,
                description,
                severity,
                wcagCriteria: ['1.3.1'],
                helpUrl,
                target: data.selector,
                html: data.outerHTML,
                source: 'tables',
            });
        };

        for (let i = 0; i < handles.length; i++) {
            const handle = handles[i]!;
            const { name, visibleToAT } = axInfos[i]!;
            if (!visibleToAT) continue; // not exposed to AT → not in scope
            const data = await handle.evaluate(collectTableData);
            evaluated++;

            // 1. Layout table (role=presentation/none) using data-table markup.
            if (data.isPresentation) {
                if (data.hasDataMarkup) {
                    push(
                        data,
                        'table-layout-with-semantics',
                        `Table has role="presentation"/"none" (layout) but uses data-table markup ` +
                            `(th, caption, scope, headers, or summary). Remove the data semantics or make it a real data table.`,
                        'moderate',
                        'https://www.w3.org/WAI/WCAG21/Techniques/failures/F46',
                    );
                }
                continue; // presentation tables are not held to data-table rules
            }

            // 2. Data table (has headers) without an accessible name / caption.
            if (data.headerCount > 0 && name.trim() === '') {
                push(
                    data,
                    'table-missing-name',
                    `Data table has no accessible name. Add a <caption> (preferred) or aria-label / ` +
                        `aria-labelledby so its purpose is announced.`,
                    'moderate',
                    'https://www.w3.org/WAI/WCAG21/Techniques/html/H39',
                );
            }

            // 3. Signals data intent (caption/thead/summary) but declares no headers.
            if (data.headerCount === 0 && (data.hasCaption || data.hasThead || data.hasSummary)) {
                push(
                    data,
                    'table-missing-headers',
                    `Table appears to be a data table (has a caption/thead/summary) but declares no header ` +
                        `cells. Use <th> with an appropriate scope for column and row headers.`,
                    'serious',
                    'https://www.w3.org/WAI/WCAG21/Techniques/html/H51',
                );
            }

            // 4. Complex data table without programmatic cell↔header association.
            if (data.headerCount > 0 && data.isComplex && !data.fullAssociation) {
                push(
                    data,
                    'table-complex-no-association',
                    `Complex data table (spanned or two-axis headers) does not associate cells with their ` +
                        `headers. Add scope to every <th>, or use headers/id associations.`,
                    'serious',
                    'https://www.w3.org/WAI/WCAG21/Techniques/html/H43',
                );
            }
        }

        ctx.log(`[tables] ${evaluated} tables evaluated, ${issues.length} issues`);

        return {
            pluginId: 'tables',
            issues,
            metadata: { totalTables: handles.length, evaluatedTables: evaluated },
        };
    },
};
