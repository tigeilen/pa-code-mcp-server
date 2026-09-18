#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createServer } from './mcp/createServer.js';

/**
 * stdio entry point — the normal way an MCP client (Claude Desktop, etc.)
 * launches this server. stdout is the MCP JSON-RPC channel, so
 * all diagnostics go to stderr.
 */
async function main(): Promise<void> {
    const cfg = loadConfig();
    if (!cfg.tm1.baseUrl) console.error('[pa-code-mcp-server] WARNING: TM1_BASE_URL is empty — set it in .env');
    const server = createServer(cfg);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[pa-code-mcp-server] stdio ready — TM1=${cfg.tm1.baseUrl || '(unset)'} mode=${cfg.mcpMode}`);
}

main().catch((e) => { console.error('[pa-code-mcp-server] fatal:', e); process.exit(1); });
