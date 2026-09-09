# @zmdb/ai — ownership, dependency and entry-point specification

`@zmdb/ai` owns provider-neutral tool documents and execution. Provider and framework integrations have separate owners; the removed schema LLM entries are not compatibility aliases.

## 1. Current contract and source authority

The [manifest](./package.json), [public entries](./src/index.ts), and [architecture policy](../../scripts/architecture/policy.mjs) define the implemented package boundaries. The
[runtime-foundation contract](../../.github/scripts/verify-runtime-foundation.SPEC.md) and [release contract](../../scripts/release/SPEC.md) govern their current dependency and compatibility rules.

The extraction status, measured starting point and original dependency diagram are preserved in [ADR 0004](../../docs/adr/0004-package-and-product-baselines.md). They are historical evidence, not
current inventories.

## 2. Final dependency graph

Use the dependency declarations in the [package manifests](./package.json) and the [current policy graph](../../ARCHITECTURE.md#32-the-current-dependency-dag-must-stay-acyclic) for the implemented
edges. The ownership rules below remain the contract.

The graph has these hard rules:

1. `@zmdb/ai` is the only owner of provider-neutral tool documents, provider dialect data, parsing, bounded chat orchestration, shared tool invocation and OpenAPI-derived tools.
2. `@zmdb/ai-anthropic`, `@zmdb/ai-langchain` and `@zmdb/ai-vercel` each depend on `@zmdb/ai` and own one external integration. They do not depend directly on `@zmdb/schema`.
3. `@zmdb/mcp` depends on `@zmdb/ai` plus platform APIs. It has no dependency on an MCP SDK, a provider SDK or `@zmdb/schema`.
4. `@zmdb/compiler` depends directly on `@zmdb/ai`, `@zmdb/validator`, `@zmdb/sql`, and `@zmdb/schema`: reflection consumes schema IR, generated validators target the runtime ABI, and `toolFor`
   compilation consumes provider-neutral AI documents. `@zmdb/validator` depends only on `@zmdb/schema`.
5. `@zmdb/schema` never depends on any package in this slice. No provider or framework package depends on a sibling integration package.
6. The implemented #710 manifests use `workspace:^`. The #746 release target supersedes that range form: same-core edges alone retain `workspace:^`, while every edge in this integration slice uses the
   explicit cross-unit compatibility range and core imports become required peers plus workspace development dependencies. External SDKs are peers of exactly one integration package and never
   dependencies or peers of `@zmdb/ai`, `@zmdb/schema`, `@zmdb/mcp` or `@zmdb/validator`, and they are not compiler dependencies.

## 3. Exact public entry points

No package uses wildcard export-map entries. A package root does not eagerly re-export another entry point, so importing provider-neutral tooling cannot resolve an integration SDK.

### 3.1 `@zmdb/ai`

```ts
export { lenientParse, toolFor, toolFromSchema } from '@zmdb/ai';
export type { ToolOptions, ToolProvider, ToolSchema, ToolSpec, ToolSpecFor } from '@zmdb/ai';
```

The root owns the five provider document dialects (`openai`, `openai-strict`, `anthropic`, `gemini`, `json-schema`) and their refusal rules. A provider name here selects a document shape; it does not
install an SDK or make a request. `toJsonSchema` remains owned by `@zmdb/schema/openapi` and is not re-exported.

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

This is the narrow build-time boundary used by `@zmdb/compiler`. It keeps runtime and AOT provider documents on one producer without exposing AI source paths:

```ts
export { ToolSpecRefusalError, toolSchemaForProvider } from '@zmdb/ai/compiler';
export type { ToolSpecRefusal } from '@zmdb/ai/compiler';
```

`ToolProvider` remains imported from `@zmdb/ai`; `ShapeIR` remains imported from `@zmdb/schema/ir`. No application-facing root star-exports this subpath.

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

Every file currently below `packages/schema/src/llm/` appears exactly once in this table. “Merge” means the named package is the sole migration owner and the old file is deleted after its contract is
incorporated; it does not permit the old path to survive.

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

Every package manifest is ESM-only, sets `sideEffects: false`, requires Node 26+, publishes `src`, `README.md` and `LICENSE`, and currently carries the common `1.0.0-alpha.4` baseline. Under the #746
release target, each package in this slice is an independently versioned integration. Each has one root `SPEC.md`; each README states its install command, public entry points, direct dependency, peer
requirement and explicit non-goals.

The external peer table is final:

| Package              | Sole external peer  | Final peer range | Optional | Versions the consumer tests must install                         |
| -------------------- | ------------------- | ---------------- | -------- | ---------------------------------------------------------------- |
| `@zmdb/ai-anthropic` | `@anthropic-ai/sdk` | `0.124.0`        | yes      | `0.124.0`                                                        |
| `@zmdb/ai-langchain` | `@langchain/core`   | `^1.2.9`         | yes      | lower bound and current measured version, both presently `1.2.9` |
| `@zmdb/ai-vercel`    | `ai`                | `^7.0.93`        | yes      | supported and tested floor `7.0.93`                              |

Issue #706 makes the Anthropic peer optional because the shipped implementation imports only SDK types and accepts a structural client; real-SDK conformance is compiled through the matching
development dependency. Issue #707 likewise makes the LangChain peer optional because the structural adapter imports no LangChain runtime; the real-package fixture proves compatibility at `1.2.9`. The
Vercel peer is optional for the same structural reason: the adapter receives the installed SDK's branded `jsonSchema` factory and never imports the SDK. Exact tested versions are development/fixture
dependencies, never runtime dependencies.

A claimed peer range ships only after packed-consumer tests pass at its exact lower bound and every additional version named by the compatibility policy. Issue #746 resolved the earlier Vercel
condition by measuring exact `ai@7.0.93`; issue #748 then set the manifest to `^7.0.93`, retained exact `7.0.93` for development, and made the four-tarball external consumer the executable proof.

`@zmdb/mcp` has no external peer. In particular, no `@modelcontextprotocol/*` package appears in its manifest.

## 6. AOT ownership remains intact

`toolFor<T>()` remains one of the AOT transformer's named callees. Extraction changes its source package, not its compile-time behavior:

1. `packages/compiler/src/transform/index.ts` imports `ToolProvider` from `@zmdb/ai`.
2. `packages/compiler/src/emit/index.ts` imports `ToolProvider` from `@zmdb/ai` and imports `toolSchemaForProvider` plus `ToolSpecRefusalError` from `@zmdb/ai/compiler`.
3. `packages/compiler/src/codegen/scan.ts` maps `toolFor` to `@zmdb/ai`.
4. Codegen witnesses import `ToolOptions`, `ToolProvider` and `ToolSpecFor` from `@zmdb/ai`.
5. The callable-surface test imports `@zmdb/ai` when proving every `CALLEES` member is callable.
6. `@zmdb/compiler/package.json` declares both `@zmdb/schema` and `@zmdb/ai` with `workspace:^`.

A successfully transformed `toolFor<T>()` call still contains no runtime call to `toolFor`, no schema walk and no provider SDK import.

## 7. Generated OpenAPI-tool modules

`generateOpenApiToolsModule` changes both generated lines atomically:

```ts
// generated by @zmdb/ai/http — do not edit
import type { OpenApiGeneratedTool } from '@zmdb/ai/http';
```

The generator, checked-in fixture, deterministic-output assertion, web round-trip suite and documentation sample must agree byte for byte. No generated file may retain `@zmdb/schema/llm/http`.

## 8. Completed green migration sequence

Backward compatibility was not a final requirement, but every intermediate commit remained buildable and publishable. During the sequence, the only permitted compatibility direction was **new package
to old package**. MCP moved directly in #709 because schema-core could not depend on MCP without creating `schema-core -> mcp -> ai -> schema-core`.

1. **Package shells:** #705 and #707 introduced the temporary new-to-old boundaries; #706, #708, and #709 moved the independent Anthropic, Vercel, and MCP leaves directly.
2. **Consumer names:** AOT callee sources and witnesses, web round-trip tests, generated OpenAPI headers, fixtures, and public tests moved to `@zmdb/ai*` and `@zmdb/mcp`.
3. **Physical ownership:** #710 moved every remaining provider-neutral file and the LangChain implementation to their final packages.
4. **Old owner removal:** #710 removed all four remaining `./llm*` exports and the complete `packages/schema/src/llm/` tree.
5. **Forwarder removal:** every published AI/MCP export now resolves to source physically owned by its package.

The repository now gates all of these conditions:

- no directory at `packages/schema/src/llm`;
- no `@zmdb/schema/llm` import, generated header, documentation sample or API-coverage mapping;
- no Anthropic, LangChain or Vercel AI SDK peer in `@zmdb/schema`;
- no provider SDK import reachable from `@zmdb/ai`, `@zmdb/ai/chat`, `@zmdb/ai/http`, `@zmdb/mcp` or the default product facade; and
- no new package source that re-exports an old schema-core LLM path.

## 9. Publish and qualification order

The release graph publishes dependencies before consumers:

```text
@zmdb/sql
  -> @zmdb/schema
    -> @zmdb/ai
      -> @zmdb/validator
      -> @zmdb/ai-anthropic
      -> @zmdb/ai-langchain
      -> @zmdb/ai-vercel
      -> @zmdb/mcp
```

The five packages after `@zmdb/ai` are peers in the dependency graph. The current lockstep tooling may publish them in parallel after their dependency; under the #746 target each is its own release
unit and does not publish merely because `@zmdb/ai` or a sibling moves.

Before any package is published, qualification must prove:

- every declared source and packed export imports;
- package roots do not eagerly resolve sibling subpaths or external peers;
- exact runtime and type-level contracts at the new package names;
- packed consumers install only declared dependencies and the selected integration peer;
- the exact peer-version matrix in §5;
- AOT `toolFor` witness generation from `@zmdb/ai`;
- generated OpenAPI-tool modules compile from `@zmdb/ai/http`; and
- a repository search satisfies every final-removal condition in §8.

## 10. Non-goals

- No unified provider client, model registry, retry policy, fallback, pricing table or secret discovery.
- No provider SDK in `@zmdb/ai`.
- No MCP transport, socket, controller or SDK.
- No compatibility export left in `@zmdb/schema`.
- No root star export that makes importing `@zmdb/ai` load chat, HTTP, MCP or a provider integration.
- No runtime implementation or package-manifest change in issue #703 itself.

## Runtime-foundation cutover (#635)

The #703 graph is the extraction path through the current package names. At the later foundation cutover, the provider-neutral implementation now physically owned by `@zmdb/ai` remains there, while
its inward contracts move from `@zmdb/schema` to `@zmdb/schema` and `@zmdb/validator`.

No foundation package imports AI. Provider SDKs, LangChain, Vercel AI, and MCP remain separate packages. Generated OpenAPI tool modules then import `@zmdb/schema/tags`, `@zmdb/validator`, and
`@zmdb/ai/http`, never an old package name.
