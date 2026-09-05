# @zmdb/ai — ownership, dependency and entry-point specification

> **Status:** target-state specification frozen by issue #703 and epic #702, with green migration stages implemented by #705, #706, #707, #708, and #709. `@zmdb/ai` is publishable and independently
> importable; its root, chat, HTTP, and compiler entries remain migration-only AI-to-schema-core forwarders, while the merged tool runtime, Anthropic integration, LangChain integration shell, Vercel
> integration, and MCP runtime are owned by their target packages. The final provider-neutral and LangChain ownership cutover remains in §8.

### Current migration state after #709

- `@zmdb/ai`, `/chat`, `/compiler`, `/http`, and `/tool-runtime` are explicit package exports.
- The package has one runtime dependency, `@zmdb/schema-core`, and no external dependency or peer.
- `@zmdb/ai-anthropic` owns the Anthropic driver, depends only on `@zmdb/ai`, and declares the SDK as its sole optional peer.
- Provider-neutral runtime and type tests execute from `packages/ai/src`.
- AOT `toolFor` imports and generated OpenAPI modules name the new package.
- `@zmdb/ai-vercel` now physically owns the AI SDK adapter, tests and peer; schema-core no longer exports `./llm/ai-sdk`.
- `@zmdb/ai-langchain` publishes one root, owns the optional `@langchain/core@^1.2.9` peer, and is exercised by the real-package fixture. Its temporary schema-core dependency is removed by #710.
- `@zmdb/mcp` owns its client, server, protocol specification, runtime tests, and type tests; its sole runtime dependency is `@zmdb/ai`.
- Schema-core no longer publishes `./llm/mcp`.
- Schema-core does not import or forward to AI; its old implementation remains the temporary source behind the permitted new-to-old forwarders.
- Measured after #709, `packages/ai/src` contains 16 files, `packages/mcp/src` contains 7, and the temporary `packages/schema-core/src/llm` tree contains 11 files. Schema-core publishes four `./llm*`
  compatibility entries and has no provider or framework peer.

## 1. Measured starting point

The inventory below was measured on 2026-09-05 at `94164c53`.

- `packages/schema-core/src/llm/` contains exactly **32 files**.
- `@zmdb/schema-core` publishes six LLM subpaths: `./llm`, `./llm/ai-sdk`, `./llm/chat`, `./llm/http`, `./llm/langchain` and `./llm/mcp`. Its package root does not export the LLM surface.
- `@zmdb/schema-core` declares `@anthropic-ai/sdk` `0.123.0`, `@langchain/core` `^1.2.9` and `ai` `^7.0.83` as optional peers.
- The installed Anthropic SDK is `0.123.0`. The LangChain consumer fixture declares and resolves `1.2.9`. The Vercel AI SDK fixture declares and resolves `7.0.92`, so the current lockfile does not
  prove the lower bound `7.0.83` even though the peer range starts there.
- Nine canonical LLM documentation pages exist: `llm-chat`, `llm-function-calling`, `llm-http`, `llm-json-schema`, `llm-langchain`, `llm-mcp`, `llm-strategy`, `llm-structured-output` and
  `llm-vercel-ai-sdk`.
- The AOT transformer, emitter, scanner, witness tests and callable-surface test still name `@zmdb/schema-core/llm`. Generated OpenAPI-tool modules also emit that old package header.

These are migration inputs, not final ownership claims.

## 2. Final dependency graph

In this diagram `A --> B` means “A has a direct runtime dependency on B”:

```text
@zmdb/ai-anthropic ──┐
@zmdb/ai-langchain ──┼──> @zmdb/ai ──> @zmdb/schema-core ──> @zmdb/query-compiler
@zmdb/ai-vercel ─────┤         ▲
@zmdb/mcp ───────────┘         │
                               │
@zmdb/aot-validator ───────────┘
         └────────────────────> @zmdb/schema-core
```

The graph has these hard rules:

