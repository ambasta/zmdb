# Migrations & Schema Diffing — Frozen Spec (Issue #40)

> Status: **FROZEN** for TDD. Implementation (#41–#44) must satisfy this spec.
> Lives in `@zmdb/query-compiler` (reuses dialects). Targets: Node 26+, ESM, TS 7.

## 1. Snapshot format (deterministic)

`snapshot(schemas): SchemaSnapshot` — a plain JSON object with **stable key
ordering**. Serializing the same schema set twice yields identical bytes.

```ts
interface ColumnSnapshot {
  readonly name: string;
  /** Abstract — `'timestamp'`, never `'TIMESTAMPTZ'`. See §3, and §1.5 for the object form. */
  readonly type: string | ExtensionType;
  /** Exact server spelling on an introspected snapshot; ignored by diff. */
  readonly catalogType?: string;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  /** Present only for a `varchar`; omitted otherwise, so old snapshots still match. */
  readonly length?: number;
  /** A catalog default expression, verbatim. Recorded, never diffed — `../introspect/SPEC.md` §4. */
  readonly default?: string;
}

type IndexColumnSnapshot =
  | string
  | { readonly column: string; readonly opclass?: string }
  | { readonly expr: string; readonly opclass?: string };

interface IndexSnapshot {
  readonly name: string;
  readonly columns: readonly IndexColumnSnapshot[];
  readonly unique: boolean;
  readonly where?: string;
  readonly method?: 'btree' | 'hash' | 'gin' | 'gist' | 'brin' | 'ivfflat' | 'hnsw';
  readonly with?: Readonly<Record<string, number>>;
}

interface TableSnapshot {
  readonly name: string;
  readonly columns: readonly ColumnSnapshot[]; // sorted by name
  /** The ordered key. See §1.1. */
  readonly primaryKey: readonly string[];
  /** Non-primary indexes, sorted by name. See §1.7. */
  readonly indexes: readonly IndexSnapshot[];
}

interface SchemaSnapshot {
  readonly version: 1;
  readonly tables: readonly TableSnapshot[]; // sorted by name
  /** Declared extensions, sorted by name. See §1.5. */
  readonly extensions: readonly { readonly name: string; readonly schema?: string }[];
}
```

### 1.1 The key is on the table, not only on the columns (frozen)

`TableSnapshot` carries `primaryKey: readonly string[]`, in declaration order, alongside the
per-column `primaryKey` flag. The flag stays — `columnDdl` reads it — but it cannot be the
only record of the key, and this is a diff problem rather than an emit problem. Given only
flags, these two changes are indistinguishable:

```
key (a)      →  key (a, b)      b's flag goes false → true
key (a)      →  key (a) + b PK  … also b's flag going false → true
```

The first must produce a key change; the second is not expressible in SQL at all (a table has
one primary key). Worse, `(a, b)` → `(b, a)` changes the index the database builds and moves no
flag whatsoever, so a flag-only snapshot reports no change for it. Hence the list, and hence
`primaryKey` is **not** optional on `TableSnapshot`: an absent field would make "old snapshot,
key unknown" and "table with no key" the same value, and the diff would have to guess which.
A snapshot is `version: 1` and there is no compatibility promise across a version — the
migration for an existing snapshot is to re-run `snapshot`.

Column order within the list is preserved; the surrounding determinism rule (tables and
columns sorted by name) deliberately does not apply to it, because sorting it would destroy
the fact it exists to carry.

### 1.2 Key DDL, per dialect (frozen goldens)

A **single-column** key keeps the inline form it emits today. This is not a stylistic
preference: `INTEGER PRIMARY KEY` is SQLite's rowid alias, which is what makes a `serial`
auto-increment there, and no existing golden SQL may move.

```
postgres  CREATE TABLE "users" ("id" SERIAL PRIMARY KEY, "email" VARCHAR(255) NOT NULL)
mysql     CREATE TABLE `users` (`id` INT AUTO_INCREMENT PRIMARY KEY, `email` VARCHAR(255) NOT NULL)
sqlite    CREATE TABLE "users" ("id" INTEGER PRIMARY KEY, "email" TEXT NOT NULL)
```

A **two-or-more-column** key emits a trailing table constraint, in the list's order, after
every column definition:

```
postgres  CREATE TABLE "memberships" ("org_id" INTEGER NOT NULL, "role" TEXT NOT NULL, "user_id" INTEGER NOT NULL, PRIMARY KEY ("user_id", "org_id"))
mysql     CREATE TABLE `memberships` (`org_id` INT NOT NULL, `role` TEXT NOT NULL, `user_id` INT NOT NULL, PRIMARY KEY (`user_id`, `org_id`))
sqlite    CREATE TABLE "memberships" ("org_id" INTEGER NOT NULL, "role" TEXT NOT NULL, "user_id" INTEGER NOT NULL, PRIMARY KEY ("user_id", "org_id"))
```

Two details in those lines are load-bearing. The columns are alphabetical (`org_id`, `role`,
`user_id`) because that is the snapshot's determinism rule; the key clause is `("user_id",
"org_id")` because that is the declaration order — the two orders differing in the same
statement is the point. And a key column in the multi-column form emits `NOT NULL`
explicitly, which the inline form suppresses as redundant. It is not redundant here: SQLite
permits a NULL in a `PRIMARY KEY` column of a table constraint unless the column is declared
`NOT NULL`, which is a documented deviation from the standard and would let a duplicate-ish
row in.

`serial` never appears in a multi-column key — the reflector refuses it upstream (see
`schema-core/src/ir/SPEC.md` §4.1), so `INT AUTO_INCREMENT` and a trailing `PRIMARY KEY`
never co-occur and MySQL's leading-column rule is never reached.

### 1.3 What `diff` emits when a key changes (frozen)

A new op, because none of the five existing ops can carry it:

```ts
| { kind: 'alter_primary_key'; table: string; from: readonly string[]; to: readonly string[] }
```

Produced when `from` and `to` differ as **sequences**, so a reorder is a change. `create_table`
carries the key in its own payload and never produces a companion `alter_primary_key`.

```
postgres  up:   ALTER TABLE "memberships" DROP CONSTRAINT "memberships_pkey", ADD PRIMARY KEY ("user_id", "org_id")
          down: ALTER TABLE "memberships" DROP CONSTRAINT "memberships_pkey", ADD PRIMARY KEY ("user_id")
