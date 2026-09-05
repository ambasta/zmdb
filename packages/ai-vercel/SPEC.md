# @zmdb/ai-vercel — Vercel AI SDK tool integration specification

> **Status:** target package boundary frozen by issue #703. Runtime source and a manifest are added by later implementation issues.

## 1. Responsibility

This package owns the Vercel AI SDK tool-object translation currently implemented by `packages/schema-core/src/llm/adapters/ai-sdk.ts`. It adapts a provider-neutral zmdb tool document to the SDK's
branded `inputSchema` contract and uses `@zmdb/ai/tool-runtime` for validation and execution semantics.

It does not own provider dialects, model clients, streaming UI state, persistence, `useChat`, provider packages or AOT validation.

## 2. Public root

The package publishes only `"."`:

```ts
export { aiSdkTool } from '@zmdb/ai-vercel';
export type { AiSdkToolFields, AiSdkToolOptions, ToolAdapterOptions } from '@zmdb/ai-vercel';
```

The final callable contract preserves the injected brand factory:

```ts
interface AiSdkToolOptions<T, Output, Schema> extends ToolAdapterOptions<T, Output> {
  readonly jsonSchema: (schema: unknown) => Schema;
}

interface AiSdkToolFields<Schema, Output> {
  readonly description: string;
  readonly inputSchema: Schema;
  readonly execute: (input: unknown) => Promise<Output | string>;
}

function aiSdkTool<T, Output, Schema>(name: string, schema: ToolSchema, options: AiSdkToolOptions<T, Output, Schema>): AiSdkToolFields<Schema, Output>;
```

The caller passes the installed SDK's `jsonSchema` function. The package neither imports nor fabricates the SDK's symbol brand, and it calls the factory exactly once with
`toolFromSchema(name, schema).parameters`.

## 3. Dependencies and peer

- Direct workspace dependency: `@zmdb/ai` at `workspace:^`.
- Sole external peer: `ai` at `^7.0.83`.
- Required consumer matrix: the declared lower bound `7.0.83` and the currently declared/resolved fixture version `7.0.92`.
- No direct dependency on `@zmdb/schema-core`, `@ai-sdk/*`, Zod, a provider SDK or another integration package.

The current tree proves `7.0.92`, not the lower bound. The final package may retain `^7.0.83` only after a packed fixture passes at both versions; otherwise its peer range narrows to `^7.0.92`.
Applications that do not install `@zmdb/ai-vercel` receive no `ai` peer.

## 4. Migration and qualification

The implementation moves:

- `adapters/ai-sdk.ts` to `packages/ai-vercel/src/index.ts`; and
- `adapters/ai-sdk.spec.ts` to `packages/ai-vercel/src/index.spec.ts`.

The shared adapter runtime moves to `@zmdb/ai/tool-runtime`.

Qualification must prove:

- the returned value is assignable to the real installed `tool()` input;
- the injected `jsonSchema` is called once and its branded return is preserved by identity;
- the field name is `inputSchema`, not the pre-v5 `parameters`;
- validation failures return the bounded value-free string;
- handler failures propagate unchanged;
- packed consumers pass at both peer-matrix versions; and
- importing `@zmdb/ai` or another integration does not resolve `ai`.

## 5. README and non-goals

The README states `yarn add @zmdb/ai @zmdb/ai-vercel ai@^7.0.83`, shows `jsonSchema` injection and the caller-owned validator, and does not claim lower-bound compatibility until the two-version
fixture passes.

No `LanguageModel` wrapper, provider package, streaming UI state, persistence adapter, `useChat` store or runtime schema library belongs here.
