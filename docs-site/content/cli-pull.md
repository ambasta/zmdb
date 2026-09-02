> **ToDo / feature gap.** There is no introspection anywhere in zmdb. Nothing
> reads a database catalogue, so there is no `pull`, no `generate-entities`, and
> no way to detect that the deployed schema has drifted from your declarations.
> This is a missing capability, not missing packaging — unlike most of the
> [other CLI pages](./cli-overview.html).

## Adopting an existing database

Write the declarations by hand, then prove they match. The proving step is what replaces introspection, and it is worth more than a one-off generator because it keeps working:

```ts
it('declarations match the live database', async () => {
  const rows = await driver.execute({
    text: `SELECT table_name, column_name, data_type, is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public'`,
    parameters: [],
  });

  const live = new Map<string, Set<string>>();
  for (const r of rows) {
    const t = String(r.table_name);
    const columns = live.get(t) ?? new Set<string>();
    columns.add(String(r.column_name));
    live.set(t, columns);
  }

  for (const s of [schemaOf<User>(), schemaOf<Order>()]) {
    const cols = live.get(s.table);
    if (cols === undefined) throw new Error(`table ${s.table} missing`);
    expect([...Object.keys(s.columns)].sort()).toEqual([...cols].sort());
  }
});
```

Run it against a restored production dump in CI. Thirty lines, and it catches the entire class of drift a `pull` would have surfaced once.

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

## Why this is not shipped

The type mapping is the whole difficulty, and it is not a matter of writing more cases:

- **It is not injective.** `SqlType` has ten members; Postgres has a few hundred types. `varchar(50)` and `varchar(500)` both come back as `character varying` plus a separate length column, and `uuid`, `inet`, `tsvector` and every extension type map to nothing — see [Database Extensions](./db-extensions.html).
- **Three catalogues.** `information_schema` covers Postgres and MySQL unevenly; SQLite needs `pragma table_info` plus parsing the stored `CREATE TABLE` text for anything else.
- **Silent wrongness is worse than absence.** A generator that emits `Sql<'text'>` for a `varchar(50)` produces a declaration that type-checks, generates DTOs, and then generates a migration that widens the column in production. A wrong declaration is more dangerous than none, because everything downstream — DDL, DTOs, the validator, the OpenAPI document — trusts it. Type-first widens the blast radius: the declaration is now the single source for five things rather than one.

A drift _checker_ — comparing a snapshot against the catalogue and reporting differences without trying to name types it does not know — is a much smaller and safer feature, and is the more likely thing to land first.

---

See also: [Schema-first](./schema-first.html) · [check](./cli-check.html) · [Database Extensions](./db-extensions.html)
