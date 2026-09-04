> **ToDo / feature gap.** There is no `CREATE EXTENSION` emitter and there are no
> extension-backed column types. `SqlType` is a closed union of ten members, so
> `vector`, `geometry`, `citext`, `hstore` and `ltree` cannot be declared as
> columns.

## Why this blocks more than it looks like

Several other pages are downstream of this one:

- [Vector similarity search](./guide-vector-search.html) — needs `vector(n)` and the `<->` / `<=>` operators
- [Geometry and point columns](./guide-postgis.html) — needs `geometry` / `point`
- [Case-insensitive unique email](./guide-case-insensitive-unique.html) — `citext` is one answer; the other is a supported functional index on `lower(email)`

## What you can do today

**Install the extension in a migration.** It is a plain statement, so a hand-written migration carries it fine:

```ts
const migrations = [
  {
    version: 1,
    name: 'extensions',
    up: 'CREATE EXTENSION IF NOT EXISTS vector',
    down: 'DROP EXTENSION IF EXISTS vector',
  },
];
```

See [Custom Migrations](./migrations-custom.html).

**Add the column in the same migration.** The schema object cannot describe it, so the DDL is hand-written and `snapshot()` will not see the column:

```ts
up: 'ALTER TABLE "documents" ADD COLUMN "embedding" vector(1536)',
```

> [!WARNING]
> A column the snapshot does not know about is a column `diff()` cannot protect. If a later migration is generated from the schema object, it will not drop your hand-added column — `diff` only emits changes it can derive — but it also will not stop someone re-adding it. Keep hand-managed columns in a comment next to the schema object.

**Query it with raw SQL**, since the builder cannot parameterise a distance
expression in `ORDER BY` or project one with an alias. Its low-level `where()`
accepts raw operator strings, including `<->`, but that fall-through is not a
typed vector surface:

```ts
const rows = await driver.execute({
  text: `SELECT id, embedding <-> $1 AS distance FROM documents ORDER BY distance LIMIT 10`,
  parameters: [JSON.stringify(queryEmbedding)],
});
```

**Model it as a shadow column** if you want the row type to include it. Declare the real column in the migration and a `Sql<'json'>` stand-in on the interface so `Entity<T>` has the field:

```ts
export interface Document extends Table<'documents'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  body: string & Sql<'text'>;
  // NOTE: the real column is `vector(1536)`, created in migration 1.
  // Sql<'json'> so the row type is right; never write through the repository.
  embedding: (number[] & Sql<'json'>) | null;
}
```

This works for reads on Postgres, where `pgvector` returns a JSON-ish array literal your driver can parse. It is a workaround with a comment on it, not a supported pattern — the honest version is that the type system is not modelling the column, and type-first makes that sharper rather than softer: the declaration is now the single source for the DDL too, so generating a migration from it would emit `json` and quietly replace your `vector`.

## What it would take

Two changes, and the second is the interesting one:

1. `SqlType` gains an escape hatch — `{ kind: 'extension'; sqlType: string }` — so a column can name a type the compiler does not know. The DDL emitter passes it through, and the app type is whatever the property says — `number[] & Sql<{ extension: 'vector(1536)' }>`, or a tag of its own.
2. **Operators.** `Operator` is already `... | (string & {})`, so `<->` compiles today. What is missing is that `WhereDTO`'s `FieldOps` has a fixed key set, so there is no typed way to express a distance ordering. Extension operators need either a per-type ops map or an explicit raw-expression escape in the DTO.

The first is small. The second is a design decision about how much of SQL the typed DTO should cover, which is why this is not just waiting on someone to type it out.

---

See also: [Column Types](./column-types.html) · [Custom Types & Codecs](./custom-types.html) · [Custom Migrations](./migrations-custom.html)
