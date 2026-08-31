> **ToDo / feature gap.** There is no Vercel AI SDK integration. No tool adapter,
> no `LanguageModel` wrapper, no persistence adapter for `useChat`. The glue below
> is what you write.

## Tools

The AI SDK's `tool()` takes a Zod schema, so the bridge is a JSON Schema conversion — or, on recent versions, `jsonSchema()`, which skips Zod entirely and is the better path:

```ts
import { tool, jsonSchema } from 'ai';
import { toJsonSchema } from '@zmdb/schema-core/openapi';
import { assert } from '@zmdb/aot-validator/utilities';

export const createUser = tool({
  description: 'Create a user',
  parameters: jsonSchema<CreateDTO<typeof users>>(toJsonSchema(users, 'create')),
  execute: async input => {
    const dto = assert<CreateDTO<typeof users>>(input);
    return userRepo.create(dto);
  },
});
```

`jsonSchema<T>()` carries your TypeScript type through for the SDK's inference while the runtime schema comes from your schema object — one declaration, both halves. The `assert` still earns its place: the SDK's schema handling is not the same code as your repository's type.

## Structured output

```ts
import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const { object } = await generateObject({
  model: anthropic('claude-opus-5'),
  schema: jsonSchema<CreateDTO<typeof users>>(toJsonSchema(users, 'create')),
  prompt: transcript,
});

await userRepo.create(assert<CreateDTO<typeof users>>(object));
```

## Streaming, and where it collides with `@zmdb/web`

`WebResponse.body` is a `string`, so a `@zmdb/web` handler cannot return the SDK's streaming response. This is the [shared streaming blocker](./web-streaming-files.html).

Two ways round it:

**Bypass the framework for streaming routes.** `App` exposes `fetch(request)`, so you can hand non-streaming traffic to zmdb and handle streaming routes directly:

```ts
const app = createApp(AppModule);
await app.init();

Bun.serve({
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') {
      const result = streamText({ model: anthropic('claude-opus-5'), messages: await body(request) });
      return result.toDataStreamResponse();
    }
    return app.fetch(request);
  },
});
```

**Or use a Next.js route handler** for the streaming endpoint and `@zmdb/web` for the rest. Both are the same idea: the streaming path does not go through the framework.

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
      tokens: usage.completionTokens,
    });
  },
});
```

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

## What an integration would provide

A `zmdbChatStore(repo)` implementing the SDK's persistence interface, and a `toolsFromSchemas()` helper. Both are thin, and both would pin zmdb to the SDK's interfaces, which have changed shape more than once. Writing the twenty lines above in your own repository means an SDK upgrade is your decision rather than a version conflict.

---

See also: [Structured Output](./llm-structured-output.html) · [LLM Chat](./llm-chat.html) · [Deploy to Next.js](./deploy-nextjs.html)
