# SPEC — End-to-end DX: quickstart + wiring helper (frozen)

Epic #220. Removes the "assemble four packages + write a driver + subclass a repository" on-ramp. Delivers (1) a one-call wiring helper and (2) a runnable zero-dependency (`node:sqlite`) example that
doubles as an E2E spec.

## 1. Wiring helper (#223)

```ts
import { defineRepository } from '@zmdb/repository';

// No subclassing required — bind schema + driver in one call.
const users = defineRepository(UserSchema, sqliteDriver(db), { dialect: 'sqlite' });

await users.create({ email: 'a@b.com', age: 30 }); // typed CreateDTO<User>
const list = await users.list({ page: { limit: 20 } }); // typed ListResult<Entity<User>>
const withOrders = await users.findById(1, { populate: ['orders'] });
```

Frozen behaviour:

- `defineRepository(schema, driver, opts?)` returns a **fully typed repository instance** with the same surface as a `BaseRepository<T>` subclass (findById/findOne/find/list/create/update/delete +
  populate), without writing a class. It builds an anonymous subclass under the hood binding `static schema`.
- `dialect` is the only option. It used to take a `relations` map too, restating the target table, the foreign key and the cardinality that `orders?: Order[] & OneToMany<'orders', 'userId'>` on the
  declaration already carries — `populate` reads the declaration now, so there is nothing to keep in step.
- The class-based `BaseRepository` remains fully supported (helper is sugar).

## 2. Runnable example / E2E (#222)

A `node:sqlite` script (zero external deps) that:

1. defines a schema, 2. creates the table, 3. wires a repo via `defineRepository`

- `sqliteDriver`, 4. does typed create → findById → list → update → delete, and

5. populates a relation. Runs as a vitest spec (always, no external service) and is mirrored as an `examples/` file users can copy.

## Acceptance

- Type-level: `defineRepository(schemaOf<User>(), driver)` has `create` accepting `CreateDTO<User>` and `findById` returning `Entity<User> | undefined` — the declared type is inferred from the value's
  phantom, so neither is annotated.
- Runtime: the example E2E round-trips against in-memory `node:sqlite` and is green.
