# SPEC — the chat loop, the tool registry, and its bounds (frozen)

Part of `@zmdb/schema-core`, exported from the existing `./llm` subpath and the direct `./llm/chat` subpath. A
driver-shaped chat loop over a registry of tools, with every bound and every approval point in the type.
`../SPEC.md` freezes the tool document; `../adapters/SPEC.md` freezes the framework framings; this freezes the
loop that calls them.

The reason this file is written before any code: an unbounded loop over effectful tools is the one failure in
this epic whose consequence is not a wrong answer but a changed database. Every decision below is made in the
direction of "the unsafe thing must be written out explicitly", and where a default exists it is the
restrictive one.

## 1. `ChatMessage`, not `Message`

```ts
export type ChatMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string;
      readonly toolCalls?: readonly ToolCall[];
      readonly provider?: readonly ProviderPassthrough[]; // §1.1
    }
  | { readonly role: 'tool'; readonly callId: string; readonly content: string; readonly isError?: boolean };

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}
```

**The rename is not cosmetic.** `docs-site/content/llm-chat.md` and `llm-strategy.md` both declare
`interface Message extends Table<'messages'>` as the canonical example, and that is the shape a reader has in
their own project. A type named `Message` exported from `@zmdb/schema-core/llm` would collide in precisely the
file where both are used — the controller that stores a turn and runs a loop. So the wire type is
`ChatMessage`, the stored row stays the reader's `Message`, and the two are related by a mapping the
application writes, because a stored row has a `conversationId` and a `createdAt` that a provider has never
heard of.

`args` is `unknown` and stays `unknown`. It came from a model over a network; the registry entry's validator
is what turns it into a type (§3), and any signature that made it look already-typed would be inviting the
`as` that this whole design exists to avoid.

### 1.1 Provider passthrough, and what is guaranteed

Reasoning blocks, cache markers, citations, signatures and safety metadata are all real, all provider-shaped,
and all changing. Two dishonest options: leave them out, so a loop cannot round-trip a reasoning block and
therefore cannot be used with a reasoning model at all; or model them, and be wrong within a quarter.

Frozen: **one opaque field — a list of blocks, since a reasoning model emits several — and an explicit
guarantee about it.**

```ts
export interface ProviderPassthrough {
  readonly kind: string; // the provider's own discriminator, verbatim
  readonly raw: unknown; // the provider's own block, verbatim
}
```

- **Guaranteed:** `role`, `content`, `toolCalls`, `callId` and `isError` are zmdb's, and are the same shape for
  every driver. The loop reads only those.
- **Passthrough:** `provider` is carried from the driver's output back into the driver's next input, in order,
  unmodified and uninspected. The loop never branches on it.
- **Not guaranteed:** that a `provider` block from one driver means anything to another. A conversation is not
  portable across providers once it contains one, and the loop does not pretend otherwise — a driver that
  receives a `kind` it does not recognise must refuse rather than drop it, because dropping a reasoning
  signature silently changes what the model is being asked.

That last rule is the point of the field. A provider that requires a block to be echoed back verbatim will
reject a request that lost it, and the failure reads as a nonsense API error unless the contract says who was
responsible for carrying it.

## 2. `ChatDriver`, and what the loop refuses to do

```ts
export interface ChatDriver {
  next(messages: readonly ChatMessage[], tools: readonly ToolSpec[]): Promise<ChatMessage>;
}
```

One method, no streaming, no retries, no token accounting. All three are real needs and none of them is
derivable from a declaration:

- **Streaming** is refused here because the loop's product is a message list, and a token stream is a
  different shape with a different consumer. `WebResponse.body` is a `string` besides, which is the same
  blocker `llm-chat.md` already documents; `sseStream` from `@zmdb/web/gateways` is the route, and it belongs
  to the route rather than to the loop.
- **Retries** belong to the driver, because retryability is a provider's status codes.
  `docs-site/content/llm-http.md` has the fifteen lines, including the jitter, and a retry policy inside the
  loop would be a second one fighting it.
- **Token accounting** belongs to the driver's own return, into the caller's `messages` table. The loop counts
  turns and tool calls, which are the two numbers it can bound.

`ToolSpec` — not a provider framing — is what the loop hands the driver, and the driver reframes for its
provider (`../SPEC.md` §5). A driver knows which provider it is; the loop does not.

### 2.1 The optional Anthropic driver

One concrete driver ships from `@zmdb/schema-core/llm/chat`:

```ts
export interface AnthropicMessagesClient {
  readonly messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): PromiseLike<Anthropic.Message>;
  };
}

export declare function anthropicDriver(opts: {
  readonly client: AnthropicMessagesClient;
  readonly model: string;
  readonly maxOutputTokens: number;
}): ChatDriver;
```

`@anthropic-ai/sdk` is an optional peer and a type-only import in shipped code. The caller constructs and
injects the client; importing the chat module does not read an environment variable, instantiate an SDK
client or start network I/O.

The adapter translates system, user, assistant and tool-result messages, translates `ToolSpec` into the
SDK's tool input schema, and translates text and tool-use response blocks back. Anthropic
`thinking`/`redacted_thinking` blocks use §1.1's passthrough route. Any other passthrough kind is refused
before the SDK call rather than silently dropped.

