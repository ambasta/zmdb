> **Supported core, application-owned storage.** `@zmdb/schema-core/llm/chat` provides typed chat messages, a validator-linked tool registry, a bounded loop with effect approval, and an optional
> Anthropic SDK driver. It does not persist conversations or stream tokens; those remain application concerns below.

## Safety model

The loop makes the unsafe choices explicit before it calls a model or a tool:

- `maxTurns` is required, and `maxToolCallsPerTurn` defaults to 8. The total budget is their product and is returned as `result.budget`.
- A tool is effectful unless it says `effectful: false`. If any tool is effectful, `approve` is required by the type and checked again at runtime before the first driver call.
- Model-written arguments remain `unknown` until the registry entry's validator accepts them. A handler never receives the raw value.
- Unknown tools, declined calls, and invalid arguments become bounded error tool messages. Handler internals stay in `result.errors` and are not exposed to the model.

Those are construction rules, not recommendations around an otherwise unbounded agent loop.

## Running a bounded tool loop

```ts
import Anthropic from '@anthropic-ai/sdk';
import { assert } from '@zmdb/aot-validator/utilities';
import { anthropicDriver, defineTools, run } from '@zmdb/schema-core/llm/chat';

interface SearchArgs {
  q: string;
}

interface DeleteArgs {
  userId: string;
}

const tools = defineTools({
  search_docs: {
    spec: {
      name: 'search_docs',
      description: 'Search the product documentation',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string' } },
        required: ['q'],
      },
    },
    validate: (input: unknown) => assert<SearchArgs>(input),
    handler: ({ q }) => searchDocs(q),
    effectful: false,
  },
  delete_user: {
    spec: {
      name: 'delete_user',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
    },
    validate: (input: unknown) => assert<DeleteArgs>(input),
    handler: ({ userId }) => users.delete(userId),
    // Omitted means effectful, so run() requires approve.
  },
});

const driver = anthropicDriver({
  client: new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') }),
  model: requireEnv('ANTHROPIC_MODEL'),
  maxOutputTokens: 1024,
});

const result = await run(driver, [{ role: 'user', content: 'Find the retention policy.' }], tools, {
  maxTurns: 4,
  approve: async call => call.name !== 'delete_user',
});
```

`maxTurns` is required. `maxToolCallsPerTurn` defaults to 8, and `result.budget` reports their product. A turn above the tool-call cap is not partially executed. Invalid arguments and unknown tools
become error tool messages so the model can correct its request; handler failures are sanitised in the transcript while the untouched error is returned in `result.errors`.

`run` holds no module state. Pass the returned message list into a later call if you want to continue the conversation, or persist it using the tables below. Implement the one-method `ChatDriver`
interface for another provider.

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

A literal union for `role` means a typo is a compile error. `toolUse` as a declared JSON shape means a tool call round-trips without a second table — and the shape reaches the emitted validator, so a
malformed tool call is caught on the way in rather than on the way back out.

`createdAt` says `HasDefault`, which is what makes it optional on insert. The default _value_ — `now()` — goes in the migration, because a type can say a column has a default but not which one.

Index the lookup you will do on every request:

```ts
createIndexDdl({ name: 'messages_conversation', table: 'messages', columns: ['conversation_id', 'created_at'] }, 'postgres');
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
  @Inject(MESSAGES) private readonly messages!: MessageRepository;

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

Wrap the two writes and the call in a transaction only if you want "no reply means no user message" — usually you do not, because a failed model call should leave the user's message in the history to
retry against.

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

Iterating the reversed copy rather than indexing backwards is what keeps this free of non-null assertions: `for…of` yields `Row`, while `history[i]` yields `Row | undefined` and tempts you into a `!`
that [the project treats as a defect](./architecture.html).

Storing `tokens` on the row is what makes this exact rather than a guess — and it is why the column is there.

**Summarise the prefix** into a message you store, then drop what it covers. That needs a `summarisedThrough` column on `conversations`, and it is a real design exercise, not a helper.

## Streaming

`WebResponse.body` can carry a stream. The shipped `ChatDriver.next` contract still returns one complete assistant message, so token streaming needs a provider-specific stream at the route:

- Adapt a provider SDK's native `Response.body` directly with `stream()`.
- For SSE in a Fetch `Response`, `sseStream` now awaits the provider iterator's optional `return(reason)` on cancellation. If the provider requires an `AbortSignal` instead, build an application-owned
  stream that aborts it — see [WebSockets & SSE](./web-ws-adapter.html).

See [Streaming Files](./web-streaming-files.html) for cancellation and error semantics.

## What remains application-owned

Conversation persistence, token-aware truncation, summarisation and streaming still depend on your storage and provider policy. The bounded tool-call loop is the reusable part that now ships; it
deliberately does not choose a retry policy, a token-accounting format or a conversation table for you.

---

See also: [LLM Strategy](./llm-strategy.html) · [Structured Output](./llm-structured-output.html) · [WebSockets & SSE](./web-ws-adapter.html)
