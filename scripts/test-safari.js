const assert = require('assert').strict;
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createSafariExtension } = require('../lib/safariExtension');
const { buildSafari, EXTENSION_NAME, BRIDGE_NAME } = require('./build-safari');

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
    await fs.mkdir(resourcesPath, { recursive: true });
    await fs.mkdir(path.join(contents, 'PlugIns', EXTENSION_NAME, 'Contents'), { recursive: true });
    await fs.writeFile(path.join(resourcesPath, BRIDGE_NAME), 'fixture');
    await fs.writeFile(path.join(contents, 'PlugIns', EXTENSION_NAME, 'Contents', 'Info.plist'), 'fixture');
    const calls = [];
    let loads = 0;
    const extension = createSafariExtension({ ...options, loadNative: (file) => {
      assert.equal(file, path.join(resourcesPath, BRIDGE_NAME));
      loads++;
      return {
        status: async () => { calls.push('status'); return { enabled: true }; },
        openSettings: async () => { calls.push('openSettings'); return { ok: true }; },
      };
    } });
    assert.equal((await extension.status()).enabled, true);
    assert.deepEqual(await extension.openSettings(), { ok: true });
    assert.deepEqual(calls, ['status', 'openSettings']);
    assert.equal(loads, 1, 'Load the bridge once in the containing app process.');
    const failure = createSafariExtension({ ...options, loadNative: () => ({
      status: async () => ({ error: 'Safari unavailable' }),
      openSettings: async () => ({ error: 'Safari unavailable' }),
    }) });
    assert.equal((await failure.status()).error, 'Safari unavailable');
    await assert.rejects(failure.openSettings(), /Safari unavailable/);
    const loadFailure = createSafariExtension({ ...options, loadNative: () => { throw new Error('Native bridge unavailable'); } });
    assert.match((await loadFailure.status()).error, /Native bridge unavailable/);
    await assert.rejects(loadFailure.openSettings(), /Native bridge unavailable/);
    console.log('Safari setup bridge tests passed.');

    if (process.platform === 'darwin') {
      const { bundlePath, bridgeBinary } = await buildSafari({ outputDir: path.join(temp, 'native') });
      for (const binary of [path.join(bundlePath, 'Contents', 'MacOS', 'RinkuSafariExtension'), bridgeBinary]) {
        const archs = execFileSync('/usr/bin/lipo', ['-archs', binary], { encoding: 'utf8' });
        assert.match(archs, /arm64/);
        assert.match(archs, /x86_64/);
        assert.match(execFileSync('/usr/bin/file', [binary], { encoding: 'utf8' }), binary === bridgeBinary ? /bundle/ : /executable/);
      }
      const nativeBridge = require(bridgeBinary);
      assert.equal(typeof nativeBridge.status, 'function');
      assert.equal(typeof nativeBridge.openSettings, 'function');
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

      // Exercise the production signing hook with a minimal native host, including
      // the loadable Node-API bridge and the Sandbox extension bundle.
      const host = path.dirname(contents);
      await fs.writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict>
          <key>CFBundleIdentifier</key><string>com.cdevroe.rinku.signing-test</string>
          <key>CFBundleExecutable</key><string>Rinku</string>
          <key>CFBundlePackageType</key><string>APPL</string>
          <key>CFBundleVersion</key><string>1</string>
        </dict></plist>`);
      await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true });
      await fs.copyFile(binary, path.join(contents, 'MacOS', 'Rinku'));
      await fs.copyFile(bridgeBinary, path.join(resourcesPath, BRIDGE_NAME));
      await fs.cp(bundlePath, path.join(contents, 'PlugIns', EXTENSION_NAME), { recursive: true });
      await require('./sign-mac').default({
        app: host, platform: 'darwin', identity: '-', preAutoEntitlements: false,
        gatekeeperAssess: false,
        optionsForFile: () => ({ entitlements: path.join(__dirname, '..', 'safari', 'bridge-entitlements.plist'), hardenedRuntime: true }),
      });
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', host], { stdio: ['ignore', 'pipe', 'pipe'] });
      console.log('Production signing hook seals the Safari bridge, extension, and host successfully.');
    }
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
