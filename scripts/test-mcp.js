const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { callTool } = require('../lib/mcpServer');

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

run().then(() => {
  console.log('test-mcp passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});

