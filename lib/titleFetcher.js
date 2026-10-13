const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 4500;
const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanTitle(value) {
  return decodeHtmlEntities(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function attributeValue(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? cleanTitle(match[1] || match[2] || match[3] || '') : '';
}

function extractTitle(html) {
  const metaPattern = /<meta\b[^>]*>/gi;
  let match;
  while ((match = metaPattern.exec(html))) {
    const tag = match[0];
    const key = (attributeValue(tag, 'property') || attributeValue(tag, 'name')).toLowerCase();
    if (['og:title', 'twitter:title', 'title'].includes(key)) {
      const title = attributeValue(tag, 'content');
      if (title) {
        return title;
      }
    }
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch ? cleanTitle(titleMatch[1].replace(/<[^>]+>/g, '')) : '';
}

function fetchHtml(url, options = {}, redirects = 0) {
  return new Promise((resolve) => {
    let requestUrl;
    try {
      requestUrl = new URL(url);
    } catch {
      resolve('');
      return;
    }

    if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
      resolve('');
      return;
    }

    const client = requestUrl.protocol === 'https:' ? https : http;
    const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const maxBytes = Number(options.maxBytes) || DEFAULT_MAX_BYTES;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value || '');
    };

    const request = client.request(requestUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Rinku/0.1 (+https://github.com/)',
      },
    }, (response) => {
      const statusCode = Number(response.statusCode) || 0;
      const location = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location && redirects < MAX_REDIRECTS) {
        response.resume();
        finish(fetchHtml(new URL(location, requestUrl).toString(), options, redirects + 1));
        return;
      }

      if (statusCode >= 400) {
        response.resume();
        finish('');
        return;
      }

      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        if (settled) return;
        const remaining = maxBytes - size;
        if (remaining > 0) {
          chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
        }
        size += chunk.length;
        if (size >= maxBytes) {
          finish(Buffer.concat(chunks).toString('utf8'));
          request.destroy();
        }
      });
      response.on('end', () => {
        finish(Buffer.concat(chunks).toString('utf8'));
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      finish('');
    });
    request.on('error', () => finish(''));
    request.end();
  });
}

async function fetchTitleFromUrl(url, options = {}) {
  const html = await fetchHtml(url, options);
  return html ? extractTitle(html) : '';
}

module.exports = {
  cleanTitle,
  extractTitle,
  fetchTitleFromUrl,
};
