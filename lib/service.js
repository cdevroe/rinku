const fs = require('fs').promises;
const path = require('path');
const Ajv = require('ajv');
const library = require('./library');
const { importUnmarkExport } = require('./importers');

const OPERATIONS = [
  {
    name: 'rinku_get_config',
    description: 'Return active Rinku service configuration.',
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
        libraryRoot: { type: 'string', minLength: 1, pattern: '\\S' },
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
        libraryRoot: { type: 'string', minLength: 1, pattern: '\\S' },
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
        libraryRoot: { type: 'string', minLength: 1, pattern: '\\S' },
        status: { type: 'string', enum: ['active', 'archived', 'all'] },
        label: { type: 'string' },
        tag: { type: 'string' },
        context: { type: 'string' },
        search: { type: 'string' },
        olderThanDays: { type: 'number', minimum: 0 },
        limit: { type: 'integer', minimum: 1 },
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
        libraryRoot: { type: 'string', minLength: 1, pattern: '\\S' },
        ref: { type: 'string', minLength: 1, pattern: '\\S' },
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
        libraryRoot: { type: 'string', minLength: 1, pattern: '\\S' },
        url: { type: 'string', minLength: 1, pattern: '\\S' },
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
        libraryRoot: { type: 'string', minLength: 1, pattern: '\\S' },
        ref: { type: 'string', minLength: 1, pattern: '\\S' },
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
        libraryRoot: { type: 'string', minLength: 1, pattern: '\\S' },
        ref: { type: 'string', minLength: 1, pattern: '\\S' },
      },
    },
  },
  {
    name: 'rinku_restore_link',
    description: 'Restore an archived link to active links. Write mode only.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['libraryRoot', 'ref'],
      properties: { libraryRoot: { type: 'string', minLength: 1, pattern: '\\S' }, ref: { type: 'string', minLength: 1, pattern: '\\S' } },
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
        libraryRoot: { type: 'string', minLength: 1, pattern: '\\S' },
        sourcePath: { type: 'string', minLength: 1, pattern: '\\S' },
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
        libraryRoot: { type: 'string', minLength: 1, pattern: '\\S' },
      },
    },
  },
];

const READ_OPERATIONS = new Set([
  'rinku_get_config', 'rinku_list_libraries', 'rinku_read_settings',
  'rinku_list_links', 'rinku_read_link',
]);
const ajv = new Ajv({ allErrors: true });
const validators = new Map(OPERATIONS.map((operation) => [operation.name, ajv.compile(operation.inputSchema)]));

class ServiceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function createConfig(env = process.env, prefix = 'RINKU_MCP') {
  const mode = String(env[`${prefix}_READ_ONLY`] || 'true').trim().toLowerCase();
  return {
    readOnly: !['false', '0', 'no'].includes(mode),
    allowedRoots: String(env[`${prefix}_ALLOWED_ROOTS`] || '')
      .split(path.delimiter).map((root) => root.trim()).filter(Boolean).map((root) => path.resolve(root)),
    toolCount: OPERATIONS.length,
  };
}

function normalizeOperationName(name) {
  return String(name || '').trim().replace(/^rinku\./, 'rinku_');
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// Resolve existing ancestors too, so a new library cannot be created through a symlink escape.
async function canonicalPath(target) {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(target);
    if (parent === target) throw error;
    return path.join(await canonicalPath(parent), path.basename(target));
  }
}

async function assertAllowedPath(target, config) {
  if (typeof target !== 'string' || !target.trim()) {
    throw new ServiceError('invalid_arguments', 'A nonempty path is required.');
  }
  const resolved = await canonicalPath(path.resolve(target));
  const roots = await Promise.all(config.allowedRoots.map((root) => canonicalPath(path.resolve(root))));
  if (!roots.some((root) => isPathInside(root, resolved))) {
    throw new ServiceError('forbidden', `Path is outside Rinku ${config.transport || 'MCP'} allowed roots: ${target}`, 403);
  }
  return resolved;
}

async function assertStorageTree(libraryRoot) {
  async function check(target) {
    let stat;
    try { stat = await fs.lstat(target); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new ServiceError('forbidden', `Symlinks are not supported in library storage: ${target}`, 403);
    }
    if (stat.isDirectory()) {
      for (const entry of await fs.readdir(target)) await check(path.join(target, entry));
    }
  }
  for (const name of ['rinku-settings.md', 'links', 'archive', '.rinku']) {
    await check(path.join(libraryRoot, name));
  }
}

