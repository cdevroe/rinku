const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { callTool } = require('../lib/mcpServer');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { EmptyResultSchema } = require('@modelcontextprotocol/sdk/types.js');

function parseToolResult(result) {
  assert(result && Array.isArray(result.content), 'tool result should contain content');
  return JSON.parse(result.content[0].text);
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-mcp-'));
  const libraryRoot = path.join(root, 'Library');
  const writableConfig = {
    readOnly: false,
    allowedRoots: [root],
    toolCount: 1,
  };
  const readOnlyConfig = {
    ...writableConfig,
    readOnly: true,
  };

  try {
    let result = parseToolResult(await callTool('rinku_create_library', { libraryRoot }, writableConfig));
    assert.strictEqual(result.ok, true);

    result = parseToolResult(await callTool('rinku_create_link', {
      libraryRoot,
      url: 'https://example.com/mcp',
      title: 'MCP Link',
      label: 'Read',
      contexts: ['@Work'],
    }, writableConfig));
    assert.strictEqual(result.label, 'read');
    assert.deepStrictEqual(result.contexts, ['@Work']);

    result = parseToolResult(await callTool('rinku_list_links', { libraryRoot, status: 'active' }, readOnlyConfig));
    assert.strictEqual(result.links.length, 1);

    await assert.rejects(
      () => callTool('rinku_archive_link', { libraryRoot, ref: result.links[0].id }, readOnlyConfig),
      /read-only/
    );

    await assert.rejects(
      () => callTool('rinku_list_links', { libraryRoot: path.join(os.tmpdir(), 'outside') }, readOnlyConfig),
      /outside Rinku MCP allowed roots/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function runTransport() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-mcp-stdio-'));
  const libraryRoot = path.join(root, 'Library');
  const clients = [];
  async function connect(args, readOnly) {
    const transport = new StdioClientTransport({
      command: process.execPath, args, stderr: 'pipe',
      env: { RINKU_MCP_ALLOWED_ROOTS: root, RINKU_MCP_READ_ONLY: String(readOnly) },
    });
    const client = new Client({ name: 'rinku-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(transport);
    return client;
  }
  try {
    const client = await connect([path.resolve(__dirname, '../bin/rinku.js'), 'mcp', 'serve'], false);
    assert.strictEqual(client.getServerVersion().name, 'rinku-mcp');
    await client.ping();
    const { tools } = await client.listTools();
    assert(tools.some((tool) => tool.name === 'rinku_restore_link'));
    assert.strictEqual(tools.find((tool) => tool.name === 'rinku_list_links').annotations.readOnlyHint, true);
    const call = (name, args = {}) => client.callTool({ name, arguments: args });
    assert.strictEqual(parseToolResult(await call('rinku_create_library', { libraryRoot })).ok, true);
    const createdResult = await call('rinku_create_link', {
      libraryRoot, url: 'https://example.com/stdio', title: 'Stdio Link', tags: ['MCP'], body: 'notes',
    });
    const created = parseToolResult(createdResult);
    assert.strictEqual(createdResult.structuredContent.id, created.id);
    assert.strictEqual(parseToolResult(await call('rinku_read_link', { libraryRoot, ref: created.id })).body, 'notes');
    assert.strictEqual(parseToolResult(await call('rinku_update_link', { libraryRoot, ref: created.id, title: 'Updated' })).title, 'Updated');
    assert.strictEqual(parseToolResult(await call('rinku_archive_link', { libraryRoot, ref: created.id })).status, 'archived');
    assert.strictEqual(parseToolResult(await call('rinku_list_links', { libraryRoot, status: 'all' })).total, 1);
    assert.strictEqual(parseToolResult(await call('rinku.restore_link', { libraryRoot, ref: created.id })).status, 'active');
    assert.strictEqual((await call('rinku_list_links', { libraryRoot, status: 'invalid' })).isError, true);
    assert.strictEqual((await call('rinku_update_link', { libraryRoot, ref: created.id, status: 'archived' })).isError, true);
    assert.strictEqual((await call('rinku_create_link', { libraryRoot, url: 'file:///tmp/secret' })).isError, true);
    await assert.rejects(() => call('unknown_tool'), /Unknown tool/);
    await assert.rejects(() => client.request({ method: 'unknown/method' }, EmptyResultSchema), /Method not found/);

    // Exercise the original main.js entry point and read-only error reporting on the wire.
    const readonly = await connect([path.resolve(__dirname, '../main.js'), '--mcp-server'], true);
    const result = await readonly.callTool({ name: 'rinku_create_link', arguments: { libraryRoot, url: 'https://example.com/blocked' } });
    assert.strictEqual(result.isError, true);
    assert.match(result.content[0].text, /read-only/);
    assert.strictEqual(parseToolResult(await readonly.callTool({ name: 'rinku_list_links', arguments: { libraryRoot } })).total, 1);
    await readonly.ping();
  } finally {
    for (const client of clients) await client.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().then(runTransport).then(() => {
  console.log('test-mcp passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});

