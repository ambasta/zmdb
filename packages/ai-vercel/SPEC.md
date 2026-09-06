# @zmdb/ai-vercel — Vercel AI SDK tool integration specification

> **Status:** implemented by issue #708, with the compatibility floor frozen by issue #746 and applied by issue #748. The package owns the adapter, its real-SDK and packed-consumer tests, and the `ai`
> peer; the old schema-core adapter path and workspace compatibility alias are removed. The supported and tested AI SDK floor is `7.0.93`.

## 1. Responsibility

This package owns the Vercel AI SDK tool-object translation in `packages/ai-vercel/src/index.ts`. It adapts a provider-neutral zmdb tool document to the SDK's branded `inputSchema` contract and uses
`@zmdb/ai/tool-runtime` for validation and execution semantics.

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

- Current direct workspace dependency: `@zmdb/ai` at `workspace:^`. The frozen release target replaces that cross-unit source range with the explicit compatibility range owned by release policy.
- Sole external peer: `ai` at `^7.0.93`, marked optional because shipped source never imports it and receives the branded factory from the caller.
- Supported and tested floor: exact `ai@7.0.93`.
- No runtime dependency on `@zmdb/schema-core`, `@ai-sdk/*`, Zod, a provider SDK or another integration package. `zod` is a development-only entry that satisfies the AI SDK's own peer while the
  adapter and SDK declarations compile.

The packed fixture builds and packs `@zmdb/query-compiler`, `@zmdb/schema-core`, `@zmdb/ai`, and `@zmdb/ai-vercel`, installs those tarballs with exact `ai@7.0.93` in a project outside the repository,
resolves both public imports from that project's `node_modules`, typechecks representative public use with the documented `skipLibCheck: true`, and executes a streamed tool call through the real SDK.
The stricter `skipLibCheck: false` attempt in issue #746 reached upstream `@ai-sdk/provider-utils` declaration errors, so the proof does not claim that configuration. Applications that do not install
`@zmdb/ai-vercel` receive no `ai` peer.

## 4. Migration and qualification

Issue #708 moved:

- `adapters/ai-sdk.ts` to `packages/ai-vercel/src/index.ts`;
- `adapters/ai-sdk.spec.ts` to `packages/ai-vercel/src/index.spec.ts`;
- the real-package fixture import to `@zmdb/ai-vercel`; and
- the `ai` peer and `./llm/ai-sdk` export out of schema-core.

The shared adapter runtime moves to `@zmdb/ai/tool-runtime`.

Qualification must prove:

- the returned value is assignable to the real installed `tool()` input;
- the injected `jsonSchema` is called once and its branded return is preserved by identity;
- the field name is `inputSchema`, not the pre-v5 `parameters`;
- validation failures return the bounded value-free string;
- handler failures propagate unchanged;
- a clean packed consumer passes at exact `ai@7.0.93`, with no workspace links or TypeScript path aliases, and executes a streamed tool call; and
- importing `@zmdb/ai` or another integration does not resolve `ai`.

## 5. README and non-goals

The README states `yarn add @zmdb/ai @zmdb/ai-vercel ai@^7.0.93`, shows `jsonSchema` injection and the caller-owned validator, and names the exact supported floor exercised by the packed fixture.

No `LanguageModel` wrapper, provider package, streaming UI state, persistence adapter, `useChat` store or runtime schema library belongs here.

## Runtime-foundation cutover (#635)

This optional package remains the sole owner of the current Vercel AI SDK adapter and the `ai` peer. It depends inward on `@zmdb/ai`; no foundation package imports it.
