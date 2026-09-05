# @zmdb/mcp — MCP client and server ownership specification

> **Status:** target package boundary frozen by issue #703. Runtime source and a manifest are added by later implementation issues.

## 1. Responsibility

This package owns the pure MCP client and server currently under `packages/schema-core/src/llm/mcp/`. It translates between untrusted MCP messages and the provider-neutral tool registry owned by
`@zmdb/ai`; applications continue to own stdio, HTTP, authentication and process lifecycle.

The protocol revision, envelope validation, bounded client, server discovery, tool listing/calling and error-channel separation move together. Chat orchestration, provider documents and shared tool
invocation remain in `@zmdb/ai`.

## 2. Public root

The package publishes only `"."`:

```ts
export { MCP_PROTOCOL_VERSION, McpProtocolError, createMcpClient, createMcpServer } from '@zmdb/mcp';
export type { McpClient, McpClientOptions, McpServer, McpServerOptions, RemoteTool, RemoteToolResult } from '@zmdb/mcp';
```

The existing protocol and behavioral contract moves with the source. In particular:

- `MCP_PROTOCOL_VERSION` remains `'2026-07-28'` until a separately measured protocol update changes it;
- the server consumes `ToolRegistry` from `@zmdb/ai/chat`;
- server invocation uses `invokeTool` from `@zmdb/ai/tool-runtime`, preserving the same validation ordering and redaction as local chat;
- the client retains its call-count and response-byte bounds; and
- remote schemas and arguments remain untrusted data rather than invented compile-time types.

## 3. Dependencies

- Sole direct workspace dependency: `@zmdb/ai` at `workspace:^`.
- Platform dependencies: `globalThis.crypto`, JSON and caller-supplied transport functions.
- No direct dependency on `@zmdb/schema-core`, `@zmdb/aot-validator`, a provider package, a web package or an MCP SDK.
- No external peer dependency.

The package contains no `node:` import, socket, stream, process access, controller or global registry. Its server remains a pure `handle(message, transport)` core and its client remains a bounded
wrapper around a caller-supplied `send` function.

## 4. Migration and qualification

The implementation moves:

- `mcp/client.ts` to `packages/mcp/src/client.ts`;
- `mcp/server.ts` to `packages/mcp/src/server.ts`;
- `mcp/index.ts` to `packages/mcp/src/index.ts`;
- `mcp/mcp.spec.ts` to `packages/mcp/src/mcp.spec.ts`;
- `mcp/mcp.type-test.ts` to `packages/mcp/src/mcp.type-test.ts`; and
- `mcp/SPEC.md` to `packages/mcp/src/SPEC.md`.

The server replaces relative chat/tool-runtime imports with the declared `@zmdb/ai/chat` and `@zmdb/ai/tool-runtime` entry points. It must not import `@zmdb/ai` through a filesystem path.

Qualification must prove:

- source and packed imports of the root;
- the existing exact protocol-code matrix and current protocol revision;
- identical validation/redaction behavior between chat and MCP through the shared runtime;
- no transport or SDK reachable from the packed graph;
- no direct schema-core dependency;
- bounded-client refusals before transport dispatch; and
- a packed consumer can supply both a stdio-shaped and HTTP-shaped transport without an MCP SDK.

## 5. README and non-goals

The README states `yarn add @zmdb/ai @zmdb/mcp`, shows transport injection, and makes authentication the application's responsibility.

No stdio process loop, HTTP controller, socket, session registry, resource/prompt implementation, remote-schema compiler, provider integration or `@modelcontextprotocol/*` dependency belongs here.