mysql     up:   ALTER TABLE `memberships` DROP PRIMARY KEY, ADD PRIMARY KEY (`user_id`, `org_id`)
          down: ALTER TABLE `memberships` DROP PRIMARY KEY, ADD PRIMARY KEY (`user_id`)
```

One statement per direction, not two, because a table without a primary key is a state no
migration should be interruptible in. Postgres names the constraint `<table>_pkey`, which is
its own default and therefore what an unnamed key is actually called; a key created under a
different name is out of scope for a generated migration and the runner's failure names it.

**SQLite cannot do this at all.** There is no `ALTER TABLE` form that touches a primary key;
the real procedure is create-new-table / copy / drop / rename, which needs the full target
schema, has to move the table's foreign keys and indexes with it, and cannot be expressed as
one op. The emitter therefore **refuses**, and the refusal is a thrown
`UnsupportedFeatureError` that the runner surfaces as a failed migration — never a skipped op
and never a comment in the output, which are the two ways this becomes a schema that diverges
from its snapshot silently:

```
sqlite cannot alter the primary key of "memberships" ((user_id) → (user_id, org_id)); SQLite has no
ALTER TABLE form for a key, so this needs a hand-written table rebuild — see the migration guide
```

### 1.4 A snapshot is written in physical names (frozen — epic "Naming strategy")

Every name in a `SchemaSnapshot` is a physical name: `TableSnapshot.name`, `ColumnSnapshot.name` and
the `primaryKey` list of §1.1. There is no property name anywhere in a snapshot and no field to put
one in. A snapshot describes a database, `diff` compares two databases, and a future `pull` reads one
back out of a live server, which cannot report anything but physical names. Mixing the two vocabularies
here would make `diff(pull(), snapshot(schemas))` compare a column against itself and report a change.

`snapshot(schemas)` takes schema values, and by `schema-core/src/ir/SPEC.md` §4.2 a value is already
entirely in physical vocabulary — `schemaFromIR` keys `columns` by `physicalName`. So this needs no
translation pass and no access to a strategy, which is the point: the snapshot function stays a pure
rearrangement of what it was handed.

**Turning a strategy on under an existing database is a rename, and `diff` cannot discover that.** Two
snapshots taken either side of the change differ by a dropped `createdAt` and an added `created_at`,
which is byte-for-byte what a genuine drop and a genuine add look like. Guessing — pairing them by
type, or by string similarity — is how a generated migration deletes a column of production data, so
`diff` does not guess. It is told:

```ts
type RenameOp =
  | { kind: 'rename_table'; from: string; to: string }
  | { kind: 'rename_column'; table: string; from: string; to: string };

function diff(
  prev: SchemaSnapshot,
  next: SchemaSnapshot,
  opts?: { readonly renames?: readonly RenameOp[]; readonly dialect?: Dialect },
): readonly ChangeOp[];
```

The renames a caller passes in are the same values that come back out in the plan, so there is one
vocabulary for "this column became that one" rather than an input shape and an output shape that have
to be kept in step.

A rename the caller supplies removes the pair from consideration, so the drop and the add are not also
emitted. All three dialects can express both forms, which is why this is worth having rather than
being a documentation note:

```
postgres  ALTER TABLE "users" RENAME COLUMN "createdAt" TO "created_at"
mysql     ALTER TABLE `users` RENAME COLUMN `createdAt` TO `created_at`
sqlite    ALTER TABLE "users" RENAME COLUMN "createdAt" TO "created_at"

