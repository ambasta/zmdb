// Type-level tests for the MCP surface frozen in ./SPEC.md (#532, epic #530).
//
// Compiled by `node scripts/typecheck.mjs` and never run: `*.type-test.ts` is not in vitest's
// `include`, so a `@ts-expect-error` here asserts that the compiler *does* report an error, and
// an unused directive is TS2578 — a build failure. ./SPEC.md §8.7 asks for exactly this file:
// "The client's `callTool` returns `unknown`-shaped content, asserted in a `*.type-test.ts` so
// a future convenience overload cannot quietly widen it." A runtime test cannot make that
// assertion at all, because the widening it guards against is invisible at runtime.
//
// RED ON PURPOSE. `./index.ts` does not exist (#533 writes it), so the frozen surface is
// transcribed below rather than imported, and every assertion is against the text of ./SPEC.md.
// When #533 lands, the block is deleted and one `import type` replaces it.
import type { Equal, Expect, Extends } from '../../index.js';
import type { ToolSpec } from '../index.js';

// ---------------------------------------------------------------------------
// FROZEN SURFACE — replace with `import type { … } from './index.js'` (#533)
// ---------------------------------------------------------------------------

/** `../chat/SPEC.md` §3. */
interface ToolEntry<T> {
  readonly spec: ToolSpec;
  readonly validate: (args: unknown) => T;
  readonly handler: (input: T) => unknown | PromiseLike<unknown>;
  readonly effectful?: boolean;
}

/** See ./mcp.spec.ts and NOTES.md for the two deviations this repairs. */
type ErasedToolEntry = Omit<ToolEntry<never>, 'validate' | 'handler'> & {
  readonly validate: (args: unknown) => unknown;
  readonly handler: (input: never, identity: unknown) => unknown | PromiseLike<unknown>;
};

type ToolRegistry = Readonly<Record<string, ErasedToolEntry>>;

/** ./SPEC.md §1, verbatim. */
interface McpServer {
  handle(message: unknown, identity: unknown): Promise<unknown | undefined>;
}

/** ./SPEC.md §2, verbatim — including that it is a `const` with a literal type. */
declare const MCP_PROTOCOL_VERSION = '2025-06-18';

/** ./SPEC.md §4, verbatim. */
interface McpServerOptions {
  readonly serverInfo: { readonly name: string; readonly version: string };
  readonly identify: (transport: unknown) => Promise<unknown>;
}

declare function createMcpServer(tools: ToolRegistry, opts: McpServerOptions): McpServer;

/** ./SPEC.md §7, verbatim. */
interface RemoteTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

interface RemoteToolResult {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly isError: boolean;
}

interface McpClient {
  listTools(): Promise<readonly RemoteTool[]>;
  callTool(name: string, args: unknown): Promise<RemoteToolResult>;
}
// --------------------------- end frozen surface ---------------------------

declare const anySpec: ToolSpec;
declare const client: McpClient;
declare const server: McpServer;

// ---------------------------------------------------------------------------
// §2 — one constant, one revision, and a literal type rather than `string`
// ---------------------------------------------------------------------------

// §2 records the version "as data with the date it was read", and a literal type is what makes
// that a single point of truth: a client comparing against the export gets a compile error when
// #533 bumps the revision and a comparison somewhere else was left behind.
type _ProtocolVersionIsALiteral = Expect<Equal<typeof MCP_PROTOCOL_VERSION, '2025-06-18'>>;
type _ProtocolVersionIsNotWidenedToString = Expect<Equal<Equal<typeof MCP_PROTOCOL_VERSION, string>, false>>;

// @ts-expect-error — mcp SPEC §2: one supported revision, so no other literal is this constant
const wrongVersion: typeof MCP_PROTOCOL_VERSION = '2024-11-05';
void wrongVersion;

// ---------------------------------------------------------------------------
// §1 — the whole server is one pure async function
// ---------------------------------------------------------------------------

// §1: "A JSON-RPC message in, a JSON-RPC message out, `undefined` for a notification." One
// method, no `start`, no `close`, no `connect` — a surface with a lifecycle is a surface with
// state, and §9 rejects sessions outright.
type _ServerHasOneMethod = Expect<Equal<keyof McpServer, 'handle'>>;

// The message is `unknown` going in, because it arrived over a transport this package does not
// own and has not been validated yet — §3's `-32600` row is the consequence of that being true.
type _MessageIsUnknown = Expect<Equal<Parameters<McpServer['handle']>, [unknown, unknown]>>;

