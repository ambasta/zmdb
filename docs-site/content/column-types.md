`Sql<T>` names the SQL column type. It drives the DDL emitted by [migrations](./migrations.html), and it is the half of a column declaration that TypeScript cannot infer — `integer`, `bigint` and `numeric` are all `number` in TS, and `text` and `varchar` are both `string`.

## Type mapping

Each dialect renders the type it owns. The declaration stays abstract — it says `timestamp`, never `TIMESTAMPTZ` — and the DDL emitter is where that becomes a real type, because the three databases do not agree and a schema should not have to pick.

| `Sql<…>`    | Postgres      | MySQL         | SQLite    | TS type                    |
| ----------- | ------------- | ------------- | --------- | -------------------------- |
| `integer`   | `INTEGER`     | `INT`         | `INTEGER` | `number`                   |
| `bigint`    | `BIGINT`      | `BIGINT`      | `INTEGER` | `bigint`                   |
| `numeric`   | `NUMERIC`     | `DECIMAL`     | `NUMERIC` | `number`                   |
| `text`      | `TEXT`        | `TEXT`        | `TEXT`    | `string`                   |
| `varchar`   | `VARCHAR(n)`  | `VARCHAR(n)`  | `TEXT`    | `string`                   |
| `boolean`   | `BOOLEAN`     | `TINYINT(1)`  | `INTEGER` | `boolean`                  |
| `timestamp` | `TIMESTAMPTZ` | `DATETIME(3)` | `TEXT`    | `Date`                     |
| `json`      | `JSONB`       | `JSON`        | `TEXT`    | whatever shape you declare |
| `jsonEnum`  | `TEXT`        | `TEXT`        | `TEXT`    | a literal union            |

`serial` is the tenth, and it is the one you spell as a **tag** rather than an `Sql<…>` argument — `Sql<'serial'>` does not typecheck, because `Serial` already means it. It emits `SERIAL` / `INT AUTO_INCREMENT` / `INTEGER`, is `number` in TS, and is omitted from `CreateDTO` entirely.

```ts
interface Event extends Table<'events'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  kind: 'created' | 'updated' | 'deleted'; // → jsonEnum
  sequence: bigint & Sql<'bigint'>;
  amount: number & Sql<'numeric'> & Numeric<12, 2>;
  label: string & Sql<'varchar'> & Length<80>;
  body: string & Sql<'text'>;
  payload: { source: string; retries: number } & Sql<'json'>;
  live: boolean;
  at: Date & Sql<'timestamp'>;
}
```

Note what is _not_ written there. `live: boolean` needs no `Sql<'boolean'>` and `at: Date` needs no `Sql<'timestamp'>` — the mapping is forced, so stating it twice would only create something to disagree about. And there is no `jsonEnum` tag at all: `'created' | 'updated' | 'deleted'` is a literal union, which is how TypeScript says that, and the reflection reads the members off the type.

Four rows are worth a sentence:

- **`timestamp` is `TIMESTAMPTZ` in Postgres**, not `TIMESTAMP`. `TIMESTAMP` there means _without_ time zone: it keeps the wall clock and discards the offset, so a `Date` written from one zone reads back as a different instant in another. MySQL has no zone-aware type with a usable range — `TIMESTAMP` converts to the session zone and stops in 2038 — so `DATETIME(3)` holds UTC with the milliseconds a `Date` has.
- **`varchar` needs its length**, as `Length<N>`. `Length<255>` becomes `VARCHAR(255)` everywhere it can be; a `varchar` with no `Length` is unlimited in Postgres and a syntax error in MySQL, so it degrades to `TEXT` there rather than emitting DDL that cannot run. `Length<N>` also emits `maxLength: N` into the JSON Schema, which is one fact serving two outputs rather than two facts to keep aligned.
- **`bigint` is `bigint`, not `number`.** A `BIGINT` past 2^53 is not representable as a double, so the app type is the one that can hold it. See [bigint keys](./bigint-keys.html) for what that costs at the boundary.
- **SQLite has affinities, not types.** `INTEGER PRIMARY KEY` _is_ the rowid, which is what makes `Serial` auto-increment without an `AUTOINCREMENT` keyword.

## That is the whole set

Ten abstract types, closed. A type supplied by a database extension uses
`Ext<Extension, Name, Args>` instead, including `vector`, `geometry`, and
`citext`. Other storage types such as `uuid`, `date`, `time`, `interval`,
`inet`, `cidr`, and arrays still need a [custom type](./custom-types.html) or a
`json` column.

The union is small on purpose. Every back-end has to answer for every member: the DDL emitter needs a spelling in three dialects, the validator needs a check, the JSON Schema generator needs a keyword, the seeder needs a generator. Ten members means sixty answers, all of them written down and tested. A `SqlType` with forty members would mean most of those answers were guesses, and the guesses would be in whichever back-end nobody exercised.

## Constraining a column

The value's shape is the SQL type; everything else is a tag on the same property.

```ts
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<320> & Unique & Pattern<'^[^@]+@[^@]+\\.[^@]+$'>;
  role: ('admin' | 'user') & HasDefault;
  bio: (string & Sql<'text'>) | null;
  authorId: number & Sql<'integer'> & References<'users.id'>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}
```

`References<'users.id'>` is a string literal read as `table.column`, so there is no wrapping function and no schema value to import — the whole reason the old `references(integer().notNull(), UserSchema, 'id')` had to be a function was that it needed the target's value at hand. The [tag reference](./tags-reference.html) has the rest.

> [!NOTE]
> It is a string, and nothing cross-checks it: a typo in the table or column name reaches
> the IR unchallenged. It reaches generated migrations as a named foreign-key
> constraint; compose `OnDelete<…>` and `OnUpdate<…>` on the same column when
> the action is not `NO ACTION`. The tag also feeds relation-aware documents and
> the pull/diff tooling.

## How columns become DDL

A schema diffs into `CREATE TABLE` DDL through migrations:

```sql
-- postgres
CREATE TABLE "users" ("createdAt" TIMESTAMPTZ NOT NULL, "email" TEXT NOT NULL, "id" SERIAL PRIMARY KEY, "role" TEXT NOT NULL)
-- mysql
CREATE TABLE `users` (`createdAt` DATETIME(3) NOT NULL, `email` TEXT NOT NULL, `id` INT AUTO_INCREMENT PRIMARY KEY, `role` TEXT NOT NULL)
```

Columns come out sorted by name, because a snapshot has to be byte-stable to be diffable.

Two things the snapshot does not yet carry, and so the DDL does not either: `DEFAULT` clauses and `UNIQUE`/`CHECK` constraints. For defaults this is not only a gap in the snapshot — `HasDefault` says a column _has_ a default, not _which one_, because a default is a runtime value and no type holds one. Write the value in the migration, where the DDL is written anyway. Validation tags feed the JSON Schema, the OpenAPI document and the [seed generator](./seed-functions.html); enforce them at the HTTP boundary with [`assert`](./validators-assert.html), where a failure becomes a 400 rather than a partially-applied write.

> [!TIP]
> A column is required in `CreateDTO` unless something says otherwise. `HasDefault` makes it optional, `| null` makes it optional, and `Serial` removes it from the type entirely. See [Type derivation](./type-derivation.html).

For richer schema objects (indexes, generated columns, sequences), see [Indexes & constraints](./indexes-constraints.html) and [Generated columns](./generated-columns.html).
