const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { watchLibrary } = require('../lib/libraryWatcher');
const { atomicWriteFile } = require('../lib/atomicFile');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert(Date.now() < deadline, 'Timed out waiting for a library change.');
    await delay(20);
  }
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-watcher-'));
  const indexPath = path.join(root, '.rinku', 'index.json');
  const events = [];
  let stop;
  try {
    await atomicWriteFile(indexPath, '{}');
    stop = watchLibrary(root, payload => events.push(payload), { intervalMs: 15, debounceMs: 30 });
    await delay(80);
    assert.strictEqual(events.length, 0, 'Opening a library must not emit a change.');
    await atomicWriteFile(indexPath, '{"version":1}');
    await waitFor(() => events.length === 1);
    assert.deepStrictEqual(events[0], { libraryRoot: root, files: ['.rinku/index.json'] });
    await atomicWriteFile(indexPath, '{"version":2}');
    await waitFor(() => events.length === 2);
    await atomicWriteFile(path.join(root, 'rinku-settings.md'), 'settings');
    await waitFor(() => events.length === 3);
    assert.deepStrictEqual(events[2].files, ['rinku-settings.md']);
    await fs.unlink(indexPath);
    await waitFor(() => events.length === 4);
    await atomicWriteFile(indexPath, '{}');
    await waitFor(() => events.length === 5);
    stop();
    await atomicWriteFile(indexPath, '{"version":3}');
    await delay(100);
    assert.strictEqual(events.length, 5, 'Closing the watcher must detach its listeners.');
  } finally {
    stop?.();
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().then(() => console.log('test-library-watcher passed')).catch(error => { console.error(error); process.exitCode = 1; });
