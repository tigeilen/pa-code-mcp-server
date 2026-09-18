// Temporary smoke test: initialize + call a couple of read tools over HTTP.
// Each request has a hard timeout so the script always gives feedback.
const URL = 'http://127.0.0.1:3900/mcp';
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

async function rpc(method, params, id, timeoutMs = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: ac.signal,
    });
    const text = await res.text();
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    const json = line ? line.slice(5).trim() : text.trim();
    return { ms: Date.now() - started, data: json ? JSON.parse(json) : { status: res.status, raw: text } };
  } catch (e) {
    return { ms: Date.now() - started, error: String(e?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e) };
  } finally {
    clearTimeout(t);
  }
}

console.log('1) initialize ...');
const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoketest', version: '0.0.1' } }, 1);
console.log(`   ${init.ms}ms ->`, init.error ?? JSON.stringify(init.data.result?.serverInfo ?? init.data));

console.log('2) tm1_get_server_info ...');
const info = await rpc('tools/call', { name: 'tm1_get_server_info', arguments: {} }, 2);
console.log(`   ${info.ms}ms ->`, info.error ?? (info.data.result?.content?.[0]?.text ?? JSON.stringify(info.data)));

console.log('3) tm1_list_cubes ...');
const cubes = await rpc('tools/call', { name: 'tm1_list_cubes', arguments: {} }, 3);
console.log(`   ${cubes.ms}ms ->`, cubes.error ?? (cubes.data.result?.content?.[0]?.text ?? JSON.stringify(cubes.data)));

console.log('done.');
