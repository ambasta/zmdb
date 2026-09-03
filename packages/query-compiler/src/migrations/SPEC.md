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
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  /** Present only for a `varchar`; omitted otherwise, so old snapshots still match. */
  readonly length?: number;
  /** A catalog default expression, verbatim. Recorded, never diffed — `../introspect/SPEC.md` §4. */
  readonly default?: string;
}

interface TableSnapshot {
  readonly name: string;
  readonly columns: readonly ColumnSnapshot[]; // sorted by name
  /** The ordered key. See §1.1. */
  readonly primaryKey: readonly string[];
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
  opts?: { readonly renames?: readonly RenameOp[] },
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
leaves the snapshot without leaving the database. The diff reports it as an unmanaged object rather than
dropping it silently or pretending it is gone.

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

Which means a mutually-referencing pair of tables is **not expressible on SQLite** at all, and the emitter
refuses it naming both tables rather than emitting a `CREATE TABLE` that fails. That is a real limit of the
dialect, not of zmdb, and stating it here is cheaper than discovering it from `no such table` during a
migration.

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
  existing table needs the create/copy/drop/rename rebuild, exactly as `alter_primary_key` does (§1.3), so
  the emitter **refuses** with the same class of error and the same shape of message:

```
sqlite cannot change the foreign key "posts_user_id_fkey" on "posts" (ON DELETE NO ACTION → CASCADE);
SQLite has no ALTER TABLE form for a constraint, so this needs a hand-written table rebuild — see the
migration guide
```

#### `PRAGMA foreign_keys` — zmdb turns it on

SQLite enforces foreign keys only when `PRAGMA foreign_keys = ON`, the setting is **per connection**, and
the default is off. So the choice is between DDL that is decorative and a setting zmdb changes on the
caller's behalf, and the tie is broken by a fact about SQLite rather than by preference: **enabling the
pragma does not validate the rows already in the table.** Enforcement applies to statements executed
afterwards, so turning it on cannot fail a deploy over historical data.

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

## 2. Diff engine

`diff(prev, next, opts?)` — pure function producing ordered ops. The five original ops, plus the two
the sections above add:

```ts
type ChangeOp =
  | { kind: 'create_table'; table: string; columns: ColumnSnapshot[] }
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

## 4. Migration lifecycle + version tracking

- Version table `_zmdb_migrations(version INTEGER PRIMARY KEY, name TEXT, applied_at)`.
- Runner verbs: `up`, `down`, `status`, where `up` applies every pending migration.

`up`/`down`/`status` are the _library_ verbs, and they are not the command names. The executable spells
them `migrate`, `rollback` and `status`, and deliberately has no `up` command at all — the reasoning, and
the nine-command surface these three dispatch into, are frozen in `zmdb`'s `src/cli/SPEC.md` §1.

That spec also requires a change here: a generated version is a 14-digit `YYYYMMDDHHMMSS` stamp, which does
not fit the `INTEGER` in the `CREATE TABLE IF NOT EXISTS` above on Postgres or MySQL, so the column becomes
`BIGINT` on those two dialects. SQLite's `INTEGER` is already 64-bit and existing 32-bit rows still fit.

## 5. Non-goals (rejected)

- Runtime auto-updateSchema against production. Reflection-based entity discovery.
