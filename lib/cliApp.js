const path = require('path');
const fs = require('fs').promises;
const { createService, ServiceError } = require('./service');
const { errorResult, outcome } = require('./operationResult');
const {
  archiveLink,
  createLibrary,
  createLink,
  listLinks,
  readLink,
  readSettings,
  rebuildIndex,
  restoreLink,
  updateLink,
} = require('./library');
const { importUnmarkExport } = require('./importers');
const {
  getCurrentLibrary,
  setCurrentLibrary,
} = require('./cliState');

function parseArgv(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      options.version = true;
      continue;
    }

    if (arg.startsWith('--')) {
      const equalIndex = arg.indexOf('=');
      let key = arg.slice(2);
      let value = true;

      if (equalIndex >= 0) {
        key = arg.slice(2, equalIndex);
        value = arg.slice(equalIndex + 1);
      } else if (argv[index + 1] != null && !argv[index + 1].startsWith('--')) {
        value = argv[index + 1];
        index += 1;
      }

      if (Object.prototype.hasOwnProperty.call(options, key)) {
        if (!Array.isArray(options[key])) {
          options[key] = [options[key]];
        }
        options[key].push(value);
      } else {
        options[key] = value;
      }
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, options };
}

function getOption(options, key, fallback = undefined) {
  const value = options[key];
  if (Array.isArray(value)) {
    return value[value.length - 1];
  }
  return value === undefined ? fallback : value;
}

function getOptionList(options, key) {
  const value = options[key];
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function parseOlderThanDays(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return undefined;
  }

  const match = raw.match(/^(\d+)(d|day|days)?$/);
  if (!match) {
    throw new ServiceError('invalid_arguments', `Unsupported --older-than value: ${value}`);
  }

  return Number(match[1]);
}

async function resolveLibraryRoot(options) {
  const explicit = getOption(options, 'library') || getOption(options, 'library-root');
  if (explicit) {
    return path.resolve(String(explicit));
  }

  const current = await getCurrentLibrary();
  if (!current) {
    throw new ServiceError('invalid_arguments', 'No library selected. Use `rinku use <library-root>` or pass `--library <path>`.');
  }

  return current;
}

function printJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function batchOutput(value, json) {
  const result = outcome(value);
  if (result.ok === false) {
    const error = new Error(result.error.message);
    error.result = result;
    throw error;
  }
  // Keep receipts visible in human output too; never hide partial results.
  return printJson(result);
}

async function readBatchInput(options) {
  const file = options.file;
  if (typeof file !== 'string' || !file) throw new ServiceError('invalid_arguments', 'A JSON input file is required: --file <path>.');
  try {
    const value = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new ServiceError('invalid_arguments', 'Expected a JSON object.');
    if (Object.hasOwn(value, 'libraryRoot')) throw new ServiceError('invalid_arguments', 'Choose the library with --library, not inside the input file.');
    return value;
  } catch (error) {
    if (error.code) throw error;
    throw new ServiceError('invalid_arguments', `Invalid batch input: ${error.message}`);
  }
}

async function guardedCommand(operation, libraryRoot, args) {
  // CLI invocation explicitly authorizes this selected library. MCP environment
  // permissions apply to MCP, not to a user's direct command-line operation.
  return createService({ readOnly: false, allowedRoots: [libraryRoot], transport: 'CLI' })
    .execute(operation, { ...args, libraryRoot });
}

