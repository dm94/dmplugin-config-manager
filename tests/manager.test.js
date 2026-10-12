'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const manager = require('../manager');
const { createFakeMcpServer } = require('./fake_mcp');

function response(body, headers = { 'content-type': 'application/json' }, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), arrayBuffer: async () => Buffer.from(body), text: async () => String(body), json: async () => JSON.parse(String(body)) };
}

test('MCP endpoint validation permits loopback/private IP only', () => {
  assert.equal(manager.safeEndpoint('http://127.0.0.1:9876/mcp'), 'http://127.0.0.1:9876/mcp');
  assert.equal(manager.safeEndpoint('http://192.168.1.9:9876/mcp'), 'http://192.168.1.9:9876/mcp');
  for (const endpoint of ['http://8.8.8.8:9876/mcp', 'http://0.0.0.0:9876/mcp', 'https://127.0.0.1:9876/mcp', 'http://user@127.0.0.1:9876/mcp', 'http://127.0.0.1:80/mcp', 'http://127.0.0.1:9876/other']) {
    assert.throws(() => manager.safeEndpoint(endpoint), Error, endpoint);
  }
});

test('OpenAI-compatible URL validation requires TLS remotely and strips endpoint path', () => {
  assert.equal(manager.safeAiUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
  assert.equal(manager.safeAiUrl('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1');
  assert.equal(manager.safeAiUrl('http://localhost:8080/v1/chat/completions'), 'http://localhost:8080/v1');
  for (const endpoint of ['http://api.example.com/v1', 'https://user:secret@api.example.com/v1', 'https://api.example.com/v1?token=secret', 'ftp://api.example.com/v1']) {
    assert.throws(() => manager.safeAiUrl(endpoint), Error, endpoint);
  }
});

test('model request uses OpenAI chat completions, selected model and Bearer API key', async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  let captured;
  global.fetch = async (url, options) => {
    captured = { url: String(url), options, payload: JSON.parse(options.body) };
    return response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: 'use_profile', profile: 'doors', confidence: 0.8, summary: 'Use doors' }) } }] }));
  };
  const result = await manager.askAi('https://api.example.com/v1', 'chat-model', 'secret-key', { profiles: { profiles: ['farm', 'doors'] } });
  assert.equal(captured.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(new Headers(captured.options.headers).get('authorization'), 'Bearer secret-key');
  assert.equal(captured.payload.model, 'chat-model');
  assert.deepEqual(captured.payload.response_format, { type: 'json_object' });
  assert.equal(result.profile, 'doors');
  assert.equal(result.engine, 'openai-compatible');
});

test('recommendations are restricted to existing profiles and known actions', () => {
  assert.equal(manager.parseRecommendation(JSON.stringify({ action: 'use_profile', profile: 'doors', confidence: .9, summary: 'ok' }), ['farm', 'doors']).profile, 'doors');
  const unknown = manager.parseRecommendation(JSON.stringify({ action: 'use_profile', profile: 'invented', confidence: .9 }), ['farm']);
  assert.equal(unknown.action, 'keep');
  assert.equal(unknown.profile, null);
  assert.equal(manager.parseRecommendation(JSON.stringify({ action: 'create_profile', profile: 'new', confidence: .9 }), ['farm']).action, 'keep');
  assert.throws(() => manager.parseRecommendation('{}', ['farm']));
  assert.throws(() => manager.parseRecommendation('{"action":"keep","extra_tool":"buy"}', ['farm']));
});

test('API key is persisted locally and excluded from public state', (context) => {
  const originalPath = manager.getStatePath();
  const originalState = structuredClone(manager.STATE);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-manager-state-'));
  manager.setStatePath(path.join(directory, 'state.json'));
  context.after(() => { manager.setStatePath(originalPath); Object.assign(manager.STATE, originalState); fs.rmSync(directory, { recursive: true, force: true }); });
  Object.assign(manager.STATE, { bots: [], interval_hours: 8, ai_url: 'https://api.example.com/v1', ai_model: 'chat-model', ai_api_key: 'secret-key' });
  const publicState = manager.publicState();
  assert.equal(publicState.ai_api_key_configured, true);
  assert.equal('ai_api_key' in publicState, false);
  assert.equal(JSON.stringify(publicState).includes('secret-key'), false);
  manager.saveState();
  assert.equal(fs.existsSync(path.join(directory, 'state.json')), true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, 'state.json')).mode & 0o777, 0o600);
  const stored = JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8'));
  const loaded = manager.loadState();
  assert.equal(stored.ai_api_key, 'secret-key');
  assert.equal(loaded.ai_api_key, 'secret-key');
  assert.equal(loaded.ai_url, 'https://api.example.com/v1');
  assert.equal(loaded.ai_model, 'chat-model');
});

