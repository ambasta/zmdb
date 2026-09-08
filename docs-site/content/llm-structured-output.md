> **Install:** `yarn add @zmdb/ai@1.0.0-beta.1 @zmdb/schema-core@1.0.0-beta.1 @zmdb/aot-validator@1.0.0-beta.1`. `@zmdb/ai` owns provider documents; `@zmdb/validator` owns the boundary check. No
> provider client is installed unless the application chooses one.

Getting a model to return data your database accepts is two problems: constraining what it produces, and checking what it actually produced. zmdb's schema object covers both, from one declaration.

## Constrain: a tool from a schema

```ts {"mode":"illustrative","id":"example-001","reason":"The application supplies the local modules ./schema.js; this fence is an excerpt of that project."}
import { toolFor } from '@zmdb/ai';
import type { User } from './schema.js';

const tool = toolFor<User>('anthropic', 'save_user', {
  description: 'Save a user extracted from the message',
});
```

That produces Anthropic's `{ name, description, input_schema }` shape directly. `Sensitive` columns are omitted, the validation constraints are retained, and the provider document is computed from the
declaration IR and inlined by the AOT transform. `toolFromSchema(name, schema, opts)` remains available when a provider-neutral `{ name, description, parameters }` record is what the caller needs.

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies client, tool, transcript; this excerpt does not repeat those declarations."}
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

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies User, repo, res; this excerpt does not repeat those declarations."}
import { assert } from '@zmdb/validator';
import { type CreateDTO } from '@zmdb/schema';

const block = res.content.find(c => c.type === 'tool_use');
const dto = assert<CreateDTO<User>>(block?.input);
await repo.create(dto);
```

Do not skip this. Tool-use schemas are a strong hint, not an enforced contract — a model can omit an optional-looking required field, return `"42"` where you asked for a number, or hallucinate a key.
The `assert` is the difference between a validation error naming the field and a database error naming a constraint, or worse, a row with `NaN` in it.

## Recovering from malformed JSON

When the model returns text rather than a tool call — a smaller model, a streaming response cut short, a preamble before the JSON — `lenientParse` handles the common damage:

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies CreateDTO, User, res; this excerpt does not repeat those declarations."}
import { lenientParse } from '@zmdb/ai';

const result = lenientParse<CreateDTO<User>>(res.text);
```

It strips a leading or trailing markdown code fence and calls `JSON.parse`. That is the whole of it: leading prose, trailing commas and single quotes all come back as
`{ success: false, errors: [...] }` carrying the `JSON.parse` message. It does not make the _content_ correct either, so validate afterwards:

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies CreateDTO, User, assert, lenientParse, res; this excerpt does not repeat those declarations."}
const result = lenientParse(res.text);
if (!result.success) throw new Error(result.errors?.join('; ') ?? 'unparseable model output');
const dto = assert<CreateDTO<User>>(result.data);
```

Prefer tool use over parsing prose when the API offers it. `lenientParse` is for when it does not.

## The whole extraction path

```ts {"mode":"illustrative","id":"example-006","reason":"The surrounding example supplies CreateDTO, User, assert, client, repo, toolFor; this excerpt does not repeat those declarations."}
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

```ts {"mode":"illustrative","id":"example-007","reason":"The surrounding example supplies assert, lenientParse, res; this excerpt does not repeat those declarations."}
interface Extraction {
  sentiment: 'positive' | 'neutral' | 'negative';
  topics: string[];
  confidence: number;
}

const parsed = lenientParse(res.text);
const out = assert<Extraction>(parsed.success ? parsed.data : undefined);
```

`sentiment` being a union means a model that returns `"mixed"` fails validation rather than flowing into your analytics as an unexpected value.

## Retrying on a validation failure

The error names the field, which makes it useful to feed back:

```ts {"mode":"illustrative","id":"example-008","reason":"The surrounding example supplies CreateDTO, User, call, messages, validate; this excerpt does not repeat those declarations."}
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
