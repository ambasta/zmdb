# SPEC — MCP tools in both directions

Part of `@zmdb/schema-core`, exported from `./llm` and `./llm/mcp`. The module exposes a
validator-linked tool registry as a pure MCP server core and consumes a remote server through a
bounded client. `../chat/SPEC.md` owns the registry; this file owns the protocol boundary.

## 1. The protocol core is pure; applications own transports

`@zmdb/schema-core` runs in Node.js, browsers, and React Native, so it does not import
`node:process`, open sockets, or mount controllers. Its whole server surface is:

```ts
export interface McpServer {
  handle(message: unknown, transport: unknown): Promise<unknown | undefined>;
}

export interface McpServerOptions {
  readonly serverInfo: { readonly name: string; readonly version: string };
  readonly identify: (transport: unknown) => Promise<unknown>;
}

export declare function createMcpServer(tools: ToolRegistry, opts: McpServerOptions): McpServer;
```

A JSON-RPC message goes in, a JSON-RPC answer comes out, and a notification returns `undefined`.
The application supplies newline framing for stdio or an HTTP controller. Both adapters are
fixture-tested against the same core.

`identify` has no default and runs inside `handle` before parsing or dispatch. A stdio adapter can
resolve a constant local identity; an HTTP adapter resolves credentials from headers. Either way,
there is no callable server path where nobody decided who the caller is.

## 2. Current stateless protocol revision

```ts
export const MCP_PROTOCOL_VERSION = '2026-07-28';
```

This value was checked against the published MCP specification on 2026-09-04. This revision is
stateless: there is no `initialize` handshake. Every request carries these entries under
`params._meta`:

- `io.modelcontextprotocol/protocolVersion`
- `io.modelcontextprotocol/clientCapabilities`
- optionally `io.modelcontextprotocol/clientInfo`

Missing required metadata is `-32602`. An unsupported version is `-32022` with
`data: { supported: [MCP_PROTOCOL_VERSION], requested }`. The server implements
`server/discover`, returning `resultType: 'complete'`, its supported version, `{ tools: {} }`, and
`io.modelcontextprotocol/serverInfo`.

Every successful response carries `resultType: 'complete'`. No connection state is used to remember
a previous request's version, identity, or capabilities.

## 3. Protocol errors and tool errors are separate channels

| Situation                                | Answer                      |
| ---------------------------------------- | --------------------------- |
| unparseable JSON                         | `-32700`                    |
| not a JSON-RPC request                   | `-32600`                    |
| unknown method                           | `-32601`                    |
| malformed call or unknown tool           | `-32602`                    |
| unsupported protocol revision            | `-32022`                    |
| arguments rejected by the tool validator | result with `isError: true` |
| a handler throws                         | result with `isError: true` |

A JSON-RPC error is for the client program. An `isError` tool result reaches the model, which can
correct its arguments. Validation messages contain paths, messages, and expectations, never the
rejected value. Handler failures become `tool <name> failed (<eight-hex-id>)`; no class, message,
stack, query, or table name crosses the boundary.

The server and chat loop call the same internal invocation path, so validator ordering and
redaction cannot drift between local and remote tools.

## 4. The registry is the whole exposed surface

`tools/list` maps only the entries passed to `createMcpServer`:

```ts
{
  name: entry.spec.name,
  description: entry.spec.description,
  inputSchema: entry.spec.parameters,
}
```

The registry key must equal `spec.name`; construction refuses a mismatch and snapshots the set of
entries, so adding a property later cannot create an unlisted callable tool. There is no table
enumeration, route reflection, wildcard, or `run_sql` convenience.

`tools/call` looks up an own property, validates the untrusted arguments, then invokes the handler.
The authenticated identity is supplied as the handler's optional second argument. The model's
arguments never supply identity.

## 5. HTTP adapter requirements

The package does not ship an HTTP server. An application adapter must:

1. authenticate through the server's required `identify` callback;
2. validate `Origin`, and bind a local endpoint to loopback;
3. require `MCP-Protocol-Version` and `Mcp-Method`, plus `Mcp-Name` for `tools/call`;
4. compare those headers with the request body before dispatch and return HTTP 400 with MCP
   `-32020` on a mismatch;
5. return HTTP 202 with no body for an accepted notification.

The test fixture exercises unauthenticated, wrong-token, cross-origin, and header-mismatch
requests before proving that the same authenticated call reaches its handler.

## 6. Tools only

The server advertises `{ tools: {} }`. Resources, prompts, sampling, roots, elicitation, and
completion methods return `-32601`.

Resources require a URI scheme, enumeration policy, and subscriptions. Prompts are not derived from
a schema declaration. Neither is smuggled into this slice under an empty-list response, which would
already be a capability claim.

## 7. The bounded client

```ts
export interface McpClient {
  listTools(): Promise<readonly RemoteTool[]>;
  callTool(name: string, args: unknown): Promise<RemoteToolResult>;
}

export interface McpClientOptions {
  readonly maxCalls?: number; // default 64
  readonly maxResponseBytes?: number; // default 1 MiB
  readonly clientInfo?: { readonly name: string; readonly version: string };
  readonly clientCapabilities?: Readonly<Record<string, unknown>>;
}
```

The client adds current per-request metadata and unique numeric ids. A transport may return parsed
JSON or raw JSON text; raw text is byte-bounded before parsing. The client refuses a call before
sending when the 64-call default budget is exhausted, and rejects a serialized response over the
1 MiB default before reading fields from it. Both bounds must be positive safe integers when
overridden.

The client validates:

- JSON-RPC version and correlation id;
- protocol errors, surfaced as `McpProtocolError`;
- `resultType` (`complete`, with an absent value accepted only for backward-compatible responses);
- every `tools/list` entry's name, optional description, and object-shaped `inputSchema`;
- every `tools/call` content block's type and optional text, and normalises omitted `isError` to
  `false`.

No compile-time type flows from a remote JSON Schema. `inputSchema` remains
`Readonly<Record<string, unknown>>`, arguments remain `unknown`, and content remains untrusted text.
Compiling arbitrary remote JSON Schema into validators would add a second validation front end and
would need bounded `$ref`, composition, dialect, and network-resolution semantics. Callers validate
domain payloads at their own boundary with a type and validator they own.

An `isError` tool result is returned as a value. A JSON-RPC error throws because it is addressed to
the client program, not the model.

## 8. Assertions

1. Requests echo ids and notifications return `undefined`.
2. Every row in §3 is asserted by exact error code or `isError` channel.
3. `server/discover` reports the one supported revision; missing metadata and unsupported revisions
   use their current protocol error shapes.
4. `tools/list` exactly equals the registry, and an absent tool cannot be called.
5. Validation precedes dispatch; rejected values and handler internals do not cross the wire.
6. HTTP fixture auth, origin, and mirrored-header checks happen before a handler runs.
7. The resolved transport identity reaches the handler while forged identity fields are removed by
   validation.
8. stdio and HTTP fixtures receive identical JSON-RPC answers from the pure core.
9. The client rejects malformed envelopes, malformed results, exhausted call budgets, and oversized
   responses while preserving untrusted result text verbatim.
10. Type tests keep remote schemas opaque and prevent a convenience generic from inventing a
    compile-time result type.

## 9. Non-goals

- No transport, socket, stream, controller, or `node:` import in this package.
- No legacy `initialize` session and no hidden per-connection state.
- No server-initiated requests, event stream, progress, or cancellation.
- No resources or prompts.
- No table, repository, or route enumeration.
- No generated TypeScript types or runtime JSON Schema compiler for remote tools.
