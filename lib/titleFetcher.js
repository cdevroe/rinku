const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { Parser } = require('htmlparser2');
const { decodeHTML } = require('entities');

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanTitle(value) {
  return normalizeTitle(decodeHTML(String(value || '')));
}

function usableTitle(value) {
  const title = normalizeTitle(value);
  // Never save common challenge/error page titles as if they were the article.
  return /^(robot check|captcha|access denied|just a moment[.!…]*|attention required!?\s*\|\s*cloudflare)$/i.test(title) ? '' : title;
}

function extractTitle(html) {
  const metadata = new Map();
  let titleText = '';
  let inTitle = false;
  let title = '';
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === 'title' && !title) {
        inTitle = true;
        titleText = '';
      }
      if (name === 'meta') {
        const key = String(attributes.property || attributes.name || '').toLowerCase();
        if (['og:title', 'twitter:title', 'title'].includes(key) && !metadata.has(key)) {
          const value = usableTitle(attributes.content);
          if (value) metadata.set(key, value);
        }
      }
    },
    ontext(text) {
      if (inTitle) titleText += text;
    },
    onclosetag(name, isImplied) {
      if (name === 'title' && inTitle) {
        if (!isImplied) title = usableTitle(titleText);
        inTitle = false;
      }
    },
  });
  parser.end(String(html || ''));
  // Prefer the publisher's Open Graph title regardless of tag order.
  return metadata.get('og:title') || metadata.get('twitter:title') || metadata.get('title') || title;
}

function decodeHtml(buffer, contentType) {
  const headerCharset = String(contentType || '').match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
  const prefix = buffer.subarray(0, 1024).toString('latin1');
  let metaCharset = '';
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name !== 'meta' || metaCharset) return;
      metaCharset = attributes.charset || (attributes.content || '').match(/charset\s*=\s*([^\s;"']+)/i)?.[1] || '';
    },
  });
  parser.end(prefix);
  try {
    return new TextDecoder(headerCharset || metaCharset || 'utf-8').decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

function fetchHtml(url, options = {}) {
  return new Promise((resolve) => {
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const maxBytes = Math.max(1, Number(options.maxBytes) || DEFAULT_MAX_BYTES);
    const deadline = Date.now() + timeoutMs;
    let settled = false;
    let request;
    let response;
    let decoder;
    const finish = (html = '', reason = 'network', statusCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ html, reason, ...(statusCode ? { statusCode } : {}) });
      decoder?.destroy();
      response?.destroy();
      request?.destroy();
    };
    // A single wall-clock deadline includes DNS, redirects and slow-drip bodies.
    const timer = setTimeout(() => finish('', 'timeout'), timeoutMs);

    function visit(address, redirects = 0) {
      let requestUrl;
      try {
        requestUrl = new URL(address);
      } catch {
        finish('', 'invalid_url');
        return;
      }
      if (!['http:', 'https:'].includes(requestUrl.protocol)) {
        finish('', 'invalid_url');
        return;
      }
      if (Date.now() >= deadline) {
        finish('', 'timeout');
        return;
      }
      const client = requestUrl.protocol === 'https:' ? https : http;
      try {
        const outgoing = client.get(requestUrl, {
          headers: {
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': 'Mozilla/5.0 (compatible; Rinku/0.1; +https://github.com/cdevroe/rinku)',
          },
        }, (incoming) => {
          if (settled) { incoming.destroy(); return; }
          response = incoming;
          const status = Number(response.statusCode) || 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = response.headers.location;
            if (!location || redirects >= MAX_REDIRECTS) { finish('', 'unreadable'); return; }
            let next;
            try { next = new URL(location, requestUrl).href; } catch { finish('', 'unreadable'); return; }
            response.on('error', () => {});
            response.destroy();
            visit(next, redirects + 1);
            return;
          }
          response.on('error', () => finish());
          response.on('aborted', () => finish());
          if (status < 200 || status >= 300) {
            finish('', status === 429 ? 'rate_limited' : [401, 403].includes(status) ? 'blocked' : 'http_error', status);
            return;
          }
          const contentType = String(response.headers['content-type'] || '');
          if (contentType && !/^(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
            finish('', 'not_html');
            return;
          }
          const encoding = String(response.headers['content-encoding'] || 'identity').trim().toLowerCase();
          if (encoding === 'gzip') decoder = zlib.createGunzip();
          else if (encoding === 'deflate') decoder = zlib.createInflate();
          else if (encoding === 'br') decoder = zlib.createBrotliDecompress();
          else if (encoding !== 'identity' && encoding !== '') { finish('', 'unreadable'); return; }
          const stream = decoder ? response.pipe(decoder) : response;
          stream.on('error', () => finish('', 'unreadable'));
          const chunks = [];
          let size = 0;
          const complete = () => finish(decodeHtml(Buffer.concat(chunks), contentType), '');
          stream.on('data', (chunk) => {
            if (settled) return;
            const remaining = maxBytes - size;
            chunks.push(chunk.subarray(0, remaining));
            size += Math.min(chunk.length, remaining);
            if (size >= maxBytes) complete();
          });
          stream.on('end', complete);
        });
        request = outgoing;
        request.on('error', () => { if (request === outgoing) finish(); });
      } catch {
        finish();
      }
    }
    visit(url);
  });
}

async function fetchTitleDetails(url, options = {}) {
  const result = await fetchHtml(url, options);
  const title = result.html ? extractTitle(result.html) : '';
  if (title) return { title };
  const reason = result.reason || 'no_title';
  const explanations = {
    rate_limited: 'This site is limiting requests, so Rinku could not fetch its title.',
    blocked: 'This site refused Rinku’s request for its title.',
    timeout: 'The site took too long to respond, so Rinku could not fetch its title.',
    network: 'Rinku could not connect to the site to fetch its title.',
    http_error: 'The site returned an error, so Rinku could not fetch its title.',
    not_html: 'This link does not point to a web page with a readable title.',
    no_title: 'The page did not provide a readable title.',
    unreadable: 'Rinku could not read the page’s title.',
    invalid_url: 'Rinku could not fetch a title from this URL.',
  };
  return {
    title: '', reason,
    ...(result.statusCode ? { statusCode: result.statusCode } : {}),
    message: `Link saved. ${explanations[reason]} You can enter a title below.`,
  };
}

async function fetchTitleFromUrl(url, options = {}) {
  return (await fetchTitleDetails(url, options)).title;
}

module.exports = { cleanTitle, extractTitle, fetchTitleFromUrl, fetchTitleDetails };
