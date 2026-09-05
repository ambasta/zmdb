# @zmdb/ai-anthropic — Anthropic SDK integration specification

> **Status:** target package boundary frozen by issue #703. Runtime source and a manifest are added by later implementation issues.

## 1. Responsibility

This package owns exactly the Anthropic SDK translation currently implemented by `packages/schema-core/src/llm/chat/drivers/anthropic.ts` and its tests. It turns the provider-neutral `@zmdb/ai/chat`
contract into one injected Anthropic Messages API call and translates the response back.

Provider document dialects, `toolFor('anthropic', ...)`, the bounded chat loop, tool invocation, approval and redaction remain in `@zmdb/ai`. This package does not own OpenAI, Gemini, raw `fetch`,
fallback, retries, streaming, model discovery, persistence or secret loading.

## 2. Public root

The package publishes only `"."`:

```ts
export { anthropicDriver } from '@zmdb/ai-anthropic';
export type { AnthropicDriverOptions, AnthropicMessagesClient } from '@zmdb/ai-anthropic';
```

The behavioral signatures remain those already frozen by the chat specification:

```ts
interface AnthropicMessagesClient {
  readonly messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): PromiseLike<Anthropic.Message>;
  };
}

interface AnthropicDriverOptions {
  readonly client: AnthropicMessagesClient;
  readonly model: string;
  readonly maxOutputTokens: number;
}

function anthropicDriver(options: AnthropicDriverOptions): ChatDriver;
```

The caller constructs and injects the client. Importing this package reads no environment variable, creates no client and makes no request.

## 3. Dependencies and peer

- Direct workspace dependency: `@zmdb/ai` at `workspace:^`.
- Sole external peer: `@anthropic-ai/sdk` at exactly `0.123.0`.
- Exact development/fixture version: `0.123.0`, which is both declared and resolved in the measured starting tree.
- No direct dependency on `@zmdb/schema-core`, `@zmdb/aot-validator` or another integration package.

The SDK peer is required for an installed integration package, though shipped runtime code keeps the import type-only and receives a structural client. Applications that do not install
`@zmdb/ai-anthropic` receive no Anthropic peer.

## 4. Migration and qualification

The implementation moves:

- `chat/drivers/anthropic.ts` to `packages/ai-anthropic/src/index.ts`; and
- `chat/drivers/anthropic.spec.ts` to `packages/ai-anthropic/src/index.spec.ts`.

The Anthropic clauses currently embedded in `chat/SPEC.md` are copied here before the old file moves to `@zmdb/ai`; the provider-neutral chat clauses remain with `@zmdb/ai`.

Qualification must use the real installed SDK types without network I/O and prove:

- request fields are assignable to `MessageCreateParamsNonStreaming`;
- supported text, tool-use and passthrough blocks round-trip;
- an unknown passthrough block is refused before `client.messages.create` is called;
- the provider-neutral package entry points do not reach `@anthropic-ai/sdk`; and
- a packed consumer importing this root succeeds with `0.123.0` and fails clearly when the required peer is absent.

## 5. README and non-goals

The package README states `yarn add @zmdb/ai @zmdb/ai-anthropic @anthropic-ai/sdk@0.123.0`, shows client injection, and links to the provider-neutral chat contract. It must not suggest that API keys
are read automatically.

This package does not expose a generic provider abstraction, HTTP retry policy, streaming driver, model registry, cost table or environment helper.

## Runtime-foundation cutover (#635)

This optional package remains the sole owner of the current Anthropic chat driver and the `@anthropic-ai/sdk` peer. It depends inward on `@zmdb/ai`; no foundation package imports it.
