const http = require('http');
const { randomBytes, timingSafeEqual } = require('crypto');
const { OPERATIONS, ServiceError, createConfig, createService } = require('./service');

const DEFAULT_API_PORT = 47343;
const MAX_BODY_BYTES = 1024 * 1024;
const ROUTES = [
  ['GET', '/config', 'rinku_get_config'],
  ['GET', '/libraries', 'rinku_list_libraries'],
  ['POST', '/libraries', 'rinku_create_library', 201],
  ['GET', '/settings', 'rinku_read_settings'],
  ['GET', '/links', 'rinku_list_links'],
  ['POST', '/links', 'rinku_create_link', 201],
  ['GET', '/links/{ref}', 'rinku_read_link'],
  ['PATCH', '/links/{ref}', 'rinku_update_link'],
  ['POST', '/links/{ref}/archive', 'rinku_archive_link'],
  ['POST', '/links/{ref}/restore', 'rinku_restore_link'],
  ['POST', '/imports/unmark', 'rinku_import_unmark'],
  ['POST', '/index/rebuild', 'rinku_rebuild_index'],
];

function openApiDocument() {
  const paths = {};
  for (const [method, route, name, status = 200] of ROUTES) {
    const operation = OPERATIONS.find((entry) => entry.name === name);
    const properties = { ...operation.inputSchema.properties };
    const required = [...(operation.inputSchema.required || [])];
    const parameters = [];
    if (route.includes('{ref}')) {
      parameters.push({ name: 'ref', in: 'path', required: true, schema: properties.ref });
      delete properties.ref;
      required.splice(required.indexOf('ref'), 1);
    }
    if (properties.libraryRoot && name !== 'rinku_create_library') {
      parameters.push({ name: 'libraryRoot', in: 'query', schema: properties.libraryRoot, description: 'Library path; optional if the server has a default library.' });
      delete properties.libraryRoot;
      required.splice(required.indexOf('libraryRoot'), 1);
    }
    const endpoint = {
      operationId: name, summary: operation.description, parameters,
      responses: {
        [status]: { description: 'Success', content: { 'application/json': { schema: { type: 'object', required: ['ok', 'data'], properties: { ok: { type: 'boolean' }, data: { type: 'object' } } } } } },
        default: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    };
    if (method === 'GET') {
      for (const [key, schema] of Object.entries(properties)) parameters.push({ name: key, in: 'query', schema });
    } else if (Object.keys(properties).length) {
      endpoint.requestBody = {
        required: required.length > 0,
        content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties, required } } },
      };
    }
    paths[`/api/v1${route}`] ||= {};
    paths[`/api/v1${route}`][method.toLowerCase()] = endpoint;
  }
  paths['/api/v1/openapi.json'] = { get: { summary: 'Read the OpenAPI document', responses: { 200: { description: 'OpenAPI 3.1 document' } } } };
  return {
    openapi: '3.1.0', info: { title: 'Rinku Local API', version: '1.0.0' }, paths,
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: { Error: { type: 'object', properties: { ok: { type: 'boolean' }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } } },
    },
  };
}

async function readJsonBody(request) {
  const type = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type && type !== 'application/json') throw new ServiceError('unsupported_media_type', 'Use application/json.', 415);
  const chunks = [];
  let size = 0;
  await new Promise((resolve, reject) => {
    let tooLarge = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (tooLarge) return;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new ServiceError('payload_too_large', 'Request body exceeds 1 MiB.', 413));
      } else chunks.push(chunk);
    });
    request.once('end', resolve);
    request.once('error', reject);
    request.once('aborted', () => reject(new ServiceError('invalid_arguments', 'Request was aborted.')));
  });
  if (!size) return {};
  if (!type) throw new ServiceError('unsupported_media_type', 'Use application/json.', 415);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
    throw new ServiceError('invalid_json', 'Request body must be valid JSON.');
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(status === 401 ? { 'WWW-Authenticate': 'Bearer realm="Rinku"' } : {}),
  });
  response.end(JSON.stringify(value));
}

