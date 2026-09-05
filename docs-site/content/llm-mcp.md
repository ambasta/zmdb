The temporary `@zmdb/schema-core/llm/mcp` path turns the validator-linked registry from `@zmdb/ai/chat` into a pure MCP server and provides a bounded client for remote MCP tools. The MCP package move
is a later slice; your application still owns stdio or HTTP framing.

## Trust boundary first

Authentication is mandatory on the server core: `identify` has no default and runs before parsing, tool lookup, validation, or dispatch. A local stdio adapter may resolve a fixed process identity. An
HTTP adapter must authenticate the transport, validate `Origin`, and verify the mirrored protocol/method/name headers before calling `handle`; exposing the core over unauthenticated HTTP is not a
supported configuration.

The boundary points in both directions. Local tool arguments are untrusted until their registry validator accepts them. A remote tool's `inputSchema` and result text are network data, not types your
application may trust.

## Declare once

```ts
import { assert } from '@zmdb/aot-validator/utilities';
import { toolFromSchema } from '@zmdb/ai';
import { defineTools } from '@zmdb/ai/chat';
import { createMcpServer } from '@zmdb/schema-core/llm/mcp';

const tools = defineTools({
  search_docs: {
    spec: toolFromSchema('search_docs', docs, {
      description: 'Search documentation',
    }),
    validate: value => assert<{ q: string }>(value),
    handler: ({ q }, identity) => docsRepo.for(identity).search(q),
    effectful: false,
  },
});

const server = createMcpServer(tools, {
  serverInfo: { name: 'docs-service', version: '1.0.0' },
  identify: transport => authenticateTransport(transport),
});
```

`tools/list` contains only `tools`. `tools/call` resolves an own registry property, runs its validator, and only then calls its handler. The optional second handler argument is the identity resolved
from the transport; identity does not come from model-written arguments.

The server core is one function:

```ts
const answer = await server.handle(message, transport);
```

It accepts parsed JSON or raw JSON text, returns a JSON-RPC value, and returns `undefined` for a notification. It does not open a socket, read `process.stdin`, or mount an HTTP controller, so the same
code runs in Node.js, a browser, or a device runtime.

## Current protocol shape

The exported `MCP_PROTOCOL_VERSION` is `2026-07-28`. This is the stateless MCP revision: there is no `initialize` handshake. Every request carries:

```json
{
  "_meta": {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": {
      "name": "my-client",
      "version": "1.0.0"
    }
  }
}
```

`server/discover` reports the supported revision and `{ "tools": {} }`. Missing metadata is `-32602`; an unsupported revision is `-32022` with the supported and requested versions in `error.data`.
Successful responses include `resultType: "complete"`.

The server intentionally advertises no resources, prompts, roots, sampling, elicitation, or completion support. Requests for those methods receive `-32601`, rather than an empty result that would
falsely claim the capability.

## stdio adapter

For a local process, resolve a constant identity and frame one JSON value per line:

```ts
const local = createMcpServer(tools, {
  serverInfo: { name: 'docs-local', version: '1.0.0' },
  identify: async () => ({ sub: process.env.USER }),
});

process.stdin.setEncoding('utf8');
let buffer = '';

process.stdin.on('data', async chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim() === '') continue;
    const answer = await local.handle(line, { kind: 'stdio' });
    if (answer !== undefined) process.stdout.write(`${JSON.stringify(answer)}\n`);
  }
});
```

Buffering matters: a stream chunk can end halfway through a JSON message.

## Authenticated HTTP adapter

HTTP authentication is not optional in the core API: `identify` is required, and `handle` invokes it before parsing or dispatch. The adapter still owns the HTTP-specific checks:

- reject an invalid `Origin` with 403 and bind a local server to loopback;
- require `MCP-Protocol-Version` and `Mcp-Method`;
- require `Mcp-Name` for `tools/call`;
- compare those headers with the request body and reject a mismatch with HTTP 400 and MCP error `-32020`;
- pass headers or the request object as `transport`, so `identify` reads credentials from the transport rather than the body;
- return 202 with no body for an accepted notification.

This ordering matters. An anonymous or cross-origin request must not learn whether a tool exists, and it must never reach a validator or handler.

## Calling a remote server

The client is transport-independent too:

```ts
import { createMcpClient } from '@zmdb/schema-core/llm/mcp';

const client = createMcpClient(sendJsonRpc, {
  clientInfo: { name: 'my-client', version: '1.0.0' },
  maxCalls: 32,
  maxResponseBytes: 256 * 1024,
});

const remoteTools = await client.listTools();
const result = await client.callTool('search_docs', { q: 'transactions' });
```

`sendJsonRpc` is your stdio or HTTP adapter. For HTTP it mirrors the method, name, and protocol version into the required headers. It may return parsed JSON or raw response text; returning text lets
the client apply its byte bound before parsing. The client adds request ids and current `_meta`, checks correlation and JSON-RPC errors, validates tool-list and tool-result envelopes, and normalises
omitted `isError` to `false`.

Bounds apply even when you omit options: at most 64 calls and 1 MiB per response. Explicit bounds must be positive safe integers. A call beyond the budget is refused before `sendJsonRpc` runs; an
oversized answer is rejected before fields are read from it.

## Trust boundary

A remote `inputSchema` is a network document, not a TypeScript type. It remains an opaque `Readonly<Record<string, unknown>>`; `callTool` arguments are `unknown`, and result blocks are validated
protocol values containing untrusted text.

Do not put remote tool text in a system message, interpolate it into SQL, or treat it as a domain object because a generic type argument says so. Validate a domain payload with a type and validator
you own:

```ts
const result = await client.callTool('search_docs', { q });
const text = result.content.find(block => block.type === 'text')?.text;
const hits = assert<{ hits: readonly { id: number; title: string }[] }>(JSON.parse(text ?? 'null'));
```

An MCP tool result with `isError: true` is returned as a value so the model can recover. A JSON-RPC error throws `McpProtocolError`, because that channel is for the client program.

## Error exposure

Argument validation failures return paths and expectations, never rejected values. Handler exceptions become:

```text
tool search_docs failed (1a2b3c4d)
```

The exception class, message, stack, SQL, table names, and filesystem paths do not cross the protocol boundary.

---

See also: [Chat & Agents](./llm-chat.html) · [Structured Output](./llm-structured-output.html) · [HTTP Tools from Controllers](./llm-http.html)
