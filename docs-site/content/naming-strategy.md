> **ToDo / feature gap.** The physical-name execution boundary is implemented:
> reflected IR can carry declared and physical names, schema values and snapshots
> expose physical names, and repositories compile physical SQL while returning
> declared property keys. Project configuration does not yet pass `naming` or
> `namingStrategy` into reflection, and the built-in strategies and public
> explicit-name tag are not shipped yet.

## The boundary that now exists

The IR carries both vocabularies:

```ts
interface ColumnIR {
  name: string; // TypeScript property and DTO key
  physicalName: string; // SQL identifier
}

interface SchemaIR {
  table: string; // declared table identity
  physicalTable: string; // SQL table identifier
}
```

The reflector resolves those values once, at build time. Downstream code never
calls a naming function:

- `Entity<T>`, `CreateDTO<T>`, filters, JSON Schema and OpenAPI use declared
  property names;
- DDL, snapshots, repository predicates, ordering, grouping and writes use
  physical names;
- entity reads project `physical_name AS "propertyName"` when the names differ,
  so drivers already return the public row shape;
- raw SQL expressions and fragments are emitted byte-for-byte.

There is no JavaScript pass that renames every returned row. The repository
builds its property-to-physical map once when it is constructed and applies it
while compiling each statement.

For example, an IR produced with `authorId → author_id` and
`blogPost → blog_posts` compiles:

```sql
SELECT "id", "author_id" AS "authorId"
FROM "blog_posts"
WHERE "author_id" = $1
```

The corresponding entity still has an `authorId` property.

## Observable behavior without project wiring

The standard CLI and transformer setup currently use identity names because
they do not yet pass the configured strategy into reflection:

```ts
export interface BlogPost extends Table<'blog_posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  authorId: number & Sql<'integer'>;
}
```

With identity naming, that declaration still emits an `authorId` SQL column.
If an existing database requires `author_id` today, use `author_id` as the
property or adapt at an application boundary until the configuration slice
lands.

The config loader already validates the `naming` and `namingStrategy` fields,
but database commands and ordinary generated application code do not apply
them yet. Do not treat a valid config as proof that a migration or repository
has been renamed.

## What remains

The remaining work is project-level admission rather than SQL translation:

- resolve the built-in `snake_case` and `snake_case_plural` names;
- choose a custom `namingStrategy` when configured;
- pass that resolved strategy into every CLI and transformer reflection call;
- publish the explicit physical-name tag;
- promote this page from ToDo once those routes have executable coverage.

Until then, this page documents an implemented internal boundary and a
configuration gap, not a production configuration recipe.

---

See also: [Schema Declaration](./schema-declaration.html) · [Configuration](./config-file.html) · [Type Derivation](./type-derivation.html)
