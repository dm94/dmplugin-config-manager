'use strict';
const http = require('node:http');

const PROFILES = ['config', 'doors', 'palladium'];
const RESOURCES = {
  'bot://profiles': { profiles: PROFILES },
  'bot://status': { running: true, map_name: '1-5' },
  'bot://hero': { config_name: 'FIRST' },
  'bot://stats': { general: { credits: 123456, uridium: 7890 } },
  'mcp://inventory': { item_count: 1, items: [{ name: 'laser', amount: 1 }] },
  'mcp://npc_event': { generic: { status: 'INACTIVE' } },
};

async function handler(request, response) {
  if (request.method !== 'POST') { response.writeHead(405).end(); return; }
  let payload;
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    response.writeHead(400).end(); return;
  }
  const { method, params = {} } = payload;
  let result = {};
  if (method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { resources: {}, tools: {} }, serverInfo: { name: 'fake-dmplugin', version: 'test' } };
  else if (method === 'tools/list') result = { tools: [{ name: 'set_profile', description: 'Switch config profile' }] };
  else if (method === 'resources/read') {
    const value = RESOURCES[params.uri];
    result = { contents: value ? [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(value) }] : [] };
  }
  if (!Object.hasOwn(payload, 'id')) { response.writeHead(200, { 'content-length': '0' }).end(); return; }
  const body = JSON.stringify({ jsonrpc: '2.0', id: payload.id, result });
  response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }).end(body);
}

function createFakeMcpServer() { return http.createServer((request, response) => { void handler(request, response); }); }

if (require.main === module) {
  const port = Number(process.argv[2] || 9878);
  const server = createFakeMcpServer();
  server.listen(port, '127.0.0.1', () => console.log(`fake MCP listening on ${port}`));
  process.once('SIGINT', () => server.close(() => process.exit(0)));
  process.once('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = { createFakeMcpServer, PROFILES, RESOURCES };
