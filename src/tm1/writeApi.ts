import { Tm1Client, odataKey } from './Tm1Client.js';

/** Write / model-building functions over a TM1 database. Each returns a summary string. */

function normElemType(t?: string): 'Numeric' | 'String' | 'Consolidated' {
    const s = String(t ?? '').trim().toLowerCase();
    if (s.startsWith('c') || s === '3' || s === 'consolidated') return 'Consolidated';
    if (s.startsWith('s') || s === '2' || s === 'string') return 'String';
    return 'Numeric';
}

// --- Dimensions, hierarchies & elements ---------------------------------------

export async function createDimension(c: Tm1Client, dim: string, hier?: string): Promise<string> {
    const h = hier || dim;
    await c.post('/api/v1/Dimensions', { Name: dim, Hierarchies: [{ Name: h }] });
    return `Created dimension '${dim}'${h !== dim ? ` with hierarchy '${h}'` : ''}.`;
}

export async function createHierarchy(c: Tm1Client, dim: string, hier: string): Promise<string> {
    await c.post(`/api/v1/Dimensions('${odataKey(dim)}')/Hierarchies`, { Name: hier });
    return `Created hierarchy '${hier}' in '${dim}'.`;
}

export async function deleteDimension(c: Tm1Client, dim: string): Promise<string> {
    await c.del(`/api/v1/Dimensions('${odataKey(dim)}')`);
    return `Deleted dimension '${dim}'.`;
}

export async function addElements(c: Tm1Client, dim: string, hier: string | undefined, elements: { name: string; type?: string }[]): Promise<string> {
    if (!elements?.length) throw new Error('elements must be a non-empty array.');
    if (elements.length > 20000) throw new Error('Max 20000 elements per call.');
    const h = hier || dim;
    const url = `/api/v1/Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(h)}')/Elements`;
    let added = 0, failed = 0; let firstErr: string | undefined;
    for (const e of elements) {
        try { await c.post(url, { Name: e.name, Type: normElemType(e.type) }); added++; }
        catch (err: any) { failed++; if (!firstErr) firstErr = err.message; }
    }
    if (added === 0) throw new Error(`No elements added to '${dim}': ${firstErr}`);
    return `Added ${added} element(s) to '${dim}'${failed ? ` (${failed} skipped/failed — likely already exist)` : ''}.`;
}

export async function addEdges(c: Tm1Client, dim: string, hier: string | undefined, edges: { parent: string; child: string; weight?: number }[]): Promise<string> {
    if (!edges?.length) throw new Error('edges must be a non-empty array.');
    if (edges.length > 20000) throw new Error('Max 20000 edges per call.');
    const h = hier || dim;
    const url = `/api/v1/Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(h)}')/Edges`;
    let added = 0, failed = 0; let firstErr: string | undefined;
    for (const e of edges) {
        try { await c.post(url, { ParentName: e.parent, ComponentName: e.child, Weight: e.weight ?? 1 }); added++; }
        catch (err: any) { failed++; if (!firstErr) firstErr = err.message; }
    }
    if (added === 0) throw new Error(`No edges added to '${dim}': ${firstErr}`);
    return `Added ${added} edge(s) to '${dim}'${failed ? ` (${failed} skipped/failed)` : ''}.`;
}

export async function deleteElement(c: Tm1Client, dim: string, hier: string | undefined, element: string): Promise<string> {
    const h = hier || dim;
    await c.del(`/api/v1/Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(h)}')/Elements('${odataKey(element)}')`);
    return `Deleted element '${element}' from '${dim}'.`;
}

// --- Cubes & rules ------------------------------------------------------------

export async function createCube(c: Tm1Client, cube: string, dimensions: string[]): Promise<string> {
    if (!dimensions?.length) throw new Error('dimensions must be a non-empty ordered array.');
    const binds = dimensions.map((d) => `Dimensions('${odataKey(d)}')`);
    await c.post('/api/v1/Cubes', { Name: cube, 'Dimensions@odata.bind': binds });
    return `Created cube '${cube}' over [${dimensions.join(', ')}].`;
}

export async function deleteCube(c: Tm1Client, cube: string): Promise<string> {
    await c.del(`/api/v1/Cubes('${odataKey(cube)}')`);
    return `Deleted cube '${cube}'.`;
}

export async function setCubeRules(c: Tm1Client, cube: string, rules: string): Promise<string> {
    await c.patch(`/api/v1/Cubes('${odataKey(cube)}')`, { Rules: rules || '' });
    return `Updated rules on '${cube}' (${(rules || '').length} chars).`;
}

// --- Cell data ----------------------------------------------------------------

function normTuple(tuple: { dimension: string; element: string; hierarchy?: string }[]): string[] {
    if (!tuple?.length) throw new Error('tuple must be a non-empty array of { dimension, element }.');
    return tuple.map((t) => {
        if (!t.dimension || t.element == null) throw new Error('each tuple entry needs { dimension, element }.');
        const h = t.hierarchy || t.dimension;
        return `Dimensions('${odataKey(t.dimension)}')/Hierarchies('${odataKey(h)}')/Elements('${odataKey(String(t.element))}')`;
    });
}

export async function writeCell(c: Tm1Client, cube: string, tuple: any[], value: string | number): Promise<string> {
    await c.post(`/api/v1/Cubes('${odataKey(cube)}')/tm1.Update`, {
        Cells: [{ 'Tuple@odata.bind': normTuple(tuple) }],
        Value: String(value)
    });
    return `Wrote value into '${cube}'.`;
}

