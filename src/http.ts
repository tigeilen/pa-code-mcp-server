import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config.js';
import { createServer } from './mcp/createServer.js';

/**
 * Streamable HTTP entry point (stateless): each POST /mcp spins up a fresh
 * server + transport pair, handles the request and tears them down. Bound to
 * loopback. If MCP_HTTP_TOKEN is set, a matching Bearer token is required.
 */
async function main(): Promise<void> {
    const cfg = loadConfig();
    const app = express();
    app.use(express.json({ limit: '8mb' }));

    app.post('/mcp', async (req, res) => {
        if (cfg.http.token) {
            const auth = String(req.headers['authorization'] || '');
            if (auth !== `Bearer ${cfg.http.token}`) { res.status(401).json({ error: 'unauthorized' }); return; }
        }
        try {
            const server = createServer(cfg);
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (e: any) {
            if (!res.headersSent) res.status(500).json({ error: e?.message || String(e) });
        }
    });

    app.get('/health', (_req, res) => res.json({ ok: true, mode: cfg.mcpMode, tm1: cfg.tm1.baseUrl }));

    app.listen(cfg.http.port, '127.0.0.1', () => {
        console.error(`[pa-code-mcp-server] HTTP ready on http://127.0.0.1:${cfg.http.port}/mcp — mode=${cfg.mcpMode}`);
    });
}

main().catch((e) => { console.error('[pa-code-mcp-server] fatal:', e); process.exit(1); });