function renderHelp(commandName = 'rinku') {
  return [
    'Rinku CLI',
    '',
    'Usage:',
    `  ${commandName} api serve [--library <path>] [--port <n>] [--write]`,
    `  ${commandName} mcp serve`,
    `  ${commandName} --version [--json]`,
    `  ${commandName} build-info [--json]`,
    `  ${commandName} use <library-root>`,
    `  ${commandName} libraries create <library-root> [--use] [--allow-existing] [--json]`,
    `  ${commandName} libraries list [--json]`,
    `  ${commandName} links add <url> [--title <title>] [--label <label>] [--tag <tag> ...] [--context <context> ...] [--body <text>] [--json]`,
    `  ${commandName} links list [--status active|archived|all] [--label <label>] [--tag <tag>] [--context <context>] [--search <query>] [--older-than <days>] [--limit <n>] [--json]`,
    `  ${commandName} links read <link-ref> [--json]`,
    `  ${commandName} links update <link-ref> [--title <title>] [--label <label>] [--tag <tag> ...] [--context <context> ...] [--body <text>] [--json]`,
    `  ${commandName} links archive <link-ref> [--json]`,
    `  ${commandName} links restore <link-ref> [--json]`,
    `  ${commandName} links delete <exact-id> [--json]`,
    `  ${commandName} links delete --file <batch.json> [--json]`,
    `  ${commandName} links update-batch --file <batch.json> [--json]`,
    `  ${commandName} links duplicates --policy exact|trailing-slash [--json]`,
    `  ${commandName} links merge --file <batch.json> [--json]`,
    `  ${commandName} recovery list [--json]`,
    `  ${commandName} recovery restore <batch-id> <item-id> [--json]`,
    `  ${commandName} links rebuild-index [--json]`,
    `  ${commandName} import unmark --file <export.json> [--json]`,
    `  ${commandName} settings read [--json]`,
    '',
    'Global options:',
    '  --library <path>       Use a specific library for this command',
    '  --json                 Print machine-readable JSON',
    '',
  ].join('\n');
}

function renderLinkLine(link) {
  const contexts = Array.isArray(link.contexts) && link.contexts.length > 0
    ? ` ${link.contexts.join(',')}`
    : '';
  const tags = Array.isArray(link.tags) && link.tags.length > 0
    ? ` #${link.tags.join(' #')}`
    : '';
  return `${link.id} [${link.status}/${link.label}] ${link.title} <${link.url}>${contexts}${tags}`;
}

async function handleUse(positionals, options) {
  const libraryRoot = positionals[1];
  if (!libraryRoot) {
    const current = await getCurrentLibrary();
    return options.json ? printJson({ currentLibraryRoot: current }) : `${current || 'No library selected.'}\n`;
  }

  const selected = await setCurrentLibrary(libraryRoot);
  return options.json ? printJson({ currentLibraryRoot: selected }) : `Using ${selected}\n`;
}

async function handleLibraries(positionals, options) {
  const subcommand = positionals[1] || 'list';

  if (subcommand === 'create') {
    const target = positionals[2];
    if (!target) {
      throw new ServiceError('invalid_arguments', 'Library root is required.');
    }
    const result = await createLibrary(target, { allowExisting: options['allow-existing'] === true });
    if (options.use === true) {
      await setCurrentLibrary(result.libraryRoot);
    }
    return options.json ? printJson(result) : `Created ${result.libraryRoot}\n`;
  }

  if (subcommand === 'list') {
    const currentLibraryRoot = await getCurrentLibrary();
    const result = { currentLibraryRoot, libraries: currentLibraryRoot ? [{ libraryRoot: currentLibraryRoot, source: 'cli-current' }] : [] };
    if (options.json) {
      return printJson(result);
    }
    if (!currentLibraryRoot) {
      return 'No libraries known yet.\n';
    }
    return `${currentLibraryRoot} (current)\n`;
  }

  throw new ServiceError('invalid_arguments', `Unknown libraries command: ${subcommand}`);
}