export async function writeCells(c: Tm1Client, cube: string, cells: { tuple: any[]; value: string | number }[]): Promise<string> {
    if (!cells?.length) throw new Error('cells must be a non-empty array of { tuple, value }.');
    if (cells.length > 10000) throw new Error('Max 10000 cells per call.');
    let ok = 0, failed = 0; let firstErr: string | undefined;
    for (const cell of cells) {
        try { await writeCell(c, cube, cell.tuple, cell.value); ok++; }
        catch (e: any) { failed++; if (!firstErr) firstErr = e.message; }
    }
    if (ok === 0) throw new Error(`No cells written to '${cube}': ${firstErr}`);
    return `Wrote ${ok} cell(s) into '${cube}'${failed ? ` (${failed} failed: ${firstErr})` : ''}.`;
}

// --- TI processes -------------------------------------------------------------

export interface ProcCode { prolog?: string; metadata?: string; data?: string; epilog?: string; hasSecurityAccess?: boolean; }

async function compile(c: Tm1Client, name: string): Promise<void> {
    const res = await c.post(`/api/v1/Processes('${odataKey(name)}')/tm1.Compile`, {});
    const errors = res?.value || [];
    if (errors.length) {
        throw new Error('Syntax error:\n' + errors.map((e: any) => `[${e.Procedure}] Line ${e.LineNumber}: ${e.Message}`).join('\n'));
    }
}

export async function createProcess(c: Tm1Client, name: string, code: ProcCode): Promise<string> {
    await c.post('/api/v1/Processes', {
        Name: name,
        HasSecurityAccess: !!code.hasSecurityAccess,
        PrologProcedure: code.prolog || '', MetadataProcedure: code.metadata || '',
        DataProcedure: code.data || '', EpilogProcedure: code.epilog || ''
    });
    await compile(c, name);
    return `Created TI process '${name}' (compiled OK).`;
}

export async function updateProcess(c: Tm1Client, name: string, code: ProcCode): Promise<string> {
    await c.patch(`/api/v1/Processes('${odataKey(name)}')`, {
        PrologProcedure: code.prolog || '', MetadataProcedure: code.metadata || '',
        DataProcedure: code.data || '', EpilogProcedure: code.epilog || ''
    });
    await compile(c, name);
    return `Updated TI process '${name}' (compiled OK).`;
}

export async function deleteProcess(c: Tm1Client, name: string): Promise<string> {
    await c.del(`/api/v1/Processes('${odataKey(name)}')`);
    return `Deleted TI process '${name}'.`;
}

export async function executeProcess(c: Tm1Client, name: string, parameters: { Name: string; Value: any }[]): Promise<string> {
    const data = await c.post(`/api/v1/Processes('${odataKey(name)}')/tm1.ExecuteWithReturn?$expand=ErrorLogFile`, {
        Parameters: parameters || []
    });
    const status = String(data?.ProcessExecuteStatusCode || 'Unknown');
    const outcome = status === 'CompletedSuccessfully' ? 'succeeded'
        : (status === 'Aborted' || status === 'QuitCalled' || status === 'RollbackCalled') ? 'rolled_back'
        : 'completed_with_errors';
    return `Process '${name}' — outcome: ${outcome} (status: ${status}).`;
}

// --- Views & subsets ----------------------------------------------------------

export async function createView(c: Tm1Client, cube: string, view: string, mdx: string, isPrivate = false): Promise<string> {
    const coll = isPrivate ? 'PrivateViews' : 'Views';
    const body = { '@odata.type': '#ibm.tm1.api.v1.MDXView', Name: view, MDX: mdx };
    await c.post(`/api/v1/Cubes('${odataKey(cube)}')/${coll}`, body);
    return `Saved ${isPrivate ? 'private' : 'public'} MDX view '${view}' on '${cube}'.`;
}

export async function deleteView(c: Tm1Client, cube: string, view: string): Promise<string> {
    await c.del(`/api/v1/Cubes('${odataKey(cube)}')/Views('${odataKey(view)}')`);
    return `Deleted view '${view}' from '${cube}'.`;
}

export async function createSubset(c: Tm1Client, dim: string, hier: string | undefined, subset: string, isPublic: boolean, mdx?: string, elements?: string[]): Promise<string> {
    const h = hier || dim;
    const coll = isPublic ? 'Subsets' : 'PrivateSubsets';
    const body: any = { Name: subset };
    if (mdx) body.Expression = mdx;
    else body['Elements@odata.bind'] = (elements || []).map((e) => `Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(h)}')/Elements('${odataKey(e)}')`);
    await c.post(`/api/v1/Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(h)}')/${coll}`, body);
    return `Saved ${isPublic ? 'public' : 'private'} ${mdx ? 'dynamic' : 'static'} subset '${subset}' on '${dim}'.`;
}

export async function deleteSubset(c: Tm1Client, dim: string, subset: string, hier?: string): Promise<string> {
    const h = hier || dim;
    await c.del(`/api/v1/Dimensions('${odataKey(dim)}')/Hierarchies('${odataKey(h)}')/Subsets('${odataKey(subset)}')`);
    return `Deleted subset '${subset}' from '${dim}'.`;
}
