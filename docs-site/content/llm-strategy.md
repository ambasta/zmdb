> **Provider documents, not provider clients.** `toolFor` emits the shape a target API expects. It does not make the request, choose a model or hide provider-specific response handling. The optional
> framework adapters build tool objects; they do not turn LangChain or the AI SDK into a common client.

## Package and installation matrix

Provider schema dialects live in `@zmdb/ai`. Provider clients and framework adapters live only in the selected integration package:

| Capability                                            | Install                                                      | Public import                                                                              | External peer cost                   |
| ----------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| Provider-neutral tools, chat, HTTP, shared invocation | `npm add @zmdb/ai@alpha`                                     | `@zmdb/ai`, `@zmdb/ai/chat`, `@zmdb/ai/http`, `@zmdb/ai/compiler`, `@zmdb/ai/tool-runtime` | none                                 |
| Anthropic Messages API chat driver                    | `npm add @zmdb/ai-anthropic@alpha @anthropic-ai/sdk@0.124.0` | `@zmdb/ai-anthropic`                                                                       | optional `@anthropic-ai/sdk@0.124.0` |
| LangChain structured-tool adapter                     | `npm add @zmdb/ai-langchain@alpha @langchain/core@^1.2.9`    | `@zmdb/ai-langchain`                                                                       | optional `@langchain/core@^1.2.9`    |
| Vercel AI SDK tool adapter                            | `npm add @zmdb/ai-vercel@alpha ai@^7.0.83`                   | `@zmdb/ai-vercel`                                                                          | optional `ai@^7.0.83`                |
| Transport-neutral MCP client/server cores             | `npm add @zmdb/ai@alpha @zmdb/mcp@alpha`                     | `@zmdb/mcp`                                                                                | none; no MCP SDK                     |

`@zmdb/ai` itself depends only on `@zmdb/schema-core` and has no external peer. Each integration depends inward on `@zmdb/ai`; installing the provider-neutral package or MCP does not install
Anthropic, LangChain, Vercel AI, or an MCP SDK.

## Migrating from schema-core

The old `@zmdb/schema-core` exports are removed, not deprecated aliases. Replace all six former subpaths directly:

| Removed schema-core subpath | Final import                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/llm`                      | `@zmdb/ai` for tool APIs; `@zmdb/schema-core/openapi` for `toJsonSchema`; use the explicit chat, HTTP, and MCP entries below for former star exports |
| `/llm/chat`                 | `@zmdb/ai/chat`; move `anthropicDriver` and its types to `@zmdb/ai-anthropic`                                                                        |
| `/llm/http`                 | `@zmdb/ai/http`                                                                                                                                      |
| `/llm/langchain`            | `@zmdb/ai-langchain`                                                                                                                                 |
| `/llm/ai-sdk`               | `@zmdb/ai-vercel`                                                                                                                                    |
| `/llm/mcp`                  | `@zmdb/mcp`                                                                                                                                          |

There is deliberately no schema-core forwarder: `@zmdb/ai` already depends on schema-core, so forwarding in the opposite direction would create a package cycle.

## Limits first

A schema-derived tool is the `create` shape of one table: one object level with scalar leaves. A literal union becomes `enum`; recursive types and discriminated object unions do not enter this API.
For a rich `json` payload, declare the wire shape with `WireAs<W>` rather than expecting a provider dialect to infer it.

The current dialect contract refuses these shapes during generation:

| Condition                                             | Targets                                  | Result                                                                              |
| ----------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| The visible create shape has no properties            | OpenAI, OpenAI strict, Anthropic, Gemini | `ToolSpecRefusalError`; unhide an allowed field or drop the tool                    |
| The generated document has more than 1,024 properties | OpenAI, OpenAI strict, Anthropic, Gemini | `ToolSpecRefusalError`; split the operation into smaller tools                      |
| A property is untyped `{}`, as a plain `json` column  | OpenAI strict, Gemini                    | `ToolSpecRefusalError` naming the provider and property; use `WireAs<W>` or omit it |

`openai`, `anthropic` and the provider-neutral `json-schema` target pass an untyped `{}` property through, so it constrains nothing. Validation is still required before a handler. The provider data
behind these choices lives in `TOOL_DIALECTS` with the source and date used to implement it; provider APIs can change independently of a zmdb release.

## One declaration, four provider targets

```ts
import { toolFor } from '@zmdb/ai';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';

interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  amount: bigint & Sql<'bigint'>;
  note: string & Sql<'text'> & HasDefault;
  comment: (string & Sql<'text'>) | null;
  state: 'draft' | 'ready';
}

const description = 'Record an order';

