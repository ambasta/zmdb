zmdb is unusually easy to test, for two structural reasons: `compile()` produces SQL without a connection, and `Driver` has one required method. Most of what you would need a database for, you do not.

## Test the SQL, with no database

```ts
import { expect, it } from 'vitest';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { postgres } from '@zmdb/postgres';

it('filters by email', () => {
  const q = createQueryCompiler(postgres).selectFrom('users').where('email', '=', 'a@b.c').compile();
  expect(q).toEqual({ text: 'SELECT * FROM "users" WHERE "email" = $1', parameters: ['a@b.c'] });
});
```

Microseconds, no setup. Assert on the whole `CompiledQuery` rather than a substring — a `text` match will pass while the parameters are wrong.

## Fake the driver

```ts
import type { Driver } from '@zmdb/repository';
import { postgres } from '@zmdb/postgres';

const driver: Driver = { dialect: postgres, execute: async () => [{ id: 1, email: 'a@b.c', active: true }] };
const repo = defineRepository(users, driver);

it('finds a user', async () => {
  expect(await repo.findById(1)).toEqual({ id: 1, email: 'a@b.c', active: true });
});
```

## Assert on the queries issued

This is the test that catches N+1s, and it is worth writing for any hot path:

```ts
function recording(inner: Driver) {
  const seen: CompiledQuery[] = [];
  return {
    driver: {
      ...inner,
      execute: (q, options) => (seen.push(q), inner.execute(q, options)),
    } satisfies Driver,
    seen,
  };
}

it('populate issues two queries, not one per row', async () => {
  const { driver, seen } = recording(realDriver);
  await defineRepository(users, driver, { relations }).findAll({ populate: ['posts'] });
  expect(seen).toHaveLength(2);
});
```

A regression here is invisible in a functional test — the results stay correct, the query count quietly triples.

## A real database, in memory

`node:sqlite` is a built-in, so this needs no dependency:

```ts
import { DatabaseSync } from 'node:sqlite';
import { diff, snapshot } from 'zmdb/migrations';
import { sqlite } from 'zmdb/sqlite';

export function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const op of diff({ tables: {} }, snapshot(allSchemas), { dialect: sqlite })) {
    db.exec(sqlite.migrations.emitUp(op));
  }
  return db;
}

let db: DatabaseSync;
beforeEach(() => {
  db = freshDb();
});
```

The schema comes from your actual schema objects, so it cannot drift from a fixture. Sub-millisecond, isolated per test.

> [!WARNING] Testing on SQLite while deploying on Postgres leaves `ILIKE`, `RETURNING`, `ON CONFLICT`, JSON operators, transactional DDL and case sensitivity untested. Use
> [PGlite](./connect-pglite.html) for tests that touch those, and a real Postgres for the integration suite.

## Fixtures from the schema

```ts
import { seedRows } from '@zmdb/repository/seeding';

const [row] = seedRows(users, { count: 1, seed: 1 });
if (row === undefined) throw new Error('seedRows returned nothing');
await repo.create(row); // already a CreateDTO — no id to strip
```

Adding a column does not break every test that built a row by hand. Use a distinct seed per test so one test's data cannot make another pass. See [Seed Functions](./seed-functions.html).

## HTTP handlers

```ts
import { bodyText } from '@zmdb/web';
import { createTestApp } from '@zmdb/web/testing';

const app = createTestApp(AppModule, {
  overrides: [{ token: DRIVER, useValue: fakeDriver }],
});
await app.init();

it('GET /users', async () => {
  const res = await app.request({ method: 'GET', path: '/users', headers: {} });
  expect(res.status).toBe(200);
  expect(JSON.parse(await bodyText(res))).toHaveLength(1);
});
```

No port, no server, no `supertest`. `app.get(token)` reaches a provider if you need to assert on it directly. See [Testing Applications](./web-testing.html).

## The one test every project needs

If the transformer is not running, `is<T>()` and `assert<T>()` [silently accept everything](./gotchas.html). That is a validation layer that reports success and checks nothing, and it fails open:

```ts
it('the AOT transformer is running', () => {
  expect(is<{ id: number }>({ id: 'not a number' })).toBe(false);
});
```

Put it in its own file, at the top of the suite. See [AOT Setup](./aot-setup.html).

## Type-level tests

Behaviour that only exists in the type system needs a type-level test, in a `*.type-test.ts` file:

```ts
import type { Expect, Equal } from './type-utils.js';

type _1 = Expect<Equal<CreateDTO<User>, { email: string; active?: boolean }>>;
```

These fail at `tsc`, not at runtime, which is where the guarantee lives. This is how the project's own DTO derivation is tested.

## Migrations

```ts
it('migrations round-trip', async () => {
  await runCli('up', conn, migrations);
  await runCli('down', conn, migrations);
  await runCli('up', conn, migrations);
});
```

Catches the two common defects: a `down` that does not undo, and an `up` that is not re-runnable after one.

---

See also: [Testing Applications](./web-testing.html) · [AOT Setup](./aot-setup.html) · [PGlite](./connect-pglite.html)
