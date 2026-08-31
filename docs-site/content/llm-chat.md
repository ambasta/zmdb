> **ToDo / feature gap.** There is no chat abstraction — no message history type,
> no conversation manager, no streaming helper. What follows is built from
> `defineSchema`, the repository and `@zmdb/web`, all of which exist.

## The tables

```ts
import { defineSchema, serial, text, timestamp, integer, jsonEnum, json, references } from '@zmdb/schema-core';

export const conversations = defineSchema('conversations', {
  id: serial().primaryKey(),
  userId: references(integer(), users, 'id').notNull(),
  title: text().nullable(),
  createdAt: timestamp().notNull().defaultTo('now()'),
});

export const messages = defineSchema('messages', {
  id: serial().primaryKey(),
  conversationId: references(integer(), conversations, 'id').notNull(),
  role: jsonEnum(['user', 'assistant', 'tool'] as const).notNull(),
  content: text().notNull(),
  toolUse: json<{ name: string; input: unknown } | null>().nullable(),
  tokens: integer().nullable(),
  createdAt: timestamp().notNull().defaultTo('now()'),
});

export const conversationRelations = { messages: oneToMany(messages, 'conversationId') };
```

`jsonEnum` for `role` means a typo is a compile error. `toolUse` as typed JSON means a tool call round-trips without a second table.

Index the lookup you will do on every request:

```ts
createIndexDdl(
  { name: 'messages_conversation', table: 'messages', columns: ['conversation_id', 'created_at'] },
  'postgres',
);
```

## Loading a conversation

```ts
const history = await messageRepo.list({
  where: { conversationId: { eq: id } },
  orderBy: [
    { column: 'createdAt', dir: 'asc' },
    { column: 'id', dir: 'asc' },
  ],
  page: { limit: 100 },
});
```

Order by `createdAt` **and** `id`. Two messages written in the same millisecond otherwise come back in an arbitrary order, and a conversation with the turns swapped is a confusing bug to chase.

## A turn

```ts
@Controller('/chat')
export class ChatController {
  constructor(@Inject(MESSAGES) private readonly messages: MessageRepository) {}

  @Post('/:id')
  async send(ctx: Ctx<{ id: string }, unknown>) {
    const { content } = assert<{ content: string }>(ctx.body);
    const conversationId = Number(ctx.params.id);

    await this.messages.create({ conversationId, role: 'user', content, toolUse: null, tokens: null });

    const history = await this.messages.list({
      where: { conversationId: { eq: conversationId } },
      orderBy: [{ column: 'createdAt', dir: 'asc' }],
      page: { limit: 50 },
    });

    const res = await callModel(history.items.map(m => ({ role: m.role, content: m.content })));

    await this.messages.create({
      conversationId,
      role: 'assistant',
      content: res.text,
      toolUse: null,
      tokens: res.usage.output_tokens,
    });

    return { reply: res.text };
  }
}
```

Wrap the two writes and the call in a transaction only if you want "no reply means no user message" — usually you do not, because a failed model call should leave the user's message in the history to retry against.

## Context windows

A conversation grows past the model's limit. Two approaches, and you will end up with both:

**Truncate by tokens**, keeping the most recent turns:

```ts
type Message = Entity<typeof messages>;

function fit(history: readonly Message[], budget: number): readonly Message[] {
  const kept: Message[] = [];
  let used = 0;
  for (const message of [...history].reverse()) {
    const cost = message.tokens ?? Math.ceil(message.content.length / 4);
    if (used + cost > budget) break;
    used += cost;
    kept.unshift(message);
  }
  return kept;
}
```

Iterating the reversed copy rather than indexing backwards is what keeps this free
of non-null assertions: `for…of` yields `Message`, while `history[i]` yields
`Message | undefined` and tempts you into a `!` that
[the project treats as a defect](./architecture.html).

Storing `tokens` on the row is what makes this exact rather than a guess — and it is why the column is there.

**Summarise the prefix** into a message you store, then drop what it covers. That needs a `summarisedThrough` column on `conversations`, and it is a real design exercise, not a helper.

## Streaming

`WebResponse.body` is a `string`, so a `@zmdb/web` handler cannot stream a model response token by token. Two options:

- **`sseStream`** from `@zmdb/web/gateways` for server-sent events — see [WebSockets & SSE](./web-ws-adapter.html)
- **Bypass the framework** for that one route, using `app.fetch` with a `ReadableStream` response constructed directly

See [Streaming Files](./web-streaming-files.html) for the shared blocker.

## What a helper would provide

A `Conversation` type, token-aware truncation, a tool-call loop, and streaming. All of them depend on which provider you use and what your truncation policy is — which is why the pieces that _are_ derived from your schema ([`toolFromSchema`](./llm-structured-output.html)) shipped and this did not.

---

See also: [LLM Strategy](./llm-strategy.html) · [Structured Output](./llm-structured-output.html) · [WebSockets & SSE](./web-ws-adapter.html)
