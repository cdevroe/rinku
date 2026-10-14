#!/usr/bin/env node

const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { createRequire } = require('module');
const { patchSource, REPLACEMENTS, SUPPORTED_VERSION } = require('./patch-mac-signing');

async function run() {
  const file = require.resolve('app-builder-lib/out/codeSign/macCodeSign');
  const installed = fs.readFileSync(file, 'utf8');
  const original = REPLACEMENTS.reduce((source, [before, after]) => source.replace(after, before), installed);
  const fixed = patchSource(original, SUPPORTED_VERSION);
  assert.equal(patchSource(fixed, SUPPORTED_VERSION), fixed, 'Reinstall patch must be idempotent.');
  assert.throws(() => patchSource(original, '99.0.0'), /Review the macOS signing patch/);
  assert.throws(() => patchSource(original.replace(...REPLACEMENTS[0]), SUPPORTED_VERSION), /partial patch/);
  assert.throws(() => patchSource(original + original, SUPPORTED_VERSION), /partial patch/);
  assert.equal(installed, fixed, 'Run npm run postinstall to repair the installed signing dependency.');

  async function captureCommands(source) {
    const commands = [];
    const nativeRequire = createRequire(file);
    const exports = {};
    const fakeRequire = (name) => {
      if (name === 'builder-util') return {
        exec: async (executable, args) => { commands.push({ executable, args }); return ''; },
      };
      if (name === './codesign') return { importCertificate: async (link) => link };
      return nativeRequire(name);
    };
    vm.runInNewContext(source, {
      exports, require: fakeRequire, __dirname: require('path').dirname(file),
      process: { env: { TRAVIS: 'true', APP_BUILDER_TMP_DIR: '/test-only' } },
    }, { filename: file });
    await exports.createKeychain({
      tmpDir: {}, currentDir: '/test-only/project', cscLink: '/test-only/app.p12',
      cscKeyPassword: 'application-certificate-password',
      cscILink: '/test-only/installer.p12', cscIKeyPassword: 'installer-certificate-password',
    });
    return commands.map(({ executable, args }) => {
      assert.equal(executable, '/usr/bin/security');
      return args;
    });
  }

  for (const [source, expectedMatch] of [[original, false], [fixed, true]]) {
    const commands = await captureCommands(source);
    const keychainPassword = commands.find(([command]) => command === 'create-keychain')[2];
    const partitions = commands.filter(([command]) => command === 'set-key-partition-list');
    assert.equal(partitions.length, 2);
    for (const args of partitions) assert.equal(args[args.indexOf('-k') + 1] === keychainPassword, expectedMatch);
    const imports = commands.filter(([command]) => command === 'import');
    assert.deepEqual(imports.map((args) => args[args.indexOf('-P') + 1]),
      ['application-certificate-password', 'installer-certificate-password']);
  }
  const hook = {};
  let envLoads = 0;
  vm.runInNewContext(fs.readFileSync(require.resolve('./notarize'), 'utf8'), {
    exports: hook,
    require: (name) => {
      if (name === '@electron/notarize') return { notarize: async () => assert.fail('Unexpected notarization') };
      if (name === 'dotenv') return { config: () => { envLoads += 1; } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process: { env: { RINKU_SKIP_NOTARIZATION: '1' } },
    console: { warn() {} },
  });
  assert.equal(envLoads, 0, 'Loading the hook must not load macOS credentials.');
  await hook.default({ electronPlatformName: 'win32' });
  await hook.default({ electronPlatformName: 'linux' });
  assert.equal(envLoads, 0, 'Windows/Linux builds must not inherit macOS credentials.');
  await hook.default({ electronPlatformName: 'darwin' });
  assert.equal(envLoads, 1, 'macOS notarization still loads its local configuration.');
  console.log('macOS signing regression passed: original mismatch reproduced; patched keychain and certificate passwords remain separate.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