postgres  ALTER TABLE "userAccount" RENAME TO "user_accounts"
```

`RENAME COLUMN` needs MySQL 8.0 and SQLite 3.25; both predate the oldest version anything else in this
package assumes. `down` swaps `from` and `to`, which is the one op where reversal is exact rather than
approximate.

Renames are emitted **before** every add and drop in the same plan. Otherwise a rename onto a name the
same migration is adding collides, and the order that avoids it is not derivable from the op list at
apply time. And a rename naming a column absent from `prev`, or a target absent from `next`, is refused
rather than skipped: a stale rename list is worse than no rename list, because it silently reverts to
drop-and-add for the column it was supposed to protect.

A `naming` field is deliberately **not** added to the snapshot. The strategy's output is already
recorded — it is the names — and a user-supplied function has no identity to record, so the field
would be honest only for the two built-ins and misleading for the case it was added to help.

### 1.5 Extensions in the snapshot, and statement order (frozen — epic "Database extensions")

A snapshot records the extensions the schema set declares, because otherwise "adding one" is not
something a diff of two snapshots can see:

```ts
interface SchemaSnapshot {
  readonly extensions: readonly { readonly name: string; readonly schema?: string }[]; // sorted by name
}
```

Required, `[]` when there are none, for §1.1's reason: an absent field would make "old snapshot" and "no
extensions" the same value. `version` is deliberately not recorded — a version is what is installed, not
what is declared, and recording it would make every `CREATE EXTENSION` a pinned upgrade the author did
not ask for.

`snapshot(schemas)` derives the list from the columns rather than being told it: the distinct
`ExtensionType.extension` values across every column of every table are exactly the extensions the set
needs, so a `vector` column and a declared `vector` extension cannot disagree. Introspection reads the
list from the catalog instead (`../introspect/SPEC.md` §2), which is the one place the two can differ, and
that difference is the drift `check` exists to report.

`ColumnSnapshot.default` goes the other way: only introspection ever sets it, because a schema value holds
`hasDefault` and no expression. That is a third reason `diff` leaves it alone — one of the two things a
diff compares can never produce the field at all.

`ColumnSnapshot.type` widens to `string | ExtensionType` (see `schema-core/src/ir/SPEC.md` §4.3), which
makes `alter_column_type`'s `from` and `to` the same union and its comparison **structural**. `args` order
is significant, so `geometry(Point, 4326)` and `geometry(4326, Point)` are different types rather than the
same set.

```ts
| { kind: 'create_extension'; name: string; schema?: string }
```

There is no `drop_extension` op — `../schema-objects/SPEC.md` §7 says why — so an undeclared extension
leaves the snapshot without leaving the database. The operation list contains no removal; callers that
need unmanaged-object reporting must compare the two snapshots separately rather than treating absence
as permission to drop database objects.

**Statement order within one plan**, which the ops list has to encode because nothing at apply time can
recover it:

1. `create_extension` — before anything that could name a type it provides.
2. Renames (§1.4) — before the adds and drops they would otherwise collide with.
3. Table and column drops, then creates, then `alter_column_type` and `alter_primary_key`.
4. Index creation last, so an index over a column added in the same plan has a column to be over.

A dimension change — `vector(1536)` to `vector(3072)` — is an ordinary `alter_column_type` and the
emitter produces the `ALTER` for it. It will fail on a non-empty table, because Postgres cannot rewrite
one embedding into another, and that failure is the correct outcome: re-embedding a corpus is a data
migration and there is no DDL that can stand in for it. The emitter does not soften it into a comment.

### 1.6 Foreign keys and referential actions (frozen — epic "Referential actions")

Nothing in this package emits a `FOREIGN KEY` clause today, so the snapshot gains the constraint and not
just an action:

```ts
interface ForeignKeySnapshot {
  readonly name: string;
  readonly columns: readonly string[]; // on this table, in declaration order
  readonly targetTable: string;
  readonly targetColumns: readonly string[]; // positionally paired with `columns`
  readonly onDelete: ReferentialAction; // 'no action' when undeclared
  readonly onUpdate: ReferentialAction;
}

interface TableSnapshot {
  readonly foreignKeys: readonly ForeignKeySnapshot[]; // sorted by name
}
```

Required, `[]` when there are none, for §1.1's reason. All names are physical (§1.4).

#### The name is always emitted, never left to the server

```
postgres  ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
mysql     ALTER TABLE `posts` ADD CONSTRAINT `posts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
```

The convention is `<table>_<column>_…_fkey`, which is Postgres's own, so an unnamed constraint created by
hand already has the name zmdb would have generated. Leaving the name to the server is not an option
because MySQL's generated names are **ordinal** — `posts_ibfk_1`, `posts_ibfk_2` — so adding a second
foreign key renumbers nothing but changes which constraint a later `DROP CONSTRAINT posts_ibfk_2` hits, and
a diff has no stable handle on anything.

A generated name longer than 63 characters is **refused at build time**, naming the length and the limit,
rather than truncated or hashed. Postgres silently truncates at 63 bytes, which can make two distinct
constraints collide; and the alternative — a hash suffix — puts an unreadable name in the one message where
a constraint name is actually read by a human:
`violates foreign key constraint "posts_a1b2c3d4_fkey"`. An explicit `ForeignKey<…>` declaration may
therefore need to carry its own name on a schema with long identifiers.

#### The clause is a separate statement, except on SQLite

Foreign keys are added by `ALTER TABLE … ADD CONSTRAINT` **after** every table in the plan exists, never
inline in `CREATE TABLE`. A pair of tables that reference each other cannot be created inline in either
order, and that pair is ordinary — a `users.primary_org_id` against an `orgs.owner_id`.

**SQLite cannot `ADD CONSTRAINT`.** There is no such `ALTER TABLE` form, so on SQLite the foreign key is
emitted inline in the `CREATE TABLE` instead:

```
sqlite  CREATE TABLE "posts" ("id" INTEGER PRIMARY KEY, "user_id" INTEGER NOT NULL, FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)
```

