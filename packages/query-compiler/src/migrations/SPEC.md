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

## 2. Diff engine

`diff(prev, next): ChangeOp[]` — pure function producing ordered ops:

```ts
type ChangeOp =
  | { kind: 'create_table'; table: string; columns: ColumnSnapshot[] }
  | { kind: 'drop_table'; table: string }
  | { kind: 'add_column'; table: string; column: ColumnSnapshot }
  | { kind: 'drop_column'; table: string; column: string }
  | { kind: 'alter_column_type'; table: string; column: string; from: string; to: string };
```

`diff(x, x)` returns `[]`.

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
