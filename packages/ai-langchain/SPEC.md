# @zmdb/ai-langchain — LangChain tool integration specification

> **Status:** target package boundary frozen by issue #703. Runtime source and a manifest are added by later implementation issues.

## 1. Responsibility

This package owns the LangChain-specific tool-object translation currently implemented by `packages/schema-core/src/llm/adapters/langchain.ts`. It accepts the provider-neutral schema/tool contract
from `@zmdb/ai`, returns the structural fields accepted by LangChain's structured-tool API, and uses `@zmdb/ai/tool-runtime` for validation and execution semantics.

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

- Direct workspace dependency: `@zmdb/ai` at `workspace:^`.
- Sole external peer: `@langchain/core` at `^1.2.9`.
- Exact lower-bound/current fixture: `1.2.9`, which is the measured declared and resolved version.
- No direct dependency on `@zmdb/schema-core`, Zod, `json-schema-to-zod`, a provider SDK or another integration package.

The implementation remains structurally typed and need not import LangChain at runtime. The peer is nevertheless required when this integration package is installed because the package's claimed
surface is compatibility with that framework. Applications that do not install `@zmdb/ai-langchain` receive no LangChain peer.

## 4. Migration and qualification

The implementation moves:

- `adapters/langchain.ts` to `packages/ai-langchain/src/index.ts`; and
- `adapters/langchain.spec.ts` to `packages/ai-langchain/src/index.spec.ts`.

The shared adapter runtime moves to `@zmdb/ai/tool-runtime`; it is not copied as an undeclared cross-package source import.

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
