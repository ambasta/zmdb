Inheritance lets you model entity hierarchies in a single database table using a discriminator column. zmdb provides `SingleTableInheritance` utilities to map rows to their correct subtypes at
runtime.

## Single Table Inheritance

Store all subtypes in one table with a discriminator column. Each subtype has a subset of columns that apply to it.

<!-- snippet: inheritance.ts#snippet-1 -->

Generated DDL:

```sql
CREATE TABLE "events" (
  "id" SERIAL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "title" TEXT,
  "venue" TEXT,
  "artist" TEXT,
  "opponent" TEXT,
  "home_score" INTEGER,
  "away_score" INTEGER
)
```

## Discriminator Values

Use `discriminatorFor` to generate the correct discriminator value for a subtype.

<!-- snippet: inheritance.ts#snippet-2 -->

## Querying Subtypes

Query the base table and filter by discriminator to get specific subtypes.

<!-- snippet: inheritance.ts#snippet-3 -->

The declaration gets you two things here that the row shape alone does not: `type` narrows to `'concert' | 'game'`, so the `switch` below is exhaustive and a third subtype breaks the compile; and the
per-subtype columns are typed as `| null`, which is what the table says. The part it cannot express is the invariant — that a `concert` row has a `title` and a `game` row does not — because that is a
`CHECK` constraint, not a type.

> [!NOTE] Inheritance in zmdb is a runtime pattern, not a database constraint. You must ensure data integrity (e.g., that the type-specific columns match the discriminator) in your application code,
> or with a `CHECK` in a [custom migration](./migrations-custom.html).

## Polymorphic Relations

Use the discriminator to route to the correct handler for polymorphic associations.

<!-- snippet: inheritance.ts#snippet-4 -->

> [!TIP] Keep discriminator columns indexed for efficient filtering. Add a partial index if your DB supports it (e.g., `WHERE type IS NOT NULL`).

---

See also: [Repository](./repository.html) · [Embeddables](./embeddables.html) · [Schema Declaration](./schema-declaration.html)
