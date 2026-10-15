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
    const finish = (value = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
      decoder?.destroy();
      response?.destroy();
      request?.destroy();
    };
    // A single wall-clock deadline includes DNS, redirects and slow-drip bodies.
    const timer = setTimeout(() => finish(), timeoutMs);

    function visit(address, redirects = 0) {
      let requestUrl;
      try {
        requestUrl = new URL(address);
      } catch {
        finish();
        return;
      }
      if (!['http:', 'https:'].includes(requestUrl.protocol) || Date.now() >= deadline) {
        finish();
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
            if (!location || redirects >= MAX_REDIRECTS) { finish(); return; }
            let next;
            try { next = new URL(location, requestUrl).href; } catch { finish(); return; }
            response.on('error', () => {});
            response.destroy();
            visit(next, redirects + 1);
            return;
          }
          response.on('error', () => finish());
          response.on('aborted', () => finish());
          if (status < 200 || status >= 300) { finish(); return; }
          const contentType = String(response.headers['content-type'] || '');
          if (contentType && !/^(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
            finish();
            return;
          }
          const encoding = String(response.headers['content-encoding'] || 'identity').trim().toLowerCase();
          if (encoding === 'gzip') decoder = zlib.createGunzip();
          else if (encoding === 'deflate') decoder = zlib.createInflate();
          else if (encoding === 'br') decoder = zlib.createBrotliDecompress();
          else if (encoding !== 'identity' && encoding !== '') { finish(); return; }
          const stream = decoder ? response.pipe(decoder) : response;
          stream.on('error', () => finish());
          const chunks = [];
          let size = 0;
          const complete = () => finish(decodeHtml(Buffer.concat(chunks), contentType));
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

async function fetchTitleFromUrl(url, options = {}) {
  const html = await fetchHtml(url, options);
  return html ? extractTitle(html) : '';
}

module.exports = { cleanTitle, extractTitle, fetchTitleFromUrl };
