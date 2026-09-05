The repository pattern provides a typed, validated data access layer backed by your schema definition. zmdb's `BaseRepository` delivers CRUD, upsert, expression-valued updates, lifecycle hooks,
validation interception, and transaction support — all without proxies or an identity map.

## Defining a Repository

A repository is a minimal subclass that binds to your schema. The entire required body is one line.

```ts
import { BaseRepository } from '@zmdb/repository';
import { UserSchema } from './schema';

class UserRepository extends BaseRepository<User> {
  static readonly schema = UserSchema;
}
```

> [!IMPORTANT] The `static readonly schema = UserSchema` line is required. It binds the schema to the class so the repository can derive types and validate payloads.

## Injecting a Driver

The repository never opens database connections itself. You inject a `Driver` that executes compiled queries.

```ts
const driver: Driver = {
  async execute(query) {
    // query.text: SQL string
    // query.parameters: $1, $2, ... placeholders
    const result = await pg.query(query.text, query.parameters);
    return result.rows;
  },
};

const users = new UserRepository(driver, 'postgres');
```

## CRUD Operations

All write operations validate payloads against the schema before executing SQL. If validation fails, **no SQL runs**.

```ts
// CREATE — validates against CreateDTO<UserSchema>
// { email: string; role?: 'admin'|'user'|'guest' }
const created = await users.create({ email: 'a@b.com', role: 'user' });
// created: Entity<UserSchema>

// READ — returns plain objects
const byId = await users.findById(created.id);
// byId: Entity<UserSchema> | undefined

const byEmail = await users.findOne({ email: 'a@b.com' });
// byEmail: Entity<UserSchema> | undefined

const all = await users.findAll();
// all: readonly Entity<UserSchema>[]

// UPDATE — UpdatePatch<User>: strict values or branded expressions
const updated = await users.update(created.id, { role: 'admin' });
// updated: Entity<UserSchema> | undefined

// UPDATE MANY — one validated patch over a typed WhereDTO
const affected = await users.updateMany({ role: 'guest' }, { role: 'user' });
// affected: number | undefined (undefined on MySQL)

// DELETE — returns boolean indicating if a row was deleted
const deleted = await users.delete(created.id);
// deleted: boolean

// DELETE MANY — physical delete, or a soft update on SoftDelete tables
const deletedCount = await users.deleteMany({ role: 'guest' });

// Explicit physical delete and soft-delete restoration
await users.hardDelete(created.id);
await users.restore(created.id);
```

For a numeric column, `repo.increment(id, column, by?)` is the typed atomic shortcut. The column union is derived from updatable `integer`, `bigint`, and `numeric` declarations, and the operand
preserves number versus bigint.

## Typed filtering & pagination

Beyond `findById`/`findOne`, the repository exposes typed `find` and `list` methods driven by the schema-derived [WhereDTO](./filters.html) and [pagination](./pagination.html) DTOs — no untyped
`Record` filters.

```ts
// find(where: WhereDTO<S>) → readonly Entity<S>[]
const admins = await users.find({ role: 'admin', age: { gte: 18 } });

// findOne(where) adds LIMIT 1
const one = await users.findOne({ email: 'a@b.com' });

// list(query) → ListResult<Entity<S>>  { items, hasMore, total?, cursor? }
const page = await users.list({
  where: { role: 'admin' },
  orderBy: [{ column: 'createdAt', dir: 'desc' }],
  page: { limit: 20 },
});
// page.items: readonly Entity<S>[]  ·  page.hasMore: boolean
```

```sql
SELECT * FROM "users" WHERE "role" = $1 AND "age" >= $2
SELECT * FROM "users" WHERE "email" = $1 LIMIT 1
SELECT * FROM "users" WHERE "role" = $1 ORDER BY "createdAt" DESC LIMIT 21
```

> [!NOTE] `list` fetches `limit + 1` rows and trims, so `hasMore` is computed without a separate `COUNT`. The operator set (`eq/ne/lt/lte/gt/gte/in/nin/like/ilike/isNull/notNull`) and result shape
> come from [Filters](./filters.html) and the [Read/Query DTOs](./read-dtos.html).

## Lifecycle Hooks

Hooks fire synchronously around their corresponding repository operations. Override them in your subclass.

```ts
class UserRepository extends BaseRepository<User> {
  static readonly schema = UserSchema;

  protected preInsert(row: Record<string, unknown>): void {
    console.log('about to insert', row);
  }

  protected postInsert(row: Record<string, unknown>): void {
    console.log('inserted', row);
    // Trigger welcome email, etc.
  }

  protected preUpdate(patch: Record<string, unknown>): void {
    // Validated, undefined-stripped, schema-ordered patch.
    // Branded expression objects are preserved by identity.
    console.log('about to update', patch);
  }

  protected preDelete(id: unknown): void {
    // Runs once for both soft delete and hardDelete.
  }

  protected postSelect(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
    // Filter sensitive fields, enrich data
    return rows.map(r => ({ ...r, viewedAt: new Date() }));
  }
}
```

`preUpdate` runs for `update`, `updateMany`, and `increment`. `upsert` runs `preInsert` for its create payload; its conflict-update object does not also run `preUpdate`. A soft delete emits SQL
`UPDATE`, but follows delete semantics: `preDelete` runs and `preUpdate` does not.

## Transactions

Bind a repository to a transaction for atomic multi-operation flows.

```ts
const tx = await pool.connect();
await tx.query('BEGIN');

try {
  const txRepo = users.withTransaction({ execute: tx.query.bind(tx) });
  const user = await txRepo.create({ email: 'a@b.com' });
  const order = await ordersRepo.withTransaction({ execute: tx.query.bind(tx) }).create({ userId: user.id, total: 100 });

  await tx.query('COMMIT');
} catch (e) {
  await tx.query('ROLLBACK');
  throw e;
} finally {
  tx.release();
}
```

> [!NOTE] `withTransaction` returns a shallow clone — the original repository's driver is unchanged.

## Cross-links

- [CRUD](./crud.html) — detailed create/read/update/delete semantics
- [Increment & Decrement](./guide-increment-decrement.html) — atomic expression writes
- [Read DTOs](./read-dtos.html) — typed filtering, ordering, pagination
- [Transactions](./transactions.html) — transaction management details
- [Validation](./validators-is.html) — AOT-validated payloads
