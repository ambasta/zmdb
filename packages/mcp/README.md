# @zmdb/mcp

`@zmdb/mcp` provides transport-neutral MCP client and server cores. It validates every protocol envelope, routes only registered tools, resolves caller identity through an application-supplied
function, and bounds remote call count and response bytes.

The package does not open sockets, read process streams, mount an HTTP framework, or depend on an MCP SDK. Applications own stdio or HTTP framing and authentication.

## Install

```bash
npm add @zmdb/ai@alpha @zmdb/mcp@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. The runtime uses platform APIs and caller-supplied transports.

## Server

```ts
import { defineTools } from '@zmdb/ai/chat';
import { createMcpServer } from '@zmdb/mcp';

const tools = defineTools({
  lookup: {
    spec: {
      name: 'lookup',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    validate: value => value,
    handler: (input, identity) => JSON.stringify({ input, identity }),
    effectful: false,
  },
});

const server = createMcpServer(tools, {
  serverInfo: { name: 'catalog', version: '1.0.0' },
  identify: transport => authenticateTransport(transport),
});

const answer = await server.handle(message, transport);
```

`identify` is mandatory. The application decides how a stdio process or HTTP request becomes an authenticated identity before a tool runs.

## Client

```ts
import { createMcpClient } from '@zmdb/mcp';

const client = createMcpClient(sendJsonRpc, {
  maxCalls: 32,
  maxResponseBytes: 256 * 1024,
});

const tools = await client.listTools();
const result = await client.callTool('lookup', { id: 'item-7' });
```

`sendJsonRpc` supplies the transport. Remote schemas, arguments, and result text remain untrusted data; validate application payloads at your own boundary.

## Entry point

- `@zmdb/mcp` — `MCP_PROTOCOL_VERSION`, `createMcpServer`, `createMcpClient`, `McpProtocolError`, and their public contracts.

## Documentation

Full project documentation is at **https://ambasta.github.io/zmdb/**.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later).
