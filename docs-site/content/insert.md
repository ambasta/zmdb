Insert rows with the query builder, or (preferably) through a repository's
`create()`, which validates the payload against `CreateDTO<S>` **before** any SQL
is emitted.

## Basic insert

```ts
qc.insertInto('users').values({ email: 'a@b.com', role: 'user' }).compile();
```

```sql
INSERT INTO "users" ("email", "role") VALUES ($1, $2)
-- parameters: ['a@b.com', 'user']
```

## Returning the inserted row

```ts
qc.insertInto('users').values({ email: 'a@b.com' }).returning(['id', 'createdAt']).compile();
```

```sql
INSERT INTO "users" ("email") VALUES ($1) RETURNING "id", "createdAt"
```

## Through the repository (validated)

```ts
const user = await users.create({ email: 'a@b.com' }); // role defaults applied
// returns Entity<User>
```

> [!IMPORTANT]
> If the payload is invalid, `create` throws a structured `ValidationError` and
> **no SQL runs** — the driver is never called. Auto-increment PKs and defaulted
> columns may be omitted from the payload (that is what `CreateDTO` encodes).

See also [batch inserts](./batch.html) for multiple statements in one round-trip.
