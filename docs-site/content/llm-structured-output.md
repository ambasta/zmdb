> **Install:** `npm add @zmdb/ai@alpha @zmdb/schema-core@alpha @zmdb/aot-validator@alpha`. `@zmdb/ai` owns provider documents; `@zmdb/aot-validator` owns the boundary check. No provider client is
> installed unless the application chooses one.

Getting a model to return data your database accepts is two problems: constraining what it produces, and checking what it actually produced. zmdb's schema object covers both, from one declaration.

## Constrain: a tool from a schema

```ts
import { toolFor } from '@zmdb/ai';
import type { User } from './schema.js';

const tool = toolFor<User>('anthropic', 'save_user', {
  description: 'Save a user extracted from the message',
});
```

That produces Anthropic's `{ name, description, input_schema }` shape directly. `Sensitive` columns are omitted, the validation constraints are retained, and the provider document is computed from the
declaration IR and inlined by the AOT transform. `toolFromSchema(name, schema, opts)` remains available when a provider-neutral `{ name, description, parameters }` record is what the caller needs.

```ts
const res = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 1024,
  tools: [tool],
  tool_choice: { type: 'tool', name: 'save_user' },
  messages: [{ role: 'user', content: transcript }],
});
```

## Check: validate before writing

A schema-constrained model output is _usually_ right, which is not the same as right:

```ts
import { assert } from '@zmdb/aot-validator/utilities';
import type { CreateDTO } from '@zmdb/schema-core';

const block = res.content.find(c => c.type === 'tool_use');
const dto = assert<CreateDTO<User>>(block?.input);
await repo.create(dto);
```

Do not skip this. Tool-use schemas are a strong hint, not an enforced contract — a model can omit an optional-looking required field, return `"42"` where you asked for a number, or hallucinate a key.
The `assert` is the difference between a validation error naming the field and a database error naming a constraint, or worse, a row with `NaN` in it.

## Recovering from malformed JSON

When the model returns text rather than a tool call — a smaller model, a streaming response cut short, a preamble before the JSON — `lenientParse` handles the common damage:

```ts
import { lenientParse } from '@zmdb/ai';
import { assert } from '@zmdb/aot-validator/utilities';

const result = lenientParse(res.text, v => assert<CreateDTO<User>>(v));
```

It tolerates fenced code blocks, leading prose, trailing commas and single quotes — the specific ways model output deviates from strict JSON. An explicit coercion callback is required for typed parsing (`lenientParse<T>`) so caller-side validation catches shape mismatches before they reach downstream logic.

> [!NOTE]
> `assert<T>()` relies on the `@zmdb/aot-validator/unplugin` build transform to inject validator descriptors. In projects without the AOT plugin enabled, `assert<T>()` throws an uninitialized descriptor error that `lenientParse` catches as a validation failure. If your build pipeline does not include the AOT plugin, pass a hand-written narrowing function to `coerce` instead (or see [AOT Validator setup](./validators-assert.html)).

Prefer tool use over parsing prose when the API offers it. `lenientParse` is for when it does not.

## The whole extraction path

```ts
async function extractUser(transcript: string) {
  const res = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 1024,
    tools: [toolFor<User>('anthropic', 'save_user', { description: 'Save a user' })],
    tool_choice: { type: 'tool', name: 'save_user' },
    messages: [{ role: 'user', content: transcript }],
  });

  const block = res.content.find(c => c.type === 'tool_use');
  if (block === undefined) throw new Error('no tool call');

  const dto = assert<CreateDTO<User>>(block.input); // checked
  return repo.create(dto); // typed
}
```

One declaration drives the provider document and the boundary validator. Nothing here restates the shape of a user.

## Shapes that are not table rows

For an extraction target that is not a row, use the type directly — the validator does not need a schema object:

```ts
interface Extraction {
  sentiment: 'positive' | 'neutral' | 'negative';
  topics: string[];
  confidence: number;
}

const out = lenientParse(res.text, v => assert<Extraction>(v));
```

`sentiment` being a union means a model that returns `"mixed"` fails validation rather than flowing into your analytics as an unexpected value.

## Retrying on a validation failure

The error names the field, which makes it useful to feed back:

```ts
for (let i = 0; i < 3; i++) {
  const res = await call(messages);
  const result = validate<CreateDTO<User>>(res.input);
  if (result.success) return result.data;
  messages.push({ role: 'user', content: `That was invalid: ${JSON.stringify(result.errors)}. Try again.` });
}
throw new Error('model could not produce a valid result');
```

Use `validate` rather than `assert` here, because you want the errors as data. See [validate()](./validators-misc.html).

---

See also: [JSON Schema for LLMs](./llm-json-schema.html) · [assert()](./validators-assert.html) · [LLM Function Calling](./llm-http.html)
