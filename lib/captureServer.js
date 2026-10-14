const http = require('http');
const {
  createLink,
  listLinks,
  readSettings,
  updateLink,
} = require('./library');

const DEFAULT_CAPTURE_PORT = 47342;
const MAX_BODY_BYTES = 64 * 1024;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function responseHeaders(type = 'application/json') {
  return {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': type,
  };
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.flatMap(parseList);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function paramsToInput(params) {
  return {
    url: params.get('url') || '',
    title: params.get('title') || '',
    label: params.get('label') || '',
    tags: [...params.getAll('tag'), ...parseList(params.get('tags'))],
    contexts: [...params.getAll('context'), ...parseList(params.get('contexts'))],
    body: params.get('body') || params.get('notes') || '',
  };
}

function normalizeCaptureInput(input = {}) {
  return {
    url: String(input.url || '').trim(),
    title: String(input.title || '').trim(),
    label: String(input.label || '').trim(),
    tags: parseList(input.tags || input.tag),
    contexts: parseList(input.contexts || input.context),
    body: String(input.body || input.notes || '').trim(),
  };
}

function assertHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('A valid URL is required.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be captured.');
  }

  return parsed.toString();
}

function wantsJson(request) {
  return String(request.headers.accept || '').includes('application/json')
    || String(request.headers['content-type'] || '').includes('application/json');
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, responseHeaders('application/json; charset=utf-8'));
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeHtml(response, statusCode, title, body) {
  response.writeHead(statusCode, responseHeaders('text/html; charset=utf-8'));
  response.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      margin: 0;
      display: grid;
      min-height: 100vh;
      place-items: center;
      background: #eef4f7;
      color: #203247;
      font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(360px, calc(100vw - 32px));
      border: 1px solid #dce5ec;
      border-radius: 8px;
      background: #fff;
      padding: 22px;
      box-shadow: 0 18px 45px rgba(22, 42, 60, .12);
    }
    h1 { margin: 0 0 8px; font-size: 18px; }
    p { margin: 0; color: #6d8190; line-height: 1.45; }
  </style>
</head>
<body>
  <main>${body}</main>
  <script>setTimeout(() => window.close(), 1200);</script>
</body>
</html>`);
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function labelRadio(label, selectedLabel) {
  const checked = label.id === selectedLabel ? ' checked' : '';
  return `<label class="labelDotChoice" title="${escapeHtml(label.name)}">
    <input type="radio" name="label" value="${escapeHtml(label.id)}"${checked}>
    <span style="--label-color:${escapeHtml(label.color)}"></span>
  </label>`;
}

function contextCheckbox(context, selectedContexts) {
  const checked = selectedContexts.has(String(context).toLowerCase()) ? ' checked' : '';
  return `<label class="contextChoice">
    <input type="checkbox" name="context" value="${escapeHtml(context)}"${checked}>
    <span>${escapeHtml(context)}</span>
  </label>`;
}

function countTags(links) {
  const counts = new Map();
  for (const link of links) {
    for (const tag of Array.isArray(link.tags) ? link.tags : []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return counts;
}

function recentTags(links, limit = 6) {
  const seen = new Set();
  const output = [];
  for (const link of links) {
    for (const tag of Array.isArray(link.tags) ? link.tags : []) {
      if (seen.has(tag)) {
        continue;
      }
      seen.add(tag);
      output.push(tag);
      if (output.length >= limit) {
        return output;
      }
    }
  }
  return output;
}

function mostUsedTags(links, limit = 6) {
  return Array.from(countTags(links).entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

async function captureReviewModel(libraryRoot, link) {
  const [settings, listed] = await Promise.all([
    readSettings(libraryRoot),
    listLinks(libraryRoot, {}),
  ]);
  const discoveredContexts = new Set();
  for (const candidate of listed.links) {
    for (const context of Array.isArray(candidate.contexts) ? candidate.contexts : []) {
      discoveredContexts.add(context);
    }
  }
  for (const context of Array.isArray(link.contexts) ? link.contexts : []) {
    discoveredContexts.add(context);
  }
  const configuredContexts = Array.isArray(settings.contexts) ? settings.contexts : [];
  const contexts = [
    ...configuredContexts,
    ...Array.from(discoveredContexts)
      .filter((context) => !configuredContexts.some((item) => item.toLowerCase() === String(context).toLowerCase()))
      .sort((left, right) => String(left).localeCompare(String(right))),
  ];

  return {
    settings,
    contexts,
    recentTags: recentTags(listed.links),
    mostUsedTags: mostUsedTags(listed.links),
  };
}

async function writeCaptureReviewHtml(response, libraryRoot, link, { duplicate = false } = {}) {
  const model = await captureReviewModel(libraryRoot, link);
  const selectedContexts = new Set((link.contexts || []).map((context) => String(context).toLowerCase()));
  const selectedLabel = link.label || 'unlabeled';
  const labels = model.settings.labels || [];
  const selectedLabelName = labels.find((label) => label.id === selectedLabel)?.name || selectedLabel;
  const domain = link.domain || new URL(link.url).hostname;
  const initialTags = Array.isArray(link.tags) ? link.tags : [];
  const suggestionTags = Array.from(new Set([...model.mostUsedTags, ...model.recentTags, ...initialTags])).filter(Boolean);

  response.writeHead(duplicate ? 200 : 201, responseHeaders('text/html; charset=utf-8'));
  response.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Saved to Rinku</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      background: #eef4f7;
      color: #203247;
      font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 42px;
      background: #20344a;
      color: #fff;
      padding: 0 18px;
      font-size: 13px;
      font-weight: 700;
    }
    .check { font-size: 22px; line-height: 1; }
    main { padding: 28px 20px 24px; }
    .titleInput {
      width: 100%;
      border: 0;
      background: transparent;
      color: #203247;
      font-size: 24px;
      line-height: 1.25;
      padding: 0;
    }
    .titleInput:focus { outline: 0; }
    .url {
      overflow: hidden;
      margin-top: 10px;
      color: #7d8997;
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    form {
      display: grid;
      gap: 26px;
      margin-top: 28px;
    }
    fieldset {
      display: grid;
      gap: 9px;
      min-width: 0;
      margin: 0;
      border: 0;
      padding: 0;
    }
    legend,
    .labelText {
      color: #6d8190;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .07em;
      text-transform: uppercase;
    }
    .labelRow {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 24px;
    }
    .labelChoices {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .labelDotChoice {
      display: inline-grid;
      width: 16px;
      height: 16px;
      cursor: pointer;
      place-items: center;
    }
    .labelDotChoice input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .labelDotChoice span {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--label-color);
    }
    .labelDotChoice input:checked + span {
      box-shadow: 0 0 0 3px rgba(47, 159, 206, .2);
      outline: 2px solid color-mix(in oklab, var(--label-color) 72%, #ffffff);
      outline-offset: 2px;
    }
    .selectedLabel {
      color: #6d8190;
      font-size: 12px;
      font-weight: 700;
    }
    .contextChoices {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }
    .contextChoice {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid #dce5ec;
      border-radius: 4px;
      background: #fff;
      padding: 6px 8px;
      font-size: 12px;
    }
    .contextChoice input { accent-color: #2f9fce; }
    .tagEditor {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 7px;
      min-height: 41px;
      border: 1px solid #dce5ec;
      border-radius: 4px;
      background: #fff;
      padding: 6px;
    }
    .tagEditor:focus-within {
      outline: 2px solid rgba(85, 184, 223, .42);
      outline-offset: 2px;
    }
    .tagPill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border-radius: 4px;
      background: #64b6df;
      color: #fff;
      padding: 5px 7px;
      font-size: 12px;
      line-height: 1;
    }
    .tagPill button {
      border: 0;
      background: transparent;
      color: rgba(255, 255, 255, .9);
      cursor: pointer;
      padding: 0;
    }
    .tagInput {
      width: 120px;
      min-width: 80px;
      flex: 1 1 100px;
      border: 0;
      background: transparent;
      padding: 4px 2px;
    }
    .tagInput:focus { outline: 0; }
    .tagSuggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      color: #7a8fa1;
      font-size: 12px;
      line-height: 1.5;
    }
    .tagSuggestion {
      border: 0;
      background: transparent;
      color: #708a9d;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      padding: 0;
    }
    textarea {
      width: 100%;
      min-height: 84px;
      resize: vertical;
      border: 1px solid #dce5ec;
      border-radius: 4px;
      background: #fff;
      padding: 12px;
      font: inherit;
      line-height: 1.45;
    }
    textarea:focus { outline: 2px solid rgba(85, 184, 223, .42); outline-offset: 2px; }
    .submit {
      min-height: 44px;
      border: 0;
      border-radius: 4px;
      background: #48a9df;
      color: #fff;
      cursor: pointer;
      font-weight: 800;
      letter-spacing: .02em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="topbar">
    <span>${duplicate ? (link.status === 'archived' ? 'This link is already in your archive. You can edit it below.' : 'This link is already saved. You can edit it below.') : 'This link has been added to your library.'}</span>
    <span class="check" aria-hidden="true">&#10003;</span>
  </div>
  <main>
    <form method="post" action="/capture/update">
      <input type="hidden" name="id" value="${escapeHtml(link.id)}">
      <input type="hidden" id="tagsValue" name="tags" value="${escapeHtml(initialTags.join(','))}">
      <div>
        <input class="titleInput" name="title" value="${escapeHtml(link.title)}" aria-label="Title">
        <div class="url">${escapeHtml(domain)}${link.url ? ` - ${escapeHtml(link.url)}` : ''}</div>
      </div>
      <fieldset>
        <legend>Label</legend>
        <div class="labelRow">
          <div class="labelChoices">${labels.map((label) => labelRadio(label, selectedLabel)).join('')}</div>
          <span class="selectedLabel" id="selectedLabel">${escapeHtml(selectedLabelName)}</span>
        </div>
      </fieldset>
      <fieldset>
        <legend>Contexts</legend>
        <div class="contextChoices">${model.contexts.map((context) => contextCheckbox(context, selectedContexts)).join('')}</div>
      </fieldset>
      <fieldset>
        <legend>Tags</legend>
        <div id="tagEditor" class="tagEditor"></div>
        ${suggestionTags.length ? `<div class="tagSuggestions">
          <span>Suggestions:</span>
          ${suggestionTags.map((tag) => `<button class="tagSuggestion" type="button" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')}
        </div>` : ''}
      </fieldset>
      <fieldset>
        <legend>Notes</legend>
        <textarea name="body" placeholder="Type note text here...">${escapeHtml(link.body || '')}</textarea>
      </fieldset>
      <button class="submit" type="submit">Update & Return</button>
    </form>
  </main>
  <script>
    const labelNames = ${safeJson(Object.fromEntries(labels.map((label) => [label.id, label.name])))};
    let tags = ${safeJson(initialTags)};
    const tagEditor = document.getElementById('tagEditor');
    const tagsValue = document.getElementById('tagsValue');
    function normalizeTag(value) {
      return String(value || '').trim().replace(/^#/, '').toLowerCase().normalize('NFKD')
        .replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    function setTags(next) {
      const seen = new Set();
      tags = next.map(normalizeTag).filter((tag) => {
        if (!tag || seen.has(tag)) return false;
        seen.add(tag);
        return true;
      });
      renderTags();
    }
    function addTag(value) {
      setTags([...tags, ...String(value || '').split(',')]);
    }
    function renderTags() {
      tagEditor.replaceChildren();
      tagsValue.value = tags.join(',');
      for (const tag of tags) {
        const pill = document.createElement('span');
        pill.className = 'tagPill';
        pill.textContent = '#' + tag;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '\\u00d7';
        remove.setAttribute('aria-label', 'Remove ' + tag);
        remove.addEventListener('click', () => setTags(tags.filter((candidate) => candidate !== tag)));
        pill.appendChild(remove);
        tagEditor.appendChild(pill);
      }
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'tagInput';
      input.placeholder = tags.length ? '' : 'e.g. work, technology, interview';
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
          event.preventDefault();
          addTag(input.value);
          input.value = '';
        } else if (event.key === 'Backspace' && !input.value && tags.length) {
          setTags(tags.slice(0, -1));
        }
      });
      input.addEventListener('blur', () => {
        if (input.value.trim()) {
          addTag(input.value);
          input.value = '';
        }
      });
      tagEditor.appendChild(input);
    }
    document.querySelectorAll('input[name="label"]').forEach((input) => {
      input.addEventListener('change', () => {
        document.getElementById('selectedLabel').textContent = labelNames[input.value] || input.value;
      });
    });
    document.querySelectorAll('[data-tag]').forEach((button) => {
      button.addEventListener('click', () => addTag(button.dataset.tag));
    });
    renderTags();
  </script>
</body>
</html>`);
}

function writeCaptureUpdatedHtml(response, link) {
  writeHtml(
    response,
    200,
    'Updated in Rinku',
    `<h1>Updated in Rinku</h1><p>${escapeHtml(link.title)} was updated.</p>`
  );
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Capture request is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function parsePostInput(request) {
  const raw = await readBody(request);
  const type = String(request.headers['content-type'] || '').split(';')[0].trim();

  if (type === 'application/json') {
    return normalizeCaptureInput(JSON.parse(raw || '{}'));
  }

  if (type === 'application/x-www-form-urlencoded' || !type) {
    return paramsToInput(new URLSearchParams(raw));
  }

  throw new Error(`Unsupported content type: ${type}`);
}

async function parsePostParams(request) {
  const raw = await readBody(request);
  const type = String(request.headers['content-type'] || '').split(';')[0].trim();

  if (type === 'application/json') {
    const source = JSON.parse(raw || '{}');
    const input = {
      id: source.id || '',
      title: source.title || '',
      label: source.label || '',
      tags: parseList(source.tags || source.tag),
      contexts: parseList(source.contexts || source.context),
      body: source.body || source.notes || '',
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          params.append(key.replace(/s$/, ''), item);
        }
      } else {
        params.set(key, value);
      }
    }
    return params;
  }

  if (type === 'application/x-www-form-urlencoded' || !type) {
    return new URLSearchParams(raw);
  }

  throw new Error(`Unsupported content type: ${type}`);
}

function paramsToUpdatePatch(params) {
  return {
    title: params.get('title') || '',
    label: params.get('label') || 'unlabeled',
    tags: [...params.getAll('tag'), ...parseList(params.get('tags'))],
    contexts: [...params.getAll('context'), ...parseList(params.get('contexts'))],
    body: params.get('body') || params.get('notes') || '',
  };
}

class LocalCaptureServer {
  constructor(options = {}) {
    this.getLibraryRoot = options.getLibraryRoot || (() => '');
    this.onCapture = options.onCapture || (() => {});
    this.server = null;
    this.host = '127.0.0.1';
    this.port = 0;
  }

  status() {
    const running = Boolean(this.server);
    return {
      running,
      host: this.host,
      port: running ? this.port : 0,
      baseUrl: running ? `http://${this.host}:${this.port}` : '',
    };
  }

  async start(options = {}) {
    if (this.server) {
      return this.status();
    }

    const requestedPort = options.port === 0
      ? 0
      : Number(options.port) || DEFAULT_CAPTURE_PORT;
    const host = options.host || '127.0.0.1';
    let port = requestedPort;
    let attempts = requestedPort === 0 ? 1 : 20;
    let lastError = null;

    while (attempts > 0) {
      try {
        await this.listen(host, port);
        return this.status();
      } catch (error) {
        lastError = error;
        if (!error || error.code !== 'EADDRINUSE' || requestedPort === 0) {
          throw error;
        }
        port += 1;
        attempts -= 1;
      }
    }

    throw lastError || new Error('Could not start capture server.');
  }

  listen(host, port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        this.handle(request, response).catch((error) => {
          this.handleError(request, response, error);
        });
      });

      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        this.server = server;
        this.host = host;
        this.port = server.address().port;
        resolve();
      });
    });
  }

  async stop() {
    if (!this.server) {
      return this.status();
    }

    const server = this.server;
    this.server = null;
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    this.port = 0;
    return this.status();
  }

  async handle(request, response) {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, responseHeaders());
      response.end();
      return;
    }

    const requestUrl = new URL(request.url, `http://${request.headers.host || `${this.host}:${this.port}`}`);
    if (requestUrl.pathname === '/status' && request.method === 'GET') {
      writeJson(response, 200, {
        ok: true,
        ...this.status(),
        libraryOpen: Boolean(this.getLibraryRoot()),
      });
      return;
    }

    if (requestUrl.pathname === '/capture/update' && request.method === 'POST') {
      await this.handleCaptureUpdate(request, response);
      return;
    }

    if (requestUrl.pathname !== '/capture' || (request.method !== 'GET' && request.method !== 'POST')) {
      writeJson(response, 404, { ok: false, error: 'Not found.' });
      return;
    }

    const libraryRoot = this.getLibraryRoot();
    if (!libraryRoot) {
      throw new Error('No Rinku library is open.');
    }

    const rawInput = request.method === 'GET'
      ? paramsToInput(requestUrl.searchParams)
      : await parsePostInput(request);
    const input = normalizeCaptureInput(rawInput);
    input.url = assertHttpUrl(input.url);

    const result = await createLink(libraryRoot, {
      ...input,
      source: {
        capture: {
          capturedAt: new Date().toISOString(),
          method: request.method,
        },
      },
    }, { learnRule: Boolean(input.label) });
    this.onCapture({ libraryRoot, link: result.link, duplicate: result.duplicate });

    if (wantsJson(request)) {
      writeJson(response, result.duplicate ? 200 : 201, { ok: true, link: result.link, duplicate: result.duplicate });
      return;
    }

    await writeCaptureReviewHtml(response, libraryRoot, result.link, { duplicate: result.duplicate });
  }

  async handleCaptureUpdate(request, response) {
    const libraryRoot = this.getLibraryRoot();
    if (!libraryRoot) {
      throw new Error('No Rinku library is open.');
    }

    const params = await parsePostParams(request);
    const id = params.get('id') || '';
    if (!id) {
      throw new Error('A link id is required.');
    }

    const link = await updateLink(
      libraryRoot,
      id,
      paramsToUpdatePatch(params),
      { learnRule: params.has('label') }
    );
    this.onCapture({ libraryRoot, link, updated: true });

    if (wantsJson(request)) {
      writeJson(response, 200, { ok: true, link });
      return;
    }

    writeCaptureUpdatedHtml(response, link);
  }

  handleError(request, response, error) {
    if (wantsJson(request)) {
      writeJson(response, 400, { ok: false, error: error.message || String(error) });
      return;
    }

    writeHtml(
      response,
      400,
      'Rinku Capture Error',
      `<h1>Capture failed</h1><p>${escapeHtml(error.message || String(error))}</p>`
    );
  }
}

function createLocalCaptureServer(options = {}) {
  return new LocalCaptureServer(options);
}

module.exports = {
  DEFAULT_CAPTURE_PORT,
  LocalCaptureServer,
  assertHttpUrl,
  createLocalCaptureServer,
  normalizeCaptureInput,
  paramsToInput,
};