1. `@zmdb/ai` is the only owner of provider-neutral tool documents, provider dialect data, parsing, bounded chat orchestration, shared tool invocation and OpenAPI-derived tools.
2. `@zmdb/ai-anthropic`, `@zmdb/ai-langchain` and `@zmdb/ai-vercel` each depend on `@zmdb/ai` and own one external integration. They do not depend directly on `@zmdb/schema-core`.
3. `@zmdb/mcp` depends on `@zmdb/ai` plus platform APIs. It has no dependency on an MCP SDK, a provider SDK or `@zmdb/schema-core`.
4. `@zmdb/aot-validator` depends directly on both `@zmdb/schema-core` and `@zmdb/ai`: schema reflection comes from the former, while `toolFor` types and provider-document helpers come from the latter.
5. `@zmdb/schema-core` never depends on any package in this slice. No provider or framework package depends on a sibling integration package.
6. Internal workspace edges use `workspace:^`. External SDKs are peers of exactly one integration package and never dependencies or peers of `@zmdb/ai`, `@zmdb/schema-core`, `@zmdb/mcp` or
   `@zmdb/aot-validator`.

## 3. Exact public entry points

No package uses wildcard export-map entries. A package root does not eagerly re-export another entry point, so importing provider-neutral tooling cannot resolve an integration SDK.

### 3.1 `@zmdb/ai`

```ts
export { lenientParse, toolFor, toolFromSchema } from '@zmdb/ai';
export type { ParseResult, ToolOptions, ToolProvider, ToolSchema, ToolSpec, ToolSpecFor } from '@zmdb/ai';
```

The root owns the five provider document dialects (`openai`, `openai-strict`, `anthropic`, `gemini`, `json-schema`) and their refusal rules. A provider name here selects a document shape; it does not
install an SDK or make a request. `toJsonSchema` remains owned by `@zmdb/schema-core/openapi` and is not re-exported.

### 3.2 `@zmdb/ai/chat`

```ts
export { defineTools, run } from '@zmdb/ai/chat';
export type { ChatDriver, ChatMessage, RunOptions, RunResult, ToolCall, ToolRegistry } from '@zmdb/ai/chat';
```

The entry point is provider-neutral. In particular it does not export `anthropicDriver` or an SDK-specific message type.

### 3.3 `@zmdb/ai/http`

```ts
export { OpenApiHttpError, ToolSpecRefusalError, bindOpenApiTool, generateOpenApiToolsModule, toolsFromOpenApi } from '@zmdb/ai/http';
export type { BoundOpenApiTool, OpenApiCallerOptions, OpenApiGeneratedTool, OpenApiOperationIdentity, OpenApiToolRequest, OpenApiToolsOptions, ToolSpecRefusal } from '@zmdb/ai/http';
```

`ToolProvider`, `ToolSpec` and `ToolSpecFor` are imported from the package root rather than duplicated by this subpath.

### 3.4 `@zmdb/ai/tool-runtime`

This is the advanced boundary used by the official integration packages and `@zmdb/mcp`. It is separate from the root so ordinary tool-document consumers do not receive invocation machinery.

```ts
export { executeToolAdapter, invokeTool, serialiseToolResult } from '@zmdb/ai/tool-runtime';
export type { InvocableTool, ToolAdapterOptions, ToolInvocation } from '@zmdb/ai/tool-runtime';
```

The implementation merges the provider-neutral behavior currently split between `adapters/runtime.ts` and `tool-runtime.ts`. Error-id generation and validation-error formatting remain private
implementation details. This subpath is public and semver-governed; there is no undeclared cross-package source import.

### 3.5 `@zmdb/ai/compiler`

This is the narrow build-time boundary used by `@zmdb/aot-validator`. It keeps runtime and AOT provider documents on one producer without exposing AI source paths:

```ts
export { ToolSpecRefusalError, toolSchemaForProvider } from '@zmdb/ai/compiler';
export type { ToolSpecRefusal } from '@zmdb/ai/compiler';
```

`ToolProvider` remains imported from `@zmdb/ai`; `ShapeIR` remains imported from `@zmdb/schema-core/ir`. No application-facing root star-exports this subpath.

### 3.6 Integration roots

The exact integration exports are:

```ts
export { anthropicDriver } from '@zmdb/ai-anthropic';
export type { AnthropicDriverOptions, AnthropicMessagesClient } from '@zmdb/ai-anthropic';

export { langchainTool } from '@zmdb/ai-langchain';
export type { LangChainToolFields, ToolAdapterOptions } from '@zmdb/ai-langchain';

export { aiSdkTool } from '@zmdb/ai-vercel';
export type { AiSdkToolFields, AiSdkToolOptions, ToolAdapterOptions } from '@zmdb/ai-vercel';

export { MCP_PROTOCOL_VERSION, McpProtocolError, createMcpClient, createMcpServer } from '@zmdb/mcp';
export type { McpClient, McpClientOptions, McpServer, McpServerOptions, RemoteTool, RemoteToolResult } from '@zmdb/mcp';
```

