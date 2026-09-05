Embeddables let you compose complex value objects from multiple columns. Instead of storing a JSON blob, you get flat columns with type-safe access. zmdb provides `flattenEmbeddable` and
`liftEmbeddable` utilities to transform between the flat database representation and nested TypeScript objects.

## Embedding a Value Object

The embeddable is a plain interface. The table declares one column per field, and two helpers move between the two shapes.

<!-- snippet: embeddables.ts#snippet-1 -->

Generated DDL:

```sql
CREATE TABLE "customers" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "address_street" TEXT NOT NULL,
  "address_city" TEXT NOT NULL,
  "address_zip" TEXT NOT NULL,
  "address_country" TEXT NOT NULL
)
```

The `address_` prefix is a naming convention the two helpers agree on, not something the declaration knows. Nothing stops `address_city` and `Address['city']` drifting apart, which is the cost of the
flat layout — see below for the version where the type system holds them together.

## JSON-Based Embeddables

For a nested structure you never filter on, one `json` column carries the whole thing and the shape stays in the declaration:

<!-- snippet: embeddables.ts#snippet-2 -->

`Entity<Order>['metadata']` is `OrderMetadata`, so `row.metadata.priority` is a `number` with no projection step and no cast. That is the difference from the flat layout: the nested type _is_ the
column type, rather than being reassembled from four columns whose names have to match.

> [!NOTE] Embeddables are a modeling pattern, not a database feature. You choose between flat columns (better indexability, SQL compatibility) or JSON (flexibility, nested structure, one declaration).
> Both work with zmdb.

## Validation Integration

Embeddables integrate with `@zmdb/aot-validator`. There is no separate validator to construct — the embeddable's interface is the argument:

<!-- snippet: embeddables.ts#snippet-3 -->

For the JSON form there is nothing extra to do at all: `assert<CreateDTO<Order>>(ctx.body)` already walks `metadata`, because the column's type is `OrderMetadata` and the generated validator follows
it. Errors come back with paths like `input.metadata.tags[0]`.

> [!TIP] Keep embeddables as value objects — immutable, compared by value. They're not entities with identity.

---

See also: [Schema Declaration](./schema-declaration.html) · [Tag Reference](./tags-reference.html) · [Lifecycle Hooks](./lifecycle-hooks.html) · [Validation](./validators-is.html)
