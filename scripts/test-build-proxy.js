const assert = require('node:assert/strict');
const http = require('node:http');
const { createRequire } = require('node:module');

// Exercise electron-builder's downloader API against the scoped global-agent
// override. Keep all traffic local, including the deliberately invalid host.
async function run() {
  let proxyRequests = 0;
  let directRequests = 0;
  const proxy = http.createServer((request, response) => {
    proxyRequests += 1;
    assert.equal(request.url, 'http://rinku-build-proxy.invalid/artifact');
    response.end('proxied');
  });
  const origin = http.createServer((_request, response) => {
    directRequests += 1;
    response.end('direct');
  });
  const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await listen(proxy);
  await listen(origin);
  try {
    process.env.GLOBAL_AGENT_HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`;
    process.env.GLOBAL_AGENT_NO_PROXY = '127.0.0.1';
    process.env.ELECTRON_GET_USE_PROXY = '1';
    const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'));
    builderRequire('@electron/get');
    const get = (url) => new Promise((resolve, reject) => {
      http.get(url, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve(body));
      }).on('error', reject).setTimeout(5000, function () { this.destroy(new Error('Proxy request timed out')); });
    });
    assert.equal(await get('http://rinku-build-proxy.invalid/artifact'), 'proxied');
    assert.equal(await get(`http://127.0.0.1:${origin.address().port}/artifact`), 'direct');
    assert.equal(proxyRequests, 1);
    assert.equal(directRequests, 1);
    console.log('test-build-proxy passed: downloader proxy bootstrap and NO_PROXY bypass');
  } finally {
    proxy.closeAllConnections();
    origin.closeAllConnections();
    await Promise.all([new Promise((resolve) => proxy.close(resolve)), new Promise((resolve) => origin.close(resolve))]);
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