test('HTTP server serves UI and persists settings without exposing the key', async (context) => {
  const originalPath = manager.getStatePath();
  const originalState = structuredClone(manager.STATE);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-manager-http-'));
  manager.setStatePath(path.join(directory, 'state.json'));
  const server = manager.startServer(0);
  await once(server, 'listening');
  const port = server.address().port;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    manager.setStatePath(originalPath);
    Object.assign(manager.STATE, originalState);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const html = await fetch(`${base}/`);
  assert.equal(html.status, 200);
  const htmlText = await html.text();
  assert.match(htmlText, /OpenAI-compatible base URL/);
  assert.doesNotMatch(htmlText, /name="current_profile"|name="profile_notes"/);
  const settings = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interval_hours: 12, ai_url: 'https://api.example.com/v1', ai_model: 'chat-model', ai_api_key: 'private-test-key' }),
  });
  assert.equal(settings.status, 200);
  const publicData = await settings.json();
  assert.equal(publicData.ai_api_key_configured, true);
  assert.equal('ai_api_key' in publicData, false);
  assert.equal(JSON.stringify(publicData).includes('private-test-key'), false);
  assert.equal(manager.loadState().ai_api_key, 'private-test-key');
});

test('adding a bot only needs its name and MCP port and reads profiles from MCP', async (context) => {
  const originalPath = manager.getStatePath();
  const originalState = structuredClone(manager.STATE);
  Object.assign(manager.STATE, { bots: [], interval_hours: 8, ai_url: '', ai_model: '', ai_api_key: '' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-manager-add-'));
  manager.setStatePath(path.join(directory, 'state.json'));
  const mcp = createFakeMcpServer();
  mcp.listen(0, '127.0.0.1');
  await once(mcp, 'listening');
  const server = manager.startServer(0);
  await once(server, 'listening');
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mcp.close(resolve));
    manager.setStatePath(originalPath);
    Object.assign(manager.STATE, originalState);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const created = await fetch(`http://127.0.0.1:${server.address().port}/api/bots`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Main Account', url: `http://127.0.0.1:${mcp.address().port}/mcp` }),
  });
  assert.equal(created.status, 201);
  const { bot } = await created.json();
  assert.equal(bot.name, 'Main Account');
  assert.equal(bot.applied_profile, '');
  assert.equal('current_profile' in bot, false);
  assert.equal('profile_notes' in bot, false);
  assert.deepEqual(bot.profiles, ['config', 'doors', 'palladium']);
  assert.deepEqual(bot.last_result.profiles, ['config', 'doors', 'palladium']);
  const publicState = await (await fetch(`http://127.0.0.1:${server.address().port}/api/state`)).json();
  assert.equal(JSON.stringify(publicState).includes('current_profile'), false);
});

test('review without a user-declared current profile applies the profile backed by live MCP data', async (context) => {
  const realFetch = global.fetch;
  const originalPath = manager.getStatePath();
  const originalState = structuredClone(manager.STATE);
  Object.assign(manager.STATE, { bots: [], interval_hours: 8, ai_url: 'https://api.example.com/v1', ai_model: 'chat-model', ai_api_key: '' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-manager-review-'));
  manager.setStatePath(path.join(directory, 'state.json'));
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.example.com')) {
      return response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: 'use_profile', profile: 'doors', confidence: 0.7, summary: 'Convert the event into doors' }) } }] }));
    }
    return realFetch(url, options);
  };
  const mcp = createFakeMcpServer();
  mcp.listen(0, '127.0.0.1');
  await once(mcp, 'listening');
  const server = manager.startServer(0);
  await once(server, 'listening');
  context.after(async () => {
    global.fetch = realFetch;
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mcp.close(resolve));
    manager.setStatePath(originalPath);
    Object.assign(manager.STATE, originalState);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = await fetch(`${base}/api/bots`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Main Account', url: `http://127.0.0.1:${mcp.address().port}/mcp` }),
  });
  assert.equal(created.status, 201);
  const { bot } = await created.json();
  const review = await fetch(`${base}/api/bots/${bot.id}/review`, { method: 'POST', body: '{}' });
  assert.equal(review.status, 202);
  let reviewed;
  for (let attempt = 0; attempt < 100 && !reviewed; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const state = await (await fetch(`${base}/api/state`)).json();
    const current = state.bots.find((item) => item.id === bot.id);
    if (current?.last_result?.outcome) reviewed = current;
  }
  assert.ok(reviewed, 'the review should have completed');
  assert.equal(reviewed.applied_profile, 'doors');
  assert.match(reviewed.last_result.outcome, /Profile activated: doors/);
  assert.equal(reviewed.last_result.recommendation.action, 'use_profile');
});

test('MCP Streamable HTTP initialize/resources/tools work against fake server', async (context) => {
  const server = createFakeMcpServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const client = new manager.McpClient(`http://127.0.0.1:${server.address().port}/mcp`);
  await client.connect();
  assert.deepEqual((await client.readResource('bot://profiles')).profiles, ['config', 'doors', 'palladium']);
  assert.equal((await client.tools())[0].name, 'set_profile');
});
