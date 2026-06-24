const fs = require('fs').promises;
const path = require('path');
const { atomicWriteFile } = require('./atomicFile');
const { DEFAULT_SETTINGS, BUILTIN_SMART_LABEL_RULES } = require('./defaults');
const { parseFrontmatter, serializeFrontmatter } = require('./frontmatter');
const {
  createId,
  createLinkFileName,
  getLinkDirectoryName,
  hashUrl,
  normalizeDateTime,
  normalizeLabelId,
  normalizeLink,
  readLinkFile,
  writeLinkFile,
} = require('./linkFile');
const {
  hostFromUrl,
  normalizeSpace,
  sanitizeDirectoryName,
  slugify,
} = require('./slug');

const SETTINGS_FILE = 'rinku-settings.md';
const LINKS_DIR = 'links';
const ARCHIVE_DIR = 'archive';
const INTERNAL_DIR = '.rinku';
const INDEX_FILE = 'index.json';

const SETTINGS_KEY_ORDER = [
  'schemaVersion',
  'labels',
  'contexts',
  'smartLabels',
  'capture',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLibraryRoot(libraryRoot) {
  const root = path.resolve(String(libraryRoot || '').trim());
  if (!String(libraryRoot || '').trim() || root === path.dirname(root)) {
    throw new Error('A library root directory is required.');
  }
  return root;
}

function settingsPath(libraryRoot) {
  return path.join(libraryRoot, SETTINGS_FILE);
}

function indexPath(libraryRoot) {
  return path.join(libraryRoot, INTERNAL_DIR, INDEX_FILE);
}

function normalizeLabel(label, index = 0, seenIds = new Set()) {
  const source = label && typeof label === 'object' ? label : {};
  const name = normalizeSpace(source.name) || `Label ${index + 1}`;
  const baseId = normalizeLabelId(source.id || name);
  let id = baseId;
  let suffix = 2;
  while (seenIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  seenIds.add(id);

  return {
    id,
    name,
    color: String(source.color || '#64748b').trim() || '#64748b',
  };
}

function normalizeLabels(labels) {
  const source = Array.isArray(labels) && labels.length > 0
    ? labels
    : DEFAULT_SETTINGS.labels;
  const seen = new Set();
  const normalized = source.map((label, index) => normalizeLabel(label, index, seen));

  if (!normalized.some((label) => label.id === 'unlabeled')) {
    normalized.push(normalizeLabel({ id: 'unlabeled', name: 'Unlabeled', color: '#64748b' }, normalized.length, seen));
  }

  return normalized;
}

function normalizeContexts(contexts) {
  const seen = new Set();
  const output = [];
  const values = Array.isArray(contexts) ? contexts : [];
  for (const value of values) {
    const context = normalizeSpace(value);
    if (!context) {
      continue;
    }
    const display = context.startsWith('@') ? context : `@${context}`;
    const identity = display.toLowerCase();
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    output.push(display);
  }
  return output;
}

function normalizeSmartLabelRule(rule) {
  const source = rule && typeof rule === 'object' ? rule : {};
  const domain = String(source.domain || source.host || '').replace(/^www\./i, '').toLowerCase().trim();
  const pathPrefix = String(source.pathPrefix || source.path || '').trim();
  const label = normalizeLabelId(source.label);
  const sourceName = String(source.source || 'learned').trim() || 'learned';

  if (!domain || !label) {
    return null;
  }

  return {
    domain,
    pathPrefix,
    label,
    source: sourceName,
  };
}

function normalizeSettings(settings = {}) {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings
    : {};
  const rawSmartLabels = source.smartLabels && typeof source.smartLabels === 'object'
    ? source.smartLabels
    : {};
  const rawCapture = source.capture && typeof source.capture === 'object'
    ? source.capture
    : {};

  return {
    schemaVersion: Number(source.schemaVersion) || DEFAULT_SETTINGS.schemaVersion,
    labels: normalizeLabels(source.labels),
    contexts: normalizeContexts(source.contexts),
    smartLabels: {
      learnFromManualChanges: rawSmartLabels.learnFromManualChanges === false ? false : true,
      rules: (Array.isArray(rawSmartLabels.rules) ? rawSmartLabels.rules : [])
        .map(normalizeSmartLabelRule)
        .filter(Boolean),
    },
    capture: {
      localHttpEnabled: rawCapture.localHttpEnabled === true,
    },
  };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function ensureDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

async function ensureLabelDirectories(libraryRoot, settings) {
  for (const label of settings.labels) {
    const directoryName = getLinkDirectoryName(settings.labels, label.id);
    await ensureDirectory(path.join(libraryRoot, LINKS_DIR, directoryName));
    await ensureDirectory(path.join(libraryRoot, ARCHIVE_DIR, directoryName));
  }
}

async function writeSettings(libraryRootInput, settings) {
  const libraryRoot = normalizeLibraryRoot(libraryRootInput);
  const normalized = normalizeSettings(settings);
  const body = [
    '# Rinku Settings',
    '',
    'This file stores library-level settings. Rinku owns the frontmatter block.',
    '',
  ].join('\n');
  await atomicWriteFile(
    settingsPath(libraryRoot),
    serializeFrontmatter(normalized, body, SETTINGS_KEY_ORDER),
    'utf8'
  );
  await ensureLabelDirectories(libraryRoot, normalized);
  return normalized;
}

async function readSettings(libraryRootInput, options = {}) {
  const libraryRoot = normalizeLibraryRoot(libraryRootInput);
  const ensureFile = options.ensureFile !== false;
  let raw = '';

  try {
    raw = await fs.readFile(settingsPath(libraryRoot), 'utf8');
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
    const defaults = normalizeSettings(clone(DEFAULT_SETTINGS));
    if (ensureFile) {
      return writeSettings(libraryRoot, defaults);
    }
    return defaults;
  }

  const parsed = parseFrontmatter(raw);
  const normalized = normalizeSettings(parsed.frontmatter);
  if (ensureFile) {
    await writeSettings(libraryRoot, normalized);
  }
  return normalized;
}

async function createLibrary(libraryRootInput, options = {}) {
  const libraryRoot = normalizeLibraryRoot(libraryRootInput);
  const exists = await pathExists(libraryRoot);

  if (exists && options.allowExisting !== true) {
    const entries = await fs.readdir(libraryRoot).catch(() => []);
    if (entries.length > 0) {
      throw new Error(`Library root already exists and is not empty: ${libraryRoot}`);
    }
  }

  await ensureDirectory(libraryRoot);
  const settings = await writeSettings(libraryRoot, normalizeSettings(clone(DEFAULT_SETTINGS)));
  await ensureDirectory(path.join(libraryRoot, INTERNAL_DIR));
  const index = await rebuildIndex(libraryRoot);

  return {
    ok: true,
    libraryRoot,
    settings,
    index,
  };
}

function getAllSmartRules(settings) {
  const learned = settings.smartLabels && Array.isArray(settings.smartLabels.rules)
    ? settings.smartLabels.rules
    : [];
  return [
    ...learned.map((rule) => ({ ...rule, source: rule.source || 'learned' })),
    ...BUILTIN_SMART_LABEL_RULES.map((rule) => ({ ...rule })),
  ];
}

function pathFromUrl(url) {
  try {
    return new URL(String(url || '').trim()).pathname || '';
  } catch {
    return '';
  }
}

function findSmartLabelForUrl(url, settings) {
  const host = hostFromUrl(url);
  const urlPath = pathFromUrl(url);
  if (!host) {
    return 'unlabeled';
  }

  for (const rule of getAllSmartRules(settings)) {
    const ruleHost = String(rule.domain || '').replace(/^www\./i, '').toLowerCase();
    if (!ruleHost) {
      continue;
    }
    if (host !== ruleHost && !host.endsWith(`.${ruleHost}`)) {
      continue;
    }
    if (rule.pathPrefix && !urlPath.startsWith(rule.pathPrefix)) {
      continue;
    }
    return normalizeLabelId(rule.label);
  }

  return 'unlabeled';
}

function findLabel(settings, labelIdOrName) {
  const wanted = normalizeLabelId(labelIdOrName);
  return settings.labels.find((label) => label.id === wanted || normalizeLabelId(label.name) === wanted) || null;
}

function ensureLabel(settings, labelIdOrName) {
  const existing = findLabel(settings, labelIdOrName);
  if (existing) {
    return existing.id;
  }

  return 'unlabeled';
}

async function getAvailableLinkPath(directoryPath, fileName) {
  const ext = path.extname(fileName) || '.md';
  const base = path.basename(fileName, ext);
  let candidate = fileName;
  let counter = 2;

  while (await pathExists(path.join(directoryPath, candidate))) {
    candidate = `${base}-${counter}${ext}`;
    counter += 1;
  }

  return path.join(directoryPath, candidate);
}

async function addOrUpdateLearnedRule(libraryRoot, settings, url, labelId) {
  if (!settings.smartLabels.learnFromManualChanges || labelId === 'unlabeled') {
    return settings;
  }

  const domain = hostFromUrl(url);
  if (!domain) {
    return settings;
  }

  const rules = settings.smartLabels.rules.filter((rule) => rule.domain !== domain || rule.pathPrefix);
  rules.unshift({
    domain,
    pathPrefix: '',
    label: labelId,
    source: 'learned',
  });

  const nextSettings = normalizeSettings({
    ...settings,
    smartLabels: {
      ...settings.smartLabels,
      rules,
    },
  });

  await writeSettings(libraryRoot, nextSettings);
  return nextSettings;
}

async function createLink(libraryRootInput, input = {}, options = {}) {
  const libraryRoot = normalizeLibraryRoot(libraryRootInput);
  let settings = options.settings ? normalizeSettings(options.settings) : await readSettings(libraryRoot);
  const explicitLabel = input.label != null && String(input.label).trim() !== '';
  const label = explicitLabel
    ? ensureLabel(settings, input.label)
    : ensureLabel(settings, findSmartLabelForUrl(input.url, settings));
  const now = new Date().toISOString();
  const link = normalizeLink({
    ...input,
    id: input.id || createId(),
    label,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  });
  const body = input.body != null ? String(input.body) : String(input.notes || '');
  const statusDirectory = link.status === 'archived' ? ARCHIVE_DIR : LINKS_DIR;
  const labelDirectory = getLinkDirectoryName(settings.labels, link.label);
  const directoryPath = path.join(libraryRoot, statusDirectory, labelDirectory);
  await ensureDirectory(directoryPath);
  const filePath = await getAvailableLinkPath(directoryPath, createLinkFileName(link));

  await writeLinkFile(filePath, link, body);
  if (options.learnRule === true && explicitLabel) {
    settings = await addOrUpdateLearnedRule(libraryRoot, settings, link.url, link.label);
  }
  const index = options.rebuildIndex === false ? null : await rebuildIndex(libraryRoot);

  return {
    link: {
      ...link,
      body,
      filePath,
      fileName: path.basename(filePath),
    },
    settings,
    index,
  };
}

async function scanLinkFiles(libraryRoot, statusDirectory, settings) {
  const root = path.join(libraryRoot, statusDirectory);
  const status = statusDirectory === ARCHIVE_DIR ? 'archived' : 'active';
  const links = [];

  let labelDirectories = [];
  try {
    labelDirectories = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return links;
    }
    throw error;
  }

  for (const entry of labelDirectories) {
    if (!entry.isDirectory()) {
      continue;
    }

    const labelDirectoryName = entry.name;
    const label = settings.labels.find((candidate) => getLinkDirectoryName(settings.labels, candidate.id) === labelDirectoryName);
    const directoryPath = path.join(root, labelDirectoryName);
    const files = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => []);

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.md')) {
        continue;
      }

      const filePath = path.join(directoryPath, file.name);
      const link = await readLinkFile(filePath);
      const normalized = normalizeLink({
        ...link,
        status,
        label: label ? label.id : link.label,
      });

      links.push({
        ...normalized,
        body: link.body,
        filePath,
        fileName: file.name,
      });
    }
  }

  return links;
}

