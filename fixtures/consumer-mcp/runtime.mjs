import { defineTools } from '@zmdb/ai/chat';
import { createMcpClient, createMcpServer, MCP_PROTOCOL_VERSION } from '@zmdb/mcp';

const PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';

const record = value => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined);
const field = (value, key) => {
  const object = record(value);
  return object === undefined ? undefined : Reflect.get(object, key);
};

const tools = defineTools({
  echo: {
    spec: {
      name: 'echo',
      description: 'Echo a value with the authenticated subject',
      parameters: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
    },
    validate(value) {
      const input = record(value);
      if (input === undefined || typeof input.value !== 'string') throw new TypeError('value must be a string');
      return { value: input.value };
    },
    handler(input, identity) {
      return JSON.stringify({ value: input.value, subject: field(identity, 'sub') });
    },
    effectful: false,
  },
});

const server = createMcpServer(tools, {
  serverInfo: { name: 'packed-consumer', version: '1.0.0' },
  identify(transport) {
    if (field(transport, 'kind') === 'stdio') return Promise.resolve({ sub: 'local-user' });
    const headers = field(transport, 'headers');
    if (field(headers, 'authorization') === 'Bearer fixture-token') return Promise.resolve({ sub: 'http-user' });
    return Promise.reject(new Error('unauthorised'));
  },
});

const message = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'echo',
    arguments: { value: 'hello' },
    _meta: {
      [PROTOCOL_VERSION_KEY]: MCP_PROTOCOL_VERSION,
      [CLIENT_CAPABILITIES_KEY]: {},
    },
  },
};

const stdio = await server.handle(JSON.stringify(message), { kind: 'stdio' });
if (field(field(stdio, 'result'), 'isError') !== false) throw new Error('stdio-shaped dispatch failed');
if (!JSON.stringify(stdio).includes('local-user')) throw new Error('stdio identity did not reach the handler');

const http = await server.handle(message, { headers: { authorization: 'Bearer fixture-token' } });
if (field(field(http, 'result'), 'isError') !== false) throw new Error('HTTP-shaped dispatch failed');
if (!JSON.stringify(http).includes('http-user')) throw new Error('HTTP identity did not reach the handler');

const client = createMcpClient(
  request => server.handle(request, { headers: { authorization: 'Bearer fixture-token' } }),
  { maxCalls: 2, maxResponseBytes: 4096 },
);
const listed = await client.listTools();
if (listed.length !== 1 || listed[0]?.name !== 'echo')
  throw new Error('packed client did not list the registered tool');
const called = await client.callTool('echo', { value: 'from-client' });
if (called.isError || called.content[0]?.text?.includes('http-user') !== true) {
  throw new Error('packed client did not validate and return the server result');
}

process.stdout.write('packed-mcp-runtime-ok\n');