async function handleLinks(positionals, options) {
  const subcommand = positionals[1] || 'list';
  const libraryRoot = await resolveLibraryRoot(options);

  if (['delete', 'update-batch', 'duplicates', 'merge'].includes(subcommand)) {
    const allowedOptions = new Set(['library', 'library-root', 'json', ...(subcommand === 'duplicates' ? ['policy'] : ['file'])]);
    for (const key of Object.keys(options)) {
      if (!allowedOptions.has(key)) throw new ServiceError('invalid_arguments', `Unknown option for links ${subcommand}: --${key}`);
    }
    let args;
    if (subcommand === 'duplicates') {
      if (positionals.length !== 2) throw new ServiceError('invalid_arguments', 'Use links duplicates --policy exact|trailing-slash.');
      args = { policy: getOption(options, 'policy') };
    } else if (subcommand === 'delete' && positionals[2]) {
      if (options.file || positionals.length !== 3) throw new ServiceError('invalid_arguments', 'Provide one exact ID or --file, not both.');
      args = { records: [{ id: positionals[2] }] };
    } else {
      if (positionals.length !== 2) throw new ServiceError('invalid_arguments', 'Unexpected positional argument.');
      args = await readBatchInput(options);
    }
    const operation = { delete: 'rinku_delete_links', 'update-batch': 'rinku_update_links', duplicates: 'rinku_preview_duplicates', merge: 'rinku_merge_links' }[subcommand];
    return batchOutput(await guardedCommand(operation, libraryRoot, args), options.json);
  }

  if (subcommand === 'add') {
    const url = positionals[2] || getOption(options, 'url');
    if (!url) {
      throw new ServiceError('invalid_arguments', 'URL is required.');
    }
    const result = await createLink(libraryRoot, {
      url,
      title: getOption(options, 'title') || '',
      label: getOption(options, 'label'),
      tags: getOptionList(options, 'tag'),
      contexts: getOptionList(options, 'context'),
      body: getOption(options, 'body') || getOption(options, 'notes') || '',
      source: { cli: { addedAt: new Date().toISOString() } },
    }, { learnRule: Boolean(getOption(options, 'label')) });
    return options.json ? printJson({ ...result.link, duplicate: result.duplicate })
      : `${result.duplicate ? 'Already saved: ' : ''}${renderLinkLine(result.link)}\n`;
  }

  if (subcommand === 'list') {
    const status = getOption(options, 'status', 'active');
    const result = await listLinks(libraryRoot, {
      status: status === 'all' ? undefined : status,
      label: getOption(options, 'label'),
      tag: getOption(options, 'tag'),
      context: getOption(options, 'context'),
      search: getOption(options, 'search'),
      olderThanDays: parseOlderThanDays(getOption(options, 'older-than')),
      limit: getOption(options, 'limit'),
      rebuild: options.rebuild === true,
    });
    return options.json ? printJson(result) : `${result.links.map(renderLinkLine).join('\n')}${result.links.length ? '\n' : ''}`;
  }

  if (subcommand === 'read') {
    const ref = positionals[2] || getOption(options, 'link');
    const link = await readLink(libraryRoot, ref);
    return options.json ? printJson(link) : `${renderLinkLine(link)}\n\n${link.body || ''}\n`;
  }

  if (subcommand === 'update') {
    const ref = positionals[2] || getOption(options, 'link');
    const patch = {};
    if (getOption(options, 'title') !== undefined) patch.title = getOption(options, 'title');
    if (getOption(options, 'label') !== undefined) patch.label = getOption(options, 'label');
    if (options.tag !== undefined) patch.tags = getOptionList(options, 'tag');
    if (options.context !== undefined) patch.contexts = getOptionList(options, 'context');
    if (getOption(options, 'body') !== undefined) patch.body = getOption(options, 'body');
    const link = await updateLink(libraryRoot, ref, patch, { learnRule: patch.label != null });
    return options.json ? printJson(link) : `${renderLinkLine(link)}\n`;
  }

  if (subcommand === 'archive') {
    const ref = positionals[2] || getOption(options, 'link');
    const link = await archiveLink(libraryRoot, ref);
    return options.json ? printJson(link) : `${renderLinkLine(link)}\n`;
  }

  if (subcommand === 'restore') {
    const ref = positionals[2] || getOption(options, 'link');
    const link = await restoreLink(libraryRoot, ref);
    return options.json ? printJson(link) : `${renderLinkLine(link)}\n`;
  }

  if (subcommand === 'rebuild-index') {
    const index = await rebuildIndex(libraryRoot);
    return options.json ? printJson(index) : `Indexed ${index.totals.all} links.\n`;
  }

  throw new ServiceError('invalid_arguments', `Unknown links command: ${subcommand}`);
}

