const fs = require('fs').promises;
const { constants } = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const library = require('./library');
const { normalizeLink, getLinkDirectoryName } = require('./linkFile');
const { parseFrontmatter, serializeFrontmatter } = require('./frontmatter');
const { atomicWriteFile } = require('./atomicFile');

const hash = text => createHash('sha256').update(text).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const revisionFor = (relative, link, raw) => hash(JSON.stringify([relative, link.label, link.status, raw]));
function conflict(message) { const error = new Error(message); error.code = 'conflict'; return error; }

// Called again immediately before touching a path, in addition to the service's
// whole-tree check. Never follow a symlink in storage or recovery directories.
async function safePath(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..')) {
    throw conflict('Invalid storage path.');
  }
  let target = root;
  for (const part of ['', ...relative.split(path.sep)]) {
    if (part) target = path.join(target, part);
    try {
      if ((await fs.lstat(target)).isSymbolicLink()) throw conflict('Symlinks are not supported in library storage.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

function matchKey(url, policy) {
  if (!['exact', 'trailing-slash'].includes(policy)) throw conflict('Choose exact or trailing-slash matching.');
  if (policy === 'exact') return url;
  // Only remove ONE final pathname slash. Preserve the literal authority, case,
  // escapes, query and fragment, including empty ?/# delimiters. No URL reserialization.
  const match = /^(https?:\/\/[^/?#]+)([^?#]*)([?#].*)?$/i.exec(url);
  return match ? match[1] + match[2].replace(/\/$/, '') + (match[3] || '') : url;
}

async function snapshot(root) {
  const { links } = await library.listLinks(root, { rebuild: true, readOnly: true });
  const records = [];
  for (const indexed of links) {
    const relative = path.relative(root, indexed.filePath);
    const raw = await fs.readFile(await safePath(root, relative), 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    if (typeof frontmatter.id !== 'string' || !frontmatter.id.trim()) throw conflict(`Record has no stable ID: ${relative}`);
    const link = { ...normalizeLink(frontmatter), label: indexed.label, status: indexed.status, body };
    records.push({ ...link, relative, raw, frontmatter,
      revision: revisionFor(relative, indexed, raw),
      validDate: Number.isFinite(Date.parse(frontmatter.createdAt)),
    });
  }
  return records;
}

function publicRecord(record) {
  const { raw, frontmatter, relative, validDate, ...link } = record;
  return { ...link, filePath: relative, validCreatedAt: validDate };
}

function oldest(records) {
  if (records.some(record => !record.validDate)) throw conflict('Every merged record needs a valid createdAt date.');
  return [...records].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || compare(a.id, b.id));
}

async function previewDuplicates(root, policy) {
  const records = await snapshot(root);
  const counts = new Map();
  const groups = new Map();
  for (const record of records) {
    counts.set(record.id, (counts.get(record.id) || 0) + 1);
    const key = matchKey(record.url, policy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return { policy, groups: [...groups.entries()].filter(([, members]) => members.length > 1)
    .sort(([a], [b]) => compare(a, b)).map(([key, members]) => {
      const mergeable = members.every(member => counts.get(member.id) === 1 && member.validDate);
      const sorted = mergeable ? oldest(members) : members;
      return { key, mergeable, survivorId: mergeable ? sorted[0].id : null,
        differences: ['url', 'title', 'label', 'tags', 'contexts', 'body', 'source', 'mergeHistory', 'status', 'createdAt', 'archivedAt']
          .filter(field => new Set(members.map(member => JSON.stringify(member[field]))).size > 1),
        records: sorted.map(publicRecord) };
    }) };
}

function select(records, requested) {
  const matches = records.filter(record => record.id === requested.id);
  if (!matches.length) { const error = new Error(`Link not found: ${requested.id}`); error.code = 'not_found'; throw error; }
  if (matches.length !== 1) throw conflict(`Ambiguous stable ID: ${requested.id}`);
  const record = matches[0];
  if (requested.revision && record.revision !== requested.revision) throw conflict(`Link changed since preview: ${requested.id}`);
  return record;
}

async function unchanged(root, record, expected = record.raw) {
  const file = await safePath(root, record.relative);
  if (await fs.readFile(file, 'utf8') !== expected) throw conflict(`Link changed during cleanup: ${record.id}`);
  return file;
}

async function executeBatch(root, operation, requests, policy, options = {}) {
  const records = await snapshot(root); // One fresh scan for the entire batch.
  const settings = operation === 'update' ? await library.readSettings(root, { ensureFile: false }) : null;
  const settingsRaw = settings ? await fs.readFile(path.join(root, 'rinku-settings.md'), 'utf8') : null;
  const batchId = randomUUID();
  const relativeDirectory = path.join('.rinku', 'recovery', batchId);
  const directory = await safePath(root, relativeDirectory);
  const journal = { version: 1, batchId, operation, policy, startedAt: new Date().toISOString(), items: [], results: [], state: 'running' };
  let changed = false;
  let mutationCount = 0;
  let prepared = false;
  const used = new Set();
  const persist = async () => {
    await safePath(root, path.join(relativeDirectory, 'manifest.json'));
    await atomicWriteFile(path.join(directory, 'manifest.json'), JSON.stringify(journal, null, 2));
  };
  async function prepare(members) {
    if (!prepared) { await fs.mkdir(directory, { recursive: true, mode: 0o700 }); prepared = true; }
    const items = [];
    for (const member of members) {
      const itemId = String(journal.items.length);
      const item = { itemId, id: member.id, url: member.url, title: member.title, status: member.status,
        createdAt: member.createdAt, originalPath: member.relative, sha256: hash(member.raw),
        backup: `${itemId}-original.md`, removed: `${itemId}-removed.md` };
      const handle = await fs.open(await safePath(root, path.join(relativeDirectory, item.backup)), 'wx', 0o600);
      try { await handle.writeFile(member.raw); await handle.sync(); } finally { await handle.close(); }
      journal.items.push(item);
      items.push(item);
    }
    await persist(); // Durable recovery plan before changing any indexed file.
    return items;
  }
  async function remove(record, item, deleted) {
    const source = await unchanged(root, record);
    const destination = await safePath(root, path.join(relativeDirectory, item.removed));
    await fs.rename(source, destination);
    changed = true;
    mutationCount++;
    item.moved = true;
    const receipt = { id: record.id, url: record.url, title: record.title, status: record.status, createdAt: record.createdAt,
      originalPath: record.relative, verified: false,
      recovery: { batchId, itemId: item.itemId, filePath: path.join(relativeDirectory, item.removed) } };
    deleted.push(receipt); // Report every completed move, even if verification fails.
    // If an outside writer raced the last check, retain the actual moved bytes
    // in recovery and report a partial failure, never silently discard that edit.
    await safePath(root, path.join(relativeDirectory, item.removed));
    if (await fs.readFile(destination, 'utf8') !== record.raw) throw conflict(`Link changed while being moved: ${record.id}; inspect recovery.`);
    receipt.verified = true;
  }
  for (const request of requests) {
    const result = { ids: operation === 'merge' ? request.records.map(record => record.id) : [request.id], status: 'failed', deleted: [] };
    const changesBefore = mutationCount;
    let wroteSurvivor = false;
    try {
      if (result.ids.some(id => used.has(id)) || new Set(result.ids).size !== result.ids.length) throw conflict('A record may appear only once per batch.');
      result.ids.forEach(id => used.add(id));
      const members = (operation === 'merge' ? request.records : [request]).map(record => select(records, record));
      if (operation === 'merge') {
        if (new Set(members.map(record => matchKey(record.url, policy))).size !== 1) throw conflict('Selected URLs do not match the requested policy.');
        members.splice(0, members.length, ...oldest(members));
      }
      for (const record of members) await unchanged(root, record);
      const items = await prepare(members);
      await options.afterPrepare?.({ members, directory });
      for (const record of members) await unchanged(root, record);
      if (operation === 'update') {
        const current = members[0];
        const patch = request.patch;
        if (await fs.readFile(await safePath(root, 'rinku-settings.md'), 'utf8') !== settingsRaw) throw conflict('Library settings changed during the batch.');
        const label = patch.label === undefined ? current.label : library.findLabel(settings, patch.label)?.id;
        if (!label) throw conflict(`Unknown label: ${patch.label}`);
        const next = normalizeLink({ ...current, ...patch, label, updatedAt: new Date().toISOString() });
        const body = patch.body === undefined ? current.body : patch.body;
        const raw = serializeFrontmatter({ ...current.frontmatter, ...next }, body);
        const relative = label === current.label ? current.relative : path.join(
          current.status === 'archived' ? 'archive' : 'links', getLinkDirectoryName(settings.labels, label), path.basename(current.relative));
        const destination = await safePath(root, relative);
        await unchanged(root, current);
        if (relative === current.relative) {
          await atomicWriteFile(destination, raw);
        } else {
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await safePath(root, relative);
          // Exclusive creation never overwrites another bookmark on a label move.
          const handle = await fs.open(destination, 'wx', 0o600);
          changed = true;
          mutationCount++;
          result.updatedPath = relative;
          try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
        }
        changed = true;
        mutationCount++;
        result.updatedPath = relative;
        await options.afterUpdateWrite?.({ destination });
        await unchanged(root, { ...current, relative }, raw);
        if (relative !== current.relative) {
          result.retiredFiles = [];
          await remove(current, items[0], result.retiredFiles);
        }
        result.status = 'updated';
        result.link = { ...next, body, filePath: relative, revision: revisionFor(relative, next, raw) };
      } else if (operation === 'delete') {
        await remove(members[0], items[0], result.deleted);
        result.status = 'deleted';
      } else {
        const survivor = members[0];
        const notes = [...new Set(members.map(member => member.body).filter(body => body !== ''))];
        const merged = { ...survivor.frontmatter, ...normalizeLink(survivor),
          tags: [...new Set(members.flatMap(member => member.tags))],
          contexts: [...new Set(members.flatMap(member => member.contexts))],
          updatedAt: new Date().toISOString(),
          mergeHistory: [...(survivor.mergeHistory || []), {
            batchId, policy, mergedAt: new Date().toISOString(),
            records: members.map(member => ({ ...publicRecord(member), rawMarkdown: member.raw })),
          }],
        };
        // Keep the oldest record's URL, title, label, timestamps and archive state.
        const mergedRaw = serializeFrontmatter(merged, notes.join('\n\n---\n\n'));
        const survivorPath = await unchanged(root, survivor);
        await atomicWriteFile(survivorPath, mergedRaw);
        changed = true;
        mutationCount++;
        wroteSurvivor = true;
        result.survivorId = survivor.id;
        result.survivorPath = survivor.relative;
        await options.afterSurvivorWrite?.({ survivor, survivorPath });
        await unchanged(root, survivor, mergedRaw); // Verify before removing ANY redundant record.
        for (let index = 1; index < members.length; index++) {
          await unchanged(root, survivor, mergedRaw);
          await options.beforeRemove?.({ record: members[index], index });
          await remove(members[index], items[index], result.deleted);
        }
        result.status = 'merged';
        result.survivor = { ...normalizeLink(merged), body: notes.join('\n\n---\n\n'), filePath: survivor.relative };
      }
    } catch (error) {
      result.status = wroteSurvivor || mutationCount !== changesBefore ? 'partial' : (error.code === 'not_found' ? 'not_found' : ['conflict', 'EEXIST'].includes(error.code) ? 'conflict' : 'failed');
      result.error = { code: error.code || 'io_error', message: error.message };
    }
    journal.results.push(result);
    if (prepared) {
      try { await persist(); } catch (error) { journal.journalError = error.message; break; }
    }
  }
  let indexUpdated = false;
  if (changed) {
    try { await (options.rebuildIndex || library.rebuildIndex)(root); indexUpdated = true; }
    catch (error) { journal.indexError = error.message; }
  }
  journal.state = 'finished';
  journal.indexUpdated = indexUpdated;
  if (prepared) {
    try { await persist(); } catch (error) { journal.journalError = error.message; }
  }
  return { ok: journal.results.length === requests.length && journal.results.every(result => ['deleted', 'merged', 'updated'].includes(result.status))
      && !journal.indexError && !journal.journalError,
    batchId: prepared ? batchId : null, recoveryDirectory: prepared ? relativeDirectory : null,
    results: journal.results, indexUpdated, ...(journal.indexError ? { indexError: journal.indexError } : {}),
    ...(journal.journalError ? { journalError: journal.journalError } : {}),
    unprocessed: requests.length - journal.results.length };
}

async function recoverDeleted(root, batchId, itemId) {
  const relative = path.join('.rinku', 'recovery', batchId);
  const journal = JSON.parse(await fs.readFile(await safePath(root, path.join(relative, 'manifest.json')), 'utf8'));
  const item = journal.items.find(item => item.itemId === itemId);
  if (!item) throw conflict('Recovery item not found.');
  // Derive filenames rather than trusting paths in an editable manifest.
  const removedPath = await safePath(root, path.join(relative, `${itemId}-removed.md`));
  const raw = await fs.readFile(removedPath, 'utf8');
  if (parseFrontmatter(raw).frontmatter.id !== item.id) throw conflict('Recovery file ID does not match its manifest.');
  const records = await snapshot(root);
  if (records.some(record => record.id === item.id)) throw conflict('A record with this ID already exists; recovery will not overwrite it.');
  if (!/^(links|archive)[\\/][^\\/]+[\\/][^\\/]+\.md$/.test(item.originalPath)) throw conflict('Invalid original recovery path.');
  const destination = await safePath(root, item.originalPath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await safePath(root, item.originalPath);
  await fs.copyFile(removedPath, destination, constants.COPYFILE_EXCL);
  // Keep recovery bytes even after restoring, so interrupted calls lose nothing.
  try {
    await library.rebuildIndex(root);
    return { ok: true, id: item.id, restoredPath: item.originalPath, indexUpdated: true };
  } catch (error) {
    return { ok: false, id: item.id, restoredPath: item.originalPath, indexUpdated: false, indexError: error.message };
  }
}

async function listRecovery(root) {
  const base = await safePath(root, path.join('.rinku', 'recovery'));
  let entries;
  try { entries = await fs.readdir(base, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return { batches: [] }; throw error; }
  const batches = [];
  for (const entry of entries.filter(entry => entry.isDirectory())) {
    try {
      const journal = JSON.parse(await fs.readFile(await safePath(root, path.join('.rinku', 'recovery', entry.name, 'manifest.json')), 'utf8'));
      const items = [];
      for (let i = 0; i < journal.items.length; i++) {
        const item = journal.items[i];
        const removed = await safePath(root, path.join('.rinku', 'recovery', entry.name, `${i}-removed.md`));
        const recoverable = await fs.stat(removed).then(stat => stat.isFile(), error => { if (error.code === 'ENOENT') return false; throw error; });
        items.push({ ...item, itemId: String(i), recoverable });
      }
      batches.push({ ...journal, batchId: entry.name, items });
    } catch (error) { batches.push({ batchId: entry.name, error: error.message }); }
  }
  return { batches };
}

async function readWithRevision(root, ref) {
  const indexed = await library.findLinkRecord(root, ref, { rebuild: true, readOnly: true });
  const relative = path.relative(root, indexed.filePath);
  const raw = await fs.readFile(await safePath(root, relative), 'utf8');
  const parsed = parseFrontmatter(raw);
  const link = { ...normalizeLink(parsed.frontmatter), label: indexed.label, status: indexed.status };
  if (link.id !== indexed.id) throw conflict('The record changed while being read; read it again.');
  // The displayed fields and revision must come from the same bytes, not two
  // reads that could straddle an external edit.
  return { ...link, body: parsed.body, filePath: indexed.filePath, fileName: path.basename(indexed.filePath),
    revision: revisionFor(relative, link, raw) };
}

module.exports = { previewDuplicates, executeBatch, recoverDeleted, listRecovery, matchKey, readWithRevision };
