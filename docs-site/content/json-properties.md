A `json` column stores structured data, and its TypeScript type is whatever you declared the property as.

## Typed JSON

```ts
import type { PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

interface Address {
  street: string;
  city: string;
  zip: string;
}

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  address: Address & Sql<'json'>;
  prefs: (Record<string, boolean> & Sql<'json'>) | null;
}
```

```ts
type Row = Entity<User>;
// { id: number; address: Address; prefs: Record<string, boolean> | null }
```

`Sql<'json'>` says how the column is stored. What it holds is the property's own type, so
there is no type argument to forget and no `unknown` to cast away — a bare `json()` used to
be spellable and gave you exactly that.

> [!WARNING]
> Write `(T & Sql<'json'>) | null`, not `(T | null) & Sql<'json'>`. The second distributes the
> tag into both members and `null & Sql<'json'>` is `never`, so the column stops being nullable
> in a way that typechecks.

The DDL per dialect:

| Dialect  | Type            |
| -------- | --------------- |
| postgres | `JSONB`         |
| mysql    | `JSON`          |
| sqlite   | `TEXT`          |
| mssql    | `NVARCHAR(MAX)` |

## The declaration is a claim, and the validator is what checks it

`address: Address & Sql<'json'>` tells the type system what the column holds. It does not make the database enforce it — a row written by a migration, another service, or `psql` can hold anything. So validate at the boundary where data enters:

```ts
import { assert } from '@zmdb/aot-validator/utilities';

const dto = assert<CreateDTO<User>>(ctx.body); // checks address.street, .city, .zip
await repo.create(dto);
```

Because `CreateDTO<User>` includes `address: Address`, the generated validator walks the nested object. That is the whole benefit of the shape being in the declaration: one `assert` at the edge covers the JSON payload too, with paths like `input.address.zip` in the error.

For data that was already in the table when you added the type, validate on the way out:

```ts
const row = await repo.findById(1);
if (row && !is<Address>(row.address)) {
  /* legacy row */
}
```

## Enums

A literal union narrows to its members, and nothing widens it:

```ts
export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  status: 'draft' | 'review' | 'published';
}
```

```ts
type Row = Entity<Post>;
// { id: number; status: 'draft' | 'review' | 'published' }
```

There is no `as const` in sight, which matters: `jsonEnum(['draft', 'review'] as const)` gave
you `string` rather than the union the moment the `as const` was missing, silently. `WhereDTO`
narrows too, so `{ status: { eq: 'publshed' } }` is a compile error rather than a query that
returns nothing.

## Querying inside a JSON column

There are no JSON path operators in the builder. Filtering on `address->>'city'` needs raw SQL:

```ts
const q = {
  text: `SELECT * FROM "users" WHERE "address"->>'city' = $1`,
  parameters: ['Berlin'],
};
const rows = await driver.execute(q);
```

See [Raw SQL](./raw-sql.html). If you filter on a field often, that is a signal it should be a column — you get an index, a type in the DDL, and a `WhereDTO` entry.

## Generated columns over JSON

Postgres and MySQL can both project a JSON field into a real, indexable column:

```ts
import { generatedColumnDdl } from '@zmdb/query-compiler/schema-objects';

generatedColumnDdl(
  {
    name: 'city',
    type: 'TEXT',
    expression: `("address"->>'city')`,
    stored: true,
  },
  'postgres',
);
```

Add `city: (string & Sql<'text'>) | null` to the interface and it becomes queryable through the normal path. See [Generated Columns](./generated-columns.html).

## Serialization

The `json` column round-trips through your driver. `node-postgres` parses `JSONB` for you; `node:sqlite` gives you the raw `TEXT`, so parse it in the driver or with a [custom type](./custom-types.html):

```ts
const addressType = defineType<Address, Address, string>({
  sqlType: 'text',
  toDb: v => JSON.stringify(v),
  fromDb: raw => assert<Address>(JSON.parse(raw)),
  toWire: v => v,
  fromWire: raw => raw,
});
```

> [!NOTE]
> `assert` rather than `as Address`, at the boundary of the database where you decide what the
> guarantee is. The three type parameters are wire, app and database — a codec that named only
> two left the third to be guessed.

---

See also: [Column Types](./column-types.html) · [Tag Reference](./tags-reference.html) · [Custom Types & Codecs](./custom-types.html) · [Generated Columns](./generated-columns.html)