That makes the constraint part of the `create_table` op on every dialect, even though Postgres and MySQL
emit it later:

```ts
{
  kind: 'create_table';
  table: string;
  columns: ColumnSnapshot[];
  primaryKey: readonly string[];
  foreignKeys: ForeignKeySnapshot[];
}
```

Without that field the SQLite statement above is not representable: `emitUp` receives one op, not the
snapshot it came from, and the current payload carries only columns. Postgres and MySQL still emit separate
`add_foreign_key` statements so mutually-referencing tables remain possible there.

Which means a mutually-referencing pair of tables is **not expressible on SQLite** at all, and the emitter
cannot discover that from either table's op in isolation. The caller therefore passes the target dialect to
`diff`; for SQLite, `diff` inspects the complete target snapshot and refuses a cycle naming both tables
before it returns either `create_table` op. That is a real limit of the dialect, not of zmdb, and stating it
here is cheaper than discovering it from `no such table` during a migration.

#### The three dialect exceptions, and what is done about each

- **InnoDB rejects `SET DEFAULT`.** MySQL parses the clause and then fails the `CREATE`/`ALTER` with
  "Cannot add foreign key constraint", which names nothing useful. So `'set default'` is **refused at emit
  time** on MySQL, naming the action, the constraint and the dialect. It is not downgraded to `NO ACTION`:
  the two behaviours differ on exactly the delete the author was thinking about when they chose it.
- **MySQL requires an index on the referencing columns and will create one silently.** zmdb emits it
  itself, on MySQL only, named `<constraint>_idx`, immediately before the constraint. The reason is drift
  rather than performance: a server-created index is a real index that introspection finds and that `diff`
  then wants to drop, so every `check` on a MySQL database would report an index nobody declared. On
  Postgres and SQLite no index is emitted, because neither server creates one and the choice is the
  author's — with the note that without one, `ON DELETE CASCADE` scans the child table once per deleted
  parent row.
- **SQLite cannot alter a constraint.** Adding, dropping or changing the action of a foreign key on an
  existing table needs the create/copy/drop/rename rebuild, exactly as `alter_primary_key` does (§1.3).
  The frozen drop/add ops do not each carry both the old and new action, while `diff` has both snapshots, so
  a dialect-aware `diff` **refuses before returning the pair** with the same class of error and this message:

```
sqlite cannot change the foreign key "posts_user_id_fkey" on "posts" (ON DELETE NO ACTION → CASCADE);
SQLite has no ALTER TABLE form for a constraint, so this needs a hand-written table rebuild — see the
migration guide
```

#### `PRAGMA foreign_keys` — zmdb turns it on

SQLite enforces foreign keys only when `PRAGMA foreign_keys = ON`, and the setting is **per connection**.
The initial state cannot be assumed: the Node 26 `DatabaseSync` build in the repository's E2E starts at
`1`, while SQLite can be compiled or opened with enforcement off. So the choice is between DDL that may be
decorative and an idempotent setting zmdb applies on the caller's behalf, and the tie is broken by a fact
about SQLite rather than by preference: **enabling the pragma does not validate the rows already in the
table.** Enforcement applies to statements executed afterwards, so turning it on cannot fail a deploy over
historical data.

zmdb's `node:sqlite` adapter therefore issues `PRAGMA foreign_keys = ON` on every connection it opens. The
alternative leaves an author who wrote `ON DELETE CASCADE` with no cascade, a passing test suite, and no
signal anywhere — the emitted clause is a comment.

For a driver zmdb did not open, it cannot set the pragma. The introspector reads it and reports it
(`../introspect/SPEC.md` §8), so "foreign keys are declared but not enforced on this connection" is a
finding rather than a silence, and `PRAGMA foreign_key_check` is the way to find pre-existing violations
before enabling it on an old database.

#### Diff

```ts
| { kind: 'add_foreign_key'; table: string; fk: ForeignKeySnapshot }
| { kind: 'drop_foreign_key'; table: string; name: string }
```

An action change is a **drop then an add**, on both Postgres and MySQL, because neither has an `ALTER
TABLE … ALTER CONSTRAINT` form that reaches `ON DELETE` — Postgres's only touches deferrability. Two ops
rather than one, in that order, and the pair is inside the migration's transaction on Postgres.

Constraints are compared structurally by every field except the name, so a constraint whose columns and
target match but whose action differs is a change rather than a drop plus an unrelated add. Comparing by
name alone would make a hand-named constraint look like a different one entirely.

The statement order in §1.5 gains two positions, both forced by dependency:

1. `create_extension`.
2. **`drop_foreign_key`** — before any column or table drop, because a constraint referencing a column
   blocks dropping it.
3. Renames.
4. Table and column drops, then creates, then `alter_column_type` and `alter_primary_key`.
5. **`add_foreign_key`** — after every table and column it names exists.
6. Index creation last. On MySQL the supporting index of a foreign key is the exception and is emitted with
   its constraint, since the constraint cannot be created without it.

### 1.7 Indexes in the snapshot (frozen — epic "Introspection")

`TableSnapshot.indexes` is required and sorted by name. The primary-key index is not repeated here:
`primaryKey` already carries it, and recording both would make one physical object look like two declared
objects. Named unique and ordinary indexes are included.

