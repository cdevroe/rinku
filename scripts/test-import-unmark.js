const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { createLibrary, listLinks, readLink } = require('../lib/library');
const { importUnmarkExport } = require('../lib/importers');

const REAL_EXPORT_PATH = '/Users/cdevroe/Downloads/export-3.json';

async function makeFixture(filePath) {
  const fixture = {
    export: {
      export_version: 1,
      export_date: '2026-06-24 13:36:58',
      marks_count: 3,
      marks: [
        {
          mark_id: '1',
          mark_title: null,
          notes: 'A note',
          active: '1',
          created_on: '2026-06-23 16:19:16',
          archived_on: null,
          title: 'Caleb Thal Photography',
          url: 'https://calebthal.com/',
          embed: null,
          label_id: '1',
          label_name: 'Unlabeled',
          tags: {
            photography: { tag_id: '358', name: 'photography', slug: 'photography' },
          },
        },
        {
          mark_id: '2',
          mark_title: 'Custom title',
          notes: null,
          active: '1',
          created_on: '2026-05-20 16:52:15',
          archived_on: '2026-06-01 10:00:00',
          title: 'Original title',
          url: 'https://cdn.openai.com/example.pdf',
          embed: null,
          label_id: '2',
          label_name: 'Read',
          tags: {},
        },
        {
          mark_id: '3',
          mark_title: null,
          notes: null,
          active: '1',
          created_on: '2026-05-20 16:52:15',
          archived_on: null,
          title: 'Duplicate',
          url: 'https://calebthal.com/',
          embed: null,
          label_id: '1',
          label_name: 'Unlabeled',
          tags: {},
        },
      ],
    },
  };
  await fs.writeFile(filePath, JSON.stringify(fixture, null, 2), 'utf8');
}

async function runSyntheticImport() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-import-'));
  const libraryRoot = path.join(root, 'Library');
  const fixturePath = path.join(root, 'unmark-export.json');

  try {
    await createLibrary(libraryRoot);
    await makeFixture(fixturePath);
    const result = await importUnmarkExport(libraryRoot, fixturePath);
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.added, 2);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.archived, 1);

    const all = await listLinks(libraryRoot, { rebuild: true });
    assert.strictEqual(all.links.length, 2);

    const active = await listLinks(libraryRoot, { status: 'active' });
    assert.strictEqual(active.links.length, 1);
    assert(active.links[0].filePath.includes(`${path.sep}links${path.sep}Unlabeled${path.sep}`));

    const archived = await listLinks(libraryRoot, { status: 'archived' });
    assert.strictEqual(archived.links.length, 1);
    assert(archived.links[0].filePath.includes(`${path.sep}archive${path.sep}Read${path.sep}`));
    assert.strictEqual(archived.links[0].title, 'Custom title');

    const activeFull = await readLink(libraryRoot, active.links[0].id);
    assert.strictEqual(activeFull.body, 'A note');
    assert.deepStrictEqual(activeFull.tags, ['photography']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function runRealExportSmoke() {
  try {
    await fs.access(REAL_EXPORT_PATH);
  } catch {
    console.log('test-import-unmark real export skipped');
    return;
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-real-import-'));
  const libraryRoot = path.join(root, 'Library');
  try {
    await createLibrary(libraryRoot);
    const result = await importUnmarkExport(libraryRoot, REAL_EXPORT_PATH);
    assert.strictEqual(result.total, 3735);
    assert.strictEqual(result.added, 3735);
    assert.strictEqual(result.skipped, 0);
    assert.strictEqual(result.archived, 1392);

    const all = await listLinks(libraryRoot, { rebuild: true });
    assert.strictEqual(all.links.length, 3735);
    const labels = new Set(all.links.map((link) => link.label));
    assert(labels.has('read'));
    assert(labels.has('unlabeled'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function run() {
  await runSyntheticImport();
  await runRealExportSmoke();
}

run().then(() => {
  console.log('test-import-unmark passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