The package-specific specifications below freeze the signatures and peer policy. No integration root is re-exported from `@zmdb/ai`.

## 4. Complete ownership map

Every file currently below `packages/schema-core/src/llm/` appears exactly once in this table. “Merge” means the named package is the sole migration owner and the old file is deleted after its
contract is incorporated; it does not permit the old path to survive.

| Current path                     | Final owner          | Final disposition                                                           |
| -------------------------------- | -------------------- | --------------------------------------------------------------------------- |
| `SPEC.md`                        | `@zmdb/ai`           | move to `packages/ai/src/SPEC.md`                                           |
| `adapters/SPEC.md`               | `@zmdb/ai`           | merge shared invocation clauses into `packages/ai/src/tool-runtime/SPEC.md` |
| `adapters/ai-sdk.spec.ts`        | `@zmdb/ai-vercel`    | move to `packages/ai-vercel/src/index.spec.ts`                              |
| `adapters/ai-sdk.ts`             | `@zmdb/ai-vercel`    | move to `packages/ai-vercel/src/index.ts`                                   |
| `adapters/langchain.spec.ts`     | `@zmdb/ai-langchain` | move to `packages/ai-langchain/src/index.spec.ts`                           |
| `adapters/langchain.ts`          | `@zmdb/ai-langchain` | move to `packages/ai-langchain/src/index.ts`                                |
| `adapters/runtime.ts`            | `@zmdb/ai`           | merge into `packages/ai/src/tool-runtime.ts`                                |
| `chat/SPEC.md`                   | `@zmdb/ai`           | move to `packages/ai/src/chat/SPEC.md`                                      |
| `chat/chat.spec.ts`              | `@zmdb/ai`           | move to `packages/ai/src/chat/chat.spec.ts`                                 |
| `chat/chat.type-test.ts`         | `@zmdb/ai`           | move to `packages/ai/src/chat/chat.type-test.ts`                            |
| `chat/drivers/anthropic.spec.ts` | `@zmdb/ai-anthropic` | move to `packages/ai-anthropic/src/index.spec.ts`                           |
| `chat/drivers/anthropic.ts`      | `@zmdb/ai-anthropic` | move to `packages/ai-anthropic/src/index.ts`                                |
| `chat/index.ts`                  | `@zmdb/ai`           | move to `packages/ai/src/chat/index.ts`; remove Anthropic re-exports        |
| `http/SPEC.md`                   | `@zmdb/ai`           | move to `packages/ai/src/http/SPEC.md`                                      |
| `http/caller.ts`                 | `@zmdb/ai`           | move to `packages/ai/src/http/caller.ts`                                    |
| `http/generate.ts`               | `@zmdb/ai`           | move to `packages/ai/src/http/generate.ts`; change generated import header  |
| `http/index.ts`                  | `@zmdb/ai`           | move to `packages/ai/src/http/index.ts`                                     |
| `http/openapi-tools.spec.ts`     | `@zmdb/ai`           | move to `packages/ai/src/http/openapi-tools.spec.ts`                        |
| `http/parse.ts`                  | `@zmdb/ai`           | move to `packages/ai/src/http/parse.ts`                                     |
| `http/types.ts`                  | `@zmdb/ai`           | move to `packages/ai/src/http/types.ts`                                     |
| `index.ts`                       | `@zmdb/ai`           | move to `packages/ai/src/index.ts`; stop star-exporting chat, HTTP and MCP  |
| `llm.spec.ts`                    | `@zmdb/ai`           | move to `packages/ai/src/index.spec.ts`                                     |
| `llm.type-test.ts`               | `@zmdb/ai`           | move to `packages/ai/src/index.type-test.ts`                                |
| `mcp/SPEC.md`                    | `@zmdb/mcp`          | moved by #709 to `packages/mcp/src/SPEC.md`                                 |
| `mcp/client.ts`                  | `@zmdb/mcp`          | moved by #709 to `packages/mcp/src/client.ts`                               |
| `mcp/index.ts`                   | `@zmdb/mcp`          | moved by #709 to `packages/mcp/src/index.ts`                                |
| `mcp/mcp.spec.ts`                | `@zmdb/mcp`          | moved by #709 to `packages/mcp/src/mcp.spec.ts`                             |
| `mcp/mcp.type-test.ts`           | `@zmdb/mcp`          | moved by #709 to `packages/mcp/src/mcp.type-test.ts`                        |
| `mcp/server.ts`                  | `@zmdb/mcp`          | moved by #709 to `packages/mcp/src/server.ts`                               |
| `providers.spec.ts`              | `@zmdb/ai`           | move to `packages/ai/src/providers.spec.ts`                                 |
| `providers.ts`                   | `@zmdb/ai`           | move to `packages/ai/src/providers.ts`                                      |
| `tool-runtime.ts`                | `@zmdb/ai`           | merge into `packages/ai/src/tool-runtime.ts`                                |

