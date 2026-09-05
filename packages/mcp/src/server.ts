import type { ToolRegistry } from '@zmdb/ai/chat';
import { invokeTool } from '@zmdb/ai/tool-runtime';

export const MCP_PROTOCOL_VERSION = '2026-07-28';

const PARSE_ERROR = -32_700;
const INVALID_REQUEST = -32_600;
const METHOD_NOT_FOUND = -32_601;
const INVALID_PARAMS = -32_602;
const UNSUPPORTED_PROTOCOL_VERSION = -32_022;

const PROTOCOL_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

type RequestId = string | number;

const toolErrorId = (): string =>
  [...globalThis.crypto.getRandomValues(new Uint8Array(4))].map(byte => byte.toString(16).padStart(2, '0')).join('');

interface ParsedRequest {
  readonly kind: 'request';
  readonly id: RequestId;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

interface ParsedNotification {
  readonly kind: 'notification';
}

interface InvalidMessage {
  readonly kind: 'invalid';
  readonly id: RequestId | null;
  readonly code: number;
  readonly message: string;
}

type ParsedMessage = ParsedRequest | ParsedNotification | InvalidMessage;

export interface McpServer {
  handle(message: unknown, transport: unknown): Promise<unknown | undefined>;
}

export interface McpServerOptions {
  readonly serverInfo: { readonly name: string; readonly version: string };
  readonly identify: (transport: unknown) => Promise<unknown>;
}

type McpToolHandler = {
  bivarianceHack(input: unknown, identity?: unknown): unknown | PromiseLike<unknown>;
}['bivarianceHack'];

interface McpToolEntry {
  readonly spec: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: unknown;
  };
  readonly validate: (args: unknown) => unknown;
  readonly handler: McpToolHandler;
  readonly effectful?: boolean;
}

type McpToolRegistry = Readonly<Record<string, McpToolEntry>>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (value: Readonly<Record<string, unknown>>, key: string): unknown => Reflect.get(value, key);

const requestIdOf = (value: unknown): RequestId | null => {
  if (typeof value === 'string') return value;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
};

const parseMessage = (message: unknown): ParsedMessage => {
  let value: unknown = message;
  if (typeof message === 'string') {
    try {
      value = JSON.parse(message);
    } catch {
      return { kind: 'invalid', id: null, code: PARSE_ERROR, message: 'Parse error' };
    }
  }

  if (!isRecord(value)) {
    return { kind: 'invalid', id: null, code: INVALID_REQUEST, message: 'Invalid Request' };
  }

  const rawId = field(value, 'id');
  const id = requestIdOf(rawId);
  if (field(value, 'jsonrpc') !== '2.0' || typeof field(value, 'method') !== 'string') {
    return { kind: 'invalid', id, code: INVALID_REQUEST, message: 'Invalid Request' };
  }

  if (!Object.hasOwn(value, 'id')) return { kind: 'notification' };
  if (id === null) return { kind: 'invalid', id: null, code: INVALID_REQUEST, message: 'Invalid Request' };

  const method = field(value, 'method');
  const rawParams = field(value, 'params');
  if (rawParams !== undefined && !isRecord(rawParams)) {
    return { kind: 'invalid', id, code: INVALID_PARAMS, message: 'Invalid params' };
  }

  return {
    kind: 'request',
    id,
    method: typeof method === 'string' ? method : '',
    params: rawParams ?? {},
  };
};

const errorResponse = (
  id: RequestId | null,
  code: number,
  message: string,
  data?: unknown,
): Readonly<Record<string, unknown>> => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

const responseMeta = (
  serverInfo: McpServerOptions['serverInfo'],
): Readonly<Record<string, Readonly<Record<string, string>>>> => ({
  [SERVER_INFO_KEY]: serverInfo,
});

const resultResponse = (
  id: RequestId,
  serverInfo: McpServerOptions['serverInfo'],
  result: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  jsonrpc: '2.0',
  id,
  result: {
    ...result,
    resultType: 'complete',
    _meta: responseMeta(serverInfo),
  },
});