// …so a caller cannot read a field off a message before handing it over, which is what keeps
// the parsing in one place.
declare const incoming: Parameters<McpServer['handle']>[0];
// @ts-expect-error — mcp SPEC §1: an incoming message is `unknown` until the server has parsed it
const peeked: string = incoming.method;
void peeked;

// And the answer is `unknown` too: §7 is explicit that no type flows from a document this
// codebase did not compile, and a server that returned a typed envelope would be claiming the
// client's half of that as well.
type _AnswerIsUnknown = Expect<Equal<Awaited<ReturnType<McpServer['handle']>>, unknown>>;
// @ts-expect-error — mcp SPEC §1: the answer is `unknown`; the caller serialises it, not reads it
const peekedResult: number = (await server.handle({}, {})).id;
void peekedResult;

// §1: no transport in the type. `handle` takes a message and an identity, and nothing that
// could be a socket, a stream or a `process`.
type _HandleTakesTwoArguments = Expect<Equal<Parameters<McpServer['handle']>['length'], 2>>;

// ---------------------------------------------------------------------------
// §4 — `identify` has no default, and the type is where that is enforced
// ---------------------------------------------------------------------------

const registry = {
  search_docs: {
    spec: anySpec,
    validate: (args: unknown): { readonly q: string } => args as { readonly q: string },
    handler: (input: { readonly q: string }, identity: unknown) => `${input.q}:${String(identity)}`,
    effectful: false,
  },
} as const;

const serverInfo = { name: 'zmdb-fixture', version: '0.0.0' };
declare const identify: (transport: unknown) => Promise<unknown>;

void createMcpServer(registry, { serverInfo, identify });

// §4: "there is no path to a mounted server where nobody decided who the caller is". The
// missing property is not on any line, so the error is on the declaration — which is also the
// line a reader lands on from the diagnostic.
// @ts-expect-error — mcp SPEC §4: `identify` has no default, so a server cannot be built without one
const noIdentify: McpServerOptions = { serverInfo };
void noIdentify;

// @ts-expect-error — mcp SPEC §4: `identify` has no default, and `createMcpServer` will not infer one
void createMcpServer(registry, { serverInfo });

// Nor can it be switched off by passing `undefined`, which is the shape a config object with a
// missing key would produce under `exactOptionalPropertyTypes`.
// @ts-expect-error — mcp SPEC §4: `identify` is required, so `undefined` is not a value for it
void createMcpServer(registry, { serverInfo, identify: undefined });

// §4: `identify` resolves from the *transport*, which is `unknown` because this package does not
// know what a transport is. A synchronous constant is not enough — it returns a promise, because
// a real one looks a token up.
type _IdentifyTakesTheTransport = Expect<Equal<Parameters<McpServerOptions['identify']>, [unknown]>>;
type _IdentifyIsAsync = Expect<Equal<ReturnType<McpServerOptions['identify']>, Promise<unknown>>>;
// @ts-expect-error — mcp SPEC §4: `identify` answers a promise, because resolving a credential is I/O
const syncIdentify: McpServerOptions['identify'] = () => ({ sub: 'user-7' });
void syncIdentify;

// And the resolved identity is `unknown`, so nothing in this package can be written against a
// shape it invented — a tool scopes its queries by whatever the application decided identity is.
type _ResolvedIdentityIsUnknown = Expect<Equal<Awaited<ReturnType<McpServerOptions['identify']>>, unknown>>;

// `serverInfo` is both fields or neither: it is what `initialize` returns, and a client shows it
// to a human.
// @ts-expect-error — mcp SPEC §2: `serverInfo` carries a name and a version
const halfInfo: McpServerOptions['serverInfo'] = { name: 'zmdb-fixture' };
void halfInfo;

// §4's contradiction with `../chat/SPEC.md` §3, frozen as a true statement rather than as a
// `@ts-expect-error`, because a one-parameter handler is legal today and a directive cannot
// pre-assert that a currently-legal shape becomes illegal. A registry written for the loop —
// handlers that never mention identity — is usable over MCP unchanged, which is §1's stated
// payoff; when #533 resolves where identity goes, this is the line that reports it.
type LoopShapedRegistry = {
  readonly search: Omit<ToolEntry<never>, 'validate'> & { readonly validate: (args: unknown) => unknown };
};
type _LoopRegistryWorksOverMcp = Expect<Extends<LoopShapedRegistry, ToolRegistry>>;

// ---------------------------------------------------------------------------
// §7 and §8.7 — the client's ceiling, which is the point of this file
// ---------------------------------------------------------------------------

