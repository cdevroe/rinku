const assert = require('assert').strict;
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createSafariExtension } = require('../lib/safariExtension');
const { buildSafari, EXTENSION_NAME, HELPER_NAME } = require('./build-safari');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-safari-test-'));
  try {
    const resourcesPath = path.join(temp, 'Rinku.app', 'Contents', 'Resources');
    const contents = path.dirname(resourcesPath);
    const options = { platform: 'darwin', isPackaged: true, resourcesPath };
    assert.deepEqual(await createSafariExtension({ ...options, platform: 'win32' }).status(), { supported: false, bundled: false, enabled: false });
    assert.deepEqual(await createSafariExtension({ ...options, isPackaged: false }).status(), { supported: true, bundled: false, enabled: false });
    assert.deepEqual(await createSafariExtension(options).status(), { supported: true, bundled: false, enabled: false });
    await assert.rejects(createSafariExtension(options).openSettings(), /installed macOS builds/);
    await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await fs.mkdir(path.join(contents, 'PlugIns', EXTENSION_NAME, 'Contents'), { recursive: true });
    await fs.writeFile(path.join(contents, 'MacOS', HELPER_NAME), 'fixture');
    await fs.writeFile(path.join(contents, 'PlugIns', EXTENSION_NAME, 'Contents', 'Info.plist'), 'fixture');
    const calls = [];
    const extension = createSafariExtension({ ...options, execute: async (file, args, execOptions) => {
      calls.push({ file, args, execOptions });
      return { stdout: JSON.stringify(args[0] === 'status' ? { enabled: true } : { ok: true }) };
    } });
    assert.equal((await extension.status()).enabled, true);
    assert.deepEqual(await extension.openSettings(), { ok: true });
    assert.equal(calls[0].file, path.join(contents, 'MacOS', HELPER_NAME));
    assert.deepEqual(calls.map((call) => call.args), [['status'], ['open-settings']]);
    assert.equal(calls[0].execOptions.timeout, 15000);
    const failure = createSafariExtension({ ...options, execute: async () => { throw Object.assign(new Error('failed'), { stdout: '{"error":"Safari unavailable"}' }); } });
    assert.equal((await failure.status()).error, 'Safari unavailable');
    await assert.rejects(failure.openSettings(), /Safari unavailable/);
    const timeout = createSafariExtension({ ...options, execute: async () => { throw new Error('timeout'); } });
    assert.match((await timeout.status()).error, /Safari could not respond/);
    console.log('Safari setup bridge tests passed.');

    if (process.platform === 'darwin') {
      const { bundlePath, helperBinary } = await buildSafari({ outputDir: path.join(temp, 'native') });
      for (const binary of [path.join(bundlePath, 'Contents', 'MacOS', 'RinkuSafariExtension'), helperBinary]) {
        const archs = execFileSync('/usr/bin/lipo', ['-archs', binary], { encoding: 'utf8' });
        assert.match(archs, /arm64/);
        assert.match(archs, /x86_64/);
        assert.match(execFileSync('/usr/bin/file', [binary], { encoding: 'utf8' }), /executable/);
      }
      // Verify the extension bundle's Sandbox entitlements and resource seal.
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', path.join(__dirname, '..', 'safari', 'entitlements.plist'), bundlePath], { stdio: ['ignore', 'pipe', 'pipe'] });
      execFileSync('/usr/bin/codesign', ['--verify', '--strict', bundlePath], { stdio: ['ignore', 'pipe', 'pipe'] });
      const entitlements = execFileSync('/usr/bin/codesign', ['--display', '--entitlements', '-', bundlePath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.match(entitlements, /app-sandbox/);

      let toolEnv = process.env;
      try { execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { stdio: 'pipe' }); }
      catch { toolEnv = { ...process.env, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' }; }
      const binary = path.join(temp, 'capture-url-tests');
      execFileSync('xcrun', ['clang', '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-framework', 'Foundation', path.join(__dirname, '..', 'safari', 'CaptureURL.m'), path.join(__dirname, '..', 'safari', 'CaptureURLTests.m'), '-o', binary], { env: toolEnv, stdio: 'inherit' });
      const result = JSON.parse(execFileSync(binary, [], { encoding: 'utf8' }));
      const capture = new URL(result.captureURL);
      assert.equal(capture.searchParams.get('url'), result.url);
      assert.equal(capture.searchParams.get('title'), result.title);
      console.log('Universal Safari build, bundle signature, and native capture encoding tests passed.');
    }
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