async function handleImport(positionals, options) {
  const subcommand = positionals[1];
  const libraryRoot = await resolveLibraryRoot(options);

  if (subcommand === 'unmark') {
    const filePath = getOption(options, 'file') || positionals[2];
    if (!filePath) {
      throw new ServiceError('invalid_arguments', 'Unmark export file is required.');
    }
    const result = await importUnmarkExport(libraryRoot, path.resolve(String(filePath)));
    return options.json ? printJson(result) : `Imported ${result.added}/${result.total} links (${result.skipped} skipped, ${result.failed} failed).\n`;
  }

  throw new ServiceError('invalid_arguments', `Unknown import command: ${subcommand || ''}`);
}

async function handleSettings(positionals, options) {
  const subcommand = positionals[1] || 'read';
  const libraryRoot = await resolveLibraryRoot(options);

  if (subcommand === 'read') {
    const settings = await readSettings(libraryRoot);
    return options.json ? printJson(settings) : `${JSON.stringify(settings, null, 2)}\n`;
  }

  throw new ServiceError('invalid_arguments', `Unknown settings command: ${subcommand}`);
}

async function runCli(argv, commandName = 'rinku') {
  const { positionals, options } = parseArgv(argv);
  const command = positionals[0];

  if (options.version || command === 'build-info') {
    const info = require('./runtimeInfo').runtimeInfo;
    return options.json || command === 'build-info' ? printJson(info) : `Rinku ${info.version}\n`;
  }

  if (options.help || !command) {
    return renderHelp(commandName);
  }

  switch (command) {
    case 'recovery': {
      for (const key of Object.keys(options)) {
        if (!['library', 'library-root', 'json'].includes(key)) throw new ServiceError('invalid_arguments', `Unknown recovery option: --${key}`);
      }
      const libraryRoot = await resolveLibraryRoot(options);
      if (positionals[1] === 'list' && positionals.length === 2) return batchOutput(await guardedCommand('rinku_list_recovery', libraryRoot, {}), options.json);
      if (positionals[1] === 'restore' && positionals.length === 4) return batchOutput(await guardedCommand('rinku_recover_deleted_link', libraryRoot, { batchId: positionals[2], itemId: positionals[3] }), options.json);
      throw new ServiceError('invalid_arguments', 'Use recovery list or recovery restore <batch-id> <item-id>.');
    }
    case 'api': {
      if (positionals[1] !== 'serve') throw new ServiceError('invalid_arguments', 'Use `rinku api serve`.');
      const { startApiServer } = require('./apiServer');
      await startApiServer({
        libraryRoot: getOption(options, 'library'),
        port: getOption(options, 'port'),
        ...(options.write === true ? { config: { readOnly: false } } : {}),
      });
      return '';
    }
    case 'mcp': {
      if (positionals[1] !== 'serve') throw new ServiceError('invalid_arguments', 'Use `rinku mcp serve`.');
      await require('./mcpServer').startMcpServer();
      return '';
    }
    case 'use':
      return handleUse(positionals, options);
    case 'libraries':
      return handleLibraries(positionals, options);
    case 'links':
      return handleLinks(positionals, options);
    case 'import':
      return handleImport(positionals, options);
    case 'settings':
      return handleSettings(positionals, options);
    default:
      throw new ServiceError('invalid_arguments', `Unknown command: ${command}\n\n${renderHelp(commandName)}`);
  }
}

async function executeCli(argv, commandName = 'rinku') {
  try { return { stdout: await runCli(argv, commandName), stderr: '', exitCode: 0 }; }
  catch (error) {
    const result = error.result || errorResult(error);
    const json = parseArgv(argv).options.json === true;
    return { stdout: json ? printJson(result) : '', stderr: json ? '' : `${printJson(result)}`,
      exitCode: result.error.code === 'partial_failure' ? 2 : 1 };
  }
}

module.exports = {
  parseArgv,
  runCli,
  executeCli,
};
