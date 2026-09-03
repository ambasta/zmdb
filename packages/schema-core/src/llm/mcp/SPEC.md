# SPEC — MCP, both directions (frozen)

Part of `@zmdb/schema-core`, exported from the existing `./llm` subpath. A server that answers JSON-RPC for a
registry of tools, and a client that calls a remote server's. `../chat/SPEC.md` owns the registry; this owns
the protocol.

The payoff of sharing the registry is the reason both live here: a tool written once — spec, validator,
handler, `effectful` flag — is callable by the loop and reachable over MCP without being declared twice, and a
tool declared twice is a tool whose validator drifts.

## 1. The protocol core is a pure function, and both transports are the app's

`@zmdb/schema-core` has no `node:` import outside a `__testing__` helper, and that is load-bearing:
`docs-site/content/connect-react-native.md` lists this package as running unchanged on device, and
`migrations-web-mobile.md` lists it as running in a browser. A stdio transport needs `process.stdin`. So a
stdio transport cannot live here, and neither can an HTTP server.

Frozen: **the whole server is one pure async function.**

```ts
export interface McpServer {
  handle(message: unknown, identity: unknown): Promise<unknown | undefined>;
}
export declare function createMcpServer(tools: ToolRegistry, opts: McpServerOptions): McpServer;
```

A JSON-RPC message in, a JSON-RPC message out, `undefined` for a notification (which by the protocol takes no
response). No sockets, no streams, no framing, no `process`. Both transports then become what the docs pages
already show: fifteen lines of newline-delimited JSON over stdin/stdout, or a `@Post('/')` controller in
`@zmdb/web`. Neither is code this repository ships, and both are code it tests as fixtures.

That also settles a question the issue leaves open: **nothing lands in `@zmdb/web` for MCP.** The HTTP
transport is a controller the application writes, because it needs the application's authentication (§4), and
a controller zmdb shipped would either be unauthenticated or would invent an auth model.

## 2. One protocol version, echoed and negotiated

```ts
export const MCP_PROTOCOL_VERSION = '2025-06-18';
```

One constant, one supported revision, declared in one place, with the same discipline `../SPEC.md` §2.1 sets
for provider keyword tables: it is somebody else's specification, so it is recorded as data with the date it
was read, and #532 confirms it against the revision current when the code lands and edits this one line.

`initialize` returns that string, the server's `capabilities` (`tools` only — §6) and its `serverInfo`. An
`initialize` naming an unsupported version is answered with this version rather than an error, per the
protocol's own negotiation rule, and the client then decides whether it can proceed. Every subsequent request
is answered regardless of what the client claimed, because a server that tracks per-connection state is a
server with sessions, and §4 explains why there are none.

## 3. Protocol errors and tool errors are different channels

This is the distinction implementations get wrong, and it matters more than it looks:

| Situation                                 | Answer                        | Who sees it   |
| ----------------------------------------- | ----------------------------- | ------------- |
| unparseable JSON                          | `-32700`                      | the client    |
| not a JSON-RPC message                    | `-32600`                      | the client    |
| unknown method                            | `-32601`                      | the client    |
| `tools/call` naming an unregistered tool  | `-32602`                      | the client    |
| arguments that fail the entry's validator | a result with `isError: true` | **the model** |
| a handler that throws                     | a result with `isError: true` | **the model** |

A JSON-RPC error goes to the client program; an `isError` result goes into the conversation, where the model
can read it and try again. Reporting a bad argument as `-32602` means the model is told nothing and the client
sees a protocol violation for what is an ordinary mistake. Reporting an unknown _tool_ as `isError` is the
opposite error: it tells the model to keep trying a tool that does not exist.

The content of an `isError` result follows `../chat/SPEC.md` §6 exactly — validation paths without values, and
`tool <name> failed (<errorId>)` for anything else — because a tool result crossing a network to a model
someone else is running is the same exposure as one crossing a function call, only easier to forget.

## 4. `tools/list` is the registry, and nothing else

