> **Small runtime, not an agent framework.** There is no agent graph, unified
> provider client abstraction or conversation store. Alongside provider-specific
> `toolFor`, generic `toolFromSchema` and `lenientParse`,
> `@zmdb/schema-core/llm/chat` provides a bounded tool loop, typed messages and
> an optional injected Anthropic SDK driver.

## What is actually provided, and why it is the right amount

The library gives you the things that are reusable without choosing application
policy:

- **`toolFor<T>(provider, name, opts)`** — an AOT-inlined OpenAI, Anthropic, Gemini or generic tool definition
- **`toolFromSchema(name, schema, opts)`** — the unchanged provider-neutral JSON Schema form
- **`langchainTool(...)`** — optional `@langchain/core` tool fields with validation before dispatch
- **`aiSdkTool(...)`** — optional Vercel AI SDK tool fields using the SDK's own `jsonSchema`
- **`lenientParse<T>(text)`** — recovery from the specific ways model output deviates from strict JSON
- **`defineTools(registry)`** — a registry that requires a validator and links each handler to that validator's output
- **`run(driver, messages, tools, opts)`** — a provider-independent loop with explicit turn and per-turn tool-call bounds
- **`anthropicDriver(opts)`** — a thin adapter over an injected optional Anthropic SDK client

Plus the validators, which are the part that actually matters: `assert<CreateDTO<Order>>(toolInput)` before any write.

What it deliberately does not give you is one provider abstraction pretending
every model API is the same. The framework adapters only build tools; the loop
depends on a one-method `ChatDriver`, with an optional Anthropic implementation.
For another provider, implement that method or call its API with `fetch`.

## The strategy that follows from that

**One: the declaration is the contract.** Do not hand-write a JSON Schema for the model and a TypeScript type for your code. Both come off the one interface, so a new column appears in the tool definition automatically:

```ts
const tool = toolFor<Order>('openai-strict', 'save_order', { description: 'Record an order' });
```

**Two: validate at the boundary, always.** Treat model output exactly like a request body from an untrusted client — because that is what it is. A `tool_use` block is a suggestion:

```ts
const dto = assert<CreateDTO<Order>>(block.input);
```

**Three: keep tools narrow.** A tool per operation, with its own declared type, beats one `run_sql` tool. The narrow version constrains the model's output space and bounds the damage of a wrong call; a generic SQL tool is a remote console — see [HTTP Proxy](./connect-http-proxy.html) for why that is not a small risk.

**Four: no writes without a check the model does not control.** If a tool call deletes or charges, gate it on something outside the conversation — an idempotency key, a confirmation step, an authorisation check against the caller's identity rather than the model's claim about it.

## Reading data for a model

The read side is where a derived shape helps most, because it bounds what goes into the context:

```ts
const page = await repo.list({ select: ['id', 'title', 'status'], page: { limit: 20 } });
const context = stringify<Pick<Entity<Order>, 'id' | 'title' | 'status'>[]>(page.items);
```

`select` keeps the columns you did not need out of the prompt, which is both cheaper and less likely to put something sensitive in front of a model. A column tagged `Sensitive` is excluded from `stringify` output by construction — that is a real safety property, and it is worth relying on deliberately rather than accidentally.

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

`role` is a literal union, so an invalid role is a compile error rather than a row you discover later — and the same union becomes the `enum` in the tool definition the model is handed, which is the point of deriving one from the other. See [LLM Chat](./llm-chat.html).

## What a framework would have to justify

Retries with backoff, streaming, token accounting and provider fallback are all
real needs, and all depend heavily on which provider you use and what your
failure policy is. The shipped loop owns only the provider-independent safety
properties: validation before dispatch, approval for effectful tools, bounded
turns, bounded calls per turn and a reasoned stop result.

---

See also: [Structured Output](./llm-structured-output.html) · [LLM Chat](./llm-chat.html) · [Anti-patterns](./anti-patterns.html)
