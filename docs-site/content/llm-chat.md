> **ToDo / feature gap.** There is no chat abstraction — no message history type,
> no conversation manager, no streaming helper. What follows is built from a schema
> declaration, the repository and `@zmdb/web`, all of which exist.

## The tables

```ts
import type { HasDefault, OneToMany, PrimaryKey, References, Serial, Sql, Table } from 'zmdb/tags';

export interface Conversation extends Table<'conversations'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  title: (string & Sql<'text'>) | null;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  messages?: Message[] & OneToMany<'messages', 'conversationId'>;
}

export interface Message extends Table<'messages'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  conversationId: number & Sql<'integer'> & References<'conversations.id'>;
  role: 'user' | 'assistant' | 'tool';
  content: string & Sql<'text'>;
  toolUse: ({ name: string; input: unknown } & Sql<'json'>) | null;
  tokens: (number & Sql<'integer'>) | null;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}
```

A literal union for `role` means a typo is a compile error. `toolUse` as a declared JSON shape means a tool call round-trips without a second table — and the shape reaches the emitted validator, so a malformed tool call is caught on the way in rather than on the way back out.

`createdAt` says `HasDefault`, which is what makes it optional on insert. The default _value_ — `now()` — goes in the migration, because a type can say a column has a default but not which one.

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
type Row = Entity<Message>;

function fit(history: readonly Row[], budget: number): readonly Row[] {
  const kept: Row[] = [];
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
of non-null assertions: `for…of` yields `Row`, while `history[i]` yields
`Row | undefined` and tempts you into a `!` that
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
