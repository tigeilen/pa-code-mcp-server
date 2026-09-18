import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Tm1Client } from '../tm1/Tm1Client.js';
import * as read from '../tm1/readApi.js';
import * as write from '../tm1/writeApi.js';
import { McpMode } from '../config.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (text: string): TextResult => ({ content: [{ type: 'text', text }] });
const fail = (text: string): TextResult => ({ content: [{ type: 'text', text }], isError: true });

/** Wraps a handler so thrown errors become MCP error content instead of crashing the transport. */
function guard(fn: () => Promise<string>): Promise<TextResult> {
    return fn().then(ok).catch((e: any) => fail(`Error: ${e?.message || String(e)}`));
}

const elementShape = z.object({ name: z.string(), type: z.string().optional().describe('Numeric | String | Consolidated (also N/S/C).') });
const edgeShape = z.object({ parent: z.string(), child: z.string(), weight: z.number().optional() });
const tupleEntry = z.object({ dimension: z.string(), element: z.string(), hierarchy: z.string().optional() });

/**
 * Registers the TM1 tools on an MCP server. Read tools are always registered;
 * write / model-building tools only when mode === 'readwrite'. Destructive tools
 * take a `confirm` argument that must repeat the target name.
 */
export function registerTools(server: McpServer, c: Tm1Client, mode: McpMode): void {
    // ---------------------------------------------------------------- read ----
    server.tool('tm1_list_cubes', 'List cubes.', { includeControl: z.boolean().optional() },
        (a) => guard(() => read.listCubes(c, !!a.includeControl)));
    server.tool('tm1_list_dimensions', 'List dimensions.', { includeControl: z.boolean().optional() },
        (a) => guard(() => read.listDimensions(c, !!a.includeControl)));
    server.tool('tm1_list_processes', 'List TI processes.', { includeControl: z.boolean().optional() },
        (a) => guard(() => read.listProcesses(c, !!a.includeControl)));
    server.tool('tm1_get_cube_dimensions', 'Ordered dimensions of a cube.', { cubeName: z.string() },
        (a) => guard(() => read.getCubeDimensions(c, a.cubeName)));
    server.tool('tm1_get_cube_rules', 'Rules text of a cube.', { cubeName: z.string() },
        (a) => guard(() => read.getCubeRules(c, a.cubeName)));
    server.tool('tm1_get_process_code', 'Full source of a TI process.', { processName: z.string() },
        (a) => guard(() => read.getProcessCode(c, a.processName)));
    server.tool('tm1_list_dimension_elements', 'List elements of a dimension hierarchy (capped).',
        { dimensionName: z.string(), hierarchyName: z.string().optional(), limit: z.number().optional() },
        (a) => guard(() => read.listDimensionElements(c, a.dimensionName, a.hierarchyName, a.limit ?? 500)));
    server.tool('tm1_list_hierarchies', 'List hierarchies of a dimension.', { dimensionName: z.string() },
        (a) => guard(() => read.listHierarchies(c, a.dimensionName)));
    server.tool('tm1_list_views', 'List views on a cube.', { cubeName: z.string() },
        (a) => guard(() => read.listViews(c, a.cubeName)));
    server.tool('tm1_list_subsets', 'List subsets of a dimension.', { dimensionName: z.string(), hierarchyName: z.string().optional() },
        (a) => guard(() => read.listSubsets(c, a.dimensionName, a.hierarchyName)));
    server.tool('tm1_execute_mdx', 'Run a read-only MDX query (capped).', { mdx: z.string(), maxCells: z.number().optional() },
        (a) => guard(() => read.executeMdx(c, a.mdx, a.maxCells ?? 100)));
    server.tool('tm1_get_cube_grid', 'Build a rows × columns value grid for an editable data-entry table. Returns JSON (rows, columns, values, updateable) that maps each cell back to a write tuple.',
        {
            cubeName: z.string(),
            rowDimension: z.string(), rowHierarchy: z.string().optional(), rowElements: z.array(z.string()),
            colDimension: z.string(), colHierarchy: z.string().optional(), colElements: z.array(z.string()),
            context: z.array(z.object({ dimension: z.string(), hierarchy: z.string().optional(), element: z.string() })).optional()
        },
        (a) => guard(() => read.getCubeGrid(c, {
            cube: a.cubeName,
            rowDimension: a.rowDimension, rowHierarchy: a.rowHierarchy, rowElements: a.rowElements,
            colDimension: a.colDimension, colHierarchy: a.colHierarchy, colElements: a.colElements,
            context: a.context
        })));
    server.tool('tm1_get_server_info', 'Static server configuration.', {},
        () => guard(() => read.getServerInfo(c)));

    if (mode !== 'readwrite') return;

    // --------------------------------------------------------------- write ----
    const confirmField = z.string().describe('Repeat the exact target name to confirm this destructive/irreversible action.');
    const needConfirm = (given: string | undefined, target: string): string | null =>
        (given && given === target) ? null : `This action is destructive/irreversible. Re-call with confirm="${target}" to proceed.`;

    // Dimensions & elements
    server.tool('tm1_create_dimension', 'Create a dimension with a leaves hierarchy.',
        { dimensionName: z.string(), hierarchyName: z.string().optional() },
        (a) => guard(() => write.createDimension(c, a.dimensionName, a.hierarchyName)));
    server.tool('tm1_create_hierarchy', 'Create an additional hierarchy in a dimension.',
        { dimensionName: z.string(), hierarchyName: z.string() },
        (a) => guard(() => write.createHierarchy(c, a.dimensionName, a.hierarchyName)));
    server.tool('tm1_add_elements', 'Add elements (Numeric/String/Consolidated) to a hierarchy.',
        { dimensionName: z.string(), hierarchyName: z.string().optional(), elements: z.array(elementShape) },
        (a) => guard(() => write.addElements(c, a.dimensionName, a.hierarchyName, a.elements)));
    server.tool('tm1_add_edges', 'Add consolidation edges (parent -> child, weight).',
        { dimensionName: z.string(), hierarchyName: z.string().optional(), edges: z.array(edgeShape) },
        (a) => guard(() => write.addEdges(c, a.dimensionName, a.hierarchyName, a.edges)));
    server.tool('tm1_delete_element', 'Delete an element (destructive).',
        { dimensionName: z.string(), hierarchyName: z.string().optional(), elementName: z.string(), confirm: confirmField },
        (a) => { const m = needConfirm(a.confirm, a.elementName); return m ? Promise.resolve(fail(m)) : guard(() => write.deleteElement(c, a.dimensionName, a.hierarchyName, a.elementName)); });
    server.tool('tm1_delete_dimension', 'Delete a dimension (destructive).',
        { dimensionName: z.string(), confirm: confirmField },
        (a) => { const m = needConfirm(a.confirm, a.dimensionName); return m ? Promise.resolve(fail(m)) : guard(() => write.deleteDimension(c, a.dimensionName)); });

    // Cubes & rules
    server.tool('tm1_create_cube', 'Create a cube over ordered dimensions.',
        { cubeName: z.string(), dimensions: z.array(z.string()) },
        (a) => guard(() => write.createCube(c, a.cubeName, a.dimensions)));
    server.tool('tm1_delete_cube', 'Delete a cube (destructive).',
        { cubeName: z.string(), confirm: confirmField },
        (a) => { const m = needConfirm(a.confirm, a.cubeName); return m ? Promise.resolve(fail(m)) : guard(() => write.deleteCube(c, a.cubeName)); });
    server.tool('tm1_set_cube_rules', 'Replace the rules of a cube (overwrites; requires confirm).',
        { cubeName: z.string(), rules: z.string(), confirm: confirmField },
        (a) => { const m = needConfirm(a.confirm, a.cubeName); return m ? Promise.resolve(fail(m)) : guard(() => write.setCubeRules(c, a.cubeName, a.rules)); });

    // Cell data
    server.tool('tm1_write_cell', 'Write a single value into a cube cell (requires confirm).',
        { cubeName: z.string(), tuple: z.array(tupleEntry), value: z.union([z.string(), z.number()]), confirm: confirmField },
        (a) => { const m = needConfirm(a.confirm, a.cubeName); return m ? Promise.resolve(fail(m)) : guard(() => write.writeCell(c, a.cubeName, a.tuple, a.value)); });
    server.tool('tm1_write_cells', 'Write many values into a cube (requires confirm).',
        { cubeName: z.string(), cells: z.array(z.object({ tuple: z.array(tupleEntry), value: z.union([z.string(), z.number()]) })), confirm: confirmField },
        (a) => { const m = needConfirm(a.confirm, a.cubeName); return m ? Promise.resolve(fail(m)) : guard(() => write.writeCells(c, a.cubeName, a.cells)); });

    // TI processes
    const procShape = { processName: z.string(), prolog: z.string().optional(), metadata: z.string().optional(), data: z.string().optional(), epilog: z.string().optional(), hasSecurityAccess: z.boolean().optional() };
    server.tool('tm1_create_process', 'Create a TI process with code (compiles on save).', procShape,
        (a) => guard(() => write.createProcess(c, a.processName, a)));
    server.tool('tm1_update_process', 'Replace the code of a TI process (compiles on save).', procShape,
        (a) => guard(() => write.updateProcess(c, a.processName, a)));
    server.tool('tm1_delete_process', 'Delete a TI process (destructive).',
        { processName: z.string(), confirm: confirmField },
        (a) => { const m = needConfirm(a.confirm, a.processName); return m ? Promise.resolve(fail(m)) : guard(() => write.deleteProcess(c, a.processName)); });
    server.tool('tm1_execute_process', 'Execute a TI process (side effects; requires confirm). Returns an outcome.',
        { processName: z.string(), parameters: z.array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]) })).optional(), confirm: confirmField },
        (a) => { const m = needConfirm(a.confirm, a.processName); return m ? Promise.resolve(fail(m)) : guard(() => write.executeProcess(c, a.processName, a.parameters || [])); });

    // Views & subsets
    server.tool('tm1_create_view', 'Save an MDX view on a cube.',
        { cubeName: z.string(), viewName: z.string(), mdx: z.string(), isPrivate: z.boolean().optional() },
        (a) => guard(() => write.createView(c, a.cubeName, a.viewName, a.mdx, !!a.isPrivate)));
    server.tool('tm1_delete_view', 'Delete a cube view (destructive).',
        { cubeName: z.string(), viewName: z.string(), confirm: confirmField },
        (a) => { const m = needConfirm(a.confirm, a.viewName); return m ? Promise.resolve(fail(m)) : guard(() => write.deleteView(c, a.cubeName, a.viewName)); });
    server.tool('tm1_create_subset', 'Save a static or dynamic subset.',
        { dimensionName: z.string(), hierarchyName: z.string().optional(), subsetName: z.string(), isPublic: z.boolean().optional(), mdx: z.string().optional(), elements: z.array(z.string()).optional() },
        (a) => guard(() => write.createSubset(c, a.dimensionName, a.hierarchyName, a.subsetName, a.isPublic !== false, a.mdx, a.elements)));
    server.tool('tm1_delete_subset', 'Delete a subset (destructive).',
        { dimensionName: z.string(), subsetName: z.string(), hierarchyName: z.string().optional(), confirm: confirmField },
        (a) => { const m = needConfirm(a.confirm, a.subsetName); return m ? Promise.resolve(fail(m)) : guard(() => write.deleteSubset(c, a.dimensionName, a.subsetName, a.hierarchyName)); });
}
