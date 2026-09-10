> **Install:** `yarn add @zmdb/ai@1.0.0-beta.2 @zmdb/ai/vercel@1.0.0-beta.2 ai@^7.0.93`. Exact `7.0.93` is the supported and packed-consumer-tested floor; `ai` is the adapter's sole optional peer.
> Applications that do not install `@zmdb/ai/vercel` do not receive the AI SDK. A `LanguageModel` wrapper and persistence adapter for `useChat` remain application code.

## Know the boundary

- The adapter emits provider-neutral JSON Schema. The AI SDK and its provider package own any later provider translation.
- The SDK's `Schema` is branded, so the application passes the installed package's own `jsonSchema` factory. zmdb neither imports `ai` nor fabricates its brand with a cast.
- `validate` runs before the handler. Validation failures become value-free tool-result text the model can correct; handler and infrastructure errors still throw.
- The returned fields do not contain a name. In the AI SDK, the key in the `tools` record is the tool name.

## Tools

`aiSdkTool` builds the fields accepted by `tool()`. Pass the SDK's own `jsonSchema` factory so it keeps ownership of its branded schema type. This example compiles against the tested peer:

```ts {"mode":"compile","id":"example-001"}
import { jsonSchema, tool } from 'ai';
import { aiSdkTool } from '@zmdb/ai/vercel';
import { assert } from '@zmdb/validator';
import { schemaOf, type CreateDTO } from '@zmdb/schema';
import { type HasDefault, type PrimaryKey, type Serial, type Sql, type Table } from '@zmdb/schema/tags';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: ('admin' | 'user') & HasDefault;
}

const users = schemaOf<User>();

export const tools = {
  create_user: tool(
    aiSdkTool('create_user', users, {
      jsonSchema,
      description: 'Create a user',
      validate: input => assert<CreateDTO<User>>(input),
      execute: async dto => ({ email: dto.email, role: dto.role ?? 'user' }),
    }),
  ),
};
```

`schemaOf<User>()` and `assert<CreateDTO<User>>()` are both resolved by the normal [AOT setup](./aot-setup.html). The validator's return value is the decoded value passed to `execute`, so a custom
wire codec can decode there too. The application needs no Zod schema and no `JSONSchema7` cast.

## Streaming through `@zmdb/web`

The response layer can carry the SDK's `ReadableStream`. Convert the SDK `Response` into a tagged stream response:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies anthropic, messages, streamText; this excerpt does not repeat those declarations."}
const result = streamText({
  model: anthropic('claude-opus-5'),
  messages,
});
const response = result.toUIMessageStreamResponse();
if (response.body === null) return respond({ status: response.status });

return stream(response.body, {
  status: response.status,
  headers: Object.fromEntries(response.headers),
  onError: error => logger.error({ error }),
});
```

The framework handles backpressure and disconnect cancellation. The provider SDK still owns its event format and token-stream semantics.

## Persisting `useChat` history

The SDK's `onFinish` is where a turn gets written, and a [messages table](./llm-chat.html) is the store:

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies anthropic, conversationId, messageRepo, messages, streamText; this excerpt does not repeat those declarations."}
const result = streamText({
  model: anthropic('claude-opus-5'),
  messages,
  onFinish: async ({ text, usage }) => {
    await messageRepo.create({
      conversationId,
      role: 'assistant',
      content: text,
      toolUse: null,
      tokens: usage.outputTokens ?? null,
    });
  },
});
```

`outputTokens` is v5's name for what v4 called `completionTokens`, and it is optional — a provider that reports no usage leaves it `undefined`, which is why the column is nullable rather than
`NOT NULL DEFAULT 0`.

Write the user's message _before_ the call, not in `onFinish` — otherwise a failed generation loses the prompt and the user retypes it.

## Reading history back

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies id, messageRepo; this excerpt does not repeat those declarations."}
const page = await messageRepo.list({
  where: { conversationId: { eq: id } },
  orderBy: [
    { column: 'createdAt', dir: 'asc' },
    { column: 'id', dir: 'asc' },
  ],
  page: { limit: 100 },
});

const messages = page.items.map(m => ({ role: m.role, content: m.content }));
```

The `id` tie-break matters: two messages in the same millisecond otherwise come back in an arbitrary order.

## What remains application code

A `zmdbChatStore(repo)` would still pin zmdb to the SDK's persistence interfaces, which have changed shape more than once. Keeping the short `onFinish` repository call in the application makes that
upgrade your decision.

---

See also: [Structured Output](./llm-structured-output.html) · [LLM Chat](./llm-chat.html) · [Deploy to Next.js](./deploy-nextjs.html)