`tools/list` maps over the registry and emits `{ name, description, inputSchema }` per entry, where
`inputSchema` is the entry's `spec.parameters` — the `json-schema` framing (`../SPEC.md` §5), which is what MCP
wants and is why the two shapes were described as "close" in `llm-mcp.md`.

**There is no other source.** No table enumeration, no route reflection, no wildcard, no
`exposeAllRepositories`. The registry is a literal an author wrote, and `llm-mcp.md` already argues the case:
a server that loops over your tables is a remote CRUD console with a language model at the keyboard. The
absence of an enumerating helper is deliberate, and this section is where that is written down so that
"convenient" does not later look like an oversight.

`createMcpServer` requires an identity, and the requirement is in the type:

```ts
export interface McpServerOptions {
  readonly serverInfo: { readonly name: string; readonly version: string };
  readonly identify: (transport: unknown) => Promise<unknown>;
}
```

`identify` has no default. A local stdio server returns a constant — it is already running as the user — and
that is a one-line function the author writes, which is exactly the point: there is no path to a mounted
server where nobody decided who the caller is. The resolved identity is passed to `handle` and reaches the
handler, so a tool scopes its queries by it the way `entity-filters.md` scopes a tenant. The model's arguments
never carry identity; if a handler reads a user id out of `args`, it has been told who to act for by the thing
being authorised, which is the failure `llm-mcp.md` calls "authorise the caller, not the request".

For the HTTP transport specifically, three requirements, all of them the app's to satisfy and all of them
stated because a reader will otherwise ship without them:

1. **Authentication before dispatch.** The controller resolves an identity from the transport, not from the
   body. An MCP endpoint with no auth is an unauthenticated remote procedure call over your database.
2. **`Origin` validation.** A browser can be made to POST to `http://localhost:<port>/mcp` by any page the
   user visits; checking `Origin` is the protocol's own DNS-rebinding requirement and costs one comparison.
3. **Bind to loopback for a local server.** A dev server on `0.0.0.0` is on the coffee shop's network.

## 5. What the HTTP transport cannot do, and why the freeze says so

`WebResponse.body` is a `string` (`packages/web/src/pipeline/index.ts:31`), and `Ctx`
(`packages/web/src/context/index.ts:24`) carries `params`, `body`, `query`, `headers`, `method` and `path` —
**no `AbortSignal`**. Two consequences, both named rather than discovered:

- **Request/response only.** A `POST` returning `application/json` is a conforming Streamable HTTP server for
  everything in §3, because the protocol permits a single JSON response instead of an event stream. What is
  therefore unsupported: the `GET` stream, server-initiated notifications, progress updates, and any
  server→client request (`sampling/*`, `roots/*`, `elicitation/*`). The server advertises no capability that
  requires them, so a client will not ask.
- **No cancellation.** `notifications/cancelled` is accepted and ignored — a notification takes no response, so
  ignoring it is protocol-legal — and the handler runs to completion. Doing better needs a signal on `Ctx`
  that does not exist; when the transports epic adds one, this section is the precondition to revisit.

`sseStream` in `@zmdb/web/gateways` produces a `ReadableStream<Uint8Array>` and is the eventual route to the
`GET` stream, but it does not compose with a controller returning a `WebResponse` — which is the shared
streaming blocker `llm-chat.md` and `web-streaming-files.md` both already point at. Claiming stream support
before that resolves would be claiming a capability that fails on the first notification.

## 6. Tools only: no resources, no prompts

`llm-mcp.md` maps resources onto rows and resource schemas onto `toJsonSchema(schema, 'entity')`, and the
mapping is genuinely mechanical. It is still refused for this epic, and for a reason worth stating rather than
hiding behind scope: a resource is addressed by a URI the server invents, so shipping resources means shipping
a URI scheme (`zmdb://users/42`?), a listing model, subscriptions to changes, and a decision about what a
client may enumerate. The subscription half needs §5's stream. A URI scheme frozen now, without the
subscription that gives it meaning, is a shape we would be stuck with.

