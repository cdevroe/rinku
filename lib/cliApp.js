const path = require('path');
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
    throw new Error(`Unsupported --older-than value: ${value}`);
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
    throw new Error('No library selected. Use `rinku use <library-root>` or pass `--library <path>`.');
  }

  return current;
}

function printJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function renderHelp(commandName = 'rinku') {
  return [
    'Rinku CLI',
    '',
    'Usage:',
    `  ${commandName} api serve [--library <path>] [--port <n>] [--write]`,
    `  ${commandName} mcp serve`,
    `  ${commandName} use <library-root>`,
    `  ${commandName} libraries create <library-root> [--use] [--allow-existing] [--json]`,
    `  ${commandName} libraries list [--json]`,
    `  ${commandName} links add <url> [--title <title>] [--label <label>] [--tag <tag> ...] [--context <context> ...] [--body <text>] [--json]`,
    `  ${commandName} links list [--status active|archived|all] [--label <label>] [--tag <tag>] [--context <context>] [--search <query>] [--older-than <days>] [--limit <n>] [--json]`,
    `  ${commandName} links read <link-ref> [--json]`,
    `  ${commandName} links update <link-ref> [--title <title>] [--label <label>] [--tag <tag> ...] [--context <context> ...] [--body <text>] [--json]`,
    `  ${commandName} links archive <link-ref> [--json]`,
    `  ${commandName} links restore <link-ref> [--json]`,
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
      throw new Error('Library root is required.');
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

  throw new Error(`Unknown libraries command: ${subcommand}`);
}

async function handleLinks(positionals, options) {
  const subcommand = positionals[1] || 'list';
  const libraryRoot = await resolveLibraryRoot(options);

  if (subcommand === 'add') {
    const url = positionals[2] || getOption(options, 'url');
    if (!url) {
      throw new Error('URL is required.');
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

  throw new Error(`Unknown links command: ${subcommand}`);
}

async function handleImport(positionals, options) {
  const subcommand = positionals[1];
  const libraryRoot = await resolveLibraryRoot(options);

  if (subcommand === 'unmark') {
    const filePath = getOption(options, 'file') || positionals[2];
    if (!filePath) {
      throw new Error('Unmark export file is required.');
    }
    const result = await importUnmarkExport(libraryRoot, path.resolve(String(filePath)));
    return options.json ? printJson(result) : `Imported ${result.added}/${result.total} links (${result.skipped} skipped, ${result.failed} failed).\n`;
  }

  throw new Error(`Unknown import command: ${subcommand || ''}`);
}

async function handleSettings(positionals, options) {
  const subcommand = positionals[1] || 'read';
  const libraryRoot = await resolveLibraryRoot(options);

  if (subcommand === 'read') {
    const settings = await readSettings(libraryRoot);
    return options.json ? printJson(settings) : `${JSON.stringify(settings, null, 2)}\n`;
  }

  throw new Error(`Unknown settings command: ${subcommand}`);
}

async function runCli(argv, commandName = 'rinku') {
  const { positionals, options } = parseArgv(argv);
  const command = positionals[0];

  if (options.help || !command) {
    return renderHelp(commandName);
  }

  switch (command) {
    case 'api': {
      if (positionals[1] !== 'serve') throw new Error('Use `rinku api serve`.');
      const { startApiServer } = require('./apiServer');
      await startApiServer({
        libraryRoot: getOption(options, 'library'),
        port: getOption(options, 'port'),
        ...(options.write === true ? { config: { readOnly: false } } : {}),
      });
      return '';
    }
    case 'mcp': {
      if (positionals[1] !== 'serve') throw new Error('Use `rinku mcp serve`.');
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
      throw new Error(`Unknown command: ${command}\n\n${renderHelp(commandName)}`);
  }
}

module.exports = {
  parseArgv,
  runCli,
};
