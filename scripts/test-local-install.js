const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { replaceApp, checkSource, validateRuntimeIdentity } = require('./install-mac');
const { sourceFingerprint } = require('./build-info');

async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rinku-install-test-'));
  const staged = path.join(temporary, 'staged');
  const installed = path.join(temporary, 'installed');
  const previous = path.join(temporary, 'previous');
  function bundle(directory, value) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'version'), value);
  }
  const version = directory => fs.readFileSync(path.join(directory, 'version'), 'utf8');
  try {
    const executable = path.join(temporary, 'Rinku');
    const alias = path.join(temporary, 'Rinku-alias');
    const other = path.join(temporary, 'Other');
    fs.writeFileSync(executable, 'fixture');
    fs.writeFileSync(other, 'different executable');
    fs.symlinkSync(executable, alias);
    const expectedRuntime = { version: '0.1.3-beta.1', electron: '45.3.2', sourceSha256: 'fixture-source' };
    const runtime = { ...expectedRuntime, mode: 'packaged', executablePath: executable };
    validateRuntimeIdentity(runtime, expectedRuntime, alias);
    assert.throws(() => validateRuntimeIdentity({ ...runtime, executablePath: other }, expectedRuntime, alias), /mismatch: executable/);
    assert.throws(() => validateRuntimeIdentity({ ...runtime, sourceSha256: 'stale' }, expectedRuntime, alias), /mismatch: source/);
    assert.throws(() => validateRuntimeIdentity({ ...runtime, electron: 'old' }, expectedRuntime, alias), /mismatch: electron/);
    assert.throws(() => validateRuntimeIdentity({ ...runtime, identityError: 'missing metadata' }, expectedRuntime, alias), /mismatch: identity/);
    bundle(installed, 'old');
    bundle(staged, 'new');
    await assert.rejects(replaceApp(staged, installed, previous, async () => {
      assert.strictEqual(version(installed), 'new');
      throw new Error('packaged UI check failed');
    }), /packaged UI check failed/);
    assert.strictEqual(version(installed), 'old', 'A failed installed-app check restores the old app.');
    assert.strictEqual(version(staged), 'new');
    assert(!fs.existsSync(previous));

    await replaceApp(staged, installed, previous, async () => {});
    assert.strictEqual(version(installed), 'new');
    assert.strictEqual(version(previous), 'old');
    bundle(staged, 'newer');
    await assert.rejects(replaceApp(staged, installed, previous, async () => {}), /Refusing to overwrite/);
    assert.strictEqual(version(installed), 'new');
    assert.strictEqual(version(previous), 'old');

    fs.rmSync(previous, { recursive: true });
    fs.rmSync(staged, { recursive: true });
    await assert.rejects(replaceApp(staged, installed, previous, async () => {}), /ENOENT/);
    assert.strictEqual(version(installed), 'new', 'A failed rename also restores the app.');

    fs.rmSync(installed, { recursive: true });
    bundle(staged, 'first install');
    await assert.rejects(replaceApp(staged, installed, previous, async () => { throw new Error('failed'); }), /failed/);
    assert(!fs.existsSync(installed), 'Failed first install leaves no broken app behind.');

    const resources = path.join(staged, 'Contents/Resources');
    fs.mkdirSync(resources, { recursive: true });
    const repo = path.resolve(__dirname, '..');
    assert.throws(() => checkSource(staged, repo), /no source fingerprint/);
    fs.writeFileSync(path.join(resources, 'rinku-build.json'), JSON.stringify({ sourceSha256: 'stale' }));
    assert.throws(() => checkSource(staged, repo), /does not match/);
    fs.writeFileSync(path.join(resources, 'rinku-build.json'), JSON.stringify({ sourceSha256: sourceFingerprint(repo) }));
    assert.strictEqual(checkSource(staged, repo).sourceSha256, sourceFingerprint(repo));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

run().then(() => console.log('Local install rollback and source checks passed.')).catch(error => { console.error(error); process.exitCode = 1; });
