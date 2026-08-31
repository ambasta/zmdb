> **ToDo / feature gap.** There is no HTTP client for model providers. zmdb has
> [zero runtime dependencies](./why-zmdb.html) and does not wrap any vendor API.
> Use `fetch`; the examples below are complete.

## Anthropic

```ts
import { toolFromSchema } from '@zmdb/schema-core/llm';
import { assert } from '@zmdb/aot-validator/utilities';

interface AnthropicResponse {
  content: ({ type: 'text'; text: string } | { type: 'tool_use'; name: string; input: unknown })[];
  usage: { input_tokens: number; output_tokens: number };
}

export async function extract<T>(prompt: string, tool: ReturnType<typeof toolFromSchema>) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': requireEnv('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 1024,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);

  const body = assert<AnthropicResponse>(await res.json());
  const block = body.content.find(c => c.type === 'tool_use');
  if (block === undefined) throw new Error('no tool call in response');
  return assert<T>(block.input);
}
```

`requireEnv(name)` is the three-line helper from [Configuration](./web-configuration.html) — it throws on a missing or empty variable, so a misconfigured deployment fails at boot rather than on the first query.

The two `assert` calls are doing different jobs, and both are worth having. The first checks the _provider's_ response shape — an API change or an error body that came back with a 200 fails here with a field name. The second checks the _model's_ output against your type. Neither is redundant.

## OpenAI

```ts
const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'user', strict: true, schema: toJsonSchema(users, 'create') },
    },
  }),
});
```

OpenAI's strict mode requires `additionalProperties: false` and every property in `required`. `toJsonSchema` does not emit that, so add it:

```ts
const strict = { ...toJsonSchema(users, 'create'), additionalProperties: false };
```

## Retries

Model APIs rate-limit and occasionally return a 529. Retry on the retryable statuses only:

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 0;
      const retryable = status === 429 || status === 529 || status >= 500;
      if (i >= attempts - 1 || !retryable) throw e;
      await new Promise(r => setTimeout(r, 2 ** i * 500 + Math.random() * 200));
    }
  }
}
```

Jitter matters: without it, every concurrent request retries at the same instant and you rate-limit yourself. Honour `retry-after` when the response carries it.

## Timeouts

`fetch` has no default timeout, so a hung request hangs forever:

```ts
const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
```

Sixty seconds is not generous for a long completion — size it to your `max_tokens`, not to a habit from ordinary HTTP calls.

## Recording usage

Store it, from the beginning. Cost attribution after the fact is impossible without it:

```ts
await usageRepo.create({
  userId,
  model: 'claude-opus-5',
  inputTokens: body.usage.input_tokens,
  outputTokens: body.usage.output_tokens,
});
```

Then `repo.aggregate()` answers "which endpoint costs the most" from real numbers. See [Aggregations](./aggregations.html).

## Never log the key

```ts
console.log({ url, status: res.status }); // fine
console.log({ headers: init.headers }); // logs your API key
```

---

See also: [Structured Output](./llm-structured-output.html) · [LLM Strategy](./llm-strategy.html) · [Logging](./logging.html)