## 3. The registry, and effectful-by-default

```ts
export interface ToolEntry<T> {
  readonly spec: ToolSpec;
  readonly validate: (args: unknown) => T;
  readonly handler: (input: T, identity?: unknown) => unknown | PromiseLike<unknown>;
  readonly effectful?: boolean; // omitted means effectful — see below
}

export type ToolRegistry = Readonly<Record<string, ToolEntry<unknown>>>;
export declare function defineTools<
  const I extends Readonly<Record<string, unknown>>,
  const R extends {
    readonly [K in keyof I]: ToolEntry<I[K]>;
  },
>(
  tools: R & {
    readonly [K in keyof I]: ToolEntry<I[K]>;
  },
): R;
```

`validate` is the caller's, required, for the reason `../adapters/SPEC.md` §2 gives at length: `assert<T>` is
inlined where the checker can resolve `T`, and inside a published generic there is no `T` to resolve. So the
registry entry carries `v => assert<CreateDTO<User>>(v)` and `handler` is typed from its return.

The registry's erased form is `ToolEntry<unknown>`, not the frozen draft's `ToolEntry<never>`. The latter
cannot contain a validator that returns a real value. `defineTools` links each key back to its own validator
return, so a handler for `ReadUser` beside a validator for `CreateUser` is a compile error while the returned
object keeps its literal keys and exact entry types.

**`effectful` is omitted-means-true, which is the opposite of how an optional boolean usually reads.** A
reader who writes four tools and thinks about the flag for none of them gets four tools that require approval,
and finds out at the first `run` call rather than after the first `DELETE`. The safe default is the one that
demands a decision. `effectful: false` is a claim the author makes — "this only reads" — and it is the sort of
claim that belongs next to the handler rather than in a policy file.

The optional second argument is the transport-authenticated identity when the same registry is exposed through
MCP. The chat loop passes no identity. Keeping identity outside the model's input is what prevents a caller
from authorising itself by writing a user or tenant id into tool arguments.

## 4. `maxTurns` is required, and the approval hook is required by the type when it matters

```ts
export interface RunOptions {
  readonly maxTurns: number; // required: no default that permits a runaway
  readonly maxToolCallsPerTurn?: number; // default 8, see below
  readonly approve?: (call: ToolCall) => Promise<boolean>;
}

export type RunOptionsFor<R extends ToolRegistry> =
  HasEffectful<R> extends true ? RunOptions & { readonly approve: (call: ToolCall) => Promise<boolean> } : RunOptions;

export declare function run<
  const I extends Readonly<Record<string, unknown>>,
  R extends {
    readonly [K in keyof I]: ToolEntry<I[K]>;
  },
>(
  driver: ChatDriver,
  messages: readonly ChatMessage[],
  tools: R & {
    readonly [K in keyof I]: ToolEntry<I[K]>;
  },
  opts: RunOptionsFor<R>,
): Promise<RunResult>;
```

Step 3 of the issue asks for a type error if one is achievable. It is: `HasEffectful<R>` is
`{ [K in keyof R]: R[K] extends { readonly effectful: false } ? never : K }[keyof R] extends never ? false : true`,
and it **degrades in the safe direction** — which is the property worth checking rather than the cleverness.
A registry built dynamically, or passed through `Record<string, ToolEntry<unknown>>`, has `effectful` widened to
`boolean | undefined`, so no entry matches `{ effectful: false }`, so `approve` is required. Losing type
information can only make the requirement stricter, never looser.

The runtime check stays anyway: `run` throws before the first driver call if any entry is effectful and
`approve` is absent. Not because the type is unreliable, but because the type is absent in a file compiled
with `checkJs` off, in a registry that came from `JSON.parse`, and in the one place where someone silenced an
error with an `as`. The type is the primary mechanism because it cannot be skipped at three in the morning;
the throw is what happens when it was.

**`maxToolCallsPerTurn` defaults to 8, and the number that matters is the product.** Two independent caps are
how a reader accidentally authorises ten thousand tool calls: `maxTurns: 50` reads as modest and
`maxToolCallsPerTurn: 200` reads as generous, and nobody multiplies. So `RunResult` reports
`budget = maxTurns * maxToolCallsPerTurn` and the docs page states it as the number to reason about. Eight is
chosen as more than any provider emits for a well-specified tool set and small enough that a runaway is
capped; it is a default rather than a required field because, unlike `maxTurns`, exceeding it is a bounded
mistake.

## 5. Termination is a value, not an absence

```ts
export interface RunResult {
  readonly messages: readonly ChatMessage[];
  readonly stop: 'complete' | 'max-turns' | 'max-tool-calls';
  readonly turns: number;
  readonly toolCalls: number;
  readonly budget: number;
  readonly declined: readonly ToolCall[];
  readonly errors: readonly {
    readonly callId: string;
    readonly name: string;
    readonly errorId: string;
    readonly error: unknown;
  }[];
}
```

