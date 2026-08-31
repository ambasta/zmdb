The `stringify` function serializes JavaScript values to JSON strings. It wraps `JSON.stringify` with consistent error handling and explicit bigint rejection — the AOT transformer will eventually emit fast concatenation for known shapes.

> [!IMPORTANT]
> Unlike `JSON.stringify`, `stringify` explicitly throws on bigint values. This is intentional — bigint serialization is database-dependent and should be handled explicitly by the caller.

## Basic Usage

```ts
import { stringify } from '@zmdb/aot-validator/serialization';

const json = stringify({ name: 'alice', age: 30, active: true });
// '{"name":"alice","age":30,"active":true}'

const arr = stringify([1, 2, 3]);
// '[1,2,3]'

const nested = stringify({ user: { email: 'a@b.com' } });
// '{"user":{"email":"a@b.com"}}'
```

## Working with Complex Types

```ts
import { stringify } from '@zmdb/aot-validator/serialization';

// Arrays of objects
const users = stringify([
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
]);
// '[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]'

// Null and undefined handling (like JSON.stringify)
stringify(null); // 'null'
stringify(undefined); // undefined (returns JSON.stringify result)

// Nested arrays
const matrix = stringify([
  [1, 2],
  [3, 4],
]);
// '[[1,2],[3,4]]'
```

## Bigint Handling

`stringify` throws a descriptive error for bigint values:

```ts
import { stringify } from '@zmdb/aot-validator/serialization';

try {
  stringify({ id: 123n });
} catch (e) {
  // TypeError: Do not know how to serialize a BigInt
}
```

> [!TIP]
> For PostgreSQL, use `toString()` on bigints before storing, or cast to `text` in your schema. The schema-core package provides the `bigint` column type for this purpose.

## Assert Stringify

The `assertStringify` function validates before serializing, throwing on invalid input:

```ts
import { assertStringify } from '@zmdb/aot-validator/serialization';

const descriptor = {
  kind: 'object',
  fields: {
    email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
    age: { kind: 'number', minimum: 18 },
  },
};

// Valid — returns JSON string
const json = assertStringify({ email: 'test@test.com', age: 25 }, descriptor);
// '{"email":"test@test.com","age":25}'

// Invalid — throws AssertError
try {
  assertStringify({ email: 'invalid', age: 15 }, descriptor);
} catch (e) {
  // AssertError with validation issues
}
```

## Comparison with JSON.stringify

| Feature             | JSON.stringify             | stringify                                   |
| ------------------- | -------------------------- | ------------------------------------------- |
| bigint              | Serializes to empty object | Throws TypeError                            |
| Error objects       | Converts to `{}`           | Returns `'{}'` (standard JSON)              |
| Circular references | Throws                     | Throws (same)                               |
| Custom replacer     | Supported                  | Not supported (use JSON.stringify directly) |

## AOT Inlining

In AOT mode, `stringify` calls on known shapes become inline concatenation:

```ts
// Authored:
const json = stringify({ name: user.name, age: user.age });

// AOT output (for known object shape):
const json = '{"name":' + JSON.stringify(user.name) + ',"age":' + JSON.stringify(user.age) + '}';
```

This eliminates function call overhead for hot paths.

- [json-parse](./json-parse.html) — deserialization
- [json-schema](./json-schema.html) — JSON Schema generation
- [openapi](./openapi.html) — OpenAPI spec generation