Prompts are refused outright: a prompt template is not derived from a declaration, and this package's rule is
that what it publishes comes from the reader's types.

So `initialize` advertises `{ tools: {} }`, `resources/list` and `prompts/list` answer `-32601`, and the epic
does not claim MCP support beyond tools.

## 7. The client, and the honest limit of typing it

```ts
export interface McpClient {
  listTools(): Promise<readonly RemoteTool[]>;
  callTool(name: string, args: unknown): Promise<RemoteToolResult>;
}
export interface RemoteTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}
export interface RemoteToolResult {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly isError: boolean;
}
```

**A remote tool's types come from a document this codebase did not compile, so no type flows.** `inputSchema`
is a JSON Schema that arrived over a network at runtime; `args` is therefore `unknown` and the result's
`content` is a list of loosely-typed blocks. That is the ceiling, and pretending otherwise would mean either a
lie in a signature or a `as` in a library.

What the caller does about it is the same move as everywhere else in this package: `assert<T>` at their own
call site, where `T` is a type they declared and the transform can see it.

```ts
const result = await client.callTool('search_docs', { q });
const parsed = assert<{ hits: readonly { id: number; title: string }[] }>(JSON.parse(text(result)));
```

The one route that would give real types is a build-time codegen from a captured `tools/list` snapshot,
emitting interfaces. It is refused for the same reason `../http/SPEC.md` §5 refuses generating validators from
an OpenAPI document — it is a second codegen front end, and `ARCHITECTURE.md` §2.9 allows one — and because a
remote server may change its schema between the snapshot and the call, which makes the generated type a
statement about the past.

Three rules about remote results, which are the security half of being a client:

1. **A remote result is untrusted text.** It goes into a conversation a model reads, so it can contain
   instructions. Never give a remote tool's output the authority of a system message, and never interpolate it
   into SQL — `raw-sql.md`'s rule applies with more force here, not less.
2. **Validate the envelope before the content.** A server that answers `tools/call` with something that is not
   a result is a failure to report, not a value to index into.
3. **`isError` is not an exception.** It is a message for the model, and a client that throws on it converts
   something the model could recover from into something the application must.

## 8. What #533 has to assert

1. `handle` returns `undefined` for a notification and a response for a request, including for
   `notifications/cancelled`.
2. Each row of §3's table, by code, including that a bad argument is `isError` and an unknown tool is `-32602`.
3. `tools/list` equals the registry's specs, and a tool absent from the registry is unreachable by any method.
4. `initialize` echoes `MCP_PROTOCOL_VERSION` and advertises exactly `{ tools: {} }`;
   `resources/list` and `prompts/list` are `-32601`.
5. The identity from `identify` reaches the handler, and no code path reads an identity out of `args`.
6. A fixture stdio transport and a fixture `@zmdb/web` controller both drive the same `McpServer` and agree
   response for response — which is what makes §1's "the core is pure" a tested claim rather than a stated one.
7. The client's `callTool` returns `unknown`-shaped content, asserted in a `*.type-test.ts` so a future
   convenience overload cannot quietly widen it.

## 9. Non-goals (rejected)

- **No transport in this package.** §1 — `process.stdin` does not exist on a device, and this package runs
  there.
- **No MCP code in `@zmdb/web`.** §1 — the transport needs the app's authentication, and a shipped controller
  would either invent an auth model or omit one.
- **No sessions, no `Mcp-Session-Id` state.** §2, §5 — with no server→client stream there is nothing for a
  session to carry, and a session id is a thing to leak.
- **No `GET` event stream, no server-initiated requests, no progress notifications.** §5 — the response body
  is a string and there is no signal on `Ctx`.
- **No cancellation.** §5 — accepted and ignored, which is protocol-legal and honestly documented.
- **No resources and no prompts.** §6.
- **No tool enumeration from tables, repositories or routes.** §4 — the lazy version has to stay hard to
  write.
- **No generated types for remote tools.** §7 — a second codegen front end, describing a schema that may
  already have changed.
