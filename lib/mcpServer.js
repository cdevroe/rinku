const fs = require('fs').promises;
const path = require('path');
const {
  archiveLink,
  createLibrary,
  createLink,
  listLinks,
  readLink,
  readSettings,
  rebuildIndex,
  updateLink,
} = require('./library');
const { importUnmarkExport } = require('./importers');

const TOOL_DEFINITIONS = [
  {
    name: 'rinku_get_config',
    description: 'Return active Rinku MCP server configuration.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'rinku_list_libraries',
    description: 'List Rinku libraries found directly under allowed roots.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'rinku_create_library',
    description: 'Create a Rinku library inside an allowed root. Write mode only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['libraryRoot'],
      properties: {
        libraryRoot: { type: 'string' },
      },
    },
  },
  {
    name: 'rinku_read_settings',
    description: 'Read rinku-settings.md for a library.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['libraryRoot'],
      properties: {
        libraryRoot: { type: 'string' },
      },
    },
  },
  {
    name: 'rinku_list_links',
    description: 'List indexed links with optional filters.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['libraryRoot'],
      properties: {
        libraryRoot: { type: 'string' },
        status: { type: 'string' },
        label: { type: 'string' },
        tag: { type: 'string' },
        context: { type: 'string' },
        search: { type: 'string' },
        olderThanDays: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'rinku_read_link',
    description: 'Read one link Markdown file by id, filename, title, or URL.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['libraryRoot', 'ref'],
      properties: {
        libraryRoot: { type: 'string' },
        ref: { type: 'string' },
      },
    },
  },
  {
    name: 'rinku_create_link',
    description: 'Create a link in a library. Write mode only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['libraryRoot', 'url'],
      properties: {
        libraryRoot: { type: 'string' },
        url: { type: 'string' },
        title: { type: 'string' },
        label: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        contexts: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
      },
    },
  },
  {
    name: 'rinku_update_link',
    description: 'Update link metadata/body. Write mode only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['libraryRoot', 'ref'],
      properties: {
        libraryRoot: { type: 'string' },
        ref: { type: 'string' },
        title: { type: 'string' },
        label: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        contexts: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
      },
    },
  },
  {
    name: 'rinku_archive_link',
    description: 'Move a link to the archive directory. Write mode only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['libraryRoot', 'ref'],
      properties: {
        libraryRoot: { type: 'string' },
        ref: { type: 'string' },
      },
    },
  },
  {
    name: 'rinku_import_unmark',
    description: 'Import an Unmark JSON export into a Rinku library. Write mode only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['libraryRoot', 'sourcePath'],
      properties: {
        libraryRoot: { type: 'string' },
        sourcePath: { type: 'string' },
      },
    },
  },
  {
    name: 'rinku_rebuild_index',
    description: 'Rebuild the library index. Write mode only because it updates .rinku/index.json.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['libraryRoot'],
      properties: {
        libraryRoot: { type: 'string' },
      },
    },
  },
];

function isReadOnly(env = process.env) {
  const value = String(env.RINKU_MCP_READ_ONLY || 'true').trim().toLowerCase();
  return !(value === 'false' || value === '0' || value === 'no');
}

function getAllowedRoots(env = process.env) {
  return String(env.RINKU_MCP_ALLOWED_ROOTS || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(String(parentPath || ''));
  const child = path.resolve(String(childPath || ''));
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertAllowedPath(targetPath, config) {
  const resolved = path.resolve(String(targetPath || ''));
  if (!resolved) {
    throw new Error('Path is required.');
  }

  if (!config.allowedRoots.some((root) => isPathInside(root, resolved))) {
    throw new Error(`Path is outside Rinku MCP allowed roots: ${resolved}`);
  }

  return resolved;
}

function assertWritable(config) {
  if (config.readOnly) {
    throw new Error('Rinku MCP is running in read-only mode.');
  }
}

async function pathLooksLikeLibrary(directoryPath) {
  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return entries.some((entry) => (
      (entry.isFile() && entry.name === 'rinku-settings.md') ||
      (entry.isDirectory() && entry.name === 'links')
    ));
  } catch {
    return false;
  }
}

async function listLibraries(config) {
  const libraries = [];
  const seen = new Set();

  for (const root of config.allowedRoots) {
    if (await pathLooksLikeLibrary(root)) {
      libraries.push({ libraryRoot: root, source: 'allowed-root' });
      seen.add(root);
      continue;
    }

    let entries = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidate = path.join(root, entry.name);
      if (!seen.has(candidate) && await pathLooksLikeLibrary(candidate)) {
        seen.add(candidate);
        libraries.push({ libraryRoot: candidate, source: 'allowed-root-child' });
      }
    }
  }

  return libraries;
}

