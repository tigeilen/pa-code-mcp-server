# pa-code-mcp-server

A **standalone** [Model Context Protocol](https://modelcontextprotocol.io) server for IBM Planning Analytics / TM1, extracted from the [pa-code](https://marketplace.visualstudio.com/) VS Code extension so it can run **without** the extension.

It exposes the TM1 model to any MCP-compatible LLM client as callable tools — both **read** (inspect cubes, dimensions, processes, rules, run MDX) and, in read/write mode, **write / model-building** (create dimensions, elements, consolidations, cubes, rules, TI processes, views, subsets; write cells; execute processes).

> Local / proof of concept. Point read/write mode at a **test** database whose account has the rights the agent should have. Not a production, multi-user server.

## Architecture

```
MCP client (Claude Desktop, …)
      │  stdio  or  Streamable HTTP
      ▼
pa-code-mcp-server ──REST──> TM1 / Planning Analytics
(read + write tools)
```

- `src/tm1/` — standalone TM1 REST client + read/write API (no VS Code, no pa-code dependency).
- `src/mcp/` — MCP tool registration (mode-gated, confirm-guarded), server factory.
- `src/index.ts` — **stdio** transport (normal MCP launch).
- `src/http.ts` — **Streamable HTTP** transport (loopback, optional bearer token).

## Setup

Requires Node.js ≥ 20.

```powershell
cd C:\VSCode\pa-code-mcp-server
npm install
copy .env.example .env      # then edit .env
npm run build
```

Fill in `.env`:
- **TM1**: `TM1_BASE_URL`, `TM1_AUTH_MODE` (basic | cam | apikey), `TM1_USER`, `TM1_PASSWORD`, (`TM1_CAM_NAMESPACE`), `TM1_SSL_REJECT_UNAUTHORIZED`.
- **Mode**: `MCP_MODE` = `readonly` (default) or `readwrite`.

## Run

**As an MCP server (stdio)** — e.g. from Claude Desktop or any MCP client:
```powershell
npm start
```
MCP client config example:
```json
{ "mcpServers": { "tm1": { "command": "node", "args": ["C:/VSCode/pa-code-mcp-server/dist/index.js"], "env": { "MCP_MODE": "readwrite" } } } }
```

**As an HTTP MCP server**:
```powershell
npm run start:http     # http://127.0.0.1:3900/mcp
```

## Tools

Read (always): `tm1_list_cubes`, `tm1_list_dimensions`, `tm1_list_processes`, `tm1_get_cube_dimensions`, `tm1_get_cube_rules`, `tm1_get_process_code`, `tm1_list_dimension_elements`, `tm1_list_hierarchies`, `tm1_list_views`, `tm1_list_subsets`, `tm1_execute_mdx`, `tm1_get_server_info`.

Write (only in `readwrite`): `tm1_create_dimension`, `tm1_create_hierarchy`, `tm1_add_elements`, `tm1_add_edges`, `tm1_delete_element`, `tm1_delete_dimension`, `tm1_create_cube`, `tm1_delete_cube`, `tm1_set_cube_rules`, `tm1_write_cell`, `tm1_write_cells`, `tm1_create_process`, `tm1_update_process`, `tm1_delete_process`, `tm1_execute_process`, `tm1_create_view`, `tm1_delete_view`, `tm1_create_subset`, `tm1_delete_subset`.

Destructive/irreversible tools (deletes, cell writes, rule replacement, process execution) require a `confirm` argument equal to the exact target name.

## Security notes

- Read/write mode gives the agent the full TM1 rights of the configured account. Use a scoped test account.
- `TM1_SSL_REJECT_UNAUTHORIZED=false` disables TLS validation (common for TM1 dev certs). Dev only.
- The HTTP transport binds to loopback; set `MCP_HTTP_TOKEN` to require a bearer token.

## License

MIT — Copyright (c) 2026 Tim Geilen. See [LICENSE](LICENSE).

IBM, Planning Analytics and TM1 are trademarks of IBM Corp.; this project is not affiliated with or endorsed by IBM.
