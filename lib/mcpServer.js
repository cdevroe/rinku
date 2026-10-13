const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } = require('@modelcontextprotocol/sdk/types.js');
const { version } = require('../package.json');
const { OPERATIONS, READ_OPERATIONS, createConfig, createService, normalizeOperationName } = require('./service');

const TOOL_DEFINITIONS = OPERATIONS.map((operation) => ({
  ...operation,
  annotations: {
    readOnlyHint: READ_OPERATIONS.has(operation.name),
    destructiveHint: !READ_OPERATIONS.has(operation.name),
    openWorldHint: false,
  },
}));

function toolContent(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

// Keep the direct-call interface for local integrations and tests.
const services = new WeakMap();
async function callTool(name, args = {}, config) {
  if (!services.has(config)) services.set(config, createService(config));
  return toolContent(await services.get(config).execute(name, args));
}

function createMcpServer(config = createConfig()) {
  const service = createService(config);
  const server = new Server({ name: 'rinku-mcp', version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = normalizeOperationName(request.params.name);
    if (!TOOL_DEFINITIONS.some((tool) => tool.name === name)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`);
    }
    try {
      return toolContent(await service.execute(name, request.params.arguments ?? {}));
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
  return server;
}

async function startMcpServer(config = createConfig()) {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  server.onerror = (error) => process.stderr.write(`${error.message}\n`);
  await server.connect(transport);
  const close = () => server.close().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  process.stdin.once('end', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  return server;
}

module.exports = { TOOL_DEFINITIONS, callTool, createConfig, createMcpServer, startMcpServer };
