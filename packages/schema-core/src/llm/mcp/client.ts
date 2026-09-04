import { MCP_PROTOCOL_VERSION } from './server.js';

const PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';

const DEFAULT_MAX_CALLS = 64;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

type RequestId = string | number;

export interface RemoteTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface RemoteToolResult {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly isError: boolean;
}

export interface McpClient {
  listTools(): Promise<readonly RemoteTool[]>;
  callTool(name: string, args: unknown): Promise<RemoteToolResult>;
}

export interface McpClientOptions {
  readonly maxCalls?: number;
  readonly maxResponseBytes?: number;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  readonly clientCapabilities?: Readonly<Record<string, unknown>>;
}

export class McpProtocolError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'McpProtocolError';
    this.code = code;
    this.data = data;
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (value: Readonly<Record<string, unknown>>, key: string): unknown => Reflect.get(value, key);

const positiveSafeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
};

const boundedResponse = (value: unknown, maxResponseBytes: number): unknown => {
  const serialised = typeof value === 'string' ? value : JSON.stringify(value);
  if (serialised === undefined) throw new TypeError('MCP transport returned a non-JSON value');
  if (new TextEncoder().encode(serialised).byteLength > maxResponseBytes) {
    throw new RangeError(`MCP response exceeds maxResponseBytes (${String(maxResponseBytes)})`);
  }
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new TypeError('MCP transport returned invalid JSON');
  }
};

const responseResult = (
  response: unknown,
  id: RequestId,
  maxResponseBytes: number,
): Readonly<Record<string, unknown>> => {
  const bounded = boundedResponse(response, maxResponseBytes);
  if (!isRecord(bounded) || field(bounded, 'jsonrpc') !== '2.0' || field(bounded, 'id') !== id) {
    throw new TypeError('invalid MCP response envelope');
  }

  const rawError = field(bounded, 'error');
  if (rawError !== undefined) {
    if (!isRecord(rawError)) throw new TypeError('invalid MCP error response');
    const code = field(rawError, 'code');
    const message = field(rawError, 'message');
    if (typeof code !== 'number' || !Number.isInteger(code) || typeof message !== 'string') {
      throw new TypeError('invalid MCP error response');
    }
    throw new McpProtocolError(code, message, field(rawError, 'data'));
  }

  const result = field(bounded, 'result');
  if (!isRecord(result)) throw new TypeError('invalid MCP result response');
  const resultType = field(result, 'resultType');
  if (resultType !== undefined && resultType !== 'complete') {
    throw new TypeError(`unsupported MCP resultType ${String(resultType)}`);
  }
  return result;
};

const remoteToolOf = (value: unknown): RemoteTool => {
  if (!isRecord(value)) throw new TypeError('invalid remote MCP tool');
  const name = field(value, 'name');
  const description = field(value, 'description');
  const inputSchema = field(value, 'inputSchema');
  if (
    typeof name !== 'string' ||
    (description !== undefined && typeof description !== 'string') ||
    !isRecord(inputSchema)
  ) {
    throw new TypeError('invalid remote MCP tool');
  }
  return description === undefined ? { name, inputSchema } : { name, description, inputSchema };
};

const contentBlockOf = (value: unknown): { readonly type: string; readonly text?: string } => {
  if (!isRecord(value)) throw new TypeError('invalid remote MCP content block');
  const type = field(value, 'type');
  const text = field(value, 'text');
  if (typeof type !== 'string' || (text !== undefined && typeof text !== 'string')) {
    throw new TypeError('invalid remote MCP content block');
  }
  return text === undefined ? { ...value, type } : { ...value, type, text };
};

export function createMcpClient(send: (message: unknown) => Promise<unknown>, opts: McpClientOptions = {}): McpClient {
  const maxCalls = positiveSafeInteger(opts.maxCalls ?? DEFAULT_MAX_CALLS, 'maxCalls');
  const maxResponseBytes = positiveSafeInteger(opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 'maxResponseBytes');
  const clientCapabilities = opts.clientCapabilities ?? {};
  let nextId = 1;
  let calls = 0;

  const request = async (
    method: string,
    params: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> => {
    if (calls >= maxCalls) throw new RangeError(`MCP client call budget exhausted (${String(maxCalls)})`);
    calls += 1;
    const id = nextId;
    nextId += 1;
    const meta =
      opts.clientInfo === undefined
        ? {
            [PROTOCOL_VERSION_KEY]: MCP_PROTOCOL_VERSION,
            [CLIENT_CAPABILITIES_KEY]: clientCapabilities,
          }
        : {
            [PROTOCOL_VERSION_KEY]: MCP_PROTOCOL_VERSION,
            [CLIENT_INFO_KEY]: opts.clientInfo,
            [CLIENT_CAPABILITIES_KEY]: clientCapabilities,
          };
    const response = await send({
      jsonrpc: '2.0',
      id,
      method,
      params: { ...params, _meta: meta },
    });
    return responseResult(response, id, maxResponseBytes);
  };

  return {
    async listTools(): Promise<readonly RemoteTool[]> {
      const result = await request('tools/list', {});
      const tools = field(result, 'tools');
      if (!Array.isArray(tools)) throw new TypeError('invalid MCP tools/list result');
      return tools.map(remoteToolOf);
    },

    async callTool(name: string, args: unknown): Promise<RemoteToolResult> {
      const result = await request('tools/call', { name, arguments: args });
      const content = field(result, 'content');
      const isError = field(result, 'isError');
      if (!Array.isArray(content) || (isError !== undefined && typeof isError !== 'boolean')) {
        throw new TypeError('invalid MCP tools/call result');
      }
      return {
        content: content.map(contentBlockOf),
        isError: isError ?? false,
      };
    },
  };
}