The issue's signature returns `readonly Message[]`, and its own step 2 asks for the cap to be
distinguishable from completion. Both cannot hold: a message list ending in an assistant message with tool
calls the loop declined to run looks exactly like a list the caller truncated. So `run` returns a result, and
`stop` is the field:

- `complete` — the driver returned an assistant message with no tool calls. The only outcome that means the
  model considered itself finished.
- `max-turns` — `turns === maxTurns` and the last message still requested tools.
- `max-tool-calls` — a single turn requested more than `maxToolCallsPerTurn`. The turn's calls are **not
  partially executed**: the loop stops before the first one, because "we ran three of your nine calls" is a
  state no caller can reason about.

A driver that throws propagates unchanged. The loop does not convert a provider outage into a `stop` value,
because a caller retrying a `stop` is not the same decision as a caller retrying an exception, and collapsing
the two loses the stack.

`declined` records every call `approve` returned `false` for. A declined call becomes a tool message with
`isError: true` and the content `declined by the operator`, and **the loop continues** — aborting the run
throws away the turns already spent and gives the model no chance to propose something acceptable. The model
may of course ask again; that is bounded by `maxTurns`, and a model that spends its whole budget re-asking is
visible in `declined`.

## 6. What the model sees versus what the caller gets

A tool that throws becomes a tool message with `isError: true`, because the model can act on that. What goes
into `content` is bounded on purpose, and this is the section to read before adding a nicer error message:

- **A validation failure** — `validationIssuesOf(error)` returns a list (`../adapters/SPEC.md` §5, same
  function, same reason) — yields the paths and the expectations, and **never `ValidationIssue.value`**. The
  model needs the path to fix the call; the value is what it should not be told it got away with sending, and a
  tool result is the easiest accidental exfiltration path in an agent loop.
- **Anything else** yields exactly `tool <name> failed (<errorId>)`. No message, no class name, no stack. An
  exception message in this codebase can contain a table name, a column list, a compiled SQL string or a
  connection target, all of which are internals and none of which help a model retry.
- `errorId` is 8 hex characters from `globalThis.crypto.getRandomValues` — the Web Crypto route
  `.oxlintrc.json` requires, and there is no `node:crypto` here — and the same id appears in
  `RunResult.errors` alongside the untouched error. That join is the whole point: an operator reading a
  transcript can find the real failure without the transcript containing it.

**The loop logs nothing.** `@zmdb/schema-core` has no logger and must not acquire one — it runs in a browser
and on a device — so the errors are returned rather than reported, and a caller that ignores
`RunResult.errors` has decided to. A `console.error` here would be a library writing to a stream it does not
own.

The redaction applies to the generated tool-error message. The caller-owned transcript is preserved: if the
incoming assistant message contained the offending value in `toolCalls[].args`, that original message remains
in `RunResult.messages`. The loop does not mutate or selectively rewrite conversation history; the caller
chooses whether and where to retain it.

## 7. What the suite asserts

1. `stop` is `complete`, `max-turns` and `max-tool-calls` for three drivers that each end the loop a
   different way, and `turns`/`toolCalls`/`budget` agree with the caps in every case.
2. A registry with a default-`effectful` entry and no `approve` throws before the driver is called once — the
   driver is a spy and its call count is zero.
3. The type-level requirement, in a `*.type-test.ts`: a missing validator and a validator/handler mismatch are
   errors; `run` with an effectful registry and no `approve` is an error; with `effectful: false` throughout it
   is not; with an erased `ToolRegistry` it is an error again, which is the safe-degradation claim in §4.
4. A throwing tool produces `isError: true`, content matching `tool <name> failed (<8 hex>)` and one
   `RunResult.errors` entry carrying the original error object by identity.
5. A validation failure produces a message containing the path and **not** containing the offending value, for
   a value chosen to be recognisable if it leaked.
6. A `provider` block on an assistant message is passed to the next `next()` call by identity, unmodified.
7. A declined call appears in `declined`, produces an `isError` tool message, and does not stop the loop.
8. The Anthropic adapter is checked against the installed SDK's request and response types without network
   I/O, carries supported reasoning blocks by identity, and refuses an unknown passthrough block before
   calling the SDK.

## 8. Non-goals (rejected)

- **No default for `maxTurns`.** §4 — any number defensible enough to default to is a number that lets a
  runaway run.
- **No streaming in the driver interface.** §2 — a token stream is a different product with a different
  consumer, and the framework's response body is a string.
- **No retries, backoff or rate-limit handling in the loop.** §2 — retryability is a provider's status codes,
  and `llm-http.md` already has the code.
- **No `Message` export.** §1 — the name is taken, in the reader's own file, by the example this repository
  publishes.
- **No structured provider fields.** §1.1 — one opaque block with a stated contract outlives four fields
  modelled from this quarter's API.
- **No logging, and no logger injection.** §6 — the errors are in the return value; a package that runs on a
  device does not own a stream.
- **No partial execution of a turn that exceeded the tool-call cap.** §5.
- **No agent, planner, memory or multi-agent orchestration.** A loop with a bounded turn count over a
  registry the author wrote is the whole product; everything past it is a policy, and a policy that ships as a
  library is a policy someone will fight.
