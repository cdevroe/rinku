const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
const config = require('../electron-builder.json');

// Exercise the actual packaging consumers of the scoped minimatch overrides,
// including legacy ASAR/glob consumers that still require a callable export.
async function run() {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-build-matching-'));
  try {
    const source = path.join(scratch, 'source');
    const filter = new FileMatcher(source, path.join(scratch, 'output'), value => value, config.files).createFilter();
    const matches = (file, directory = false) => filter(path.join(source, file), { isDirectory: () => directory });
    for (const file of ['app/app.js', 'bin/rinku.js', 'lib/service.js', 'static/styles.css', 'index.html', 'main.js', 'preload.js', 'package.json', 'build/icon-macos.png']) {
      assert.equal(matches(file), true, `include ${file}`);
    }
    for (const file of ['.env', 'signing/private.p12', 'library/bookmark.md', 'dist/Rinku.app/main.js', 'app/app.js.map', 'app/.DS_Store', 'node_modules/.cache/cache.json', 'scripts/test-core.js']) {
      assert.equal(matches(file), false, `exclude ${file}`);
    }
    for (const directory of ['app', 'lib', 'build']) assert.equal(matches(directory, true), true, `traverse ${directory}`);

    const braceFilter = new FileMatcher(source, scratch, value => value, ['{app,lib}/**', '!**/*.map']).createFilter();
    assert.equal(braceFilter(path.join(source, 'lib', 'nested', 'file.js'), { isDirectory: () => false }), true);
    assert.equal(braceFilter(path.join(source, 'lib', 'file.js.map'), { isDirectory: () => false }), false);

    const universalPackage = require.resolve('@electron/universal/package.json');
    const universalRequire = createRequire(universalPackage);
    const asar = universalRequire('@electron/asar');
    const { mergeASARs } = require(path.join(path.dirname(universalPackage), 'dist/cjs/asar-utils.js'));
    const matcher = universalRequire('minimatch');
    assert.equal(matcher.minimatch('nested/Info.plist', '*.plist', { matchBase: true }), true);
    assert.equal(matcher.minimatch('nested/secret.txt', '*.plist', { matchBase: true }), false);
    // The macOS universal merger assumes POSIX archive paths. Its listPackage
    // conversion does not handle Windows separators; Windows packaging does
    // not use this merger. Keep the real file filters and matcher checks above
    // on every platform, and exercise archive merging on macOS and Linux.
    if (process.platform === 'win32') {
      console.log('test-build-matching passed: packaging allowlist, exclusions, traversal, and universal matcher; POSIX-only universal ASAR merge skipped on Windows');
      return;
    }
    const archives = {};
    for (const arch of ['x64', 'arm64']) {
      const dir = path.join(scratch, arch);
      await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
      await fs.writeFile(path.join(dir, 'index.js'), 'module.exports = "shared";');
      await fs.writeFile(path.join(dir, 'assets', `${arch}.txt`), `${arch} fixture`);
      archives[arch] = path.join(scratch, `${arch}.asar`);
      await asar.createPackage(dir, archives[arch]);
    }
    const options = { x64AsarPath: archives.x64, arm64AsarPath: archives.arm64, outputAsarPath: path.join(scratch, 'merged.asar') };
    await assert.rejects(mergeASARs({ ...options, singleArchFiles: 'unrelated.txt' }), /not covered by allowList/);
    assert.equal(await fs.stat(options.outputAsarPath).catch(() => null), null, 'rejected merge produces no archive');
    await mergeASARs({ ...options, singleArchFiles: '{x64,arm64}.txt' });
    for (const arch of ['x64', 'arm64']) {
      assert.equal(asar.extractFile(options.outputAsarPath, `assets/${arch}.txt`).toString(), `${arch} fixture`);
    }
    assert.equal(asar.extractFile(options.outputAsarPath, 'index.js').toString(), 'module.exports = "shared";');
    console.log('test-build-matching passed: packaging allowlist, exclusions, traversal, and universal ASAR merge');
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