The column shape is the same closed union the schema-object emitter consumes. A column name remains a
string; an expression remains `{ expr }` and is compared byte-for-byte. SQLite reports an expression index
as `cid = -2` / `name = NULL`, so `sqlite_master.sql` is the measured fallback for that expression. Postgres
reads expressions and methods through `pg_index`/`pg_get_indexdef`; MySQL reads names and uniqueness through
`information_schema.STATISTICS`.

`catalogType`, default expressions and server-created supporting indexes are handled by the explicit
normalization rules in `../introspect/SPEC.md` and its drift tests. They are not reasons to omit an index
the catalog actually contains.

## 2. Diff engine

`diff(prev, next, opts?)` — pure function producing ordered ops. The five original ops, plus the two
the sections above add:

```ts
type ChangeOp =
  | {
      kind: 'create_table';
      table: string;
      columns: ColumnSnapshot[];
      primaryKey: readonly string[]; // §1.3
      foreignKeys: ForeignKeySnapshot[]; // §1.6
    }
  | { kind: 'drop_table'; table: string }
  | { kind: 'add_column'; table: string; column: ColumnSnapshot }
  | { kind: 'drop_column'; table: string; column: string }
  | { kind: 'alter_column_type'; table: string; column: string; from: string; to: string }
  | { kind: 'alter_primary_key'; table: string; from: readonly string[]; to: readonly string[] } // §1.3
  | RenameOp // §1.4
  | { kind: 'create_extension'; name: string; schema?: string } // §1.5
  | { kind: 'add_foreign_key'; table: string; fk: ForeignKeySnapshot } // §1.6
  | { kind: 'drop_foreign_key'; table: string; name: string }; // §1.6
```

`diff(x, x)` returns `[]`. Passing a rename alongside two identical snapshots is refused rather than
ignored, by §1.4's stale-list rule: the target name is absent from `next`, because `next` still has the
old one.

## 3. DDL emitter (per dialect)

`emitUp(op, dialect)` / `emitDown(op, dialect)` return SQL strings. `down`
reverses `up`. Postgres golden examples:

```
add_column users.age integer NOT NULL
  up:   ALTER TABLE "users" ADD COLUMN "age" INTEGER NOT NULL
  down: ALTER TABLE "users" DROP COLUMN "age"

create_table users(id serial pk)
  up:   CREATE TABLE "users" ("id" SERIAL PRIMARY KEY)
  down: DROP TABLE "users"
```

**Both the identifiers and the types are dialect-specific.** A snapshot names the
abstract type (`timestamp`, `varchar`); `ddlType(dialect, column)` renders it. The map is
in `index.ts` and pinned by `sql-types.spec.ts` dialect by dialect; the row that matters
most is `timestamp` → `TIMESTAMPTZ` on Postgres, because plain `TIMESTAMP` there discards
the offset of every `Date` written through it. An abstract type the map does not know is
passed through unchanged rather than guessed at.

**"Per dialect" has been less true of this emitter than the heading claims**, and the audit that found it is
in `../dialects/SPEC.md` §1. Three statements here are emitted in one dialect's grammar for all of them:
`add_column` says `ADD COLUMN`, which T-SQL rejects; `alter_column_type` says `ALTER COLUMN c TYPE t`, which
is the Postgres spelling and not MySQL's `MODIFY COLUMN`; and `emitDown` of a `drop_table` produces
`CREATE TABLE t ()`, an empty column list that only Postgres parses. SQL Server uses
`ALTER COLUMN c t` with no `TYPE`; SQLite has no direct alter-type statement at all, and the five-field op
does not contain the complete table snapshot a rebuild would need, so SQLite refuses `'alter column type'`.
The first two spellings and that refusal are fixed as part of the dialect-traits work, since that is where a
per-dialect answer acquires somewhere to live. The `drop_table` reversal is not a spelling problem — the
columns of a dropped table are not recoverable from a `ChangeOp` — so the `down` of a `drop_table` becomes a
refusal carrying the `-- zmdb:down` sentinel from §4 rather than SQL that cannot run on three dialects out
of six.

The type map itself gains three columns and one correction. `mssql` maps `timestamp` to `DATETIMEOFFSET(3)`
rather than `DATETIME2`, following the same rule the Postgres row is annotated with: a `timestamp` gets the
dialect's zone-aware type wherever one with a usable range exists. `cockroach` inherits Postgres and
overrides two entries — `serial` becomes `INT8 DEFAULT unique_rowid()`, which is what Cockroach's `SERIAL`
already means, and `integer` becomes `INT4`, because Cockroach's `INTEGER` is 64-bit and `Entity<T>` types
the column as a `number`. `singlestore` inherits MySQL and widens `serial` to `BIGINT AUTO_INCREMENT`, since
auto-increment values there are allocated per partition in large strides.

## 4. Migration lifecycle + version tracking

- Version table `_zmdb_migrations(version INTEGER PRIMARY KEY, name TEXT, applied_at)`.
- Runner verbs: `up`, `down`, `status`, where `up` applies every pending migration.

`up`/`down`/`status` are the _library_ verbs, and they are not the command names. The executable spells
them `migrate`, `rollback` and `status`, and deliberately has no `up` command at all — the reasoning, and
the nine-command surface these three dispatch into, are frozen in `zmdb`'s `src/cli/SPEC.md` §1.

