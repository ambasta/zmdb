> **ToDo / feature gap.** The library now reads PostgreSQL, MySQL and SQLite
> catalogs into a normalized snapshot. There is still no declaration emitter,
> complete drift report, `pull` or `generate-entities` command. This page remains
> TODO because the catalog reader is the first half of the workflow, not the CLI.

## Read the catalog today

```ts
import { createIntrospector } from '@zmdb/query-compiler/introspect';

const live = await createIntrospector('postgres').snapshot(driver, {
  schemas: ['public'],
  exclude: ['audit_*'],
});
```

Catalog queries use bound values, driver rows are validated before use, and the result is sorted like a declared snapshot. The reader also preserves catalog type evidence and default expressions. It deliberately does not invent TypeScript for types the declaration vocabulary cannot represent.

## Adopting an existing database

Write the declarations by hand, then compare them with the catalog snapshot. Until the dedicated drift reporter lands, an explicit test keeps that comparison visible:

```ts
import { createIntrospector } from '@zmdb/query-compiler/introspect';
import { diff, snapshot } from '@zmdb/query-compiler/migrations';

it('declarations match the live database', async () => {
  const live = await createIntrospector('postgres').snapshot(driver, {
    schemas: ['public'],
  });
  const declared = snapshot([schemaOf<User>(), schemaOf<Order>()]);

  expect(diff(live, declared)).toEqual([]);
  expect(diff(declared, live)).toEqual([]);
});
```

Run it against a restored production dump in CI. This currently compares table, column and normalized type presence in both directions. The dedicated drift reporter will add complete reporting for every recovered key, foreign-key and index fact.

The full walkthrough is on [Schema-first](./schema-first.html).

## A one-off generator, if the table count is large

For fifty tables, hand-writing is a bad use of an afternoon. A throwaway script that prints an interface per table from `information_schema` gets you 90% of the way, and you fix the rest by hand:

```ts
const cols = await driver.execute({
  text: `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
  parameters: [table],
});

// app type × the Sql tag that disambiguates it
const TYPES: Record<string, string> = {
  integer: `number & Sql<'integer'>`,
  bigint: `bigint & Sql<'bigint'>`,
  text: `string & Sql<'text'>`,
  boolean: 'boolean',
  numeric: `number & Sql<'numeric'>`,
  jsonb: `object & Sql<'json'>`,
  'timestamp with time zone': `Date & Sql<'timestamp'>`,
};

console.log(`export interface ${pascal(table)} extends Table<'${table}'> {`);
for (const c of cols) {
  const serial = String(c.column_default ?? '').startsWith('nextval');
  const base = serial
    ? `number & Sql<'integer'> & Serial`
    : (TYPES[String(c.data_type)] ?? `/* TODO ${c.data_type} */ string & Sql<'text'>`);
  // tags bind tighter than the union, so a nullable column needs the parentheses
  const type = c.is_nullable === 'NO' ? base : `(${base}) | null`;
  console.log(`  ${c.column_name}: ${type};`);
}
console.log('}');
```

Then read every line of the output. The `TODO` markers are the point: the mapping is lossy in exactly the places that matter — `varchar(50)` loses its `Length<50>`, a `jsonb` column comes out as a bare `object` because its payload shape exists nowhere in the catalogue, `uuid` and `inet` have no representation at all, and a `CHECK` constraint is invisible.

The `jsonb` line is worth staring at, because the obvious spelling for "some JSON, shape
unknown" does not work: `unknown & Sql<'json'>` collapses to `Sql<'json'>` before reflection
ever sees it — `unknown & X` _is_ `X` — and the reflector refuses it by name. `object &
Sql<'json'>` is the spelling, and it validates as "not a primitive", which is honestly all a
catalogue can tell you. And a dropped `Length<50>` no longer just loses a DDL detail: it loses
the validator's `maxLength` and the OpenAPI document's too.

## Why `pull` is not shipped

The reader-side type mapping now ships. Producing declarations is a separate product because its lossy cases need named warnings and review:

- **It is not injective.** `SqlType` has ten members; Postgres has a few hundred types. `varchar(50)` and `varchar(500)` both report `character varying` plus separate length evidence, while `uuid`, `inet` and `tsvector` have no declared-type equivalent. Extension-backed types such as `citext` and `vector` retain their catalog evidence but still need an emitter policy — see [Database Extensions](./db-extensions.html).
- **Three catalogues.** The readers handle their different sources, but those sources expose different amounts of evidence. A generated declaration must explain every loss rather than hide it.
- **Silent wrongness is worse than absence.** A generator that emits `Sql<'text'>` for a `varchar(50)` produces a declaration that type-checks, generates DTOs, and then generates a migration that widens the column in production. A wrong declaration is more dangerous than none, because everything downstream — DDL, DTOs, the validator, the OpenAPI document — trusts it. Type-first widens the blast radius: the declaration is now the single source for five things rather than one.

The catalog-to-snapshot half has landed. Deterministic declaration emission and a complete two-direction drift report remain the two library slices needed before a `pull` command can be honest.

---

See also: [Schema-first](./schema-first.html) · [check](./cli-check.html) · [Database Extensions](./db-extensions.html)
