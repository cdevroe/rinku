// Runs only in the isolated source snapshot on the Linux test desktop.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sha256 = contents => crypto.createHash('sha256').update(contents).digest('hex');
function main() {
  if (process.platform !== 'linux') throw new Error('This worker requires the Linux test desktop.');
  process.chdir(root);
  fs.mkdirSync('test-results', { recursive: true });
  const manifest = JSON.parse(fs.readFileSync('test-source.json'));
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (sha256(fs.readFileSync(file)) !== expected) throw new Error(`Snapshot mismatch: ${file}`);
  }
  const env = { ...process.env };
  const session = spawnSync('systemctl', ['--user', 'show-environment'], { encoding: 'utf8' });
  if (session.status !== 0) throw new Error('Could not read the active desktop session.');
  for (const line of session.stdout.split('\n')) {
    const match = line.match(/^(DISPLAY|WAYLAND_DISPLAY|XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS|XAUTHORITY|HYPRLAND_INSTANCE_SIGNATURE)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) throw new Error('Log into Omarchy before running desktop tests.');
  // Never target a user's installed executable or packaged Safari integration.
  delete env.RINKU_TEST_EXECUTABLE;
  delete env.RINKU_TEST_SAFARI_SETUP;
  const dependencyKey = sha256(fs.readFileSync('package-lock.json') + fs.readFileSync('package.json', 'utf8')
    + fs.readFileSync('scripts/patch-mac-signing.js', 'utf8') + process.version + process.arch);
  const dependencies = path.join(os.homedir(), '.cache/rinku-tests/dependencies', dependencyKey);
  fs.mkdirSync(path.join(dependencies, 'scripts'), { recursive: true });
  if (!fs.existsSync(path.join(dependencies, '.ready'))) {
    for (const file of ['package.json', 'package-lock.json', 'scripts/patch-mac-signing.js']) fs.copyFileSync(file, path.join(dependencies, file));
    const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dependencies, env, stdio: 'inherit' });
    if (install.status !== 0) throw new Error('Linux dependency installation failed.');
    fs.writeFileSync(path.join(dependencies, '.ready'), dependencyKey);
  }
  fs.symlinkSync(path.join(dependencies, 'node_modules'), 'node_modules', 'dir');
  fs.writeFileSync('test-results/environment.json', JSON.stringify({
    sourceSha256: manifest.sourceSha256, node: process.version, arch: process.arch,
    kernel: os.release(), electron: require('electron/package.json').version,
    display: env.DISPLAY, waylandDisplay: env.WAYLAND_DISPLAY,
  }, null, 2));
  env.PLAYWRIGHT_JSON_OUTPUT_NAME = path.join(root, 'test-results/results.json');
  const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
    '--reporter=list,json', ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status || (result.signal ? 1 : 0);
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
