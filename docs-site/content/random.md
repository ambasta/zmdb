The `random` function generates sample values that satisfy a TypeDescriptor by construction. This is invaluable for testing — you get valid test data without manually constructing fixtures, and the generated values respect all constraints (minimum values, patterns, enums, etc.).

> [!NOTE]
> The generated values are _valid_ according to the descriptor — `is(random(descriptor), descriptor) === true`. However, they are not _deterministic_ (except when seeding is added in a future version).

## Basic Usage

```ts
import { random, is } from '@zmdb/aot-validator/utilities';

const descriptor = {
  kind: 'object',
  fields: {
    name: { kind: 'string', maxLength: 20 },
    age: { kind: 'number', minimum: 18 },
    active: { kind: 'boolean' },
  },
};

const sample = random(descriptor);
// { name: 'sabc123', age: 42, active: true }

// Verify it's valid
is(sample, descriptor); // true
```

## Generating Primitive Values

```ts
import { random } from '@zmdb/aot-validator/utilities';

// String with maxLength
random({ kind: 'string', maxLength: 10 }); // 'sabc1234'

// Number with minimum
random({ kind: 'number', minimum: 100 }); // 150 (minimum + random offset)

// Boolean
random({ kind: 'boolean' }); // true or false

// Enum
random({ kind: 'enum', values: ['admin', 'user', 'guest'] }); // 'user'
```

## Generating Complex Structures

```ts
import { random } from '@zmdb/aot-validator/utilities';

// Array of objects
const users = random({
  kind: 'array',
  of: {
    kind: 'object',
    fields: {
      id: { kind: 'number', minimum: 1 },
      email: { kind: 'string' },
    },
  },
});
// [{ id: 5, email: 'sabc123@example.com' }, { id: 12, ... }, ...]

// Nested objects
const order = random({
  kind: 'object',
  fields: {
    id: { kind: 'number' },
    items: {
      kind: 'array',
      of: {
        kind: 'object',
        fields: {
          productId: { kind: 'number' },
          quantity: { kind: 'number', minimum: 1 },
        },
      },
    },
  },
});
```

> [!TIP]
> The array generator creates between 1-3 elements by default. This provides realistic array shapes for testing without extreme edge cases.

## Pattern Handling

For strings with patterns, the generator recognizes common patterns:

```ts
import { random } from '@zmdb/aot-validator/utilities';

// Email pattern — generates valid-looking email
random({ kind: 'string', pattern: '^[^@]+@[^@]+$' });
// 'user123@example.com'

// Other patterns — falls back to safe single character
random({ kind: 'string', pattern: '^[A-Z]{3}$' });
// 'x' (fallback for unknown patterns)
```

> [!WARNING]
> Complex patterns that aren't email-like fall back to a single character `'x'`. This ensures the generated value is always a string, even if it doesn't match the pattern perfectly.

## Using with Schema

Generate test data from schema definitions:

```ts
import { defineSchema, text, integer, serial } from '@zmdb/schema-core';

// Define your schema
const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  name: text().notNull().validate(tags.MaxLength(100)),
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+$')),
  age: integer().validate(tags.Minimum(0)),
});

// Generate a random user (manually constructing descriptor from schema info)
const sampleUser = random({
  kind: 'object',
  fields: {
    id: { kind: 'number' },
    name: { kind: 'string', maxLength: 100 },
    email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
    age: { kind: 'number', minimum: 0 },
  },
});
// { id: 42, name: 'sabc123', email: 'user456@example.com', age: 25 }
```

## Integration with Testing

Use `random` to generate fixtures in tests:

```ts
import { random, is, assertEquals } from '@zmdb/aot-validator/utilities';

describe('UserRepository', () => {
  const userDescriptor = {
    kind: 'object',
    fields: {
      email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
      name: { kind: 'string', maxLength: 50 },
      age: { kind: 'number', minimum: 18 },
    },
  };

  it('creates valid users', async () => {
    const input = random(userDescriptor);

    // Generated data is guaranteed valid
    is(input, userDescriptor); // true

    const created = await repo.create(input);

    // Verify round-trip
    assertEquals(created, userDescriptor);
  });

  it('rejects invalid input', async () => {
    const invalid = { email: 'not-email', name: 'x'.repeat(100), age: 15 };

    await expect(repo.create(invalid)).rejects.toThrow();
  });
});
```

## Generated Value Ranges

| Type      | Range/Behavior                                          |
| --------- | ------------------------------------------------------- |
| `number`  | `minimum` (or 0) + random(0-1000)                       |
| `string`  | `'s' + randomHex` or email-like if pattern contains `@` |
| `boolean` | 50/50 true/false                                        |
| `enum`    | Random selection from values array                      |
| `array`   | 1-3 elements, each recursively generated                |
| `object`  | All fields generated recursively                        |

> [!IMPORTANT]
> Generated values are _structurally valid_ but not _meaningful_ — a random email looks like an email but isn't a real address. Use for testing validation, not for seeding production data.

## Random for Fuzzing

Combine with property-based testing:

```ts
import { random, is, validate } from '@zmdb/aot-validator/utilities';

// Generate many random inputs
for (let i = 0; i < 1000; i++) {
  const input = random(complexDescriptor);

  // Should always pass validation
  const result = validate(input, complexDescriptor);
  if (!result.success) {
    console.error('Generated invalid input:', input, result.errors);
  }
}
```

- [validators-validate](./validators-validate.html) — validation
- [validators-assert](./validators-assert.html) — assertion
- [json-parse](./json-parse.html) — JSON parsing
