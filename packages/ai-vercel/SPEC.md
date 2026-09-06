# @zmdb/ai-vercel — Vercel AI SDK tool integration specification

> **Status:** implemented by issue #708, with the compatibility floor frozen by issue #746. The package owns the adapter, its real-SDK and packed-consumer tests, and the `ai` peer; the old schema-core
> adapter path is removed. The supported and tested AI SDK floor is `7.0.93`. The checked-in manifest still contains the pre-freeze `^7.0.83` range and `7.0.83` test alias until issue #748 changes
> that metadata.

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
- Target sole external peer: `ai` at `^7.0.93`, marked optional because shipped source never imports it and receives the branded factory from the caller.
- Supported and tested floor: exact `ai@7.0.93`.
- No runtime dependency on `@zmdb/schema-core`, `@ai-sdk/*`, Zod, a provider SDK or another integration package. `zod` is a development-only entry that satisfies the AI SDK's own peer while both the
  adapter and SDK declarations compile.

Issue #746 built and packed `@zmdb/query-compiler`, `@zmdb/schema-core`, `@zmdb/ai`, and `@zmdb/ai-vercel`, installed those tarballs with exact `ai@7.0.93` in a project outside the repository,
resolved both imports from that project's `node_modules`, typechecked representative public use with `exactOptionalPropertyTypes: true` and the documented `skipLibCheck: true`, and executed the real
`description`, `execute`, and `inputSchema` fields. The stricter `skipLibCheck: false` attempt reached upstream `@ai-sdk/provider-utils` declaration errors, so the proof does not claim that
configuration. Applications that do not install `@zmdb/ai-vercel` receive no `ai` peer.

The existing `^7.0.83` manifest range and `ai-lower-bound` alias are transition state, not evidence that `7.0.83` is supported. Issue #748 owns narrowing the manifest and removing the alias; issue
#746 does not alter either.

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
- a packed consumer passes at exact `ai@7.0.93` with no workspace links or TypeScript path aliases; and
- importing `@zmdb/ai` or another integration does not resolve `ai`.

## 5. README and non-goals

The README states `yarn add @zmdb/ai @zmdb/ai-vercel ai@^7.0.93`, shows `jsonSchema` injection and the caller-owned validator, and names exact `7.0.93` as the supported and tested floor.

No `LanguageModel` wrapper, provider package, streaming UI state, persistence adapter, `useChat` store or runtime schema library belongs here.

## Runtime-foundation cutover (#635)

This optional package remains the sole owner of the current Vercel AI SDK adapter and the `ai` peer. It depends inward on `@zmdb/ai`; no foundation package imports it.
