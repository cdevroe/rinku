const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'rinku.js');

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, ...env },
      cwd: path.join(__dirname, '..'),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`CLI failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-cli-'));
  const configHome = path.join(root, 'config');
  const libraryRoot = path.join(root, 'Library');
  const env = { RINKU_CONFIG_HOME: configHome };

  try {
    let result = await runCli(['libraries', 'create', libraryRoot, '--use', '--json'], env);
    const created = JSON.parse(result.stdout);
    assert.strictEqual(created.ok, true);
    assert.strictEqual(created.libraryRoot, libraryRoot);

    result = await runCli(['links', 'add', 'https://example.com/article', '--title', 'Example Article', '--label', 'Read', '--tag', 'Testing', '--context', 'Home', '--body', 'Notes', '--json'], env);
    const link = JSON.parse(result.stdout);
    assert.strictEqual(link.label, 'read');
    assert.deepStrictEqual(link.tags, ['testing']);
    assert.deepStrictEqual(link.contexts, ['@Home']);

    result = await runCli(['links', 'list', '--json'], env);
    const listed = JSON.parse(result.stdout);
    assert.strictEqual(listed.links.length, 1);

    result = await runCli(['links', 'archive', link.id, '--json'], env);
    const archived = JSON.parse(result.stdout);
    assert.strictEqual(archived.status, 'archived');

    result = await runCli(['links', 'list', '--status', 'archived', '--json'], env);
    const archivedList = JSON.parse(result.stdout);
    assert.strictEqual(archivedList.links.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().then(() => {
  console.log('test-cli passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