The framework-specific clauses in the old `adapters/SPEC.md` are restated in `packages/ai-langchain/SPEC.md` and `packages/ai-vercel/SPEC.md`; that copying does not create a second owner for the old
file. The `@zmdb/ai` implementation issue owns deleting it.

## 5. Manifest and peer policy

Every new package manifest is ESM-only, sets `sideEffects: false`, requires Node 26+, publishes `src`, `README.md` and `LICENSE`, and uses the repository release version. Each has one root `SPEC.md`;
each README states its install command, public entry points, direct dependency, peer requirement and explicit non-goals.

The external peer table is final:

| Package              | Sole external peer  | Final peer range | Optional | Versions the consumer tests must install                             |
| -------------------- | ------------------- | ---------------- | -------- | -------------------------------------------------------------------- |
| `@zmdb/ai-anthropic` | `@anthropic-ai/sdk` | `0.123.0`        | yes      | `0.123.0`                                                            |
| `@zmdb/ai-langchain` | `@langchain/core`   | `^1.2.9`         | yes      | lower bound and current measured version, both presently `1.2.9`     |
| `@zmdb/ai-vercel`    | `ai`                | `^7.0.83`        | yes      | lower bound `7.0.83` and current measured installed version `7.0.92` |

Issue #706 makes the Anthropic peer optional because the shipped implementation imports only SDK types and accepts a structural client; real-SDK conformance is compiled through the matching
development dependency. Issue #707 likewise makes the LangChain peer optional because the structural adapter imports no LangChain runtime; the real-package fixture proves compatibility at `1.2.9`. The
Vercel peer is optional for the same structural reason: the adapter receives the installed SDK's branded `jsonSchema` factory and never imports the SDK. Exact tested versions are development/fixture
dependencies, never runtime dependencies.

A claimed peer range ships only after packed-consumer tests pass at both its lower bound and the repository's current pinned version. If the Vercel lower-bound fixture cannot pass, the manifest
narrows to `^7.0.92`; the docs may not call `7.0.83` supported based only on the old declaration.

`@zmdb/mcp` has no external peer. In particular, no `@modelcontextprotocol/*` package appears in its manifest.

## 6. AOT ownership remains intact

`toolFor<T>()` remains one of the AOT transformer's named callees. Extraction changes its source package, not its compile-time behavior:

1. `packages/aot-validator/src/transformer.ts` imports `ToolProvider` from `@zmdb/ai`.
2. `packages/aot-validator/src/emit/index.ts` imports `ToolProvider` from `@zmdb/ai` and imports `toolSchemaForProvider` plus `ToolSpecRefusalError` from `@zmdb/ai/compiler`.
3. `packages/aot-validator/src/cli/scan.ts` maps `toolFor` to `@zmdb/ai`.
4. Codegen witnesses import `ToolOptions`, `ToolProvider` and `ToolSpecFor` from `@zmdb/ai`.
5. The callable-surface test imports `@zmdb/ai` when proving every `CALLEES` member is callable.
6. `@zmdb/aot-validator/package.json` declares both `@zmdb/schema-core` and `@zmdb/ai` with `workspace:^`.

A successfully transformed `toolFor<T>()` call still contains no runtime call to `toolFor`, no schema walk and no provider SDK import.

## 7. Generated OpenAPI-tool modules

`generateOpenApiToolsModule` changes both generated lines atomically:

```ts
// generated by @zmdb/ai/http — do not edit
import type { OpenApiGeneratedTool } from '@zmdb/ai/http';
```

The generator, checked-in fixture, deterministic-output assertion, web round-trip suite and documentation sample must agree byte for byte. No generated file may retain `@zmdb/schema-core/llm/http`.

