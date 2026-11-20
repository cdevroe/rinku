const fs = require('fs').promises;
const path = require('path');
const Ajv = require('ajv');
const library = require('./library');
const { importUnmarkExport } = require('./importers');
const cleanup = require('./cleanup');
const { runtimeInfo } = require('./runtimeInfo');

const cleanupRoot = { type: 'string', minLength: 1, pattern: '\\S' };
const cleanupRecord = { type: 'object', additionalProperties: false, required: ['id'], properties: {
  id: { type: 'string', minLength: 1, pattern: '\\S' },
  revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
} };
const cleanupPolicy = { type: 'string', enum: ['exact', 'trailing-slash'], description: 'exact compares literal URLs. trailing-slash ignores one final pathname slash only; query strings and fragments remain significant.' };

const OPERATIONS = [
  {
    name: 'rinku_update_links',
    description: 'Batch-update up to 500 bookmarks by exact stable ID with one final index rebuild. Each record has a patch of title/label/tags/contexts/body; arrays replace existing values, empty arrays/text clear them, omitted fields are preserved. Optional revisions from read_link/duplicate preview reject stale edits. Unknown labels are conflicts; no smart-label rules are learned. Returns per-record outcomes and recovery backups; inspect partial failures. Write mode only.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['libraryRoot', 'records'], properties: {
      libraryRoot: cleanupRoot, records: { type: 'array', minItems: 1, maxItems: 500, items: {
        ...cleanupRecord, required: ['id', 'patch'], properties: { ...cleanupRecord.properties,
          patch: { type: 'object', additionalProperties: false, minProperties: 1, properties: {
            title: { type: 'string' }, label: { type: 'string', minLength: 1 },
            tags: { type: 'array', items: { type: 'string' } }, contexts: { type: 'array', items: { type: 'string' } }, body: { type: 'string' },
          } },
        },
      } },
    } },
  },
  {
    name: 'rinku_list_recovery',
    description: 'Read-only list of cleanup receipts and recovery items, including interrupted batches. recoverable means the removed Markdown file still exists. Use batchId/itemId with rinku_recover_deleted_link. No files are modified.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['libraryRoot'], properties: { libraryRoot: cleanupRoot } },
  },
  {
    name: 'rinku_delete_links',
    description: 'Recoverably delete active or archived bookmarks by exact stable IDs, not references. Moves Markdown into .rinku/recovery outside indexed links/archive; no permanent deletion. Optional revisions reject stale edits. Returns per-record outcomes and recovery identifiers; missing IDs return not_found. Write mode only. Use for explicitly authorized deletion without an extra confirmation call. One index rebuild per batch.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['libraryRoot', 'records'], properties: {
      libraryRoot: cleanupRoot, records: { type: 'array', minItems: 1, maxItems: 500, items: cleanupRecord },
    } },
  },
  {
    name: 'rinku_preview_duplicates',
    description: 'Read-only duplicate candidates across active and archived bookmarks under an explicit URL matching policy. Includes exact IDs, URLs, createdAt, state, metadata/notes/source differences and revisions for merge. Oldest createdAt wins, then case-sensitive ID order. Preview is not authorization to merge.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['libraryRoot', 'policy'], properties: {
      libraryRoot: cleanupRoot, policy: cleanupPolicy,
    } },
  },
  {
    name: 'rinku_merge_links',
    description: 'Merge explicitly selected duplicate groups using revisions from preview. Keep oldest createdAt (tie: case-sensitive ID order), its URL/title/label/archive state; union tags/contexts and distinct notes. Preserve every original Markdown record and source history in survivor.mergeHistory and recovery backups. Verify survivor before recoverably deleting others. Returns conflicts/partial outcomes; re-preview after changes. One index rebuild per batch. Write mode only; execute authorized cleanup without extra confirmation.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['libraryRoot', 'policy', 'groups'], properties: {
      libraryRoot: cleanupRoot, policy: cleanupPolicy,
      groups: { type: 'array', minItems: 1, maxItems: 250, items: {
        type: 'object', additionalProperties: false, required: ['records'], properties: {
          records: { type: 'array', minItems: 2, maxItems: 500, items: { ...cleanupRecord, required: ['id', 'revision'] } },
        },
      } },
    } },
  },
  {
    name: 'rinku_recover_deleted_link',
    description: 'Restore a deleted bookmark using its batchId/itemId recovery receipt. Refuses existing IDs or destination files; keeps recovery bytes. Also works for redundant records removed by merge, but does not undo the merged survivor. Write mode only.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['libraryRoot', 'batchId', 'itemId'], properties: {
      libraryRoot: cleanupRoot,
      batchId: { type: 'string', pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' },
      itemId: { type: 'string', pattern: '^(0|[1-9][0-9]*)$' },
    } },
  },
  {
    name: 'rinku_get_config',
    description: 'Return active service permissions and the running process identity: version, source/build fingerprint, commit, executable/app paths, runtime versions and start time. Reconnect MCP after installing a new build; existing processes retain their startup identity.',
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
    description: 'Save a link or return its existing record without changing its metadata. Set fetchTitle to true to fetch the page title when no title is supplied. The result includes a duplicate flag. Write mode only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['libraryRoot', 'url'],
      properties: {
        libraryRoot: { type: 'string', minLength: 1, pattern: '\\S' },
        url: { type: 'string', minLength: 1, pattern: '\\S' },
        fetchTitle: { type: 'boolean', default: false, description: 'Fetch the remote page title if title is omitted. Falls back to the URL on failure.' },
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
  'rinku_preview_duplicates',
  'rinku_list_recovery',
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
  if (error.code === 'conflict') return new ServiceError('conflict', message, 409);
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
    if (operation === 'rinku_get_config') return { ...config, toolCount: OPERATIONS.length, runtime: runtimeInfo };
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
      return cleanup.readWithRevision(libraryRoot, args.ref);
    }
    if (operation === 'rinku_update_links') return cleanup.executeBatch(libraryRoot, 'update', args.records);
    if (operation === 'rinku_preview_duplicates') return cleanup.previewDuplicates(libraryRoot, args.policy);
    if (operation === 'rinku_list_recovery') return cleanup.listRecovery(libraryRoot);
    if (operation === 'rinku_delete_links') return cleanup.executeBatch(libraryRoot, 'delete', args.records);
    if (operation === 'rinku_merge_links') return cleanup.executeBatch(libraryRoot, 'merge', args.groups, args.policy);
    if (operation === 'rinku_recover_deleted_link') return cleanup.recoverDeleted(libraryRoot, args.batchId, args.itemId);
    if (operation === 'rinku_create_link') {
      assertHttpUrl(args.url);
      const { libraryRoot: ignored, fetchTitle, ...input } = args;
      const result = await library.createLink(libraryRoot, input, {
        learnRule: Boolean(args.label), fetchTitle: fetchTitle === true,
      });
      return { ...result.link, duplicate: result.duplicate };
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
