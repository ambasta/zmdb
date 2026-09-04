import type { Equal, Expect, Extends } from '../../index.js';
import { defineTools, type ToolRegistry } from '../chat/index.js';
import type { ToolSpec } from '../index.js';
import {
  createMcpClient,
  createMcpServer,
  type MCP_PROTOCOL_VERSION,
  type McpClient,
  type McpClientOptions,
  type McpServer,
  type McpServerOptions,
  type RemoteTool,
  type RemoteToolResult,
} from './index.js';

declare const anySpec: ToolSpec;
declare const send: (message: unknown) => Promise<unknown>;
declare const client: McpClient;
declare const server: McpServer;

type _ProtocolVersionIsCurrent = Expect<Equal<typeof MCP_PROTOCOL_VERSION, '2026-07-28'>>;
type _ProtocolVersionIsLiteral = Expect<Equal<Equal<typeof MCP_PROTOCOL_VERSION, string>, false>>;

// @ts-expect-error — the implementation supports one measured MCP revision, not an open string
const wrongVersion: typeof MCP_PROTOCOL_VERSION = '2025-06-18';
void wrongVersion;

type _ServerHasOneMethod = Expect<Equal<keyof McpServer, 'handle'>>;
type _HandleTakesMessageAndTransport = Expect<Equal<Parameters<McpServer['handle']>, [unknown, unknown]>>;
type _HandleReturnsUnknown = Expect<Equal<Awaited<ReturnType<McpServer['handle']>>, unknown>>;

declare const incoming: Parameters<McpServer['handle']>[0];
// @ts-expect-error — transport input is untrusted until the protocol core parses it
const method: string = incoming.method;
void method;

// @ts-expect-error — a pure protocol answer remains unknown to the transport adapter
const answerId: number = (await server.handle({}, {})).id;
void answerId;

const tools = defineTools({
  search_docs: {
    spec: anySpec,
    validate: (args: unknown): { readonly q: string } => {
      if (typeof args !== 'object' || args === null || !('q' in args) || typeof args.q !== 'string') {
        throw new TypeError('q');
      }
      return { q: args.q };
    },
    handler: (input, identity) => {
      const query: string = input.q;
      // @ts-expect-error — the application owns the authenticated identity shape
      const subject: string = identity.sub;
      void subject;
      return query;
    },
    effectful: false,
  },
});

const serverInfo = { name: 'fixture', version: '1.0.0' };
declare const identify: (transport: unknown) => Promise<unknown>;

void createMcpServer(tools, { serverInfo, identify });

// A loop-only registry with one-argument handlers remains usable by MCP unchanged.
declare const loopRegistry: ToolRegistry;
void createMcpServer(loopRegistry, { serverInfo, identify });

// @ts-expect-error — authentication has no default, including for a local stdio adapter
void createMcpServer(tools, { serverInfo });

// @ts-expect-error — explicitly disabling authentication is no different from omitting it
void createMcpServer(tools, { serverInfo, identify: undefined });

type _IdentifyReadsTransport = Expect<Equal<Parameters<McpServerOptions['identify']>, [unknown]>>;
type _IdentifyIsAsync = Expect<Equal<ReturnType<McpServerOptions['identify']>, Promise<unknown>>>;
type _IdentityShapeIsApplicationOwned = Expect<Equal<Awaited<ReturnType<McpServerOptions['identify']>>, unknown>>;

// @ts-expect-error — identity resolution may perform I/O and therefore returns a promise
const syncIdentify: McpServerOptions['identify'] = () => ({ sub: 'user-7' });
void syncIdentify;

// @ts-expect-error — discovery publishes both server name and server version
const incompleteServerInfo: McpServerOptions['serverInfo'] = { name: 'fixture' };
void incompleteServerInfo;

type _ClientHasTwoMethods = Expect<Equal<keyof McpClient, 'listTools' | 'callTool'>>;
type _CallToolTakesUnknownArgs = Expect<Equal<Parameters<McpClient['callTool']>, [string, unknown]>>;
type _CallToolReturnsValidatedEnvelope = Expect<Equal<Awaited<ReturnType<McpClient['callTool']>>, RemoteToolResult>>;
type _ListToolsIsReadonly = Expect<Equal<Awaited<ReturnType<McpClient['listTools']>>, readonly RemoteTool[]>>;

void createMcpClient(send);
void createMcpClient(send, {
  maxCalls: 32,
  maxResponseBytes: 262_144,
  clientInfo: { name: 'fixture', version: '1.0.0' },
  clientCapabilities: {},
});

// Bounds default safely at runtime, but explicit `undefined` is not a configured bound.
// @ts-expect-error — exact optional properties distinguish omitted from explicitly disabled
const undefinedCalls: McpClientOptions = { maxCalls: undefined };
void undefinedCalls;

void client.callTool('search_docs', { q: 'zmdb' });
void client.callTool('search_docs', 'remote arguments remain unknown');
void client.callTool('search_docs', undefined);

// @ts-expect-error — a remote schema does not create a compile-time generic result type
void client.callTool<{ readonly hits: readonly string[] }>('search_docs', { q: 'zmdb' });

const remoteResult = await client.callTool('search_docs', { q: 'zmdb' });
// @ts-expect-error — envelope validation does not invent a payload property
const hits: readonly string[] = remoteResult.hits;
void hits;

type ContentBlock = RemoteToolResult['content'][number];
type _BlockTypeIsOpen = Expect<Equal<ContentBlock['type'], string>>;
type _BlockTextIsOptional = Expect<Equal<ContentBlock['text'], string | undefined>>;
type _IsErrorIsNormalised = Expect<Equal<RemoteToolResult['isError'], boolean>>;

// @ts-expect-error — callers cannot assume every remote block has text
const text: string = remoteResult.content[0]?.text;
void text;

declare const remoteTool: RemoteTool;
type _InputSchemaIsOpaque = Expect<Equal<RemoteTool['inputSchema'], Readonly<Record<string, unknown>>>>;
// @ts-expect-error — a network document's members are unknown until the caller validates them
const properties: Readonly<Record<string, unknown>> = remoteTool.inputSchema['properties'];
void properties;

type _RemoteToolIsNotLocalToolSpec = Expect<Equal<Extends<RemoteTool, ToolSpec>, false>>;
type _LocalToolSpecIsNotRemoteTool = Expect<Equal<Extends<ToolSpec, RemoteTool>, false>>;
