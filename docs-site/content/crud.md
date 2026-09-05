Create, Read, Update, and Delete operations form the backbone of any data layer. zmdb's repository provides full CRUD semantics with automatic validation against your schema, ensuring that only well-typed data reaches the database.

## Create

Insert a new row. The payload is validated against `CreateDTO<S>` — auto-increment columns are rejected, and columns with defaults or nullable columns are optional.

```ts
const user = await users.create({
  email: 'alice@example.com',
  role: 'user', // optional, 'user' is the default
});
// user: Entity<UserSchema> — includes generated id, createdAt
```

**SQL emitted:**

```sql
INSERT INTO "users" ("email", "role") VALUES ($1, $2) RETURNING *
-- parameters: ['alice@example.com', 'user']
```

> [!IMPORTANT]
> If validation fails, **no SQL is executed**. The driver is never called with an invalid payload.

## Read

Fetch rows by ID, by arbitrary where clause, or all rows.

```ts
// By primary key — the fastest path
const user = await users.findById(1);
// user: Entity<UserSchema> | undefined

// By arbitrary columns
const admin = await users.findOne({ role: 'admin' });
// admin: Entity<UserSchema> | undefined

// All rows — use with caution on large tables
const allUsers = await users.findAll();
// allUsers: readonly Entity<UserSchema>[]
```

## Update

Partial update. The payload is an `UpdatePatch<S>` — all fields are optional;
ordinary values must match `UpdateDTO<S>`, and branded expression operands must
match the same column type.

```ts
import { inc } from 'zmdb';

const updated = await users.update(1, { role: 'admin' });
// updated: Entity<UserSchema> | undefined (undefined if id not found)

const post = await posts.increment(1, 'views');
const affected = await posts.updateMany({ authorId: 7 }, { views: inc(1) });
```

**SQL emitted:**

```sql
UPDATE "users" SET "role" = $1 WHERE "id" = $2 RETURNING *
-- parameters: ['admin', 1]
```

The Postgres family, SQLite and SQL Server expression-bearing keyed updates
return the computed row; `updateMany` returns the number of rows returned. The
MySQL family omits unsupported `RETURNING` for expression-bearing keyed updates
and every `updateMany`, so those calls resolve to `undefined` without issuing a
follow-up `SELECT`.

> [!WARNING]
> Unlike ORM proxies, zmdb rows are inert. Mutating a fetched object **does not persist**:

```ts
const user = await users.findById(1);
user.role = 'admin'; // ❌ This does NOTHING

await users.update(1, { role: 'admin' }); // ✅ Explicit update required
```

## Delete

Remove a row by ID. Returns `true` if a row was deleted, `false` if the ID didn't exist.
On a table declared with `SoftDelete<'deletedAt'>`, this is a guarded `UPDATE`
that records a Node `Date`; use `hardDelete(id)` for a deliberate physical delete
and `restore(id)` to clear the managed timestamp.

```ts
const deleted = await users.delete(1);
// deleted: boolean
```

**SQL emitted:**

```sql
DELETE FROM "users" WHERE "id" = $1 RETURNING "id"
-- parameters: [1]
```

For a soft-deletable table the emitted statement is instead:

```sql
UPDATE "users" SET "deletedAt" = $1
WHERE "id" = $2 AND "deletedAt" IS NULL
RETURNING "id"
```

## Validation Semantics

`create`, `update`, `updateMany`, and the update object passed to `upsert` run
validation before compiling SQL:

| Operation | Auto-increment fields   | Fields with defaults | Required fields    |
| --------- | ----------------------- | -------------------- | ------------------ |
| create    | **Rejected** (always)   | Optional             | Must be present    |
| update    | Ignored (cannot update) | Optional             | N/A (all optional) |

For an expression-valued update, only that key is removed from the ordinary
row-value check; its operand is validated against the column's app type, and
every ordinary sibling remains strict.

```ts
// This throws — id is auto-increment
await users.create({ id: 999, email: 'test@example.com' });

// This throws — missing required field
await users.create({}); // email is required
```

> [!TIP]
> The validation error includes a structured `issues` array with paths and messages, useful for API error responses.

## Cross-links

- [Repository](./repository.html) — full repository API
- [Read DTOs](./read-dtos.html) — typed query helpers
- [Inert Rows](./inert-rows.html) — why rows don't auto-persist
- [Validation](./validators-is.html) — AOT validation details
