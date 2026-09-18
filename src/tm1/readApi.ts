import { Tm1Client, odataKey } from './Tm1Client.js';

/** Read-only "model context" functions over a TM1 database. Each returns text. */

function isControl(name: string): boolean { return name.startsWith('}'); }

export async function listCubes(c: Tm1Client, includeControl = false): Promise<string> {
    const data = await c.get('/api/v1/Cubes?$select=Name');
    const names = (data.value || []).map((x: any) => x.Name).filter((n: string) => includeControl || !isControl(n));
    return names.length ? names.join('\n') : 'No cubes.';
}

export async function listDimensions(c: Tm1Client, includeControl = false): Promise<string> {
    const data = await c.get('/api/v1/Dimensions?$select=Name');
    const names = (data.value || []).map((x: any) => x.Name).filter((n: string) => includeControl || !isControl(n));
    return names.length ? names.join('\n') : 'No dimensions.';
}

export async function listProcesses(c: Tm1Client, includeControl = false): Promise<string> {
    const data = await c.get('/api/v1/Processes?$select=Name');
    const names = (data.value || []).map((x: any) => x.Name).filter((n: string) => includeControl || !isControl(n));
    return names.length ? names.join('\n') : 'No processes.';
}

export async function getCubeDimensions(c: Tm1Client, cube: string): Promise<string> {
    const data = await c.get(`/api/v1/Cubes('${odataKey(cube)}')?$expand=Dimensions($select=Name)`);
    const dims = (data.Dimensions || []).map((d: any, i: number) => `${i + 1}. ${d.Name}`);
    return dims.length ? `Cube '${cube}' dimensions:\n${dims.join('\n')}` : `Cube '${cube}' has no dimensions.`;
}

export async function getCubeRules(c: Tm1Client, cube: string): Promise<string> {
    const data = await c.get(`/api/v1/Cubes('${odataKey(cube)}')?$select=Name,Rules`);
    return data.Rules && data.Rules.trim() ? data.Rules : `Cube '${cube}' has no rules.`;
}

export async function getProcessCode(c: Tm1Client, name: string): Promise<string> {
    const q = `/api/v1/Processes('${odataKey(name)}')?$select=PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,Parameters,DataSource`;
    const d = await c.get(q);
    const tab = (label: string, code: string) => `### ${label}\n${code && code.trim() ? '```\n' + code + '\n```' : '(empty)'}`;
    return [
        `# TI Process: ${name}`,
        tab('Prolog', d.PrologProcedure || ''),
        tab('Metadata', d.MetadataProcedure || ''),
        tab('Data', d.DataProcedure || ''),
        tab('Epilog', d.EpilogProcedure || ''),
        `### Parameters\n\`\`\`json\n${JSON.stringify(d.Parameters || [], null, 2)}\n\`\`\``
    ].join('\n\n');
}

export async function listDimensionElements(c: Tm1Client, dim: string, hier: string | undefined, limit = 500): Promise<string> {
    const h = hier || dim;
    const cap = Math.min(Math.max(limit, 1), 5000);
    const data = await c.get(`/api/v1/Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(h)}')/Elements?$select=Name,Type&$top=${cap}`);
    const rows = (data.value || []).map((e: any) => `${e.Name} (${e.Type})`);
    return rows.length ? rows.join('\n') : `No elements in '${dim}'.`;
}

export async function listHierarchies(c: Tm1Client, dim: string): Promise<string> {
    const data = await c.get(`/api/v1/Dimensions('${odataKey(dim)}')/Hierarchies?$select=Name`);
    const names = (data.value || []).map((x: any) => x.Name);
    return names.length ? names.join('\n') : `No hierarchies in '${dim}'.`;
}

export async function listViews(c: Tm1Client, cube: string): Promise<string> {
    const data = await c.get(`/api/v1/Cubes('${odataKey(cube)}')/Views?$select=Name`);
    const names = (data.value || []).map((x: any) => x.Name);
    return names.length ? names.join('\n') : `No views on '${cube}'.`;
}

export async function listSubsets(c: Tm1Client, dim: string, hier?: string): Promise<string> {
    const h = hier || dim;
    const data = await c.get(`/api/v1/Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(h)}')/Subsets?$select=Name`);
    const names = (data.value || []).map((x: any) => x.Name);
    return names.length ? names.join('\n') : `No subsets on '${dim}'.`;
}