// §8.7, verbatim: the content is `unknown`-shaped, and no convenience overload may widen it.
// Asserted as an `Equal` on the whole signature rather than on the return alone, because an
// added generic overload changes `Parameters` and `ReturnType` together and either half moving
// is the signal.
type _CallToolTakesUnknownArgs = Expect<Equal<Parameters<McpClient['callTool']>, [string, unknown]>>;
type _CallToolReturnsARemoteToolResult = Expect<Equal<Awaited<ReturnType<McpClient['callTool']>>, RemoteToolResult>>;
type _ClientHasTwoMethods = Expect<Equal<keyof McpClient, 'listTools' | 'callTool'>>;

// The tool name is a `string`, not a union: §7 says the name came from a `tools/list` this
// codebase did not compile, so there is no set of literals to constrain it to. A future
// `callTool<'search_docs'>` would be a statement about a remote server's past.
type _ToolNameIsAnOpenString = Expect<Equal<Parameters<McpClient['callTool']>[0], string>>;

// §7: `args` is `unknown`, so the client cannot check it and does not pretend to. Passing
// anything is legal — including the wrong thing, which is why §7 points the caller at
// `assert<T>` at their own call site.
void client.callTool('search_docs', { q: 'zmdb' });
void client.callTool('search_docs', 'a bare string');
void client.callTool('search_docs', undefined);

// What is *not* legal is treating the result as the caller's own type. This is the assertion
// §8.7 exists for: a convenience overload that inferred a payload type from a type argument
// would make the next line compile, and it must not.
// @ts-expect-error — mcp SPEC §7: no type flows from a remote schema, so `callTool` takes no type argument
void client.callTool<{ readonly hits: readonly string[] }>('search_docs', { q: 'zmdb' });

const remoteResult = await client.callTool('search_docs', { q: 'zmdb' });

// @ts-expect-error — mcp SPEC §7: the result's content is a list of loosely-typed blocks, not a payload
const hits: readonly string[] = remoteResult.hits;
void hits;

// The block's `text` is optional, because a non-text block has none — a client that assumed a
// string would hand `undefined` to a model as the word "undefined".
type ContentBlock = RemoteToolResult['content'][number];
type _BlockTextIsOptional = Expect<Equal<ContentBlock['text'], string | undefined>>;
type _BlockTypeIsAnOpenString = Expect<Equal<ContentBlock['type'], string>>;
// @ts-expect-error — mcp SPEC §7: a content block's `text` may be absent
const text: string = remoteResult.content[0]?.text;
void text;

// §7.3: `isError` is not an exception, so it is a required boolean on the value rather than
// something a client threw away by throwing.
type _IsErrorIsARequiredBoolean = Expect<Equal<RemoteToolResult['isError'], boolean>>;
// @ts-expect-error — mcp SPEC §7.3: `isError` is a message for the model, so it is always present
const missingIsError: RemoteToolResult = { content: [] };
void missingIsError;

// §7: `inputSchema` is a JSON Schema that arrived over a network at runtime, so it is opaque.
// Reading a field off it is the mistake — a `properties` that a client indexed into is a
// document this codebase never compiled.
type _InputSchemaIsOpaque = Expect<Equal<RemoteTool['inputSchema'], Readonly<Record<string, unknown>>>>;
declare const remoteTool: RemoteTool;
// @ts-expect-error — mcp SPEC §7: a remote `inputSchema`'s members are `unknown`, not a schema shape
const schemaProperties: Readonly<Record<string, unknown>> = remoteTool.inputSchema['properties'];
void schemaProperties;

// A remote tool is not a `ToolSpec`: the local type's `parameters` is a compiled
// `JsonSchemaObject` with a known `type`, `properties` and `required`, and the remote one is a
// bag. Keeping them distinct is what stops a remote schema being fed to the local loop as if it
// had been checked.
type _RemoteToolIsNotAToolSpec = Expect<Equal<Extends<RemoteTool, ToolSpec>, false>>;
type _ToolSpecIsNotARemoteTool = Expect<Equal<Extends<ToolSpec, RemoteTool>, false>>;

// §7's `listTools` answers a readonly list, so a caller cannot cache it and then mutate the
// cache into something the server never said.
type _ListToolsIsReadonly = Expect<Equal<Awaited<ReturnType<McpClient['listTools']>>, readonly RemoteTool[]>>;
declare const listed: Awaited<ReturnType<McpClient['listTools']>>;
// @ts-expect-error — mcp SPEC §7: `listTools` answers a readonly list
listed.push(remoteTool);
