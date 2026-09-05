> **Install:** `npm add @zmdb/ai@alpha @zmdb/ai-vercel@alpha ai@^7.0.83`. The adapter's packed consumer runs against `7.0.83` and `7.0.92`; `ai` is its sole optional peer. Applications that do not
> install `@zmdb/ai-vercel` do not receive the AI SDK. A `LanguageModel` wrapper and persistence adapter for `useChat` remain application code.

## Know the boundary

- The adapter emits provider-neutral JSON Schema. The AI SDK and its provider package own any later provider translation.
- The SDK's `Schema` is branded, so the application passes the installed package's own `jsonSchema` factory. zmdb neither imports `ai` nor fabricates its brand with a cast.
- `validate` runs before the handler. Validation failures become value-free tool-result text the model can correct; handler and infrastructure errors still throw.
- The returned fields do not contain a name. In the AI SDK, the key in the `tools` record is the tool name.

## Tools

`aiSdkTool` builds the fields accepted by `tool()`. Pass the SDK's own `jsonSchema` factory so it keeps ownership of its branded schema type. This example compiles against the tested peer:

```ts
import { jsonSchema, tool } from 'ai';
import { aiSdkTool } from '@zmdb/ai-vercel';
import { assert } from '@zmdb/aot-validator/utilities';
import { schemaOf, type CreateDTO } from '@zmdb/schema-core';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';

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

```ts
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

```ts
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

```ts
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