function toolContent(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function normalizeToolName(name) {
  const normalized = String(name || '').trim();
  if (normalized.startsWith('rinku.')) {
    return `rinku_${normalized.slice('rinku.'.length)}`;
  }
  return normalized;
}

async function callTool(name, args = {}, config) {
  const toolName = normalizeToolName(name);

  switch (toolName) {
    case 'rinku_get_config':
      return toolContent(config);
    case 'rinku_list_libraries':
      return toolContent({ libraries: await listLibraries(config) });
    case 'rinku_create_library': {
      assertWritable(config);
      const libraryRoot = assertAllowedPath(args.libraryRoot, config);
      return toolContent(await createLibrary(libraryRoot, { allowExisting: true }));
    }
    case 'rinku_read_settings': {
      const libraryRoot = assertAllowedPath(args.libraryRoot, config);
      return toolContent(await readSettings(libraryRoot));
    }
    case 'rinku_list_links': {
      const libraryRoot = assertAllowedPath(args.libraryRoot, config);
      return toolContent(await listLinks(libraryRoot, args));
    }
    case 'rinku_read_link': {
      const libraryRoot = assertAllowedPath(args.libraryRoot, config);
      return toolContent(await readLink(libraryRoot, args.ref));
    }
    case 'rinku_create_link': {
      assertWritable(config);
      const libraryRoot = assertAllowedPath(args.libraryRoot, config);
      const result = await createLink(libraryRoot, args, { learnRule: Boolean(args.label) });
      return toolContent(result.link);
    }
    case 'rinku_update_link': {
      assertWritable(config);
      const libraryRoot = assertAllowedPath(args.libraryRoot, config);
      return toolContent(await updateLink(libraryRoot, args.ref, args, { learnRule: args.label != null }));
    }
    case 'rinku_archive_link': {
      assertWritable(config);
      const libraryRoot = assertAllowedPath(args.libraryRoot, config);
      return toolContent(await archiveLink(libraryRoot, args.ref));
    }
    case 'rinku_import_unmark': {
      assertWritable(config);
      const libraryRoot = assertAllowedPath(args.libraryRoot, config);
      const sourcePath = assertAllowedPath(args.sourcePath, config);
      return toolContent(await importUnmarkExport(libraryRoot, sourcePath));
    }
    case 'rinku_rebuild_index': {
      assertWritable(config);
      const libraryRoot = assertAllowedPath(args.libraryRoot, config);
      return toolContent(await rebuildIndex(libraryRoot));
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function createConfig() {
  return {
    readOnly: isReadOnly(),
    allowedRoots: getAllowedRoots(),
    toolCount: TOOL_DEFINITIONS.length,
  };
}

function writeJsonRpcMessage(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

async function handleJsonRpcMessage(message, config) {
  if (!message || typeof message !== 'object') {
    return;
  }

  const id = message.id;
  try {
    if (message.method === 'initialize') {
      writeJsonRpcMessage({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'rinku-mcp', version: '0.1.0' },
        },
      });
      return;
    }

    if (message.method === 'tools/list') {
      writeJsonRpcMessage({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOL_DEFINITIONS },
      });
      return;
    }

    if (message.method === 'tools/call') {
      const params = message.params || {};
      const result = await callTool(params.name, params.arguments || {}, config);
      writeJsonRpcMessage({ jsonrpc: '2.0', id, result });
      return;
    }

    if (id != null) {
      writeJsonRpcMessage({ jsonrpc: '2.0', id, result: {} });
    }
  } catch (error) {
    writeJsonRpcMessage({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: error.message,
      },
    });
  }
}

function createMessageParser(onMessage) {
  let buffer = Buffer.alloc(0);

  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length > 0) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd >= 0) {
        const header = buffer.slice(0, headerEnd).toString('utf8');
        const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
        if (!lengthMatch) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }
        const length = Number(lengthMatch[1]);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + length;
        if (buffer.length < bodyEnd) {
          return;
        }
        const body = buffer.slice(bodyStart, bodyEnd).toString('utf8');
        buffer = buffer.slice(bodyEnd);
        onMessage(JSON.parse(body));
        continue;
      }

      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }
      const line = buffer.slice(0, newlineIndex).toString('utf8').trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        onMessage(JSON.parse(line));
      }
    }
  };
}

async function startMcpServer() {
  const config = createConfig();
  const parser = createMessageParser((message) => {
    handleJsonRpcMessage(message, config).catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
    });
  });

  process.stdin.on('data', parser);
  process.stdin.resume();
}

module.exports = {
  TOOL_DEFINITIONS,
  callTool,
  createConfig,
  startMcpServer,
};

