The `parse` function provides safe JSON parsing with structured error handling. Unlike `JSON.parse()` which throws on invalid JSON, `parse` returns a result object that indicates success or failure with detailed error information.

> [!NOTE]
> The `parse` function is the first step in the deserialize pipeline — it handles JSON syntax validation. For full type validation, use `decode()` which combines parsing with descriptor validation.

## Basic Usage

```ts
import { parse } from '@zmdb/aot-validator/serialization';

const result = parse('{"name": "alice", "age": 30}');
// { success: true, data: { name: 'alice', age: 30 } }

const bad = parse('not valid json');
// { success: false, issues: [{ path: 'input', expected: 'valid JSON', value: 'not valid json', message: 'Unexpected token o in JSON at position 0' }] }
```

## Working with ParseResult

The `ParseResult<T>` type provides type-safe access to parsed data:

```ts
import { parse } from '@zmdb/aot-validator/serialization';

interface User {
  name: string;
  age: number;
}

const result = parse<User>('{"name": "bob", "age": 25}');

if (result.success) {
  // TypeScript knows result.data is User
  console.log(result.data.name);
} else {
  // Handle parse error
  console.error(result.issues[0]?.message);
}
```

## Error Handling

Parse errors include the original input and a helpful message:

```ts
const result = parse('{"incomplete":');
// result.issues[0] contains:
// {
//   path: 'input',
//   expected: 'valid JSON',
//   value: '{"incomplete":',
//   message: 'Unexpected end of JSON input'
// }
```

## Using decode for Parsing + Validation

The `decode` function combines parsing with type validation:

```ts
import { decode } from '@zmdb/aot-validator/serialization';

const descriptor = {
  kind: 'object',
  fields: {
    email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
    age: { kind: 'number', minimum: 18 },
  },
};

// Valid JSON + valid shape
const ok = decode('{"email": "test@example.com", "age": 25}', descriptor);
// { success: true, data: { email: 'test@example.com', age: 25 } }

// Valid JSON + invalid shape
const invalid = decode('{"email": "bad", "age": 15}', descriptor);
// { success: false, issues: [/* validation errors */] }

// Invalid JSON
const malformed = decode('not json', descriptor);
// { success: false, issues: [{ path: 'input', expected: 'valid JSON', ... }] }
```

> [!TIP]
> Use `decode` when you need to both parse JSON and validate its structure in one step. It's more efficient than calling `parse` then `validate` separately.

## Typed Decode

The `decode` function supports generic type parameters for full type safety:

```ts
import { decode } from '@zmdb/aot-validator/serialization';

interface Order {
  id: number;
  status: 'pending' | 'shipped' | 'delivered';
  total: number;
}

const descriptor = {
  kind: 'object',
  fields: {
    id: { kind: 'number' },
    status: { kind: 'enum', values: ['pending', 'shipped', 'delivered'] },
    total: { kind: 'number', minimum: 0 },
  },
};

const result = decode<Order>('{"id": 1, "status": "shipped", "total": 99.99}', descriptor);

if (result.success) {
  // result.data is typed as Order
  console.log(result.data.status);
}
```

## Integration with Repository

The repository layer uses these serialization functions when handling JSON columns:

```ts
import { defineSchema, json } from '@zmdb/schema-core';

const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  // JSON column for flexible payload
  payload: json().notNull(),
});

// When reading, payload is automatically parsed
// When writing, object is automatically stringified
```

- [json-stringify](./json-stringify.html) — serialization
- [json-schema](./json-schema.html) — JSON Schema generation
- [validators-validate](./validators-validate.html) — full validation