## 8. Green migration sequence

Backward compatibility is not a final requirement, but intermediate commits must remain buildable and publishable. The only permitted compatibility direction is **new package to old package**. MCP is
the deliberate exception to using a forwarder: its implementation moved directly in #709 and the old subpath was removed, because schema-core cannot depend on MCP without creating
`schema-core -> mcp -> ai -> schema-core`.

1. **Add package shells.** Add the new manifests and explicit forwarding entry points. `@zmdb/ai` forwards its root, chat, HTTP and compiler symbols from the old `@zmdb/schema-core/llm*` paths;
   `@zmdb/ai-langchain` may temporarily forward only its own symbols. These shells may declare `@zmdb/schema-core`; they must be labeled migration-only in their source and tests. #706, #708, and #709
   moved the independent Anthropic, Vercel, and MCP leaves directly to physical ownership.
2. **Move consumers to the new names.** Change AOT callee sources and witnesses, repository fixtures, web round-trip tests, the nine LLM docs and every other old import. While the shell forwards,
   behavior remains owned by the old source and each intermediate revision stays green.
3. **Perform the remaining ownership cutover.** Move every file still under the old tree according to §4, move the LangChain implementation, regenerate the OpenAPI-tool fixture, and remove every
   remaining `@zmdb/schema-core` forwarding dependency from the new packages.
4. **Delete the old owner in the same cutover.** Remove all four remaining `./llm*` exports and `packages/schema-core/src/llm/`. Do not replace them with schema-core-to-AI forwarding: that would
   create `schema-core <-> ai`.
5. **Delete every temporary forwarder.** Each new export must resolve to source physically owned by its package. A forwarding module is a migration device, not deprecated API.

The final repository must satisfy all of these searches:

- no directory at `packages/schema-core/src/llm`;
- no `@zmdb/schema-core/llm` import, generated header, documentation sample or API-coverage mapping;
- no Anthropic, LangChain or Vercel AI SDK peer in `@zmdb/schema-core`;
- no provider SDK import reachable from `@zmdb/ai`, `@zmdb/ai/chat`, `@zmdb/ai/http`, `@zmdb/mcp` or the default product facade; and
- no new package source that re-exports an old schema-core LLM path.

## 9. Publish and qualification order

The release graph publishes dependencies before consumers:

```text
@zmdb/query-compiler
  -> @zmdb/schema-core
    -> @zmdb/ai
      -> @zmdb/aot-validator
      -> @zmdb/ai-anthropic
      -> @zmdb/ai-langchain
      -> @zmdb/ai-vercel
      -> @zmdb/mcp
```

The five packages after `@zmdb/ai` are peers in the publish graph and may publish in parallel. The wider repository continues from those edges according to its own dependency graph.

Before any package is published, qualification must prove:

- every declared source and packed export imports;
- package roots do not eagerly resolve sibling subpaths or external peers;
- exact runtime and type-level contracts at the new package names;
- packed consumers install only declared dependencies and the selected integration peer;
- the two-version peer matrix in §5;
- AOT `toolFor` witness generation from `@zmdb/ai`;
- generated OpenAPI-tool modules compile from `@zmdb/ai/http`; and
- a repository search satisfies every final-removal condition in §8.

## 10. Non-goals

- No unified provider client, model registry, retry policy, fallback, pricing table or secret discovery.
- No provider SDK in `@zmdb/ai`.
- No MCP transport, socket, controller or SDK.
- No compatibility export left in `@zmdb/schema-core`.
- No root star export that makes importing `@zmdb/ai` load chat, HTTP, MCP or a provider integration.
- No runtime implementation or package-manifest change in issue #703 itself.

## Runtime-foundation cutover (#635)

The #703 graph is the extraction path through the current package names. At the later foundation cutover, the ten build-included provider-neutral source files assigned by
`.github/scripts/verify-runtime-foundation.SPEC.md` remain owned by `@zmdb/ai`, while its inward contracts move from `@zmdb/schema-core` to `@zmdb/schema` and `@zmdb/validator`.

No foundation package imports AI. Provider SDKs, LangChain, Vercel AI, and MCP remain separate packages. Generated OpenAPI tool modules then import `@zmdb/schema/tags`, `@zmdb/validator`, and
`@zmdb/ai/http`, never an old package name.
