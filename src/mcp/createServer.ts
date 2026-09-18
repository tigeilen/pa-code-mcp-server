import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Tm1Client } from '../tm1/Tm1Client.js';
import { registerTools } from './registerTools.js';
import { AppConfig } from '../config.js';

/** Builds an MCP server wired to a fresh TM1 client for the given config. */
export function createServer(cfg: AppConfig): McpServer {
    const server = new McpServer({ name: 'pa-code-mcp-server', version: '0.1.0' });
    const client = new Tm1Client(cfg.tm1);
    registerTools(server, client, cfg.mcpMode);
    return server;
}
