const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const http = require('http');
const { callTool } = require('../lib/mcpServer');
const { createMcpClientConfig } = require('../lib/mcpClientConfig');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { EmptyResultSchema } = require('@modelcontextprotocol/sdk/types.js');

function parseToolResult(result) {
  assert(result && Array.isArray(result.content), 'tool result should contain content');
  return JSON.parse(result.content[0].text);
}

function testClientConfig() {
  for (const fixture of [
    { platform: 'darwin', executablePath: '/Applications/Rinku.app/Contents/MacOS/Rinku', appPath: '/Applications/Rinku.app/Contents/Resources/app.asar', libraryRoot: '/Users/test/My Library' },
    { platform: 'win32', executablePath: 'C:\\Users\\Test\\AppData\\Local\\Programs\\Rinku\\Rinku.exe', appPath: 'C:\\Users\\Test\\AppData\\Local\\Programs\\Rinku\\resources\\app.asar', libraryRoot: 'C:\\Users\\Test\\My Library' },
    { platform: 'linux', executablePath: '/opt/Rinku/rinku', appPath: '/opt/Rinku/resources/app.asar', libraryRoot: '/home/test/My Library' },
  ]) {
    const config = createMcpClientConfig({ ...fixture, isPackaged: true }).mcpServers.rinku;
    assert.strictEqual(config.command, fixture.executablePath);
    assert.strictEqual(config.env.ELECTRON_RUN_AS_NODE, '1');
    assert.strictEqual(config.env.RINKU_MCP_ALLOWED_ROOTS, fixture.libraryRoot);
    assert.strictEqual(config.env.RINKU_MCP_READ_ONLY, 'true');
    assert.deepStrictEqual(config.args.slice(1), ['mcp', 'serve']);
    assert(config.args[0].startsWith(fixture.appPath));
    assert.strictEqual(JSON.parse(JSON.stringify(config)).command, fixture.executablePath);
    assert.strictEqual(createMcpClientConfig({ ...fixture, allowWrites: true }).mcpServers.rinku.env.RINKU_MCP_READ_ONLY, 'false');
  }
  const appImageOptions = { platform: 'linux', isPackaged: true, executablePath: '/tmp/.mount_old/rinku', appPath: '/tmp/.mount_old/resources/app.asar', appImage: '/home/test/Apps/Rinku.AppImage', libraryRoot: '/home/test/Library' };
  const appImage = createMcpClientConfig(appImageOptions).mcpServers.rinku;
  assert.strictEqual(appImage.command, appImageOptions.appImage);
  assert(!JSON.stringify(appImage).includes('.mount_old'), 'AppImage configuration must survive remounts');
  assert.strictEqual(appImage.args[0], '-e');
  assert(appImage.args[1].includes('process.env.APPDIR'));
  assert.deepStrictEqual(appImage.args.slice(2), ['--', '--no-sandbox'], 'keep AppRun Chromium flags out of Node options');
  const development = createMcpClientConfig({ ...appImageOptions, isPackaged: false }).mcpServers.rinku;
  assert.strictEqual(development.command, appImageOptions.executablePath, 'development must ignore inherited APPIMAGE');
  assert.throws(() => createMcpClientConfig({ ...appImageOptions, libraryRoot: '' }), /Open a library/);
  assert.throws(() => createMcpClientConfig({ ...appImageOptions, libraryRoot: 'relative' }), /absolute/);
  assert.throws(() => createMcpClientConfig({ ...appImageOptions, libraryRoot: '/home/test/Library:Private' }), /path containing/);
  assert.throws(() => createMcpClientConfig({ ...appImageOptions, platform: 'win32', libraryRoot: 'C:\\Library;Private' }), /path containing/);
}

async function run() {
  testClientConfig();
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
  let pageRequests = 0;
  const contentServer = http.createServer((_request, response) => {
    pageRequests += 1;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<title>Fetched through MCP &amp; API</title>');
  });
  await new Promise((resolve, reject) => {
    contentServer.once('error', reject);
    contentServer.listen(0, '127.0.0.1', resolve);
  });
  const pageUrl = `http://127.0.0.1:${contentServer.address().port}`;
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

    const noFetch = parseToolResult(await call('rinku_create_link', { libraryRoot, url: `${pageUrl}/no-fetch` }));
    assert.strictEqual(noFetch.title, `${pageUrl}/no-fetch`);
    assert.strictEqual(pageRequests, 0, 'Automated saves must explicitly opt into fetching.');
    const fetched = parseToolResult(await call('rinku_create_link', { libraryRoot, url: `${pageUrl}/fetch`, fetchTitle: true }));
    assert.strictEqual(fetched.title, 'Fetched through MCP & API');
    assert.strictEqual(pageRequests, 1);
    const duplicate = parseToolResult(await call('rinku_create_link', { libraryRoot, url: `${pageUrl}/fetch`, fetchTitle: true }));
    assert.strictEqual(duplicate.duplicate, true);
    assert.strictEqual(pageRequests, 1, 'Duplicates must preserve their title without refetching.');
    const explicit = parseToolResult(await call('rinku_create_link', { libraryRoot, url: `${pageUrl}/explicit`, title: 'My title', fetchTitle: true }));
    assert.strictEqual(explicit.title, 'My title');
    assert.strictEqual(pageRequests, 1);
    assert.strictEqual((await call('rinku_create_link', { libraryRoot, url: `${pageUrl}/invalid`, fetchTitle: 'yes' })).isError, true);
    const deniedFetch = await readonly.callTool({ name: 'rinku_create_link', arguments: { libraryRoot, url: `${pageUrl}/blocked`, fetchTitle: true } });
    assert.strictEqual(deniedFetch.isError, true);
    assert.strictEqual(pageRequests, 1, 'Read-only saves must not make a network request.');
  } finally {
    for (const client of clients) await client.close();
    contentServer.closeAllConnections();
    await new Promise(resolve => contentServer.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().then(runTransport).then(() => {
  console.log('test-mcp passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});