That spec also requires a change here: a generated version is a 14-digit `YYYYMMDDHHMMSS` stamp, which does
not fit the `INTEGER` in the `CREATE TABLE IF NOT EXISTS` above on Postgres or MySQL, so the column becomes
`BIGINT` on those two dialects. SQLite's `INTEGER` is already 64-bit and existing 32-bit rows still fit.

## 5. Embedded migrations, for a bundle with no filesystem (frozen — epic "React Native")

Everything above assumes a directory of migration files and something that can read it. A React Native
bundle has neither, and neither does a browser: `node:fs` does not exist, and a `.sql` file is not a module
Metro can resolve. So migrations reach a device as **data compiled into the bundle**, applied by a runner
that never opens a file. The browser-SQLite case is the same problem with a different binding, which is why
this is one section and not two.

### 5.1 The format, and the three fields the issue asked for that are not here

```ts
export interface EmbeddedMigration {
  readonly version: number; // the fourteen digits of the file name
  readonly name: string;
  readonly up: string; // the whole `-- zmdb:up` section, verbatim
  readonly checksum: string; // `sha256:<hex>` over `up`, computed at build time
}
```

**`version: number`, not `id: string`.** The generated file name is
`<YYYYMMDDHHMMSS>_<slug>.sql` and those fourteen digits _are_ the version
(`../../../zmdb/src/cli/SPEC.md` §4) — sortable lexically and numerically at once, which is the property an
id would have been introduced to provide. Carrying both would be two names for one fact with nowhere to
record which one the ledger is keyed on, and the answer is already fixed: the ledger's primary key is the
version.

**`up: string`, not `readonly string[]`.** Splitting the section into statements is attractive — a device
binding's parameterised call takes one statement — and it is refused, because the split would have to happen
somewhere and both places are wrong. On the device it is a SQL parse. At build time it is a SQL parse in the
CLI, and `;` is not a statement boundary in the text this format carries: §1.5's extension statements and
routine bodies contain semicolons, `CREATE TRIGGER … BEGIN … END` contains several, and so does any string
literal with one in it. A splitter that is right about those is a SQL parser, and this package has no reason
to own one. So the section travels verbatim and the driver requirement (§5.6) is a call that accepts more
than one statement — which every SQLite binding already has, because DDL needs it.

**No `down`.** `zmdb embed` omits it unless asked (`--with-down`), because rolling an app back does not roll
the database back and the runner below has no rollback verb at all — the reasoning is on
`docs-site/content/migrations-web-mobile.md` and it is right. Every embedded byte is shipped to a phone
(ARCHITECTURE §1), and a `down` that nothing can call is the cheapest thing to not ship. The consequence is
that `EmbeddedMigration` is **not** assignable to `Migration`, which is correct rather than unfortunate: the
two runners share no code, no connection type and no ledger rule, so a shared type would only make it look
like they did.

**`checksum` is computed at build time and only ever compared on the device.** No hashing happens on a
device, and that is a constraint rather than a preference: `.oxlintrc.json` bans `node:crypto`,
`globalThis.crypto.subtle.digest` is asynchronous and is not present in a React Native runtime without a
platform package, and adding `expo-crypto` as a peer dependency to compare two strings would be absurd. The
CLI runs in Node where `crypto.subtle` does exist, so the digest is SHA-256 over the exact `up` text, hex,
prefixed `sha256:` so that changing the algorithm later shows up as a different prefix instead of as every
migration mismatching at once.

What the checksum is for: detecting that a migration which has already been applied has since been edited.
On a device that is the common accident, not an exotic one — version `003` ships in a TestFlight build,
someone fixes a typo in it, and the next build's `003` is a different migration with the same version. It is
**not** an integrity check against tampering: the bundle is not signed and the checksum travels next to the
statement it describes.

### 5.2 The ledger lives in the database being migrated, and may predate this runner

Same table as §4, one column wider:

```sql
CREATE TABLE IF NOT EXISTS _zmdb_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  checksum TEXT
)
```

`INTEGER` and not `BIGINT`: the `BIGINT` requirement in `../../../zmdb/src/cli/SPEC.md` §4 is for Postgres
and MySQL, whose `INTEGER` is 32 bits. SQLite's is already 64, and §5.6 makes SQLite the only target here.

`checksum` is nullable and that is load-bearing. A device database may already have a three-column ledger —
from a version of the app that used the §4 runner, or from the hand-written connection the docs page
currently shows. Frozen behaviour on `ensure`:

- read the table's columns (`pragma_table_info`, which is SQLite-specific and allowed to be, per §5.6);
- if the table is absent, create it as above;
- if it exists without `checksum`, `ALTER TABLE _zmdb_migrations ADD COLUMN checksum TEXT` — a migration for
  the migration table, run before anything else and idempotent;
- a row whose `checksum` is `NULL` is **applied and unverifiable**, not mismatched. It was recorded before
  checksums existed and there is nothing to compare it to; refusing it would brick every app that upgraded
  into this runner, which is a worse outcome than not verifying a migration that already ran.

### 5.3 `runEmbedded`, and why it does not take a `Driver`

