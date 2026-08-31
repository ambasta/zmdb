zmdb can generate tool definitions from your schema for LLM function-calling. The `toolFromSchema` function converts your schema into a JSON Schema that describes the tool's parameters, enabling LLMs to call your repository methods with type-safe inputs.

## Generating Tool Specs

```ts
import { toolFromSchema, type ToolSpec } from '@zmdb/schema-core/llm';
import { toJsonSchema } from '@zmdb/schema-core';

const spec: ToolSpec = toolFromSchema('createUser', UserSchema, {
  description: 'Create a new user in the system',
});

// spec.name => 'createUser'
// spec.description => 'Create a new user in the system'
// spec.parameters => JsonSchemaObject (OpenAPI-compatible)
```

The generated spec follows the OpenAPI 3.0 JSON Schema format:

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "email": { "type": "string", "format": "email" }
  },
  "required": ["name", "email"]
}
```

## Parsing LLM Responses

When an LLM returns a function call, use `lenientParse` to extract and coerce the arguments:

```ts
import { lenientParse, type ParseResult } from '@zmdb/schema-core/llm';
import { assert } from '@zmdb/aot-validator/utilities';

const llmResponse = `{"name": "Alice", "email": "alice@example.com"}`;

const result: ParseResult<UserInput> = lenientParse(llmResponse);
// result.success => true
// result.data => { name: 'Alice', email: 'alice@example.com' }
```

The parser handles common LLM quirks:

````ts
// Markdown code fences around the JSON are stripped before parsing.
// e.g. an LLM returns a fenced block; lenientParse handles it:
const fenced = '```json\n{"name":"Bob"}\n```';
lenientParse(fenced);
// => { success: true, data: { name: 'Bob' } }
````

## Full Flow

```ts
import { BaseRepository } from '@zmdb/repository';
import { toolFromSchema, lenientParse } from '@zmdb/schema-core/llm';

// 1. Generate tool spec from your repository's schema
const toolSpec = toolFromSchema('createUser', UserSchema);

// 2. Send to LLM (your HTTP client or provider SDK)
// const response = await openai.chat.completions.create({
//   tools: [{ type: 'function', function: toolSpec }]
// });

// 3. Parse the function call
const parseResult = lenientParse<UserInput>(llmText);
if (!parseResult.success) {
  throw new Error(parseResult.errors?.join(', '));
}

// 4. Execute against your repository
const created = await userRepo.create(parseResult.data);
```

> [!IMPORTANT]
> Always validate parsed input before passing to the repository. `lenientParse` extracts JSON — it doesn't validate against your schema. Use `@zmdb/aot-validator` for that.

## Coercion

The `coerce` option lets you transform parsed data:

```ts
interface UserInput {
  id?: number;
  name: string;
}

const result = lenientParse<UserInput>('{"name": "Charlie"}', v => {
  const input = assert<UserInput>(v); // generated validator, not a cast
  return { ...input, name: input.name.toUpperCase() };
});
// result.data => { name: 'CHARLIE' }
```

`coerce` receives `unknown`, which is the honest type for model output. Narrowing it with `assert<T>` rather than a cast is what makes the `<UserInput>` type argument true instead of aspirational — and because `lenientParse` catches whatever `coerce` throws, the `AssertError` comes back as `{ success: false, errors: [...] }` rather than an exception.

> [!WARNING]
> With **no** `coerce`, `lenientParse<T>` does not validate at all — `T` is your claim about the model's output, exactly as with `JSON.parse`. A model that returns `{"name": 42}` gives you `success: true` and a `number` where your types promise a `string`. Always pass a `coerce` that asserts, or run the validator on the result.

> [!TIP]
> Use a schema validator in your `handle` function to catch malformed LLM output before it reaches the database.

---

See also: [Schema Core](./schema-declaration.html) · [Validation](./validators-is.html) · [Repository](./repository.html)
