// Send an identified source snapshot to Omarchy; never copy local libraries or secrets.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
  return result.stdout;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) throw new Error('Choose focused tests with --grep "...", or explicitly request the full suite with --full.');
  if (args[0] === '--full') args.shift();
  const sshOptions = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
  const candidates = process.env.RINKU_TEST_HOST ? [process.env.RINKU_TEST_HOST] : ['cdevroe@babu.local', 'cdevroe@babu-2.local'];
  if (!process.env.RINKU_TEST_HOST) sshOptions.push('-o', 'HostKeyAlias=babu.local');
  let host;
  for (const candidate of candidates) {
    if (!/^[a-zA-Z0-9_.@-]+$/.test(candidate) || candidate.startsWith('-')) throw new Error('Invalid RINKU_TEST_HOST.');
    const probe = spawnSync('ssh', [...sshOptions, candidate, 'true'], { stdio: 'pipe' });
    if (probe.status === 0) { host = candidate; break; }
  }
  if (!host) throw new Error('Could not reach the test desktop with its saved SSH host key. No local GUI tests were started.');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rinku-remote-'));
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const remote = `.cache/rinku-tests/runs/${runId}`;
  const report = path.join(root, 'test-results/omarchy', runId);
  try {
    const source = path.join(scratch, 'source');
    fs.mkdirSync(source);
    const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
      'app', 'bin', 'lib', 'static', 'scripts', 'tests', 'safari', 'build',
      'main.js', 'preload.js', 'index.html', 'package.json', 'package-lock.json', 'electron-builder.json', 'playwright.config.js'],
    { encoding: 'utf8', stdio: 'pipe' }).split('\0').filter(Boolean).sort();
    const hashes = {};
    for (const file of files) {
      if (file.split('/').some(part => part.startsWith('.') || part === '..') || /\.(p12|p8|key|pem)$/i.test(file)) continue;
      const origin = path.join(root, file);
      if (!fs.existsSync(origin) || !fs.lstatSync(origin).isFile()) continue;
      const contents = fs.readFileSync(origin);
      hashes[file] = crypto.createHash('sha256').update(contents).digest('hex');
      fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
      fs.writeFileSync(path.join(source, file), contents);
    }
    const manifest = {
      commit: run('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: 'pipe' }).trim(),
      branch: run('git', ['branch', '--show-current'], { encoding: 'utf8', stdio: 'pipe' }).trim(),
      sourceSha256: crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
      files: hashes,
    };
    fs.writeFileSync(path.join(source, 'test-source.json'), JSON.stringify(manifest, null, 2));
    const archive = path.join(scratch, 'source.tar.gz');
    run('tar', [...(process.platform === 'darwin' ? ['--no-xattrs'] : []), '-czf', archive, '-C', source, '.'], {
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    });
    console.log(`Testing ${manifest.branch} source ${manifest.sourceSha256.slice(0, 12)} on ${host}.`);
    const input = fs.openSync(archive, 'r');
    try {
      run('ssh', [...sshOptions, host, `umask 077; mkdir -p ${quote(remote)} && tar -xzf - -C ${quote(remote)}`], { stdio: [input, 'inherit', 'inherit'] });
    } finally { fs.closeSync(input); }
    // Serialize our runs on this shared desktop without touching other apps.
    const result = spawnSync('ssh', [...sshOptions, host,
      `flock -n .cache/rinku-tests/desktop.lock timeout --signal=TERM --kill-after=30s 20m node ${quote(`${remote}/scripts/test-remote-worker.js`)} ${args.map(quote).join(' ')}`],
    { cwd: root, stdio: 'inherit' });
    fs.mkdirSync(report, { recursive: true });
    const output = fs.openSync(path.join(report, 'results.tar.gz'), 'w');
    try {
      run('ssh', [...sshOptions, host, `cd ${quote(remote)} && tar -czf - test-source.json test-results`], { stdio: ['ignore', output, 'inherit'] });
    } finally { fs.closeSync(output); }
    run('tar', ['-xzf', path.join(report, 'results.tar.gz'), '-C', report]);
    fs.unlinkSync(path.join(report, 'results.tar.gz'));
    console.log(`Remote report: ${report}`);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Remote tests failed (status ${result.status}). Inspect the report; no local GUI tests were started.`);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
