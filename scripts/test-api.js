const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { createApiServer, MAX_BODY_BYTES } = require('../lib/apiServer');
const { readLink } = require('../lib/library');

async function snapshot(root) {
  const output = {};
  async function scan(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await scan(file);
      else output[path.relative(root, file)] = { data: await fs.readFile(file, 'utf8'), mtime: (await fs.stat(file)).mtimeMs };
    }
  }
  await scan(root);
  return output;
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-api-'));
  const libraryRoot = path.join(root, 'Library');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-api-outside-'));
  const config = { readOnly: false, allowedRoots: [root] };
  const api = createApiServer({ config, token: 'test-token', libraryRoot });
  const readOnly = createApiServer({ config: { ...config, readOnly: true }, token: 'test-token', libraryRoot });
  let pageRequests = 0;
  const titleServer = http.createServer((_request, response) => {
    pageRequests += 1;
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<title>Fetched through HTTP API</title>');
  });
  try {
    await new Promise((resolve, reject) => {
      titleServer.once('error', reject);
      titleServer.listen(0, '127.0.0.1', resolve);
    });
    const pageUrl = `http://127.0.0.1:${titleServer.address().port}`;
    const { baseUrl } = await api.start({ port: 0 });
    async function request(route, { method = 'GET', body, headers = {}, status = 200 } = {}) {
      const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: { Authorization: 'Bearer test-token', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      assert.strictEqual(response.status, status, JSON.stringify(result));
      return result;
    }
    await request('/links', { headers: { Authorization: '' }, status: 401 });
    await request('/config', { headers: { Authorization: 'Bearer wrong' }, status: 401 });
    await request('/config', { headers: { Origin: 'https://attacker.example' }, status: 403 });
    await request('/libraries', { method: 'POST', body: {}, status: 400 });
    await request('/libraries', { method: 'POST', body: { libraryRoot }, status: 201 });
    await request('/libraries', { method: 'POST', body: { libraryRoot }, status: 409 });
    assert.strictEqual((await request('/libraries')).data.libraries.length, 1);
    const spec = await request('/openapi.json');
    assert.strictEqual(spec.openapi, '3.1.0');
    assert(spec.paths['/api/v1/links/{ref}/restore']);
    assert.strictEqual(spec.paths['/api/v1/links'].post.requestBody.content['application/json'].schema.properties.fetchTitle.type, 'boolean');
    const created = (await request('/links', { method: 'POST', body: {
      url: 'https://example.com/api', title: 'API Link', label: 'Read', tags: ['JavaScript'], contexts: ['Work'], body: 'Original notes',
    }, status: 201 })).data;
    assert.strictEqual(created.label, 'read');
    assert.strictEqual(created.duplicate, false);
    assert(spec.paths['/api/v1/links'].post.responses[200]);
    const duplicate = (await request('/links', { method: 'POST', body: {
      url: created.url, title: 'Replacement title', body: 'Replacement notes',
    }, status: 200 })).data;
    assert.strictEqual(duplicate.duplicate, true);
    assert.strictEqual(duplicate.id, created.id);
    assert.strictEqual(duplicate.title, 'API Link');
    assert.strictEqual(duplicate.body, 'Original notes');
    const ref = encodeURIComponent(created.id);
    assert.strictEqual((await readLink(libraryRoot, created.id)).body, 'Original notes');
    assert.strictEqual((await request('/links?status=active&tag=javascript&limit=1')).data.total, 1);
    assert.strictEqual((await request('/links?search=unmatched')).data.total, 0);
    assert.strictEqual((await request(`/links/${ref}`, { method: 'PATCH', body: { body: 'Updated notes', tags: [] } })).data.body, 'Updated notes');
    assert.strictEqual((await request(`/links/${ref}`)).data.title, 'API Link');
    assert.strictEqual((await request(`/links/${ref}/archive`, { method: 'POST' })).data.status, 'archived');
    assert.strictEqual((await request('/links?status=all')).data.total, 1);
    assert.strictEqual((await request(`/links/${ref}/restore`, { method: 'POST' })).data.status, 'active');
    assert.strictEqual((await request('/index/rebuild', { method: 'POST' })).data.totals.all, 1);
    await request('/imports/unmark', { method: 'POST', body: { sourcePath: path.join(outside, 'export.json') }, status: 403 });
    const sourcePath = path.join(root, 'unmark.json');
    await fs.writeFile(sourcePath, JSON.stringify({ export: { marks: [
      { mark_id: '1', url: 'https://example.com/import', title: 'Imported', label_name: 'Read' },
      { mark_id: '../../escape', url: 'https://example.com/unsafe', title: 'Unsafe' },
    ] } }));
    const imported = (await request('/imports/unmark', { method: 'POST', body: { sourcePath } })).data;
    assert.strictEqual(imported.added, 1);
    assert.strictEqual(imported.failed, 1);
    assert.match(imported.errors[0].message, /path separators/);
    await fs.writeFile(sourcePath, '{');
    await request('/imports/unmark', { method: 'POST', body: { sourcePath }, status: 400 });
    await request('/links/missing', { status: 404 });
    await request('/links/%20', { status: 400 });
    await request('/links', { method: 'POST', body: '{', status: 400 });
    await request('/links', { method: 'POST', body: [], status: 400 });
    await request('/links', { method: 'POST', body: { url: 'javascript:alert(1)' }, status: 400 });
    await request('/links', { method: 'POST', body: { url: 'https://example.com', id: '../escape' }, status: 400 });
    await request('/links', { method: 'POST', body: { url: 'https://example.com', tags: 'string' }, status: 400 });
    await request('/links?status=typo', { status: 400 });
    await request('/links?limit=abc', { status: 400 });
    await request('/links?limit=0', { status: 400 });
    await request('/links?olderThanDays=-1', { status: 400 });
    await request('/links?limit=1&limit=2', { status: 400 });
    await request('/links?__proto__=test', { status: 400 });
    await request('/links', { method: 'DELETE', status: 405 });
    await request('/missing', { status: 404 });
    await request('/links', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' }, status: 415 });
    await request('/links', { method: 'POST', body: JSON.stringify({ body: 'a'.repeat(MAX_BODY_BYTES + 1) }), status: 413 });
    await request(`/links?libraryRoot=${encodeURIComponent(outside)}`, { status: 403 });
    await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await request(`/links?libraryRoot=${encodeURIComponent(path.join(root, 'escape'))}`, { status: 403 });
    await request('/libraries', { method: 'POST', body: { libraryRoot: path.join(root, 'escape', 'NewLibrary') }, status: 403 });
    await fs.symlink(outside, path.join(libraryRoot, 'links', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await request('/links', { status: 403 });
    await fs.unlink(path.join(libraryRoot, 'links', 'escape'));

    // A stale or poisoned index must not redirect reads/writes outside the library.
    const indexPath = path.join(libraryRoot, '.rinku', 'index.json');
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    index.links[0].filePath = path.join(outside, 'secret.md');
    await fs.writeFile(indexPath, JSON.stringify(index));
    assert.strictEqual((await request(`/links/${ref}`)).data.body, 'Updated notes');
    await request(`/links/${ref}`, { method: 'PATCH', body: { title: 'Still inside' } });
    await assert.rejects(() => fs.stat(path.join(outside, 'secret.md')), /ENOENT/);

    // Concurrent saves must all survive in the index.
    await Promise.all(Array.from({ length: 8 }, (_, n) => request('/links', { method: 'POST', body: { url: `https://example.com/${n}`, title: `Link ${n}` }, status: 201 })));
    assert.strictEqual((await request('/links')).data.total, 10);

    const fetched = (await request('/links', { method: 'POST', body: { url: `${pageUrl}/fetch`, fetchTitle: true }, status: 201 })).data;
    assert.strictEqual(fetched.title, 'Fetched through HTTP API');
    const noFetch = (await request('/links', { method: 'POST', body: { url: `${pageUrl}/no-fetch` }, status: 201 })).data;
    assert.strictEqual(noFetch.title, `${pageUrl}/no-fetch`);
    assert.strictEqual(pageRequests, 1);
    await request('/links', { method: 'POST', body: { url: `${pageUrl}/invalid`, fetchTitle: 'true' }, status: 400 });
    assert.strictEqual(pageRequests, 1);

    await fs.unlink(indexPath);
    const before = await snapshot(libraryRoot);
    const readonlyStatus = await readOnly.start({ port: 0 });
    const roRequest = async (route, options = {}) => fetch(`${readonlyStatus.baseUrl}${route}`, { ...options, headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' } });
    assert.strictEqual((await roRequest('/settings')).status, 200);
    assert.strictEqual((await roRequest('/links')).status, 200);
    assert.strictEqual((await roRequest(`/links/${ref}`)).status, 200);
    for (const route of ['/links', `/links/${ref}/archive`, `/links/${ref}/restore`, '/index/rebuild']) {
      const response = await roRequest(route, { method: 'POST', body: JSON.stringify(route === '/links' ? { url: 'https://example.com' } : {}) });
      assert.strictEqual(response.status, 403);
    }
    assert.deepStrictEqual(await snapshot(libraryRoot), before);

    const defaults = createApiServer({ env: { RINKU_API_LIBRARY: libraryRoot } });
    assert.strictEqual(defaults.service.config.readOnly, true);
    assert(defaults.token.length >= 32);
    await assert.rejects(() => defaults.start({ port: -1 }), /port/);
    await assert.rejects(() => createApiServer({ env: {} }).start({ port: 0 }), /ALLOWED_ROOTS/);

    // Start the public CLI entry point and verify clean signal shutdown.
    const child = spawn(process.execPath, [path.resolve(__dirname, '../bin/rinku.js'), 'api', 'serve', '--library', libraryRoot, '--port', '0'], {
      env: { ...process.env, RINKU_API_TOKEN: 'cli-test-token', RINKU_API_READ_ONLY: 'true' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      const cliUrl = await new Promise((resolve, reject) => {
        let output = '';
        child.stderr.on('data', (chunk) => {
          output += chunk.toString();
          const match = output.match(/Rinku API: (http:\/\/127\.0\.0\.1:\d+\/api\/v1)/);
          if (match) resolve(match[1]);
        });
        child.once('error', reject);
        child.once('exit', () => reject(new Error('CLI exited before startup')));
      });
      const response = await fetch(`${cliUrl}/config`, { headers: { Authorization: 'Bearer cli-test-token' } });
      assert.strictEqual((await response.json()).data.readOnly, true);
      child.kill('SIGTERM');
      assert.deepStrictEqual(await exited, { code: 0, signal: null });
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }

    // Test a real Host header without fetch normalizing it.
    await new Promise((resolve, reject) => {
      http.get(`${baseUrl}/config`, { headers: { Host: 'evil.example', Authorization: 'Bearer test-token' } }, (response) => {
        assert.strictEqual(response.statusCode, 403);
        response.resume(); response.on('end', resolve);
      }).on('error', reject);
    });
  } finally {
    titleServer.closeAllConnections();
    await new Promise(resolve => titleServer.close(resolve));
    await readOnly.stop();
    await api.stop();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
}

run().then(() => console.log('test-api passed')).catch((error) => { console.error(error); process.exit(1); });
