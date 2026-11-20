const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const library = require('../lib/library');
const cleanup = require('../lib/cleanup');
const { createService } = require('../lib/service');
const { captureRuntimeInfo, runtimeInfo } = require('../lib/runtimeInfo');
const { sourceFingerprint } = require('./build-info');
const { callTool } = require('../lib/mcpServer');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-automation-'));
  const root = path.join(temp, 'Library');
  const config = { readOnly: false, allowedRoots: [root] };
  const service = createService(config);
  const call = (name, args = {}) => service.execute(`rinku_${name}`, { libraryRoot: root, ...args });
  function cli(args, expectedCode = 0) {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/rinku.js'), ...args, '--json'], {
      env: { ...process.env, RINKU_CONFIG_HOME: path.join(temp, 'config') }, encoding: 'utf8',
    });
    assert.strictEqual(result.status, expectedCode, result.stderr || result.stdout);
    assert.strictEqual(result.stderr, '');
    return JSON.parse(result.stdout);
  }
  async function input(value) {
    const file = path.join(temp, 'batch.json');
    await fs.writeFile(file, JSON.stringify(value));
    return file;
  }
  try {
    await library.createLibrary(root);
    for (let i = 0; i < 221; i++) await library.createLink(root, {
      id: `bulk-${i}`, url: `https://example.com/${i}`, title: `Bookmark ${i}`, body: `Original ${i}`,
      source: { import: { id: i } }, contexts: ['@Home'], status: i % 2 ? 'archived' : 'active',
      ...(i === 0 ? { mergeHistory: [{ preserved: true }] } : {}),
    }, { fetchTitle: false, allowDuplicates: true, rebuildIndex: false });
    const records = Array.from({ length: 221 }, (_, i) => ({ id: `bulk-${i}`, patch: { tags: ['batch', 'Test'] } }));
    let scans = 0;
    let rebuilds = 0;
    const originalList = library.listLinks;
    library.listLinks = (...args) => { scans++; return originalList(...args); };
    let result;
    try {
      result = await cleanup.executeBatch(root, 'update', records, undefined, {
        rebuildIndex: async root => { rebuilds++; return library.rebuildIndex(root); },
      });
    } finally { library.listLinks = originalList; }
    assert(result.ok);
    assert.strictEqual(scans, 1);
    assert.strictEqual(rebuilds, 1);
    assert.strictEqual(result.results.length, 221);
    const index = await library.readIndex(root);
    assert.strictEqual(index.totals.all, 221);
    assert.strictEqual(index.totals.archived, 110);
    for (const record of records) {
      const link = await library.readLink(root, record.id);
      assert.deepStrictEqual(link.tags, ['batch', 'test']);
      assert.deepStrictEqual(link.contexts, ['@Home']);
      assert.strictEqual(link.body, `Original ${link.source.import.id}`);
    }
    const read = await call('read_link', { ref: 'bulk-0' });
    assert.match(read.revision, /^[a-f0-9]{64}$/);
    assert.deepStrictEqual(read.mergeHistory, [{ preserved: true }]);
    const settingsBefore = await fs.readFile(path.join(root, 'rinku-settings.md'), 'utf8');
    result = await call('update_links', { records: [
      { id: 'bulk-0', revision: read.revision, patch: { title: 'New title', label: 'Watch', contexts: [], body: '' } },
      { id: 'bulk-1', patch: { label: 'Read', tags: [] } },
    ] });
    assert(result.ok);
    assert.strictEqual(result.results[0].link.label, 'watch');
    assert.strictEqual(result.results[1].link.status, 'archived');
    assert(result.results[1].link.filePath.startsWith(`archive${path.sep}`));
    assert.deepStrictEqual(result.results[0].link.mergeHistory, [{ preserved: true }]);
    assert.strictEqual(await fs.readFile(path.join(root, 'rinku-settings.md'), 'utf8'), settingsBefore, 'Bulk edits do not teach smart-label rules.');
    assert.strictEqual((await library.readIndex(root)).totals.all, 221);
    const stale = await callTool('rinku_update_links', { libraryRoot: root, records: [{ id: read.id, revision: read.revision, patch: { title: 'Stale' } }] }, config);
    assert.strictEqual(stale.isError, true);
    assert.strictEqual(stale.structuredContent.error.code, 'conflict');
    assert.strictEqual(stale.structuredContent.indexUpdated, false);
    await assert.rejects(call('update_links', { records: [{ id: 'bulk-2', patch: { url: 'https://evil.example' } }] }), /additional properties/);
    await assert.rejects(call('update_links', { records: [{ id: 'bulk-2', patch: {} }] }), /properties/);
    const readonly = createService({ ...config, readOnly: true });
    await assert.rejects(readonly.execute('rinku_update_links', { libraryRoot: root, records }), /read-only/);
    const outside = createService({ ...config, allowedRoots: [path.join(temp, 'Other')] });
    await assert.rejects(outside.execute('rinku_update_links', { libraryRoot: root, records }), /outside.*allowed roots/);

    // A failure after a batch write is partial, preserves originals, and still indexes.
    const failure = await cleanup.executeBatch(root, 'update', [{ id: 'bulk-2', patch: { body: 'Changed' } }], undefined, {
      afterUpdateWrite: () => { throw new Error('Injected verification interruption'); },
    });
    assert.strictEqual(failure.results[0].status, 'partial');
    assert(failure.indexUpdated);
    const recovery = await cleanup.listRecovery(root);
    const saved = recovery.batches.find(batch => batch.batchId === failure.batchId).items[0];
    assert((await fs.readFile(path.join(root, failure.recoveryDirectory, saved.backup), 'utf8')).includes('Original 2'));

    // Real command-line interface: statuses, full receipts, JSON input, library
    // boundaries, shared duplicate merging, and recovery without hand-editing files.
    cli(['use', root]);
    const patchFile = await input({ records: [{ id: 'bulk-3', patch: { title: 'From CLI' } }, { id: 'absent', patch: { title: 'Missing' } }] });
    const partial = cli(['links', 'update-batch', '--file', patchFile], 2);
    assert.strictEqual(partial.error.code, 'partial_failure');
    assert.strictEqual(partial.results[0].status, 'updated');
    assert.strictEqual(partial.results[1].status, 'not_found');
    assert(partial.recoveryDirectory);
    assert.strictEqual(cli(['links', 'delete', 'absent'], 1).error.code, 'not_found');
    assert.strictEqual(cli(['links', 'delete', 'bulk-3', '--permanent'], 1).error.code, 'invalid_arguments');
    assert.strictEqual(cli(['links', 'update-batch', '--file', await input({ libraryRoot: temp, records })], 1).error.code, 'invalid_arguments');
    assert.strictEqual(cli(['links', 'delete', '--file', await input({ records: [{ id: 'bulk-3' }] }), '--dry-run'], 1).error.code, 'invalid_arguments');
    assert.strictEqual(cli(['unknown'], 1).error.code, 'invalid_arguments');
    const deleted = cli(['links', 'delete', 'bulk-3']);
    const receipt = deleted.results[0].deleted[0].recovery;
    assert(cli(['recovery', 'restore', receipt.batchId, receipt.itemId]).ok);
    assert(cli(['recovery', 'list']).batches.length > 0);
    await library.createLink(root, { id: 'duplicate', url: 'https://example.com/4/', title: 'Duplicate', body: 'Other notes' }, { allowDuplicates: true, fetchTitle: false });
    const preview = cli(['links', 'duplicates', '--policy', 'trailing-slash']);
    const mergeFile = await input({ policy: 'trailing-slash', groups: preview.groups.map(group => ({ records: group.records.map(({ id, revision }) => ({ id, revision })) })) });
    assert(cli(['links', 'merge', '--file', mergeFile]).ok);
    assert.strictEqual(cli(['links', 'duplicates', '--policy', 'trailing-slash']).groups.length, 0);

    // Runtime identity: real CLI output, startup snapshot, packaged metadata,
    // and missing metadata explicitly reported rather than inventing a fingerprint.
    const version = cli(['--version']);
    const info = cli(['build-info']);
    assert.strictEqual(info.version, require('../package.json').version);
    assert.strictEqual(version.sourceSha256, info.sourceSha256);
    assert.strictEqual(info.sourceSha256, sourceFingerprint(path.resolve(__dirname, '..')));
    assert.strictEqual(info.executablePath, process.execPath);
    assert.strictEqual(runtimeInfo, (await service.execute('rinku_get_config', {})).runtime);
    assert(Object.isFrozen(runtimeInfo));
    const fakeOut = path.join(temp, 'packaged');
    await require('./bundle-safari').default({ electronPlatformName: 'linux', appOutDir: fakeOut, packager: { appInfo: { productFilename: 'Rinku' } } });
    const metadataPath = path.join(fakeOut, 'resources/rinku-build.json');
    const metadata = JSON.parse(await fs.readFile(metadataPath));
    assert.strictEqual(metadata.sourceSha256, info.sourceSha256);
    const options = { appPath: path.join(fakeOut, 'resources/app.asar'), metadataPath };
    const packaged = captureRuntimeInfo(options);
    assert.strictEqual(packaged.mode, 'packaged');
    assert.strictEqual(packaged.sourceSha256, metadata.sourceSha256);
    assert(packaged.builtAt);
    await fs.writeFile(metadataPath, JSON.stringify({ ...metadata, sourceSha256: 'a'.repeat(64) }));
    assert.strictEqual(packaged.sourceSha256, metadata.sourceSha256, 'A running process retains the old build identity after replacement.');
    assert.strictEqual(captureRuntimeInfo(options).sourceSha256, 'a'.repeat(64));
    await fs.unlink(metadataPath);
    assert.strictEqual(captureRuntimeInfo(options).sourceSha256, null);
    assert(captureRuntimeInfo(options).identityError);
    console.log('221-record batch, CLI cleanup, structured failures, and runtime identity checks passed.');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
