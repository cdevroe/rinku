const fs = require('fs').promises;
const {
  createLink,
  listLinks,
  rebuildIndex,
  readSettings,
} = require('../library');
const { hashUrl, normalizeLabelId } = require('../linkFile');
const { hostFromUrl, normalizeSpace, slugify } = require('../slug');

function getMarksFromExport(exportObject) {
  if (!exportObject || typeof exportObject !== 'object') {
    throw new Error('Invalid Unmark export: expected JSON object.');
  }

  const root = exportObject.export && typeof exportObject.export === 'object'
    ? exportObject.export
    : exportObject;
  const marks = Array.isArray(root.marks) ? root.marks : null;

  if (!marks) {
    throw new Error('Invalid Unmark export: missing export.marks array.');
  }

  return {
    metadata: {
      exportVersion: root.export_version || root.exportVersion || '',
      exportDate: root.export_date || root.exportDate || '',
      marksCount: root.marks_count || root.marksCount || marks.length,
    },
    marks,
  };
}

function normalizeUnmarkDate(value) {
  if (value == null || value === '') {
    return '';
  }

  const text = String(value).trim();
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function getTags(mark) {
  const tags = mark && mark.tags;
  if (Array.isArray(tags)) {
    return tags.map((tag) => normalizeSpace(tag && tag.name ? tag.name : tag)).filter(Boolean);
  }

  if (tags && typeof tags === 'object') {
    return Object.keys(tags).map((key) => {
      const tag = tags[key];
      return normalizeSpace(tag && tag.name ? tag.name : key);
    }).filter(Boolean);
  }

  if (typeof tags === 'string') {
    return tags.split(',').map(normalizeSpace).filter(Boolean);
  }

  return [];
}

function mapLabelName(settings, labelName) {
  const wanted = normalizeLabelId(labelName || 'Unlabeled');
  const label = settings.labels.find((candidate) => {
    return candidate.id === wanted || normalizeLabelId(candidate.name) === wanted;
  });

  return label ? label.id : 'unlabeled';
}

function buildSource(mark, metadata) {
  return {
    unmark: {
      id: String(mark.mark_id || '').trim(),
      labelId: String(mark.label_id || '').trim(),
      labelName: String(mark.label_name || '').trim(),
      exportVersion: String(metadata.exportVersion || '').trim(),
      exportDate: String(metadata.exportDate || '').trim(),
    },
  };
}

function buildImportLink(mark, settings, metadata) {
  const url = String(mark.url || '').trim();
  const title = normalizeSpace(mark.mark_title || mark.title || url || 'Untitled Link');
  const createdAt = normalizeUnmarkDate(mark.created_on) || new Date().toISOString();
  const archivedAt = normalizeUnmarkDate(mark.archived_on);
  const label = mapLabelName(settings, mark.label_name);
  const unmarkId = String(mark.mark_id || '').trim();
  const id = unmarkId ? `um${unmarkId}` : undefined;

  return {
    id,
    url,
    urlHash: hashUrl(url),
    title,
    domain: hostFromUrl(url),
    label,
    tags: getTags(mark).map((tag) => slugify(tag)).filter(Boolean),
    contexts: [],
    status: archivedAt ? 'archived' : 'active',
    createdAt,
    updatedAt: createdAt,
    archivedAt,
    body: mark.notes ? String(mark.notes) : '',
    source: buildSource(mark, metadata),
  };
}

async function readUnmarkExport(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON export: ${error.message}`);
  }
}

async function getExistingUrlHashes(libraryRoot) {
  const index = await listLinks(libraryRoot, { rebuild: true });
  return new Set(index.links.map((link) => link.urlHash).filter(Boolean));
}

async function importUnmarkExport(libraryRoot, filePath, options = {}) {
  const exportObject = await readUnmarkExport(filePath);
  const { metadata, marks } = getMarksFromExport(exportObject);
  const settings = await readSettings(libraryRoot);
  const existingHashes = options.allowDuplicates === true
    ? new Set()
    : await getExistingUrlHashes(libraryRoot);
  const result = {
    ok: true,
    sourcePath: filePath,
    metadata,
    total: marks.length,
    added: 0,
    skipped: 0,
    failed: 0,
    archived: 0,
    active: 0,
    warnings: [],
    errors: [],
  };

  for (const mark of marks) {
    try {
      const link = buildImportLink(mark, settings, metadata);
      if (!link.url) {
        result.skipped += 1;
        result.warnings.push({ markId: mark.mark_id || '', message: 'Skipped mark with empty URL.' });
        continue;
      }

      if (!options.allowDuplicates && existingHashes.has(link.urlHash)) {
        result.skipped += 1;
        continue;
      }

      const created = await createLink(libraryRoot, link, {
        // This batch handles exact-URL duplicates above, including the explicit
        // allowDuplicates import option, without rescanning after every record.
        allowDuplicates: true,
        learnRule: false,
        rebuildIndex: false,
        settings,
      });
      existingHashes.add(created.link.urlHash);
      result.added += 1;
      if (created.link.status === 'archived') {
        result.archived += 1;
      } else {
        result.active += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        markId: mark && mark.mark_id ? String(mark.mark_id) : '',
        message: error.message,
      });
    }
  }

  result.ok = result.failed === 0;
  result.index = await rebuildIndex(libraryRoot);
  return result;
}

module.exports = {
  buildImportLink,
  getMarksFromExport,
  importUnmarkExport,
  readUnmarkExport,
};
