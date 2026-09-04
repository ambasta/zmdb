> **Optional integration.** The tool adapter ships at
> `@zmdb/schema-core/llm/ai-sdk` and supports `ai` `^7.0.83`. A `LanguageModel`
> wrapper and persistence adapter for `useChat` remain application choices.

## Tools

`aiSdkTool` builds the fields accepted by `tool()`. Pass the SDK's own
`jsonSchema` factory so it keeps ownership of its branded schema type:

```ts
import { tool, jsonSchema } from 'ai';
import { aiSdkTool } from '@zmdb/schema-core/llm/ai-sdk';
import { assert } from '@zmdb/aot-validator/utilities';

export const createUser = tool(
  aiSdkTool('create_user', users, {
    jsonSchema,
    description: 'Create a user',
    validate: input => assert<CreateDTO<User>>(input),
    execute: dto => userRepo.create(dto),
  }),
);
```

The AOT validator remains the trust boundary. It runs before `execute`, and its
return value is the decoded value the repository receives. Validation failures
become tool-result text the model can correct; handler failures still throw.

The application no longer needs the `JSONSchema7` cast. The adapter owns that
single structural handoff, and imports neither Zod nor another schema library.

## Structured output

```ts
import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const { object } = await generateObject({
  model: anthropic('claude-opus-5'),
  schema: jsonSchema<CreateDTO<User>>(toJsonSchema(users, 'create') as JSONSchema7),
  prompt: transcript,
});

await userRepo.create(assert<CreateDTO<User>>(object));
```

## Streaming through `@zmdb/web`

The response layer can carry the SDK's `ReadableStream`. Convert the SDK
`Response` into a tagged stream response:

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

The framework handles backpressure and disconnect cancellation. The provider SDK
still owns its event format and token-stream semantics.

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

`outputTokens` is v5's name for what v4 called `completionTokens`, and it is optional — a provider that reports no usage leaves it `undefined`, which is why the column is nullable rather than `NOT NULL DEFAULT 0`.

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

A `zmdbChatStore(repo)` would still pin zmdb to the SDK's persistence
interfaces, which have changed shape more than once. Keeping the short
`onFinish` repository call in the application makes that upgrade your decision.

---

See also: [Structured Output](./llm-structured-output.html) · [LLM Chat](./llm-chat.html) · [Deploy to Next.js](./deploy-nextjs.html)