export async function executeMdx(c: Tm1Client, mdx: string, maxCells = 100): Promise<string> {
    const q = `/api/v1/ExecuteMDX?$expand=Axes($expand=Tuples($expand=Members($select=Name))),Cells($select=Ordinal,Value,FormattedValue)`;
    const data = await c.post(q, { MDX: mdx });
    const axes = data.Axes || [];
    const cells = data.Cells || [];
    if (!cells.length) return 'Query returned no cells.';
    // Build coordinate labels per cell ordinal (axis 0 varies fastest).
    const tuplesPerAxis = axes.map((ax: any) => (ax.Tuples || []).map((t: any) => (t.Members || []).map((m: any) => m.Name).join(' | ')));
    const sizes = tuplesPerAxis.map((t: string[]) => t.length || 1);
    const lines: string[] = [];
    for (let i = 0; i < cells.length && lines.length < maxCells; i++) {
        const cell = cells[i];
        if (cell.Value == null || cell.Value === '') continue;
        let rem = i; const coords: string[] = [];
        for (let a = 0; a < sizes.length; a++) { const idx = rem % sizes[a]; rem = Math.floor(rem / sizes[a]); coords.push(tuplesPerAxis[a][idx] || ''); }
        lines.push(`${coords.filter(Boolean).join(' | ')} = ${cell.FormattedValue ?? cell.Value}`);
    }
    return lines.length ? lines.join('\n') : 'Query returned only empty cells.';
}

export async function getServerInfo(c: Tm1Client): Promise<string> {
    const data = await c.get('/api/v1/Configuration');
    return '```json\n' + JSON.stringify(data, null, 2).slice(0, 4000) + '\n```';
}

// --- Structured grid (for an editable data-entry table) -----------------------

export interface GridSpec {
    cube: string;
    rowDimension: string; rowHierarchy?: string; rowElements: string[];
    colDimension: string; colHierarchy?: string; colElements: string[];
    context?: { dimension: string; hierarchy?: string; element: string }[];
}

function memberRef(dim: string, hier: string | undefined, el: string): string {
    return `[${dim}].[${hier || dim}].[${el}]`;
}

/**
 * Executes a rows × columns cellset and returns a structured grid (JSON string)
 * that a frontend can render as an editable table and, per cell, map back to a
 * write tuple. `updateable` marks cells that accept input (leaf cells).
 */
export async function getCubeGrid(c: Tm1Client, spec: GridSpec): Promise<string> {
    const rowEls = spec.rowElements || [], colEls = spec.colElements || [];
    if (!spec.cube || !spec.rowDimension || !spec.colDimension) throw new Error('cube, rowDimension and colDimension are required.');
    if (!rowEls.length || !colEls.length) throw new Error('rowElements and colElements must be non-empty.');
    if (rowEls.length * colEls.length > 40000) throw new Error('Grid too large (max 40000 cells).');

    const colSet = '{' + colEls.map((e) => memberRef(spec.colDimension, spec.colHierarchy, e)).join(', ') + '}';
    const rowSet = '{' + rowEls.map((e) => memberRef(spec.rowDimension, spec.rowHierarchy, e)).join(', ') + '}';
    const ctx = (spec.context || []).map((t) => memberRef(t.dimension, t.hierarchy, t.element));
    const where = ctx.length ? ` WHERE (${ctx.join(', ')})` : '';
    const mdx = `SELECT ${colSet} ON 0, ${rowSet} ON 1 FROM [${spec.cube}]${where}`;

    const data = await c.post('/api/v1/ExecuteMDX?$expand=Cells($select=Ordinal,Value,FormattedValue,Updateable,Consolidated,RuleDerived)', { MDX: mdx });
    const cells = data.Cells || [];
    const nCols = colEls.length, nRows = rowEls.length;
    const values: (number | string | null)[][] = [];
    const formatted: string[][] = [];
    const updateable: boolean[][] = [];
    for (let r = 0; r < nRows; r++) {
        values.push([]); formatted.push([]); updateable.push([]);
        for (let cIdx = 0; cIdx < nCols; cIdx++) {
            const cell = cells[r * nCols + cIdx] || {};
            values[r].push(cell.Value ?? null);
            formatted[r].push(cell.FormattedValue != null ? String(cell.FormattedValue) : (cell.Value != null ? String(cell.Value) : ''));
            updateable[r].push(cell.Updateable !== false && !cell.Consolidated && !cell.RuleDerived);
        }
    }
    return JSON.stringify({
        cube: spec.cube,
        rowDimension: spec.rowDimension, rowHierarchy: spec.rowHierarchy || spec.rowDimension, rows: rowEls,
        colDimension: spec.colDimension, colHierarchy: spec.colHierarchy || spec.colDimension, columns: colEls,
        context: spec.context || [],
        values, formatted, updateable
    });
}
