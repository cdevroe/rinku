const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { sourceFingerprint } = require('./build-info');

const root = path.resolve(__dirname, '..');
const target = '/Applications/Rinku.app';
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}

function checkSource(appPath, repoRoot = root) {
  const infoPath = path.join(appPath, 'Contents/Resources/rinku-build.json');
  if (!fs.existsSync(infoPath)) throw new Error('This app has no source fingerprint. Run npm run install:mac.');
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  if (info.sourceSha256 !== sourceFingerprint(repoRoot)) {
    throw new Error('The installed app does not match the current working tree. Run npm run install:mac.');
  }
  return info;
}

// Keep the previous bundle available until verification and installed-app tests pass.
async function replaceApp(staged, destination, previous, verify) {
  if (fs.existsSync(previous)) throw new Error(`Refusing to overwrite rollback bundle: ${previous}`);
  const hadPrevious = fs.existsSync(destination);
  if (hadPrevious) fs.renameSync(destination, previous);
  let replaced = false;
  try {
    fs.renameSync(staged, destination);
    replaced = true;
    await verify();
  } catch (error) {
    if (replaced) fs.renameSync(destination, staged);
    if (hadPrevious) fs.renameSync(previous, destination);
    throw error;
  }
}

function verifyMac(appPath) {
  run('codesign', ['--verify', '--deep', '--strict', appPath]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath]);
  run('xcrun', ['stapler', 'validate', appPath], {
    env: { ...process.env, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' },
  });
}

function validateRuntimeIdentity(runtime, expected, executable) {
  const fields = {
    identity: !runtime.identityError,
    mode: runtime.mode === 'packaged',
    version: runtime.version === expected.version,
    electron: runtime.electron === expected.electron,
    source: runtime.sourceSha256 === expected.sourceSha256,
    // macOS canonicalizes /var to /private/var for temporary build executables.
    executable: Boolean(runtime.executablePath) && fs.realpathSync(runtime.executablePath) === fs.realpathSync(executable),
  };
  const failed = Object.keys(fields).filter(key => !fields[key]);
  if (failed.length) throw new Error(`Packaged CLI runtime mismatch: ${failed.join(', ')}.`);
}

function verifyRuntime(appPath) {
  const expected = checkSource(appPath);
  const executable = path.join(appPath, 'Contents/MacOS/Rinku');
  const cli = path.join(appPath, 'Contents/Resources/app.asar/bin/rinku.js');
  const runtime = JSON.parse(run(executable, [cli, 'build-info', '--json'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', stdio: 'pipe', timeout: 30000,
  }));
  validateRuntimeIdentity(runtime, expected, executable);
  console.log(`Packaged runtime verified: Rinku ${runtime.version}, Electron ${runtime.electron}.`);
}

function guiProcesses() {
  const output = run('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8', stdio: 'pipe' });
  // Use executable paths, not command-line substrings that can include this script.
  const candidates = output.split('\n').filter(line => /\/Rinku\.app\/Contents\/MacOS\/Rinku$/.test(line.trim()));
  return candidates.filter(line => {
    const pid = line.trim().split(/\s+/)[0];
    const args = run('ps', ['-p', pid, '-o', 'args='], { encoding: 'utf8', stdio: 'pipe' });
    return !/--mcp-server|\bmcp serve\b/.test(args);
  }).map(line => line.trim().replace(/^\d+\s+/, ''));
}

