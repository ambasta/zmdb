# Migrations & Schema Diffing — Frozen Spec (Issue #40)

> Status: **FROZEN** for TDD. Implementation (#41–#44) must satisfy this spec.
> Lives in `@zmdb/query-compiler` (reuses dialects). Targets: Node 26+, ESM, TS 7.

## 1. Snapshot format (deterministic)

`snapshot(schemas): SchemaSnapshot` — a plain JSON object with **stable key
ordering**. Serializing the same schema set twice yields identical bytes.

```ts
interface SchemaSnapshot {
  readonly version: 1;
  readonly tables: readonly {
    readonly name: string;
    readonly columns: readonly {
      readonly name: string;
      /** Abstract — `'timestamp'`, never `'TIMESTAMPTZ'`. See §3. */
      readonly type: string;
      readonly nullable: boolean;
      readonly primaryKey: boolean;
      /** Present only for a `varchar`; omitted otherwise, so old snapshots still match. */
      readonly length?: number;
    }[];
    /** The ordered key. See §1.1. */
    readonly primaryKey: readonly string[];
  }[]; // tables sorted by name; columns sorted by name
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
  | RenameOp; // §1.4
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
- CLI verbs: `create`, `up`, `down`, `status` (runner is #44).

## 5. Non-goals (rejected)

- Runtime auto-updateSchema against production. Reflection-based entity discovery.