function linkIndexRecord(link) {
  return {
    id: link.id,
    url: link.url,
    urlHash: link.urlHash || hashUrl(link.url),
    title: link.title,
    domain: link.domain,
    label: link.label,
    tags: Array.isArray(link.tags) ? link.tags : [],
    contexts: Array.isArray(link.contexts) ? link.contexts : [],
    status: link.status,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    archivedAt: link.archivedAt || '',
    filePath: link.filePath,
    fileName: link.fileName,
  };
}

async function rebuildIndex(libraryRootInput) {
  const libraryRoot = normalizeLibraryRoot(libraryRootInput);
  const settings = await readSettings(libraryRoot);
  await ensureLabelDirectories(libraryRoot, settings);
  const [activeLinks, archivedLinks] = await Promise.all([
    scanLinkFiles(libraryRoot, LINKS_DIR, settings),
    scanLinkFiles(libraryRoot, ARCHIVE_DIR, settings),
  ]);
  const links = [...activeLinks, ...archivedLinks]
    .map(linkIndexRecord)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
  const index = {
    schemaVersion: 1,
    libraryRoot,
    generatedAt: new Date().toISOString(),
    totals: {
      all: links.length,
      active: links.filter((link) => link.status === 'active').length,
      archived: links.filter((link) => link.status === 'archived').length,
    },
    links,
  };

  await atomicWriteFile(indexPath(libraryRoot), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return index;
}

async function readIndex(libraryRootInput, options = {}) {
  const libraryRoot = normalizeLibraryRoot(libraryRootInput);
  if (options.rebuild === true) {
    return rebuildIndex(libraryRoot);
  }

  try {
    const raw = await fs.readFile(indexPath(libraryRoot), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if ((error && error.code === 'ENOENT') || error instanceof SyntaxError) {
      return rebuildIndex(libraryRoot);
    }
    throw error;
  }
}

function linkMatchesFilters(link, filters = {}) {
  if (filters.status && link.status !== filters.status) {
    return false;
  }

  if (filters.label && normalizeLabelId(link.label) !== normalizeLabelId(filters.label)) {
    return false;
  }

  if (filters.context) {
    const context = normalizeSpace(filters.context).toLowerCase();
    const wanted = context.startsWith('@') ? context : `@${context}`;
    if (!Array.isArray(link.contexts) || !link.contexts.some((item) => String(item).toLowerCase() === wanted)) {
      return false;
    }
  }

  if (filters.tag) {
    const tag = slugify(filters.tag);
    if (!Array.isArray(link.tags) || !link.tags.some((item) => slugify(item) === tag)) {
      return false;
    }
  }

  if (filters.search) {
    const haystack = `${link.title}\n${link.url}\n${link.domain}\n${(link.tags || []).join(' ')}\n${(link.contexts || []).join(' ')}`.toLowerCase();
    const tokens = String(filters.search).toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.every((token) => haystack.includes(token))) {
      return false;
    }
  }

  if (filters.olderThanDays) {
    const days = Number(filters.olderThanDays);
    const created = Date.parse(link.createdAt);
    if (!Number.isFinite(days) || !Number.isFinite(created)) {
      return false;
    }
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    if (created > cutoff) {
      return false;
    }
  }

  return true;
}

async function listLinks(libraryRootInput, filters = {}) {
  const index = await readIndex(libraryRootInput, { rebuild: filters.rebuild === true });
  const links = index.links.filter((link) => linkMatchesFilters(link, filters));
  const limit = Number(filters.limit);

  return {
    ...index,
    links: Number.isFinite(limit) && limit > 0 ? links.slice(0, limit) : links,
    total: links.length,
  };
}

async function findLinkRecord(libraryRootInput, ref) {
  const index = await readIndex(libraryRootInput);
  const wanted = String(ref || '').trim();
  if (!wanted) {
    throw new Error('Link reference is required.');
  }

  const normalized = wanted.toLowerCase();
  const matches = index.links.filter((link) => {
    return (
      String(link.id || '').toLowerCase() === normalized ||
      String(link.fileName || '').toLowerCase() === normalized ||
      String(link.url || '').toLowerCase() === normalized ||
      String(link.title || '').toLowerCase() === normalized
    );
  });

  if (matches.length === 1) {
    return matches[0];
  }

  const partialMatches = index.links.filter((link) => {
    return (
      String(link.id || '').toLowerCase().includes(normalized) ||
      String(link.fileName || '').toLowerCase().includes(normalized) ||
      String(link.title || '').toLowerCase().includes(normalized)
    );
  });

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  if (matches.length + partialMatches.length > 1) {
    throw new Error(`Link reference is ambiguous: ${wanted}`);
  }

  throw new Error(`Link not found: ${wanted}`);
}

async function readLink(libraryRootInput, ref) {
  const record = await findLinkRecord(libraryRootInput, ref);
  return readLinkFile(record.filePath);
}

async function moveLinkFile(libraryRoot, settings, currentFilePath, link, body) {
  const statusDirectory = link.status === 'archived' ? ARCHIVE_DIR : LINKS_DIR;
  const labelDirectory = getLinkDirectoryName(settings.labels, link.label);
  const destinationDirectory = path.join(libraryRoot, statusDirectory, labelDirectory);
  await ensureDirectory(destinationDirectory);

  let destinationPath = path.join(destinationDirectory, path.basename(currentFilePath));
  if (path.dirname(currentFilePath) !== destinationDirectory && await pathExists(destinationPath)) {
    destinationPath = await getAvailableLinkPath(destinationDirectory, createLinkFileName(link));
  }

  await writeLinkFile(destinationPath, link, body);
  if (path.resolve(destinationPath) !== path.resolve(currentFilePath)) {
    await fs.unlink(currentFilePath).catch(() => {});
  }
  return destinationPath;
}

async function moveDirectoryFiles(oldPath, newPath) {
  if (path.resolve(oldPath) === path.resolve(newPath) || !await pathExists(oldPath)) {
    return;
  }

  await ensureDirectory(newPath);
  const entries = await fs.readdir(oldPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const sourcePath = path.join(oldPath, entry.name);
    let destinationPath = path.join(newPath, entry.name);
    if (await pathExists(destinationPath)) {
      destinationPath = await getAvailableLinkPath(newPath, entry.name);
    }
    await fs.rename(sourcePath, destinationPath);
  }

  await fs.rmdir(oldPath).catch(() => {});
}

async function updateLink(libraryRootInput, ref, patch = {}, options = {}) {
  const libraryRoot = normalizeLibraryRoot(libraryRootInput);
  let settings = await readSettings(libraryRoot);
  const current = await readLink(libraryRoot, ref);
  const previousLabel = current.label;
  const nextLabel = patch.label != null ? ensureLabel(settings, patch.label) : current.label;
  const body = patch.body != null ? String(patch.body) : current.body;
  const now = new Date().toISOString();
  const next = normalizeLink({
    ...current,
    ...patch,
    label: nextLabel,
    tags: patch.tags != null ? patch.tags : current.tags,
    contexts: patch.contexts != null ? patch.contexts : current.contexts,
    status: patch.status || current.status,
    archivedAt: patch.archivedAt !== undefined ? patch.archivedAt : current.archivedAt,
    updatedAt: patch.updatedAt || now,
  });

  const filePath = await moveLinkFile(libraryRoot, settings, current.filePath, next, body);
  if (options.learnRule === true && next.label !== previousLabel) {
    settings = await addOrUpdateLearnedRule(libraryRoot, settings, next.url, next.label);
  }
  await rebuildIndex(libraryRoot);

  return {
    ...next,
    body,
    filePath,
    fileName: path.basename(filePath),
  };
}

async function archiveLink(libraryRootInput, ref) {
  const current = await readLink(libraryRootInput, ref);
  if (current.status === 'archived') {
    return current;
  }

  return updateLink(libraryRootInput, ref, {
    status: 'archived',
    archivedAt: new Date().toISOString(),
  });
}

async function restoreLink(libraryRootInput, ref) {
  return updateLink(libraryRootInput, ref, {
    status: 'active',
    archivedAt: '',
  });
}

async function renameLabel(libraryRootInput, labelId, nextName) {
  const libraryRoot = normalizeLibraryRoot(libraryRootInput);
  const settings = await readSettings(libraryRoot);
  const normalizedLabelId = normalizeLabelId(labelId);
  const label = settings.labels.find((candidate) => candidate.id === normalizedLabelId);
  if (!label) {
    throw new Error(`Label not found: ${labelId}`);
  }

  const oldDirectoryName = getLinkDirectoryName(settings.labels, label.id);
  label.name = normalizeSpace(nextName) || label.name;
  const nextSettings = await writeSettings(libraryRoot, settings);
  const newDirectoryName = getLinkDirectoryName(nextSettings.labels, label.id);

  for (const parent of [LINKS_DIR, ARCHIVE_DIR]) {
    const oldPath = path.join(libraryRoot, parent, oldDirectoryName);
    const newPath = path.join(libraryRoot, parent, newDirectoryName);
    await moveDirectoryFiles(oldPath, newPath);
  }

  await rebuildIndex(libraryRoot);
  return nextSettings;
}

async function resolveIncomingFilePath(libraryRootInput, relativeParts = []) {
  const libraryRoot = normalizeLibraryRoot(libraryRootInput);
  const fullPath = path.resolve(libraryRoot, ...relativeParts);
  const relative = path.relative(libraryRoot, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes library root.');
  }
  return fullPath;
}

module.exports = {
  ARCHIVE_DIR,
  INDEX_FILE,
  INTERNAL_DIR,
  LINKS_DIR,
  SETTINGS_FILE,
  archiveLink,
  createLibrary,
  createLink,
  ensureLabel,
  findLabel,
  findLinkRecord,
  findSmartLabelForUrl,
  listLinks,
  normalizeLibraryRoot,
  readIndex,
  readLink,
  readSettings,
  rebuildIndex,
  renameLabel,
  resolveIncomingFilePath,
  restoreLink,
  updateLink,
  writeSettings,
};