async function quitInstalledApp() {
  const paths = guiProcesses();
  if (paths.some(executable => executable !== `${target}/Contents/MacOS/Rinku`)) {
    throw new Error('A different Rinku app is running. Quit that copy before installing.');
  }
  if (!paths.length) return;
  run('osascript', ['-e', `tell application "${target}" to quit`]);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!guiProcesses().length) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Rinku has not quit. Finish any open dialog and retry; the app was not replaced.');
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('The local install workflow requires macOS.');
  if (process.argv.includes('--check')) {
    const info = checkSource(target);
    const runtime = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion',
      `${target}/Contents/Frameworks/Electron Framework.framework/Resources/Info.plist`], { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (runtime !== info.electron) throw new Error(`Electron mismatch: installed ${runtime}, expected ${info.electron}`);
    const paths = guiProcesses();
    if (paths.some(executable => executable !== `${target}/Contents/MacOS/Rinku`)) throw new Error('An outdated Rinku copy is running.');
    console.log(`Installed source matches: Rinku ${info.version}, Electron ${runtime}, source ${info.sourceSha256.slice(0, 12)}.`);
    console.log(paths.length ? `Running: ${target}` : 'Rinku GUI is closed.');
    return;
  }
  const remoteTests = process.argv.length === 3 && process.argv[2] === '--remote-tests';
  if (process.argv.length > 2 && !remoteTests) throw new Error('Usage: node scripts/install-mac.js [--check|--remote-tests]');
  require('dotenv').config({ quiet: true });
  for (const name of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    if (!process.env[name]) throw new Error(`Configure ${name} in .env before installing.`);
  }
  // Never downgrade this workflow to an unnotarized preview through inherited env.
  const buildEnv = { ...process.env, RINKU_SKIP_NOTARIZATION: '0', RINKU_REQUIRE_SIGNING: '1' };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rinku-install-'));
  const token = crypto.randomUUID();
  const staged = `/Applications/.Rinku-install-${token}.app`;
  const previous = `/Applications/.Rinku-previous-${token}.bundle-backup`;
  let installed = false;
  try {
    run('npm', ['run', 'build:icons']);
    const expected = sourceFingerprint(root);
    if (remoteTests) {
      run('npm', ['test']);
      for (const test of ['test:release', 'test:build-proxy', 'test:build-matching', 'test:mac-signing', 'test:local-install', 'test:safari']) {
        run('npm', ['run', test]);
      }
      run('npm', ['run', 'test:remote', '--', '--full']);
    } else {
      run('npm', ['run', 'test:all'], { env: { ...process.env, RINKU_ALLOW_GUI_TESTS: '1' } });
    }
    run(process.execPath, ['scripts/dist-mac.js', '--universal', '--dir', `--config.directories.output=${scratch}`], { env: buildEnv });
    const built = path.join(scratch, 'mac-universal/Rinku.app');
    verifyMac(built);
    checkSource(built);
    verifyRuntime(built);
    if (sourceFingerprint(root) !== expected) throw new Error('Source changed during validation/build. Retry from the finished working tree.');
    run('ditto', [built, staged]);
    verifyMac(staged);
    await quitInstalledApp();

    const backupDirectory = path.join(root, 'dist/local-install');
    fs.mkdirSync(backupDirectory, { recursive: true });
    if (fs.existsSync(target)) {
      const pending = path.join(scratch, 'previous.zip');
      run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', target, pending]);
      run('unzip', ['-tq', pending]);
      fs.copyFileSync(pending, path.join(backupDirectory, 'Rinku.previous.zip.pending'));
      fs.renameSync(path.join(backupDirectory, 'Rinku.previous.zip.pending'), path.join(backupDirectory, 'Rinku.previous.zip'));
    }
    try {
      await replaceApp(staged, target, previous, async () => {
        verifyMac(target);
        checkSource(target);
        run(lsregister, ['-f', target]);
        verifyRuntime(target);
        if (!remoteTests) {
          run('npm', ['run', 'test:playwright'], { env: {
            ...process.env, RINKU_ALLOW_GUI_TESTS: '1', RINKU_TEST_EXECUTABLE: `${target}/Contents/MacOS/Rinku`, RINKU_TEST_SAFARI_SETUP: '1',
          } });
        }
        checkSource(target);
      });
    } catch (error) {
      if (fs.existsSync(target)) {
        run(lsregister, ['-f', target]);
        run('open', ['-a', target]);
      }
      throw error;
    }
    installed = true;
    fs.rmSync(previous, { recursive: true, force: true });
    run('open', ['-a', target]);
    console.log(`Updated and opened ${target}. Previous app: dist/local-install/Rinku.previous.zip`);
    console.log('Existing MCP connections pick up the new runtime when they reconnect.');
    if (remoteTests) console.log('Desktop tests ran on Omarchy. Native Mac UI and Safari Settings checks remain for manual beta testing.');
  } finally {
    // Never remove a rollback bundle if an unexpected filesystem error interrupted rollback.
    for (const appPath of [path.join(scratch, 'mac-universal/Rinku.app'), staged]) {
      if (fs.existsSync(appPath)) {
        try { run(lsregister, ['-u', appPath], { stdio: 'ignore' }); } catch { /* Unregistered builds are normal. */ }
      }
    }
    if (fs.existsSync(previous) && !installed) console.error(`Rollback bundle retained: ${previous}`);
    fs.rmSync(staged, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => {
  // subprocess error messages can contain credential-bearing arguments.
  let message = error.message;
  for (const key of ['CSC_KEY_PASSWORD', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_ID', 'CSC_LINK']) {
    if (process.env[key]) message = message.split(process.env[key]).join('[redacted]');
  }
  console.error(message);
  process.exitCode = 1;
});

module.exports = { replaceApp, checkSource, validateRuntimeIdentity };