const protocolVersionOf = (params: Readonly<Record<string, unknown>>): string | undefined => {
  const meta = field(params, '_meta');
  if (!isRecord(meta)) return undefined;
  const version = field(meta, PROTOCOL_VERSION_KEY);
  const capabilities = field(meta, CLIENT_CAPABILITIES_KEY);
  return typeof version === 'string' && isRecord(capabilities) ? version : undefined;
};

const toolCallOf = (
  params: Readonly<Record<string, unknown>>,
): { readonly name: string; readonly args: unknown } | undefined => {
  const name = field(params, 'name');
  if (typeof name !== 'string') return undefined;
  return { name, args: field(params, 'arguments') ?? {} };
};

const contentResult = (
  id: RequestId,
  serverInfo: McpServerOptions['serverInfo'],
  text: string,
  isError: boolean,
): Readonly<Record<string, unknown>> =>
  resultResponse(id, serverInfo, {
    content: [{ type: 'text', text }],
    isError,
  });

// The public declaration uses the structural subset MCP consumes so the
// provider-neutral @zmdb/ai/chat implementation cannot leak a provider SDK type.
// The implementation signature still proves compatibility with AI's ToolRegistry.
export function createMcpServer(tools: McpToolRegistry, opts: McpServerOptions): McpServer;
export function createMcpServer(tools: McpToolRegistry | ToolRegistry, opts: McpServerOptions): McpServer {
  const entries = Object.entries(tools);
  for (const [key, entry] of entries) {
    if (entry.spec.name !== key) {
      throw new Error(`tool registry key ${key} does not match spec name ${entry.spec.name}`);
    }
  }
  const entriesByName = new Map(entries);

  return {
    async handle(message: unknown, transport: unknown): Promise<unknown | undefined> {
      const identity = await opts.identify(transport);
      const parsed = parseMessage(message);
      if (parsed.kind === 'notification') return undefined;
      if (parsed.kind === 'invalid') {
        return errorResponse(parsed.id, parsed.code, parsed.message);
      }

      const protocolVersion = protocolVersionOf(parsed.params);
      if (protocolVersion === undefined) {
        return errorResponse(parsed.id, INVALID_PARAMS, 'Missing required MCP request metadata');
      }
      if (protocolVersion !== MCP_PROTOCOL_VERSION) {
        return errorResponse(parsed.id, UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
          supported: [MCP_PROTOCOL_VERSION],
          requested: protocolVersion,
        });
      }

      if (parsed.method === 'server/discover') {
        return resultResponse(parsed.id, opts.serverInfo, {
          supportedVersions: [MCP_PROTOCOL_VERSION],
          capabilities: { tools: {} },
        });
      }

      if (parsed.method === 'tools/list') {
        return resultResponse(parsed.id, opts.serverInfo, {
          tools: entries.map(([, entry]) =>
            entry.spec.description === undefined
              ? { name: entry.spec.name, inputSchema: entry.spec.parameters }
              : {
                  name: entry.spec.name,
                  description: entry.spec.description,
                  inputSchema: entry.spec.parameters,
                },
          ),
        });
      }

      if (parsed.method !== 'tools/call') {
        return errorResponse(parsed.id, METHOD_NOT_FOUND, 'Method not found');
      }

      const call = toolCallOf(parsed.params);
      if (call === undefined) return errorResponse(parsed.id, INVALID_PARAMS, 'Invalid tool call');
      const entry = entriesByName.get(call.name);
      if (entry === undefined) return errorResponse(parsed.id, INVALID_PARAMS, `unknown tool ${call.name}`);

      const invocation = await invokeTool(entry, call.args, identity);
      if (invocation.kind === 'success') {
        return contentResult(parsed.id, opts.serverInfo, invocation.content, false);
      }
      if (invocation.kind === 'validation-error' && invocation.content !== undefined) {
        return contentResult(parsed.id, opts.serverInfo, invocation.content, true);
      }
      const id = toolErrorId();
      return contentResult(parsed.id, opts.serverInfo, `tool ${call.name} failed (${id})`, true);
    },
  };
}