export const orderTools = {
  openAI: toolFor<Order>('openai', 'save_order', { description }),
  openAIStrict: toolFor<Order>('openai-strict', 'save_order', { description }),
  anthropic: toolFor<Order>('anthropic', 'save_order', { description }),
  gemini: toolFor<Order>('gemini', 'save_order', { description }),
};
```

The current emitter produces these differences from that one declaration:

| Target        | Wrapper                                 | Optional `note`                        | Nullable `comment`                   | `bigint`                                          |
| ------------- | --------------------------------------- | -------------------------------------- | ------------------------------------ | ------------------------------------------------- |
| OpenAI        | `{ type: 'function', function: { … } }` | omitted from `required`                | `type: ['string', 'null']`           | `type: 'integer', format: 'int64'`                |
| OpenAI strict | the same, plus `strict: true`           | required and widened to include `null` | required; `type: ['string', 'null']` | `format: 'int64'` dropped; every object is closed |
| Anthropic     | `{ name, description, input_schema }`   | omitted from `required`                | `type: ['string', 'null']`           | `type: 'integer', format: 'int64'`                |
| Gemini        | `{ name, description, parameters }`     | omitted from `required`                | `type: 'string', nullable: true`     | `type: 'integer', format: 'int64'`                |

The OpenAI strict widening is why the boundary validator remains necessary: the provider document may admit `null` for a TypeScript field that was optional but not nullable.

## What is actually provided

The library gives you the things that are reusable without choosing application policy:

- **`toolFor<T>(provider, name, opts)`** — an AOT-inlined OpenAI, Anthropic, Gemini or generic tool definition
- **`toolFromSchema(name, schema, opts)`** — the unchanged provider-neutral JSON Schema form
- **`langchainTool(...)`** — optional `@langchain/core` tool fields with validation before dispatch
- **`aiSdkTool(...)`** — optional Vercel AI SDK tool fields using the SDK's own `jsonSchema`
- **`lenientParse<T>(text)`** — recovery from the specific ways model output deviates from strict JSON
- **`defineTools(registry)`** — a registry that requires a validator and links each handler to that validator's output
- **`run(driver, messages, tools, opts)`** — a provider-independent loop with explicit turn and per-turn tool-call bounds
- **`anthropicDriver(opts)` from `@zmdb/ai-anthropic`** — a thin adapter over an injected optional Anthropic SDK client

Plus the validators, which are the part that actually matters: `assert<CreateDTO<Order>>(toolInput)` before any write.

What it deliberately does not give you is one provider abstraction pretending every model API is the same. The framework adapters only build tools; the loop depends on a one-method `ChatDriver`, with
an optional Anthropic implementation. For another provider, implement that method or call its API with `fetch`.

## The strategy that follows from that

**One: the declaration is the contract.** Do not hand-write a JSON Schema for the model and a TypeScript type for your code. Both come off the one interface, so a new column appears in the tool
definition automatically:

```ts
const tool = toolFor<Order>('openai-strict', 'save_order', { description: 'Record an order' });
```

**Two: validate at the boundary, always.** Treat model output exactly like a request body from an untrusted client — because that is what it is. A `tool_use` block is a suggestion:

```ts
const dto = assert<CreateDTO<Order>>(block.input);
```

**Three: keep tools narrow.** A tool per operation, with its own declared type, beats one `run_sql` tool. The narrow version constrains the model's output space and bounds the damage of a wrong call;
a generic SQL tool is a remote console — see [HTTP Proxy](./connect-http-proxy.html) for why that is not a small risk.

**Four: no writes without a check the model does not control.** If a tool call deletes or charges, gate it on something outside the conversation — an idempotency key, a confirmation step, an
authorisation check against the caller's identity rather than the model's claim about it.

## Reading data for a model

The read side is where a derived shape helps most, because it bounds what goes into the context:

```ts
const page = await repo.list({ select: ['id', 'title', 'status'], page: { limit: 20 } });
const context = stringify<Pick<Entity<Order>, 'id' | 'title' | 'status'>[]>(page.items);
```

`select` keeps the columns you did not need out of the prompt, which is both cheaper and less likely to put something sensitive in front of a model. A column tagged `Sensitive` is excluded from
`stringify` output by construction — that is a real safety property, and it is worth relying on deliberately rather than accidentally.

## Conversation state

There is none, and a conversation is a table:

```ts
import type { HasDefault, PrimaryKey, References, Serial, Sql, Table } from 'zmdb/tags';

export interface Message extends Table<'messages'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  conversationId: number & Sql<'integer'> & References<'conversations.id'>;
  role: 'user' | 'assistant' | 'tool';
  content: string & Sql<'text'>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}
```

`role` is a literal union, so an invalid role is a compile error rather than a row you discover later — and the same union becomes the `enum` in the tool definition the model is handed, which is the
point of deriving one from the other. See [LLM Chat](./llm-chat.html).

## What a framework would have to justify

Retries with backoff, streaming, token accounting and provider fallback are all real needs, and all depend heavily on which provider you use and what your failure policy is. The shipped loop owns only
the provider-independent safety properties: validation before dispatch, approval for effectful tools, bounded turns, bounded calls per turn and a reasoned stop result.

---

See also: [Structured Output](./llm-structured-output.html) · [LLM Chat](./llm-chat.html) · [Anti-patterns](./anti-patterns.html)
