const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const {
  archiveLink,
  createLibrary,
  createLink,
  listLinks,
  readLink,
  readSettings,
  renameLabel,
  updateLink,
  updateSettings,
} = require('../lib/library');

async function makeTempLibrary() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-core-'));
  const libraryRoot = path.join(root, 'Library');
  await createLibrary(libraryRoot);
  return { root, libraryRoot };
}

async function run() {
  const { root, libraryRoot } = await makeTempLibrary();

  try {
    const settings = await readSettings(libraryRoot);
    assert(settings.labels.some((label) => label.id === 'read'), 'default Read label should exist');
    assert.deepStrictEqual(settings.contexts, ['@Home', '@Work']);
    assert.strictEqual(settings.smartLabels.learnFromManualChanges, true);

    const first = await createLink(libraryRoot, {
      url: 'https://www.youtube.com/watch?v=abc123',
      title: 'A useful video',
    });
    assert.strictEqual(first.link.label, 'watch', 'builtin smart label should classify YouTube as Watch');
    assert(first.link.filePath.includes(`${path.sep}links${path.sep}Watch${path.sep}`));

    const updated = await updateLink(libraryRoot, first.link.id, {
      label: 'Read',
      tags: ['Video', 'Research'],
      contexts: ['Home', '@Work'],
      body: 'Watch this before writing notes.',
    }, { learnRule: true });
    assert.strictEqual(updated.label, 'read');
    assert.deepStrictEqual(updated.tags, ['video', 'research']);
    assert.deepStrictEqual(updated.contexts, ['@Home', '@Work']);
    assert(updated.filePath.includes(`${path.sep}links${path.sep}Read${path.sep}`));

    const nextSettings = await readSettings(libraryRoot);
    assert(nextSettings.smartLabels.rules.some((rule) => rule.domain === 'youtube.com' && rule.label === 'read'));

    const second = await createLink(libraryRoot, {
      url: 'https://youtube.com/@somewhere',
      title: 'Channel',
    });
    assert.strictEqual(second.link.label, 'read', 'learned label should override builtin rule');

    const archived = await archiveLink(libraryRoot, updated.id);
    assert.strictEqual(archived.status, 'archived');
    assert(archived.filePath.includes(`${path.sep}archive${path.sep}Read${path.sep}`));

    const activeRead = await listLinks(libraryRoot, { status: 'active', label: 'read' });
    assert.strictEqual(activeRead.links.length, 1);

    const archivedRead = await listLinks(libraryRoot, { status: 'archived', label: 'read' });
    assert.strictEqual(archivedRead.links.length, 1);

    const full = await readLink(libraryRoot, archived.id);
    assert.strictEqual(full.body, 'Watch this before writing notes.');

    const renamedSettings = await renameLabel(libraryRoot, 'read', 'Reading');
    assert(renamedSettings.labels.some((label) => label.id === 'read' && label.name === 'Reading'));

    const renamedActive = await listLinks(libraryRoot, { status: 'active', label: 'read' });
    assert.strictEqual(renamedActive.links.length, 1);
    assert(renamedActive.links[0].filePath.includes(`${path.sep}links${path.sep}Reading${path.sep}`));

    const renamedArchived = await listLinks(libraryRoot, { status: 'archived', label: 'read' });
    assert.strictEqual(renamedArchived.links.length, 1);
    assert(renamedArchived.links[0].filePath.includes(`${path.sep}archive${path.sep}Reading${path.sep}`));

    const customizedSettings = await updateSettings(libraryRoot, {
      labels: [
        ...renamedSettings.labels.map((label) => (
          label.id === 'read'
            ? { ...label, name: 'Research', color: '#123456' }
            : label
        )),
        { name: 'Study Later', color: '#38bdf8' },
      ],
      contexts: ['Home', '@Studio'],
    });
    assert(customizedSettings.labels.some((label) => label.id === 'read' && label.name === 'Research' && label.color === '#123456'));
    assert(customizedSettings.labels.some((label) => label.id === 'study-later' && label.name === 'Study Later'));
    assert.deepStrictEqual(customizedSettings.contexts, ['@Home', '@Studio']);
    await fs.access(path.join(libraryRoot, 'links', 'Study Later'));

    const customizedActive = await listLinks(libraryRoot, { status: 'active', label: 'read' });
    assert.strictEqual(customizedActive.links.length, 1);
    assert(customizedActive.links[0].filePath.includes(`${path.sep}links${path.sep}Research${path.sep}`));

    const customizedArchived = await listLinks(libraryRoot, { status: 'archived', label: 'read' });
    assert.strictEqual(customizedArchived.links.length, 1);
    assert(customizedArchived.links[0].filePath.includes(`${path.sep}archive${path.sep}Research${path.sep}`));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().then(() => {
  console.log('test-core passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
