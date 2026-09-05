# @zmdb/ai-langchain — LangChain tool integration specification

> **Status:** public package boundary implemented by issue #707. The manifest, root export, real LangChain tests and consumer fixture now use `@zmdb/ai-langchain`; the root is an explicit
> migration-only forwarder to the old schema-core implementation until #710 performs the coordinated physical cutover.

## 1. Responsibility

This package is the public owner of the LangChain-specific tool-object translation currently implemented by `packages/schema-core/src/llm/adapters/langchain.ts`. It accepts the provider-neutral
schema/tool contract from `@zmdb/ai`, returns the structural fields accepted by LangChain's structured-tool API, and exposes `@zmdb/ai/tool-runtime`'s adapter options.

It does not own provider dialects, JSON Schema generation, AOT validation, chat orchestration, retrievers, vector stores, memory backends, model clients or provider requests.

## 2. Public root

The package publishes only `"."`:

```ts
export { langchainTool } from '@zmdb/ai-langchain';
export type { LangChainToolFields, ToolAdapterOptions } from '@zmdb/ai-langchain';
```

The final function preserves the existing callable contract and delegates provider-neutral work to `@zmdb/ai`:

```ts
interface LangChainToolFields {
  readonly name: string;
  readonly description: string;
  readonly schema: ToolSpec['parameters'];
  readonly func: (input: unknown) => Promise<string>;
}

function langchainTool<T, Output>(name: string, schema: ToolSchema, options: ToolAdapterOptions<T, Output>): LangChainToolFields;
```

`ToolSchema` is the schema value accepted by `@zmdb/ai` and does not create a direct `@zmdb/schema-core` dependency in this package. The returned schema is byte-identical to
`toolFromSchema(name, schema).parameters`. Non-string handler results are serialized by the shared tool runtime.

## 3. Dependencies and peer

The final dependency boundary is:

- Direct workspace dependency: `@zmdb/ai` at `workspace:^`.
- Sole external peer: `@langchain/core` at `^1.2.9`.
- Exact lower-bound/current fixture: `1.2.9`, which is the measured declared and resolved version.
- No direct dependency on `@zmdb/schema-core`, Zod, `json-schema-to-zod`, a provider SDK or another integration package.

The current migration shell also declares `@zmdb/schema-core` at `workspace:^` because its runtime body delegates in the only acyclic compatibility direction: new integration package to old owner.
That temporary edge and forwarder are deleted together by #710. `@langchain/core` is already absent from both schema-core and `@zmdb/ai` manifests.

The implementation remains structurally typed and need not import LangChain at runtime. The peer is optional metadata because the shipped adapter does not import it; applications install
`@langchain/core` when they construct a real LangChain tool. Applications that do not install `@zmdb/ai-langchain` receive no LangChain peer.

## 4. Migration and qualification

The final ownership cutover moves:

- `adapters/langchain.ts` to `packages/ai-langchain/src/index.ts`; and
- `adapters/langchain.spec.ts` to `packages/ai-langchain/src/index.spec.ts`.

The shared adapter runtime moves to `@zmdb/ai/tool-runtime`; it is not copied as an undeclared cross-package source import.

Issue #707 moves the executable and type-level contract suites to this package and proves the public package now; it deliberately leaves the old source in place so schema-core never imports back
through AI and forms a cycle.

Qualification must prove:

- the returned value is assignable to the installed `DynamicStructuredTool` contract;
- schema bytes match the provider-neutral `json-schema` tool document;
- validation failures return the bounded value-free string frozen by the current adapter contract;
- handler failures propagate unchanged;
- non-string results become strings exactly once;
- a packed consumer passes at the peer range's lower bound and current pinned version; and
- importing `@zmdb/ai` or another integration does not resolve `@langchain/core`.

## 5. README and non-goals

The README states `yarn add @zmdb/ai @zmdb/ai-langchain @langchain/core@^1.2.9`, shows the required caller-owned validator, and says that JSON Schema is passed directly rather than converted through
Zod.

No retriever, vector store, memory backend, model wrapper, provider client or `json-schema-to-zod` dependency belongs here.

## Runtime-foundation cutover (#635)

This optional package remains the sole owner of the current LangChain adapter and the `@langchain/core` peer. It depends inward on `@zmdb/ai`; no foundation package imports it.