async function pathLooksLikeLibrary(root) {
  try {
    return (await fs.lstat(path.join(root, 'rinku-settings.md'))).isFile();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function listLibraries(config) {
  const libraries = [];
  const seen = new Set();
  for (const configuredRoot of config.allowedRoots) {
    const root = await assertAllowedPath(configuredRoot, config);
    const candidates = [{ libraryRoot: root, source: 'allowed-root' }];
    if (!await pathLooksLikeLibrary(root)) {
      let entries;
      try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      candidates.length = 0;
      for (const entry of entries.filter((entry) => entry.isDirectory())) {
        candidates.push({ libraryRoot: path.join(root, entry.name), source: 'allowed-root-child' });
      }
    }
    for (const candidate of candidates) {
      if (!seen.has(candidate.libraryRoot) && await pathLooksLikeLibrary(candidate.libraryRoot)) {
        seen.add(candidate.libraryRoot);
        libraries.push(candidate);
      }
    }
  }
  return libraries;
}

function assertHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch {
    throw new ServiceError('invalid_arguments', 'A valid HTTP or HTTPS URL is required.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ServiceError('invalid_arguments', 'Only HTTP and HTTPS URLs are supported.');
  }
}

function normalizeError(error) {
  if (error instanceof ServiceError) return error;
  const message = error.message || String(error);
  if (message.startsWith('Link not found:') || error.code === 'ENOENT') {
    return new ServiceError('not_found', message, 404);
  }
  if (message.startsWith('Link reference is ambiguous:') || message.includes('already exists')) {
    return new ServiceError('conflict', message, 409);
  }
  if (message.startsWith('Invalid Unmark export:') || message.startsWith('Invalid JSON export:')) {
    return new ServiceError('invalid_arguments', message);
  }
  return new ServiceError('internal_error', message, 500);
}

// Serialize operations within this service so simultaneous API/MCP calls do not lose index updates.
function createService(config = createConfig()) {
  let pending = Promise.resolve();
  async function execute(name, args = {}) {
    const operation = normalizeOperationName(name);
    const validate = validators.get(operation);
    if (!validate) throw new ServiceError('unknown_operation', `Unknown tool: ${name}`, 404);
    if (!validate(args)) {
      throw new ServiceError('invalid_arguments', ajv.errorsText(validate.errors));
    }
    if (!READ_OPERATIONS.has(operation) && config.readOnly) {
      throw new ServiceError('read_only', 'Rinku is running in read-only mode.', 403);
    }
    if (operation === 'rinku_get_config') return { ...config, toolCount: OPERATIONS.length };
    if (operation === 'rinku_list_libraries') return { libraries: await listLibraries(config) };
    const libraryRoot = await assertAllowedPath(args.libraryRoot, config);
    await assertStorageTree(libraryRoot);
    if (operation === 'rinku_create_library') return library.createLibrary(libraryRoot);
    if (!await pathLooksLikeLibrary(libraryRoot)) {
      throw new ServiceError('not_found', 'No Rinku library exists at this path.', 404);
    }
    if (operation === 'rinku_read_settings') return library.readSettings(libraryRoot, { ensureFile: false });
    if (operation === 'rinku_list_links') {
      return library.listLinks(libraryRoot, {
        ...args, status: args.status === 'all' ? undefined : args.status,
        rebuild: true, readOnly: true,
      });
    }
    if (operation === 'rinku_read_link') {
      return library.readLink(libraryRoot, args.ref, { rebuild: true, readOnly: true });
    }
    if (operation === 'rinku_create_link') {
      assertHttpUrl(args.url);
      const { libraryRoot: ignored, ...input } = args;
      // Automated saves do not fetch remote pages implicitly.
      return (await library.createLink(libraryRoot, input, { learnRule: Boolean(args.label), fetchTitle: false })).link;
    }
    let sourcePath;
    if (operation === 'rinku_import_unmark') sourcePath = await assertAllowedPath(args.sourcePath, config);
    // Ignore cached file paths before operations that locate and modify links.
    await library.rebuildIndex(libraryRoot);
    switch (operation) {
      case 'rinku_update_link': {
        const { libraryRoot: ignored, ref, ...patch } = args;
        return library.updateLink(libraryRoot, ref, patch, { learnRule: args.label != null });
      }
      case 'rinku_archive_link': return library.archiveLink(libraryRoot, args.ref);
      case 'rinku_restore_link': return library.restoreLink(libraryRoot, args.ref);
      case 'rinku_import_unmark': return importUnmarkExport(libraryRoot, sourcePath);
      case 'rinku_rebuild_index': return library.readIndex(libraryRoot);
      default: throw new ServiceError('unknown_operation', `Unknown tool: ${name}`, 404);
    }
  }
  return {
    config,
    execute(name, args) {
      const task = pending.then(() => execute(name, args)).catch((error) => { throw normalizeError(error); });
      pending = task.catch(() => {});
      return task;
    },
  };
}

module.exports = { OPERATIONS, READ_OPERATIONS, ServiceError, createConfig, createService, normalizeOperationName };
