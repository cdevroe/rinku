const assert = require('assert');
const fs = require('fs').promises;
const http = require('http');
const os = require('os');
const path = require('path');

const { createLocalCaptureServer } = require('../lib/captureServer');
const { createLibrary, listLinks, readLink } = require('../lib/library');

function requestJson(url, options = {}, body = '') {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        try {
          resolve({
            statusCode: response.statusCode,
            body: JSON.parse(raw),
          });
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${error.message}\n${raw}`));
        }
      });
    });
    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function requestText(url, options = {}, body = '') {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'text/html',
        ...(options.headers || {}),
      },
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          body: raw,
        });
      });
    });
    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function createContentServer(html) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rinku-capture-'));
  const libraryRoot = path.join(root, 'Library');
  const contentServer = await createContentServer('<!doctype html><title>Fetched Page Title</title><h1>Example</h1>');
  let captured = null;
  const server = createLocalCaptureServer({
    getLibraryRoot: () => libraryRoot,
    onCapture: (payload) => { captured = payload; },
  });

  try {
    await createLibrary(libraryRoot);
    const status = await server.start({ port: 0 });
    assert.strictEqual(status.running, true);
    assert(status.port > 0);

    let response = await requestJson(`${status.baseUrl}/status`);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.ok, true);
    assert.strictEqual(response.body.libraryOpen, true);

    const captureUrl = new URL(`${status.baseUrl}/capture`);
    captureUrl.searchParams.set('url', 'https://example.com/science');
    captureUrl.searchParams.set('title', 'Science Article');
    captureUrl.searchParams.set('label', 'Read');
    captureUrl.searchParams.append('tag', 'Science');
    captureUrl.searchParams.set('context', 'Home');
    response = await requestJson(captureUrl);
    assert.strictEqual(response.statusCode, 201);
    assert.strictEqual(response.body.ok, true);
    assert.strictEqual(response.body.link.url, 'https://example.com/science');

    const contentUrl = `http://127.0.0.1:${contentServer.address().port}/article`;
    const titledCaptureUrl = new URL(`${status.baseUrl}/capture`);
    titledCaptureUrl.searchParams.set('url', contentUrl);
    response = await requestJson(titledCaptureUrl);
    assert.strictEqual(response.statusCode, 201);
    assert.strictEqual(response.body.ok, true);
    assert.strictEqual(response.body.link.title, 'Fetched Page Title');

    const listed = await listLinks(libraryRoot, { status: 'active' });
    assert.strictEqual(listed.links.length, 2);
    const scienceLink = listed.links.find((link) => link.title === 'Science Article');
    assert(scienceLink);
    assert.strictEqual(scienceLink.label, 'read');
    assert.deepStrictEqual(scienceLink.tags, ['science']);
    assert.deepStrictEqual(scienceLink.contexts, ['@Home']);
    assert(captured);
    assert.strictEqual(captured.libraryRoot, libraryRoot);
    assert.strictEqual(captured.link.title, 'Fetched Page Title');

    response = await requestJson(`${status.baseUrl}/capture?url=file:///tmp/example`);
    assert.strictEqual(response.statusCode, 400);
    assert.strictEqual(response.body.ok, false);

    captured = null;
    const popupUrl = new URL(`${status.baseUrl}/capture`);
    popupUrl.searchParams.set('url', 'https://example.com/popup');
    popupUrl.searchParams.set('title', 'Popup Link');
    const popupResponse = await requestText(popupUrl);
    assert.strictEqual(popupResponse.statusCode, 201);
    assert(popupResponse.body.includes('This link has been added to your library.'));
    assert(popupResponse.body.includes('name="label"'));
    assert(popupResponse.body.includes('id="tagEditor"'));
    assert(captured);

    const updateBody = new URLSearchParams();
    updateBody.set('id', captured.link.id);
    updateBody.set('title', 'Updated Popup Link');
    updateBody.set('label', 'Watch');
    updateBody.set('tags', 'video,science');
    updateBody.append('context', 'Work');
    updateBody.set('body', 'Popup notes');
    response = await requestJson(`${status.baseUrl}/capture/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, updateBody.toString());
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.ok, true);
    assert.strictEqual(response.body.link.title, 'Updated Popup Link');
    assert.strictEqual(response.body.link.label, 'watch');
    assert.deepStrictEqual(response.body.link.tags, ['video', 'science']);
    assert.deepStrictEqual(response.body.link.contexts, ['@Work']);

    const updated = await readLink(libraryRoot, captured.link.id);
    assert.strictEqual(updated.body, 'Popup notes');

    const stopped = await server.stop();
    assert.strictEqual(stopped.running, false);
  } finally {
    await server.stop().catch(() => {});
    await new Promise((resolve) => contentServer.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().then(() => {
  console.log('test-capture-server passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
