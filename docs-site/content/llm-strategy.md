> **ToDo / feature gap.** There is no agent framework, no provider abstraction and
> no conversation state. `@zmdb/schema-core/llm` is two functions —
> `toolFromSchema` and `lenientParse` — and everything else on this page is a
> pattern rather than an API.

## What is actually provided, and why it is the right amount

The library gives you the two things that need to be derived from your schema:

- **`toolFromSchema(name, schema, opts)`** — the tool definition, so the model's output shape comes from your database's shape
- **`lenientParse<T>(text)`** — recovery from the specific ways model output deviates from strict JSON

Plus the validators, which are the part that actually matters: `assert<CreateDTO<S>>(toolInput)` before any write.

What it deliberately does not give you is a provider wrapper. Model APIs are HTTP endpoints that change every few months, and a thin abstraction over them ages badly while adding a dependency to a project with [zero runtime dependencies](./why-zmdb.html). Call the API with `fetch`.

## The strategy that follows from that

**One: the schema is the contract.** Do not hand-write a JSON Schema for the model and a TypeScript type for your code. Derive both from the schema object, so a new column appears in the tool definition automatically:

```ts
const tool = toolFromSchema('save_order', orders, { description: 'Record an order' });
```

**Two: validate at the boundary, always.** Treat model output exactly like a request body from an untrusted client — because that is what it is. A `tool_use` block is a suggestion:

```ts
const dto = assert<CreateDTO<typeof orders>>(block.input);
```

**Three: keep tools narrow.** A tool per operation, with a schema per operation, beats one `run_sql` tool. The narrow version constrains the model's output space and bounds the damage of a wrong call; a generic SQL tool is a remote console — see [HTTP Proxy](./connect-http-proxy.html) for why that is not a small risk.

**Four: no writes without a check the model does not control.** If a tool call deletes or charges, gate it on something outside the conversation — an idempotency key, a confirmation step, an authorisation check against the caller's identity rather than the model's claim about it.

## Reading data for a model

The read side is where a schema-derived shape helps most, because it bounds what goes into the context:

```ts
const page = await repo.list({ select: ['id', 'title', 'status'], page: { limit: 20 } });
const context = stringify<Pick<Entity<typeof orders>, 'id' | 'title' | 'status'>[]>(page.items);
```

`select` keeps the columns you did not need out of the prompt, which is both cheaper and less likely to put something sensitive in front of a model. `sensitive()` columns are excluded from `stringify` output by construction — that is a real safety property, and it is worth relying on deliberately rather than accidentally.

## Conversation state

There is none, and a conversation is a table:

```ts
export const messages = defineSchema('messages', {
  id: serial().primaryKey(),
  conversationId: references(integer(), conversations, 'id').notNull(),
  role: jsonEnum(['user', 'assistant', 'tool'] as const).notNull(),
  content: text().notNull(),
  createdAt: timestamp().notNull().defaultTo('now()'),
});
```

`jsonEnum` narrows `role` to a union, so an invalid role is a compile error rather than a row you discover later. See [LLM Chat](./llm-chat.html).

## What a framework would have to justify

Retries with backoff, streaming, tool-call loops, token accounting and provider fallback are all real needs — and all of them are twenty to fifty lines that depend heavily on which provider you use and what your failure policy is. A framework that guesses those for you is a framework you fight. If something lands here, it would be the pieces that are genuinely derived from your schema, which is what the two existing functions already are.

---

See also: [Structured Output](./llm-structured-output.html) · [LLM Chat](./llm-chat.html) · [Anti-patterns](./anti-patterns.html)