```ts
export interface EmbeddedConnection {
  /** May contain more than one statement. No parameters. Used for migration bodies and the ledger DDL. */
  exec(sql: string): Promise<void>;
  /** One statement, with parameters. Used for ledger writes. */
  run(sql: string, params: readonly (string | number | null)[]): Promise<void>;
  /** One statement, with parameters. Used for the two ledger reads. */
  rows(sql: string, params: readonly (string | number | null)[]): Promise<readonly Record<string, unknown>[]>;
}

export declare function runEmbedded(
  conn: EmbeddedConnection,
  migrations: readonly EmbeddedMigration[],
): Promise<readonly number[]>; // the versions applied, in order
```

The issue proposes `runEmbedded(driver: Driver, …)`. `Driver` is declared in `@zmdb/repository`, which
_depends on_ this package, so naming it here inverts a dependency edge — `MigrationDriver` in `runner.ts`
exists for exactly that reason. But the embedded runner does not take that either, and the reason is §5.5:
`MigrationDriver.execute` takes a `CompiledQuery`, which means a compiler, and the whole point of the
embedded entry point is that it imports nothing. Every SQL string the runner issues is a constant in its own
module, so what it needs is three calls and no query builder. Those three map one-to-one onto
`expo-sqlite`'s `execAsync` / `runAsync` / `getAllAsync` — the pairing the docs page already uses, where
`execAsync` runs the multi-statement DDL and `runAsync` takes the parameters.

Frozen order of operations, and every failure below happens **before any migration is applied**:

1. Refuse a duplicate `version` in the array, by version. It is a merge artefact, and applying one of the two
   silently means the other never runs.
2. `ensure` the ledger (§5.2).
3. Read the ledger. For every version present in both the ledger and the array, compare checksums: a
   mismatch throws, naming the version, the name, and both digests. A `NULL` ledger checksum compares equal
   to anything.
4. **The downgrade case.** A ledger row whose version appears in no bundled migration throws, naming that
   version and the newest version the bundle has. This is an older app running against a newer database, and
   the alternative — carrying on — is old code writing through a schema it does not know, which is the
   data-loss case this rule exists for. There is no flag to disable it, because a flag introduced for one
   release is never removed.
5. Apply the pending versions in ascending numeric order, one at a time. Each migration runs inside
   `BEGIN` / `COMMIT` issued by the runner, with its ledger row written in the same transaction, and a failure
   `ROLLBACK`s that one and stops the run — the same rule as `../../../zmdb/src/cli/SPEC.md` §5, and sound
   here because SQLite's DDL is transactional. SQLite has no nested transactions, so `runEmbedded` must not
   be called inside one; that is a stated precondition rather than something it can detect.

The three failures are one class with a discriminant, so an app can branch:
`EmbeddedMigrationError` with `kind: 'duplicate' | 'checksum' | 'ledger-ahead' | 'ledger-shape'`.
`QueryCompilerError` is not reused: it carries no kind, and branching on a message is not an API. The
recommended handling for `ledger-ahead` belongs on the page and is the one the page's own framing implies —
a device database is a cache with a schema, so an app that finds a ledger from the future may delete it and
start at version 0, which is a decision only the app can make.

An empty ledger is not a special case. A reinstalled or evicted database is "version 0", every migration is
pending, and that path is the one every fresh install takes.

### 5.4 Generation: `zmdb embed`, a twelfth verb

Reads the migration directory, splits each file at the `-- zmdb:up` / `-- zmdb:down` sentinels (§4), digests
the `up` section, and writes one TypeScript module:

```ts
// Generated by `zmdb embed`. Do not edit.
import type { EmbeddedMigration } from '@zmdb/query-compiler/migrations/embedded';

export const migrations: readonly EmbeddedMigration[] = [
  { version: 20260903120000, name: 'add_shipped_at', up: '…', checksum: 'sha256:…' },
] as const;
```

- **Not `generate --embed`.** `generate` diffs declarations against the stored snapshot and writes one
  migration file (`../../../zmdb/src/cli/SPEC.md` §4); it does not read the migration directory. **Not
  `export --embed`** either: `export` writes the full DDL for the schema set to stdout (§9 there) from
  declarations, not from files. Both would be a second meaning for a verb that has one, which is the wart
  that spec's §1 and §13 are both about. So `embed` reads migration files, writes a TypeScript module,
  connects to nothing — a row in that spec's command table, and eleven verbs becomes twelve.
- A TypeScript module rather than JSON: the declared type plus `as const` means a hand-edit that breaks the
  shape is a typecheck failure, and the alternative that seems simpler — importing the `.sql` files — needs
  `assetExts` surgery in the Metro config, which is the thing the wrapper in
  `../../../aot-validator/src/plugin/SPEC.md` §6.1 exists to avoid.
- Output is byte-stable in version order, so it is committed and reviewed like any other generated file.
- `check` (§7 of the CLI spec) gains a `stale-embedded` finding: the module is out of date with respect to
  the directory. A stale embedded module is the same class of bug as a stale Metro cache — a build that
  succeeds and ships the wrong statements — and the whole point of `check` is that CI notices first.

### 5.5 The subpath is the bundle-size mechanism, because Metro does not tree-shake

`@zmdb/query-compiler/migrations/embedded` → `src/migrations/embedded.ts`, which imports **nothing**: not
`../index.js`, not `./index.js`, not a type from either. That is the whole discipline, and it has to be
structural because there is no bundler here to be hopeful about — Metro has no dead-code elimination driven
by `"sideEffects": false`, so an import that is only unreachable still ships.

