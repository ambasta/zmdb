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
      readonly type: string;
      readonly nullable: boolean;
      readonly primaryKey: boolean;
    }[];
  }[]; // tables sorted by name; columns sorted by name
}
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
  up:   ALTER TABLE "users" ADD COLUMN "age" integer NOT NULL
  down: ALTER TABLE "users" DROP COLUMN "age"

create_table users(id serial pk)
  up:   CREATE TABLE "users" ("id" serial PRIMARY KEY)
  down: DROP TABLE "users"
```

## 4. Migration lifecycle + version tracking

- Version table `_zmdb_migrations(version INTEGER PRIMARY KEY, name TEXT, applied_at)`.
- CLI verbs: `create`, `up`, `down`, `status` (runner is #44).

## 5. Non-goals (rejected)

- Runtime auto-updateSchema against production. Reflection-based entity discovery.
