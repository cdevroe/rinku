const fs = require('fs').promises;
const path = require('path');
const { createHash, randomBytes } = require('crypto');
const { atomicWriteFile } = require('./atomicFile');
const { parseFrontmatter, serializeFrontmatter } = require('./frontmatter');
const {
  fileSafeHost,
  hostFromUrl,
  normalizeSpace,
  sanitizeDirectoryName,
  slugify,
  truncateSlug,
} = require('./slug');

const LINK_KEY_ORDER = [
  'id',
  'url',
  'urlHash',
  'title',
  'domain',
  'label',
  'tags',
  'contexts',
  'status',
  'createdAt',
  'updatedAt',
  'archivedAt',
  'source',
];

function createId(prefix = '') {
  return `${prefix}${randomBytes(5).toString('base64url')}`;
}

function hashUrl(url) {
  return createHash('sha256').update(String(url || '').trim()).digest('hex');
}

function normalizeDateTime(value, fallback = new Date()) {
  if (value == null || value === '') {
    return fallback ? fallback.toISOString() : '';
  }

  const asString = String(value).trim();
  const normalized = asString.includes('T') ? asString : asString.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return fallback ? fallback.toISOString() : asString;
  }

  return parsed.toISOString();
}

function normalizeStringList(values, options = {}) {
  const source = Array.isArray(values)
    ? values
    : (typeof values === 'string' ? values.split(',') : []);
  const preserveCase = options.preserveCase === true;
  const seen = new Set();
  const output = [];

  for (const value of source) {
    const text = normalizeSpace(value);
    if (!text) {
      continue;
    }
    const normalized = preserveCase ? text : slugify(text);
    const identity = normalized.toLowerCase();
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    output.push(normalized);
  }

  return output;
}

function normalizeContexts(values) {
  return normalizeStringList(values, { preserveCase: true }).map((context) => (
    context.startsWith('@') ? context : `@${context}`
  ));
}

function normalizeLabelId(value, fallback = 'unlabeled') {
  const label = slugify(value, fallback);
  return label || fallback;
}

function normalizeLink(input = {}) {
  const url = String(input.url || '').trim();
  const domain = String(input.domain || hostFromUrl(url)).trim();
  const title = normalizeSpace(input.title || input.mark_title || url || 'Untitled Link');
  const nowIso = new Date().toISOString();
  const status = input.status === 'archived' || input.archivedAt ? 'archived' : 'active';

  return {
    id: normalizeSpace(input.id) || createId(),
    url,
    urlHash: normalizeSpace(input.urlHash) || hashUrl(url),
    title,
    domain,
    label: normalizeLabelId(input.label),
    tags: normalizeStringList(input.tags),
    contexts: normalizeContexts(input.contexts),
    status,
    createdAt: normalizeDateTime(input.createdAt, new Date()),
    updatedAt: normalizeDateTime(input.updatedAt, new Date()),
    archivedAt: status === 'archived'
      ? normalizeDateTime(input.archivedAt, new Date())
      : '',
    source: input.source && typeof input.source === 'object' && !Array.isArray(input.source)
      ? input.source
      : {},
  };
}

function createLinkFileName(link) {
  const id = normalizeSpace(link.id) || createId();
  if (/[/\\\0]/.test(id)) throw new Error('Link id cannot contain path separators or null bytes.');
  const host = fileSafeHost(link.url);
  const titleSlug = truncateSlug(link.title || link.url || 'link', 76);
  return `${host}-${titleSlug}-${id}.md`;
}

function getLinkDirectoryName(labels, labelId) {
  const normalizedLabelId = normalizeLabelId(labelId);
  const label = Array.isArray(labels)
    ? labels.find((candidate) => normalizeLabelId(candidate.id || candidate.name) === normalizedLabelId)
    : null;
  return sanitizeDirectoryName(label ? label.name : normalizedLabelId);
}

function serializeLink(link, body = '') {
  return serializeFrontmatter(normalizeLink(link), body, LINK_KEY_ORDER);
}

async function readLinkFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseFrontmatter(raw);
  const link = normalizeLink(parsed.frontmatter);

  return {
    ...link,
    body: parsed.body,
    filePath,
    fileName: path.basename(filePath),
  };
}

async function writeLinkFile(filePath, link, body = '') {
  await atomicWriteFile(filePath, serializeLink(link, body), 'utf8');
}

module.exports = {
  createId,
  createLinkFileName,
  getLinkDirectoryName,
  hashUrl,
  normalizeDateTime,
  normalizeLabelId,
  normalizeLink,
  readLinkFile,
  writeLinkFile,
};
