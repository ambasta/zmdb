The `validate` function performs non-throwing validation, returning a structured result object that indicates success or failure. Unlike `assert`, it never throws — making it ideal for scenarios where you need to handle validation failures gracefully without disrupting control flow.

> [!NOTE]
> The runtime validator uses a TypeDescriptor structure to describe expected types. In production with the AOT transformer enabled, the descriptor is inlined at build time, eliminating the runtime overhead entirely.

## Basic Usage

The `validate` function accepts an input value and a TypeDescriptor, returning `{ success: boolean; data?: T; errors?: ValidationIssue[] }`.

```ts
import { validate } from '@zmdb/aot-validator/utilities';
import { tags } from '@zmdb/aot-validator';

const descriptor = {
  kind: 'object',
  fields: {
    email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
    age: { kind: 'number', minimum: 18 },
  },
};

const result = validate({ email: 'user@example.com', age: 25 }, descriptor);
// { success: true, data: { email: 'user@example.com', age: 25 } }

const invalid = validate({ email: 'invalid', age: 15 }, descriptor);
// { success: false, errors: [{ path: 'input.email', expected: 'pattern ...', value: 'invalid', message: 'expected pattern ...' }, ...] }
```

## Error Structure

Each validation issue contains precise location information:

```ts
interface ValidationIssue {
  readonly path: string; // e.g., 'input.items[2].name'
  readonly expected: string; // e.g., 'string', 'maxLength 50'
  readonly value: unknown; // the actual invalid value
  readonly message: string; // human-readable message
}
```

When validating nested structures, the path reflects the exact location:

```ts
const deepDescriptor = {
  kind: 'object',
  fields: {
    users: {
      kind: 'array',
      of: {
        kind: 'object',
        fields: {
          name: { kind: 'string', maxLength: 10 },
        },
      },
    },
  },
};

validate({ users: [{ name: 'LongNameTooLong' }] }, deepDescriptor);
// Error path: 'input.users[0].name' — shows array index + field
```

## Using with Schema Definitions

Combine validation with schema-defined descriptors for type-safe validation:

```ts
import { defineSchema, text, integer } from '@zmdb/schema-core';
import { validate } from '@zmdb/aot-validator/utilities';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+$')),
  age: integer().validate(tags.Minimum(18)),
});

// Extract descriptor from schema for validation
const descriptor = /* derived from schema */ {
  kind: 'object',
  fields: {
    email: { kind: 'string', pattern: '^[^@]+@[^@]+$' },
    age: { kind: 'number', minimum: 18 },
  },
};

const result = validate({ email: 'test@test.com', age: 17 }, descriptor);
// result.success === false, result.errors?.[0].path === 'input.age'
```

> [!TIP]
> In AOT mode, the descriptor is inlined at build time — the validate call becomes a straight-line type check with zero runtime descriptor allocation.

## Integration with Repository

The repository layer automatically validates inputs using the same validation system:

```ts
class UserRepository extends BaseRepository<typeof UserSchema> {
  async create(data: CreateDTO<typeof UserSchema>) {
    // validate() is called internally before INSERT
    return super.create(data);
  }
}

const repo = new UserRepository(driver);
await repo.create({ email: 'new@example.com', age: 25 }); // OK
await repo.create({ email: 'bad', age: 10 }); // throws validation error
```

- [assert](./validators-assert.html) — throwing variant
- [tags](./validators-tags.html) — validation rules (Minimum, Pattern, etc.)
- [unions-refinements](./unions-refinements.html) — union types and custom refinements