The two existing entry points show why a new module is required rather than a new export of an old one:

- `./migrations/runner` looks like the minimal one and is not. `runner.ts` imports `createQueryCompiler` from
  `../index.js` for `driverMigrationConnection`, so importing the runner pulls in the entire query compiler —
  every builder, every clause, every dialect — for one convenience adapter.
- `./migrations` is worse. `index.ts` re-exports `./runner.js`, so the diff engine's entry point drags the
  runner and therefore the compiler behind it. A device that only needs to run four statements would ship the
  snapshotter, the diff engine and the DDL emitter as well.

Neither is a defect in a Node build and neither is being changed here. They are the reason the embedded
runner is a leaf module: the property "the device ships the statements and nothing else" has to be true by
the shape of the import graph, since nothing downstream will enforce it.

Consequences the implementation slice owns: the subpath is added to `package.json` `exports`,
`verify-exports.mjs` then checks that it resolves and reaches no non-zmdb specifier (it reaches none at all),
and `ARCHITECTURE.md` §10's subpath count moves. It is not a build-time entry — it never touches
`typescript` — so it does not go in `BUILD_TIME_ENTRIES`.

### 5.6 The driver requirement, once, for device and browser alike

**SQLite, and the three calls in §5.3.** Not a dialect parameter: the runner selects nothing, emits no DDL of
its own beyond the ledger table, and its one non-portable statement is the `pragma_table_info` probe in
§5.2. That is honest for the platforms that need this — `expo-sqlite`, `op-sqlite`, `wa-sqlite`, `sql.js`,
OPFS — and a second dialect would need a second probe and no other change.

The migrations themselves are of course dialect-specific, and they were emitted for SQLite by the generator
that wrote them; a migration set emitted for Postgres and embedded into a phone is a mistake the format
cannot detect and the CLI can, since it knows which dialect it emitted for.

Browser SQLite differs from a device in exactly two ways, and neither reaches the runner: OPFS storage can be
evicted, which is the empty-ledger path (§5.3), and `sql.js` is in-memory unless the page persists it, which
means every load is a fresh install. Both are already normal states.

### 5.7 What the two pages have to change

`docs-site/content/migrations-web-mobile.md` and `connect-react-native.md` are both `status: 'todo'` and stay
that way until the epic closes; the corrections below belong to the docs slice, except the four marked
_done_, which were code a reader would have copied.

1. _Done._ The startup example imported `@zmdb/query-compiler/migration-runner`, which is not a subpath this
   package has. It is `@zmdb/query-compiler/migrations/runner`.
2. _Done._ The hand-written connection kept its ledger in `_migrations` while `ensureVersionTable` creates
   `_zmdb_migrations`, so the example left two tables and inserted no `applied_at` — a `NOT NULL` column with
   no default, i.e. the first `recordApplied` fails.
3. _Done._ The `expo-sqlite` `Driver` on the React Native page branched on the leading keyword and returned
   `[]` for anything that was not a `SELECT`. `create`, `update` and `delete` all compile with `RETURNING`
   (`repository/src/index.ts:709`, `:739`, `:749`), so `create()` returned an empty entity.
4. _Done._ That branch is the same prefix test as `isWrite` in `../../../repository/src/replicas/SPEC.md`,
   and it is the second place a reader could have concluded that reads and writes are distinguishable from
   the text. They are, for routing; they are not, for whether a statement returns rows.
5. The `MigrationConnection` quoted on the page declares every member as returning `Promise<void>`. The real
   one accepts a synchronous return as well, which is what makes a `better-sqlite3`-shaped binding usable
   without wrapping every call.
6. "The device only ever imports the finished array, so no diffing code ships in the bundle" is true of the
   embedded subpath and false of the other two: via `./migrations` the bundle gets the snapshotter, the diff
   engine, the DDL emitter and the whole query compiler (§5.5).
7. The React Native page's transformer section offers two workarounds — do not use the validators, or build a
   shared package separately — and both are replaced by `withZmdb`
   (`../../../aot-validator/src/plugin/SPEC.md` §6). Its claim that untransformed validators "silently accept
   everything" is wrong in the other direction: they throw (§6.4 there).
8. Neither page mentions the dev-server staleness window or `--reset-cache`, which is the one thing a reader
   will hit in their first hour (§6.3 there).

## 6. Non-goals (rejected)

- Runtime auto-updateSchema against production. Reflection-based entity discovery.
- **An `id` alongside the version.** §5.1 — the fourteen digits are already sortable and already the key.
- **A statement array in the embedded format.** §5.1 — `;` is not a statement boundary in a routine body.
- **Hashing on the device.** §5.1 — `node:crypto` is banned, Web Crypto's digest is async and absent on RN,
  and there is nothing a device can learn by re-hashing text it was handed.
- **`down` in the bundle by default, or a rollback verb on the device.** §5.1.
- **A `Driver` or `MigrationDriver` parameter for `runEmbedded`.** §5.3 — one inverts a dependency edge, the
  other requires a compiler.
- **A flag that tolerates a ledger ahead of the bundle.** §5.3 step 4.
- **Reusing `./migrations` or `./migrations/runner` for the device.** §5.5 — both reach the whole compiler,
  and Metro will not remove it.
