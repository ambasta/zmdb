A `json` column stores structured data and its TypeScript type is whatever you parameterise it with.

## Typed JSON

```ts
import { defineSchema, serial, json } from '@zmdb/schema-core';

interface Address {
  street: string;
  city: string;
  zip: string;
}

export const users = defineSchema('users', {
  id: serial().primaryKey(),
  address: json<Address>().notNull(),
  prefs: json<Record<string, boolean>>().nullable(),
});
```

```ts
type User = Entity<typeof users>;
// { id: number; address: Address; prefs: Record<string, boolean> | null }
```

The DDL per dialect:

| Dialect  | Type    |
| -------- | ------- |
| postgres | `JSONB` |
| mysql    | `JSON`  |
| sqlite   | `TEXT`  |

## The parameter is a claim, and the validator is what checks it

`json<Address>()` tells the type system what the column holds. It does not make the database enforce it — a row written by a migration, another service, or `psql` can hold anything. So validate at the boundary where data enters:

```ts
import { assert } from '@zmdb/aot-validator/utilities';

const dto = assert<CreateDTO<typeof users>>(ctx.body); // checks address.street, .city, .zip
await repo.create(dto);
```

Because `CreateDTO` includes `address: Address`, the generated validator walks the nested object. That is the whole benefit of the type parameter: one `assert` at the edge covers the JSON payload too, with paths like `input.address.zip` in the error.

For data that was already in the table when you added the type, validate on the way out:

```ts
const row = await repo.findById(1);
if (row && !is<Address>(row.address)) {
  /* legacy row */
}
```

## Enums

`jsonEnum` narrows to a union of the members rather than to `string`:

```ts
export const posts = defineSchema('posts', {
  id: serial().primaryKey(),
  status: jsonEnum(['draft', 'review', 'published'] as const).notNull(),
});

type Post = Entity<typeof posts>;
// { id: number; status: 'draft' | 'review' | 'published' }
```

The `as const` is required — without it the array widens to `string[]` and you get `string`. `WhereDTO` narrows too, so `{ status: { eq: 'publshed' } }` is a compile error rather than a query that returns nothing.

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

Add `city: text().nullable()` to the schema object and it becomes queryable through the normal path. See [Generated Columns](./generated-columns.html).

## Serialization

The `json` column round-trips through your driver. `node-postgres` parses `JSONB` for you; `node:sqlite` gives you the raw `TEXT`, so parse it in the driver or with a [custom type](./custom-types.html):

```ts
export const jsonType = <T>() =>
  defineType<T, string>({
    sqlType: 'text',
    toDb: v => JSON.stringify(v),
    fromDb: raw => JSON.parse(raw) as T,
  });
```

> [!NOTE]
> That `as T` is at the boundary of the database, in your code, where you decide what the guarantee is. If you want the guarantee checked rather than asserted, `fromDb: (raw) => assert<T>(JSON.parse(raw))`.

---

See also: [Column Types](./column-types.html) · [Custom Types & Codecs](./custom-types.html) · [Generated Columns](./generated-columns.html)
