const assert = require('assert');
const http = require('http');
const zlib = require('zlib');
const { cleanTitle, extractTitle, fetchTitleFromUrl } = require('../lib/titleFetcher');

async function run() {
  assert.strictEqual(cleanTitle(' Caf&eacute;&nbsp;&mdash; &#x1F600; &#1114112; '), 'Café — 😀 �');
  assert.strictEqual(cleanTitle('&amp;lt;'), '&lt;', 'Decode exactly once.');
  assert.strictEqual(extractTitle('<title> A &amp; B </title>'), 'A & B');
  assert.strictEqual(extractTitle('<title>Truncated'), '', 'Do not save an incomplete title.');
  assert.strictEqual(extractTitle('<META content="A > B &quot;quoted&quot;" PROPERTY="OG:TITLE">'), 'A > B "quoted"');
  assert.strictEqual(extractTitle('<meta name=twitter:title content=Twitter><title>Browser</title><meta property=og:title content=Publisher>'), 'Publisher');
  assert.strictEqual(extractTitle('<!-- <meta property=og:title content=Fake> --><script>const x = "<title>Fake</title>"</script><title>Real</title>'), 'Real');
  assert.strictEqual(extractTitle('<meta property=og:title content=""><meta name=twitter:title content="Fallback">'), 'Fallback');
  assert.strictEqual(extractTitle('<title>Robot Check</title>'), '');
  assert.strictEqual(extractTitle('<title>Just a moment...</title>'), '');
  assert.strictEqual(extractTitle('<title>Attention Required! | Cloudflare</title>'), '');

  const html = '<!doctype html><meta charset=utf-8><title>Café &amp; tea — 日本語</title>';
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: './gzip' });
      response.end();
    } else if (request.url === '/loop') {
      response.writeHead(302, { Location: '/loop' });
      response.end();
    } else if (request.url === '/bad-redirect') {
      response.writeHead(302, { Location: 'http://[' });
      response.end();
    } else if (request.url === '/file-redirect') {
      response.writeHead(302, { Location: 'file:///tmp/secret' });
      response.end();
    } else if (['/gzip', '/deflate', '/br'].includes(request.url)) {
      const encoding = request.url.slice(1);
      assert(request.headers['accept-encoding'].includes(encoding));
      response.setHeader('Content-Encoding', encoding);
      const compress = { gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync }[encoding];
      response.end(compress(Buffer.from(html)));
    } else if (request.url === '/bad-gzip') {
      response.setHeader('Content-Encoding', 'gzip');
      response.end('invalid gzip');
    } else if (request.url === '/latin1' || request.url === '/meta-charset') {
      response.setHeader('Content-Type', request.url === '/latin1' ? 'text/html; charset=iso-8859-1' : 'text/html');
      response.end(Buffer.from('<meta charset=windows-1252><title>Caf\xe9 \x96 notes</title>', 'latin1'));
    } else if (request.url === '/late-title') {
      response.end(`<head>${' '.repeat(600 * 1024)}<title>Late title</title></head>`);
    } else if (request.url === '/oversized') {
      response.end(`<title>Early title</title>${'x'.repeat(2 * 1024 * 1024)}`);
    } else if (request.url === '/json') {
      response.setHeader('Content-Type', 'application/json');
      response.end('{"title":"<title>Not HTML</title>"}');
    } else if (request.url === '/error') {
      response.writeHead(403);
      response.end('<title>Forbidden</title>');
    } else if (request.url === '/aborted') {
      response.write('<title>Incomplete');
      setTimeout(() => response.destroy(), 10);
    } else if (request.url === '/drip') {
      const timer = setInterval(() => response.write(' '), 10);
      response.on('close', () => clearInterval(timer));
    } else if (request.url.startsWith('/slow-redirect')) {
      const hop = Number(request.url.split('/').pop());
      setTimeout(() => {
        response.writeHead(302, { Location: `/slow-redirect/${hop + 1}` });
        response.end();
      }, 60);
    } else response.end(html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/', '/gzip', '/deflate', '/br', '/redirect']) {
      assert.strictEqual(await fetchTitleFromUrl(base + route), 'Café & tea — 日本語', route);
    }
    for (const route of ['/latin1', '/meta-charset']) {
      assert.strictEqual(await fetchTitleFromUrl(base + route), 'Café – notes', route);
    }
    assert.strictEqual(await fetchTitleFromUrl(base + '/late-title'), 'Late title');
    assert.strictEqual(await fetchTitleFromUrl(base + '/late-title', { maxBytes: 512 * 1024 }), '');
    assert.strictEqual(await fetchTitleFromUrl(base + '/oversized', { maxBytes: 64 }), 'Early title');
    for (const route of ['/bad-redirect', '/file-redirect', '/loop', '/bad-gzip', '/json', '/error', '/aborted']) {
      assert.strictEqual(await fetchTitleFromUrl(base + route), '', route);
    }
    for (const route of ['/drip', '/slow-redirect/0']) {
      const started = Date.now();
      assert.strictEqual(await fetchTitleFromUrl(base + route, { timeoutMs: 160 }), '');
      assert(Date.now() - started < 600, 'Enforce a total deadline, including redirects and streaming.');
    }
    const before = requests.length;
    assert.strictEqual(await fetchTitleFromUrl('file:///tmp/secret'), '');
    assert.strictEqual(await fetchTitleFromUrl('http://['), '');
    assert.strictEqual(requests.length, before);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

run().then(() => console.log('test-title-fetcher passed')).catch(error => { console.error(error); process.exitCode = 1; });
