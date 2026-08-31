Schema declaration is the foundation of zmdb. You define your table structure once using column builders and modifiers, and zmdb derives types for Entity, CreateDTO, and UpdateDTO automatically.

> [!IMPORTANT]
> zmdb uses a define-once approach. All type derivation happens at compile time from the schema metadata.

## Defining a Basic Schema

Use `defineSchema` with column definitions. Each column uses type-safe builders.

```ts
import { defineSchema, serial, text, timestamp } from '@zmdb/schema-core';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate({ kind: 'pattern', value: '^[^@]+@[^@]+$', message: 'Invalid email' }),
  name: text().nullable(),
  role: text().notNull().defaultTo('user'),
  created_at: timestamp().notNull(),
});
```

> [!TIP]
> The schema object is frozen — you cannot modify it after creation. This ensures type safety.

## Column Builders

zmdb provides builders for all common SQL types:

```ts
import { serial, integer, bigint, numeric, text, varchar, boolean, timestamp, json, jsonEnum } from '@zmdb/schema-core';

const id = serial(); // Auto-increment
const count = integer(); // Regular integer
const bigId = bigint(); // Big integers
const price = numeric(10, 2); // Numeric with precision
const description = text(); // Text field
const code = varchar(50); // VARCHAR with length
const active = boolean(); // Boolean
const created = timestamp(); // Timestamp
const metadata = json(); // JSON column
const status = jsonEnum(['pending', 'active', 'completed']); // JSON enum
```

## Column Modifiers

Fluent methods change column properties:

```ts
import { text, notNull, unique, primaryKey, defaultTo, validate } from '@zmdb/schema-core';

const column = text()
  .notNull()
  .unique()
  .primaryKey()
  .defaultTo('value')
  .validate({ kind: 'pattern', value: '^[A-Z]+$', message: 'Must be uppercase' });
```

> [!NOTE]
> Function-style modifiers also work: `notNull(col)`, `nullable(col)`, `primaryKey(col)`, `unique(col)`, `defaultTo(col, value)`, `validate(col, rule)`.

## Derived Types

zmdb automatically derives types:

```ts
import { Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';

type User = Entity<typeof UserSchema>;
// { id: number; email: string; name: string | null; role: string; created_at: Date }

type CreateUser = CreateDTO<typeof UserSchema>;
// { email: string; name?: string | null; role?: string; created_at: Date }

type UpdateUser = UpdateDTO<typeof UserSchema>;
// Partial<CreateUser>
```

## Foreign Keys

Add references using the `references` modifier:

```ts
import { defineSchema, serial, text, integer, references } from '@zmdb/schema-core';

const PostSchema = defineSchema('posts', {
  id: serial().primaryKey(),
  title: text().notNull(),
  author_id: references(integer().notNull(), UserSchema, 'id'), // FK to users.id
});
```

> [!WARNING]
> The `references` modifier only adds metadata — it doesn't create a FK constraint. Use migration DDL to add the constraint.

## Schema Registry

Access defined schemas:

```ts
import { getRegisteredSchema, registeredSchemas } from '@zmdb/schema-core';

const userSchema = getRegisteredSchema('users');
const allSchemas = registeredSchemas();
```

## Working with the Schema

Use with the query compiler:

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');
const query = compiler.selectFrom(UserSchema.table).select(['id', 'email']).where('role', '=', 'admin').compile();
```

```sql
SELECT "id", "email" FROM "users" WHERE "role" = $1
-- parameters: ['admin']
```

## Related

- [Relations](./relations.html) — defining relationships
- [Indexes & Constraints](./indexes-constraints.html) — adding constraints
- [Repository](./repository.html) — using schemas with the repository