function createApiServer(options = {}) {
  const env = options.env || process.env;
  const config = { ...createConfig(env, 'RINKU_API'), ...options.config, transport: 'API' };
  const defaultLibrary = options.libraryRoot || env.RINKU_API_LIBRARY || '';
  if (!config.allowedRoots.length && defaultLibrary) config.allowedRoots = [defaultLibrary];
  const service = createService(config);
  const token = options.token || env.RINKU_API_TOKEN || randomBytes(32).toString('base64url');
  if (typeof token !== 'string' || /\s/.test(token)) throw new Error('API token must be a nonempty string without whitespace.');
  const expected = Buffer.from(`Bearer ${token}`);
  let server;
  let port = 0;

  async function handle(request, response) {
    const host = request.headers.host;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) {
      throw new ServiceError('forbidden', 'Invalid Host header.', 403);
    }
    const origin = request.headers.origin;
    if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) {
      throw new ServiceError('forbidden', 'Cross-origin requests are not allowed.', 403);
    }
    const received = Buffer.from(request.headers.authorization || '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new ServiceError('unauthorized', 'A valid bearer token is required.', 401);
    }
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (request.method === 'GET' && url.pathname === '/api/v1/openapi.json') {
      sendJson(response, 200, openApiDocument());
      return;
    }
    const routeMatches = ROUTES.map((route) => {
      const pattern = new RegExp(`^/api/v1${route[1].replace('{ref}', '([^/]+)')}$`);
      return { route, match: url.pathname.match(pattern) };
    }).filter((entry) => entry.match);
    if (!routeMatches.length) throw new ServiceError('not_found', 'Route not found.', 404);
    const found = routeMatches.find(({ route }) => route[0] === request.method);
    if (!found) {
      response.setHeader('Allow', routeMatches.map(({ route }) => route[0]).join(', '));
      throw new ServiceError('method_not_allowed', 'Method not allowed.', 405);
    }
    const [, , name, status = 200] = found.route;
    let args = request.method === 'GET' ? Object.create(null) : await readJsonBody(request);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ServiceError('invalid_arguments', 'JSON body must be an object.');
    for (const [key, value] of url.searchParams) {
      if (Object.hasOwn(args, key)) throw new ServiceError('invalid_arguments', `Duplicate parameter: ${key}`);
      if (request.method !== 'GET' && key !== 'libraryRoot') throw new ServiceError('invalid_arguments', `Unexpected query parameter: ${key}`);
      const values = url.searchParams.getAll(key);
      if (values.length > 1) throw new ServiceError('invalid_arguments', `Duplicate parameter: ${key}`);
      args[key] = ['limit', 'olderThanDays'].includes(key) ? (value.trim() ? Number(value) : NaN) : value;
    }
    const definition = OPERATIONS.find((operation) => operation.name === name);
    if (name !== 'rinku_create_library' && definition.inputSchema.properties.libraryRoot && !Object.hasOwn(args, 'libraryRoot') && defaultLibrary) args.libraryRoot = defaultLibrary;
    if (found.match[1]) {
      if (Object.hasOwn(args, 'ref')) throw new ServiceError('invalid_arguments', 'Pass ref only in the URL path.');
      try { args.ref = decodeURIComponent(found.match[1]); } catch { throw new ServiceError('invalid_arguments', 'Invalid URL encoding.'); }
    }
    sendJson(response, status, { ok: true, data: await service.execute(name, args) });
  }

  return {
    token, service,
    status() { return { running: Boolean(server), host: '127.0.0.1', port, baseUrl: port ? `http://127.0.0.1:${port}/api/v1` : '', readOnly: config.readOnly }; },
    async start(startOptions = {}) {
      if (server) return this.status();
      if (!config.allowedRoots.length) throw new Error('Set RINKU_API_ALLOWED_ROOTS or pass --library <path>.');
      const requestedPort = Number(startOptions.port ?? env.RINKU_API_PORT ?? DEFAULT_API_PORT);
      if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('API port must be an integer between 0 and 65535.');
      const listener = http.createServer((request, response) => {
        handle(request, response).catch((error) => {
          request.resume();
          if (!response.headersSent && !response.destroyed) sendJson(response, error.status || 500, { ok: false, error: { code: error.code || 'internal_error', message: error.status ? error.message : 'Internal server error.' } });
        });
      });
      listener.requestTimeout = 30000;
      listener.headersTimeout = 10000;
      await new Promise((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(requestedPort, '127.0.0.1', () => { listener.off('error', reject); resolve(); });
      });
      server = listener;
      port = server.address().port;
      return this.status();
    },
    async stop() {
      if (!server) return this.status();
      const listener = server;
      await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
      server = undefined;
      port = 0;
      return this.status();
    },
  };
}

async function startApiServer(options = {}) {
  const api = createApiServer(options);
  const status = await api.start({ port: options.port });
  process.stderr.write(`Rinku API: ${status.baseUrl} (${status.readOnly ? 'read-only' : 'writable'})\nBearer token: ${api.token}\n`);
  const close = () => api.stop().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  return api;
}

module.exports = { DEFAULT_API_PORT, MAX_BODY_BYTES, ROUTES, createApiServer, openApiDocument, startApiServer };
