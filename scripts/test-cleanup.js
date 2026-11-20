const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const library = require('../lib/library');
const cleanup = require('../lib/cleanup');
const { createService } = require('../lib/service');
const { readLinkFile } = require('../lib/linkFile');
const { watchLibrary } = require('../lib/libraryWatcher');
const { spawnSync } = require('child_process');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-cleanup-'));
  const writable = createService({ readOnly: false, allowedRoots: [root] });
  const readonly = createService({ readOnly: true, allowedRoots: [root] });
  let sequence = 0;
  async function fixture() {
    const target = path.join(root, `Library-${sequence++}`);
    await library.createLibrary(target);
    return target;
  }
  async function add(target, input = {}) {
    return (await library.createLink(target, { url: 'https://example.com/item', title: 'First',
      createdAt: '2020-01-01T00:00:00Z', ...input }, { allowDuplicates: true, fetchTitle: false, rebuildIndex: false })).link;
  }
  const call = (name, libraryRoot, args = {}, service = writable) => service.execute(`rinku_${name}`, { libraryRoot, ...args });
  const preview = (target, policy = 'exact') => call('preview_duplicates', target, { policy }, readonly);
  const groupsFor = result => result.groups.map(group => ({ records: group.records.map(({ id, revision }) => ({ id, revision })) }));
  try {
    // Deletion is real, recoverable, ID-only, and updates the existing app watcher.
    const target = await fixture();
    const active = await add(target, { id: 'active' });
    const archived = await add(target, { id: 'archived', status: 'archived', body: 'Archived note.' });
    await library.rebuildIndex(target);
    const events = [];
    const stop = watchLibrary(target, event => events.push(event), { intervalMs: 15, debounceMs: 20 });
    let deleted;
    try {
      await delay(40);
      deleted = await call('delete_links', target, { records: [{ id: active.id }, { id: archived.id }] });
      assert(deleted.ok && deleted.indexUpdated);
      assert.deepStrictEqual(deleted.results.map(result => result.status), ['deleted', 'deleted']);
      for (const link of [active, archived]) await assert.rejects(fs.stat(link.filePath), { code: 'ENOENT' });
      assert.strictEqual((await library.readIndex(target)).totals.all, 0);
      for (let i = 0; !events.length && i < 100; i++) await delay(20);
      assert(events.some(event => event.files.includes('.rinku/index.json')), 'Notify the open app through its existing watcher.');
    } finally { stop(); }
    const receipt = deleted.results[1].deleted[0].recovery;
    assert.strictEqual((await readLinkFile(path.join(target, receipt.filePath))).body, 'Archived note.');
    assert.strictEqual((await call('list_recovery', target, {}, readonly)).batches[0].items.filter(item => item.recoverable).length, 2);
    assert((await call('recover_deleted_link', target, { batchId: receipt.batchId, itemId: receipt.itemId })).ok);
    assert.strictEqual((await library.readLink(target, archived.id)).status, 'archived');
    await assert.rejects(call('recover_deleted_link', target, { batchId: receipt.batchId, itemId: receipt.itemId }), /already exists/);
    assert.strictEqual((await call('delete_links', target, { records: [{ id: active.id }] })).results[0].status, 'not_found');
    assert.strictEqual((await call('delete_links', target, { records: [{ id: 'arch' }] })).results[0].status, 'not_found');
    assert.strictEqual((await call('delete_links', target, { records: [{ id: archived.url }] })).results[0].status, 'not_found');
    await assert.rejects(call('delete_links', target, { records: [{ id: archived.id }], permanent: true }), /additional properties/);

    // Explicit equivalence preserves everything except a single trailing path slash.
    const urls = await fixture();
    for (const url of ['https://craigmod.com/ridgeline/110', 'https://craigmod.com/ridgeline/110/',
      'https://craigmod.com/ridgeline/110/?q=1', 'https://craigmod.com/ridgeline/110?q=1',
      'https://craigmod.com/ridgeline/110/#fragment', 'https://craigmod.com/ridgeline/110//',
      'http://craigmod.com/ridgeline/110', 'https://craigmod.com/Ridgeline/110',
      'https://CRAIGMOD.com/ridgeline/110', 'https://craigmod.com/ridgeline/110?']) await add(urls, { url });
    const before = await fs.stat(path.join(urls, '.rinku/index.json'));
    assert.strictEqual((await preview(urls)).groups.length, 0);
    const slashGroups = await preview(urls, 'trailing-slash');
    assert.strictEqual(slashGroups.groups.length, 2);
    assert(slashGroups.groups.every(group => group.records.length === 2));
    assert.strictEqual((await fs.stat(path.join(urls, '.rinku/index.json'))).mtimeMs, before.mtimeMs);
    await assert.rejects(fs.stat(path.join(urls, '.rinku/recovery')), { code: 'ENOENT' });
    await fs.unlink(path.join(urls, '.rinku/index.json'));
    await preview(urls);
    await assert.rejects(fs.stat(path.join(urls, '.rinku/index.json')), { code: 'ENOENT' });
    assert.strictEqual((await call('merge_links', urls, { policy: 'exact', groups: groupsFor(slashGroups) })).results[0].status, 'conflict');

    // Oldest archived record survives; ties use exact ID order. Conflicts and raw
    // originals remain readable through MCP even after ordinary metadata updates.
    const mergeRoot = await fixture();
    const first = await add(mergeRoot, { id: 'a', status: 'archived', label: 'read', tags: ['one'], contexts: ['@Home'], body: 'First note.\n', source: { import: 'old', nested: { id: 1 } } });
    const second = await add(mergeRoot, { id: 'b', title: 'Different title', label: 'watch', tags: ['two'], contexts: ['@Work'], body: 'Second note.', source: { import: 'new', id: 2 } });
    await add(mergeRoot, { id: 'c', createdAt: '2021-01-01', body: 'First note.\n' });
    const original = await fs.readFile(second.filePath, 'utf8');
    const proposed = await preview(mergeRoot);
    assert.strictEqual(proposed.groups[0].survivorId, 'a');
    assert(proposed.groups[0].differences.includes('source'));
    const merged = await call('merge_links', mergeRoot, { policy: 'exact', groups: groupsFor(proposed) });
    assert(merged.ok);
    const survivor = await call('read_link', mergeRoot, { ref: 'a' }, readonly);
    assert.strictEqual(survivor.status, 'archived');
    assert.strictEqual(survivor.label, 'read');
    assert.strictEqual(survivor.title, first.title);
    assert.strictEqual(survivor.body, 'First note.\n\n\n---\n\nSecond note.');
    assert.deepStrictEqual(survivor.tags, ['one', 'two']);
    assert.deepStrictEqual(survivor.contexts, ['@Home', '@Work']);
    assert.deepStrictEqual(survivor.source, first.source);
    const historical = survivor.mergeHistory[0].records.find(record => record.id === 'b');
    assert.strictEqual(historical.rawMarkdown, original);
    assert.strictEqual(historical.title, 'Different title');
    assert.deepStrictEqual(historical.source, { import: 'new', id: 2 });
    await call('update_link', mergeRoot, { ref: 'a', title: 'Edited later' });
    assert.deepStrictEqual((await call('read_link', mergeRoot, { ref: 'a' })).mergeHistory, survivor.mergeHistory);
    assert.strictEqual((await preview(mergeRoot)).groups.length, 0);
    assert.strictEqual((await call('merge_links', mergeRoot, { policy: 'exact', groups: groupsFor(proposed) })).results[0].status, 'conflict');

    // A changed file after preview is rejected before writing anything.
    const stale = await fixture();
    const edited = await add(stale, { id: 'oldest', createdAt: '2019-01-01' });
    await add(stale, { id: 'newer' });
    const stalePreview = await preview(stale);
    await fs.appendFile(edited.filePath, 'External edit');
    const rejected = await call('merge_links', stale, { policy: 'exact', groups: groupsFor(stalePreview) });
    assert.strictEqual(rejected.results[0].status, 'conflict');
    assert.strictEqual(rejected.indexUpdated, false);
    assert.strictEqual((await library.listLinks(stale, { rebuild: true, readOnly: true })).total, 2);
    assert.strictEqual((await call('delete_links', stale, { records: stalePreview.groups[0].records.map(({ id, revision }) => ({ id, revision })).slice(0, 1) })).results[0].status, 'conflict');

    // Duplicate IDs are ambiguous even if filenames/titles are different.
    const ambiguous = await fixture();
    await add(ambiguous, { id: 'same', title: 'One' });
    await add(ambiguous, { id: 'same', title: 'Two' });
    assert.strictEqual((await call('delete_links', ambiguous, { records: [{ id: 'same' }] })).results[0].status, 'conflict');
    assert.strictEqual((await preview(ambiguous)).groups[0].mergeable, false);

    const invalidDate = await fixture();
    const invalid = await add(invalidDate, { id: 'invalid' });
    await add(invalidDate, { id: 'valid' });
    await fs.writeFile(invalid.filePath, (await fs.readFile(invalid.filePath, 'utf8')).replace(/createdAt:.*\n/, 'createdAt: "not-a-date"\n'));
    const invalidPreview = await preview(invalidDate);
    assert.strictEqual(invalidPreview.groups[0].mergeable, false);
    assert.strictEqual((await call('merge_links', invalidDate, { policy: 'exact', groups: groupsFor(invalidPreview) })).results[0].status, 'conflict');

    // Permission boundaries cover every new operation and recovery storage.
    for (const [name, args] of [
      ['delete_links', { records: [{ id: 'archived' }] }],
      ['merge_links', { policy: 'exact', groups: groupsFor(proposed) }],
      ['recover_deleted_link', { batchId: receipt.batchId, itemId: receipt.itemId }],
    ]) await assert.rejects(call(name, target, args, readonly), /read-only/);
    const denied = createService({ readOnly: false, allowedRoots: [path.join(root, 'other')] });
    for (const [name, args] of [['delete_links', { records: [{ id: 'archived' }] }], ['preview_duplicates', { policy: 'exact' }], ['list_recovery', {}]]) {
      await assert.rejects(call(name, target, args, denied), /outside.*allowed roots/);
    }
    const symlinkRoot = await fixture();
    await fs.symlink(target, path.join(symlinkRoot, 'links/escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(call('delete_links', symlinkRoot, { records: [{ id: 'archived' }] }), /Symlinks/);
    const narrow = createService({ readOnly: false, allowedRoots: [symlinkRoot] });
    await assert.rejects(call('delete_links', path.join(symlinkRoot, 'links/escape'), { records: [{ id: archived.id }] }, narrow), /outside.*allowed roots/);
    await fs.rm(path.join(symlinkRoot, 'links/escape'));
    await fs.symlink(target, path.join(symlinkRoot, '.rinku/recovery'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(call('delete_links', symlinkRoot, { records: [{ id: 'archived' }] }), /Symlinks/);

    // Failure after writing a survivor removes nothing until verification passes.
    const failure = await fixture();
    await add(failure, { id: 'one' });
    await add(failure, { id: 'two' });
    let failPreview = await preview(failure);
    const partial = await cleanup.executeBatch(failure, 'merge', groupsFor(failPreview), 'exact', {
      afterSurvivorWrite: async ({ survivorPath }) => fs.appendFile(survivorPath, 'Concurrent edit'),
    });
    assert.strictEqual(partial.results[0].status, 'partial');
    assert.strictEqual(partial.results[0].deleted.length, 0);
    assert(partial.indexUpdated);
    assert.strictEqual((await library.readIndex(failure)).totals.all, 2);
    assert((await library.readLink(failure, 'one')).body.includes('Concurrent edit'));

    // Mid-removal failure reports exactly the completed subset; recovery works
    // even when the index rebuild or final receipt write was interrupted.
    const midway = await fixture();
    for (const id of ['a', 'b', 'c']) await add(midway, { id });
    failPreview = await preview(midway);
    const midwayResult = await cleanup.executeBatch(midway, 'merge', groupsFor(failPreview), 'exact', {
      beforeRemove: ({ index }) => { if (index === 2) throw new Error('Injected move failure'); },
      rebuildIndex: async () => { throw new Error('Injected index failure'); },
    });
    assert.strictEqual(midwayResult.results[0].status, 'partial');
    assert.deepStrictEqual(midwayResult.results[0].deleted.map(link => link.id), ['b']);
    assert.match(midwayResult.indexError, /Injected/);
    const recovered = await call('list_recovery', midway, {}, readonly);
    const recoveryItem = recovered.batches[0].items.find(item => item.id === 'b');
    assert(recoveryItem.recoverable);
    assert((await call('recover_deleted_link', midway, { batchId: midwayResult.batchId, itemId: recoveryItem.itemId })).ok);
    assert.strictEqual((await library.readIndex(midway)).totals.all, 3);

    // Abrupt process exit leaves the pre-mutation manifest. Discovery must inspect
    // actual removed files, not just trust its old moved flags or results array.
    const crashRoot = await fixture();
    for (const id of ['a', 'b', 'c']) await add(crashRoot, { id, body: `Notes from ${id}` });
    const crashGroups = groupsFor(await preview(crashRoot));
    const child = spawnSync(process.execPath, ['-e', `
      const cleanup = require(process.argv[2]);
      cleanup.executeBatch(process.argv[1], 'merge', JSON.parse(process.argv[3]), 'exact', {
        beforeRemove: ({ index }) => { if (index === 2) process.exit(77); }
      }).catch(error => { console.error(error); process.exit(1); });
    `, crashRoot, path.resolve(__dirname, '../lib/cleanup.js'), JSON.stringify(crashGroups)], { encoding: 'utf8' });
    assert.strictEqual(child.status, 77, child.stderr);
    const interrupted = (await call('list_recovery', crashRoot, {}, readonly)).batches[0];
    assert.strictEqual(interrupted.state, 'running');
    const removedItem = interrupted.items.find(item => item.id === 'b');
    assert(removedItem.recoverable);
    assert(!removedItem.moved, 'The pre-mutation manifest intentionally lacks the completed move.');
    assert((await call('recover_deleted_link', crashRoot, { batchId: interrupted.batchId, itemId: removedItem.itemId })).ok);
    assert.strictEqual((await library.readIndex(crashRoot)).totals.all, 3);
    assert((await library.readLink(crashRoot, 'a')).body.includes('Notes from c'));

    // Bulk cleanup performs a fixed two scans (snapshot + final rebuild), not
    // one scan per bookmark, and only ONE index replacement for the whole batch.
    const bulk = await fixture();
    for (let i = 0; i < 10; i++) {
      await add(bulk, { id: `a-${i}`, url: `https://example.com/${i}` });
      await add(bulk, { id: `b-${i}`, url: `https://example.com/${i}` });
    }
    const bulkPreview = await preview(bulk);
    let rebuilds = 0;
    let snapshots = 0;
    const originalList = library.listLinks;
    library.listLinks = (...args) => { snapshots++; return originalList(...args); };
    let bulkResult;
    try {
      bulkResult = await cleanup.executeBatch(bulk, 'merge', groupsFor(bulkPreview), 'exact', {
        rebuildIndex: async target => { rebuilds++; return library.rebuildIndex(target); },
      });
    } finally { library.listLinks = originalList; }
    assert(bulkResult.ok);
    assert.strictEqual(rebuilds, 1);
    assert.strictEqual(snapshots, 1);
    assert.strictEqual((await library.readIndex(bulk)).totals.all, 10);
    console.log('Cleanup deletion, merge, recovery, conflicts, permissions, watcher, and batch checks passed.');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
