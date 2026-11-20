const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createLibrary, createLink, updateLink, archiveLink, restoreLink } = require('../lib/library');
const { resolveLinkFile } = require('../lib/linkFileLocation');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-reveal-'));
  try {
    await createLibrary(root);
    const { link } = await createLink(root, { url: 'https://example.com/file', title: 'Reveal me', label: 'read' }, { fetchTitle: false });
    const index = path.join(root, '.rinku/index.json');
    const before = await fs.stat(index);
    assert.strictEqual(await resolveLinkFile(root, link.id), link.filePath);
    assert.strictEqual((await fs.stat(index)).mtimeMs, before.mtimeMs, 'Resolving does not rewrite the index.');
    const moved = await updateLink(root, link.id, { label: 'watch' });
    assert.notStrictEqual(moved.filePath, link.filePath);
    assert.strictEqual(await resolveLinkFile(root, link.id), moved.filePath);
    const archived = await archiveLink(root, link.id);
    assert.strictEqual(await resolveLinkFile(root, link.id), archived.filePath);
    const restored = await restoreLink(root, link.id);
    assert.strictEqual(await resolveLinkFile(root, link.id), restored.filePath);
    await assert.rejects(resolveLinkFile(root, link.filePath), /could not be found/);
    await assert.rejects(resolveLinkFile(root, link.id.slice(0, 4)), /could not be found/);
    await assert.rejects(resolveLinkFile('', link.id), /Open a library/);
    await assert.rejects(resolveLinkFile(root, null), /Select a link/);
    await fs.unlink(restored.filePath);
    await assert.rejects(resolveLinkFile(root, link.id), /moved or deleted/);
    console.log('Link file location checks passed.');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
