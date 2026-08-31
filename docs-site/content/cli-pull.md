> **ToDo / feature gap.** There is no introspection anywhere in zmdb. Nothing
> reads a database catalogue, so there is no `pull`, no `generate-entities`, and
> no way to detect that the deployed schema has drifted from your schema objects.
> This is a missing capability, not missing packaging — unlike most of the
> [other CLI pages](./cli-overview.html).

## Adopting an existing database

Write the schema objects by hand, then prove they match. The proving step is what replaces introspection, and it is worth more than a one-off generator because it keeps working:

```ts
it('schema objects match the live database', async () => {
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

  for (const s of allSchemas) {
    const cols = live.get(s.table);
    if (cols === undefined) throw new Error(`table ${s.table} missing`);
    expect([...Object.keys(s.columns)].sort()).toEqual([...cols].sort());
  }
});
```

Run it against a restored production dump in CI. Thirty lines, and it catches the entire class of drift a `pull` would have surfaced once.

The full walkthrough is on [Schema-first](./schema-first.html).

## A one-off generator, if the table count is large

For fifty tables, hand-writing is a bad use of an afternoon. A throwaway script that prints schema objects from `information_schema` gets you 90% of the way, and you fix the rest by hand:

```ts
const cols = await driver.execute({
  text: `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
  parameters: [table],
});

const TYPES: Record<string, string> = {
  integer: 'integer()',
  bigint: 'bigint()',
  text: 'text()',
  boolean: 'boolean()',
  numeric: 'numeric()',
  jsonb: 'json<unknown>()',
  'timestamp without time zone': 'timestamp()',
};

console.log(`export const ${table} = defineSchema('${table}', {`);
for (const c of cols) {
  const builder = String(c.column_default ?? '').startsWith('nextval')
    ? 'serial()'
    : (TYPES[String(c.data_type)] ?? `/* TODO ${c.data_type} */ text()`);
  const nn = c.is_nullable === 'NO' ? '.notNull()' : '';
  console.log(`  ${c.column_name}: ${builder}${nn},`);
}
console.log('});');
```

Then read every line of the output. The `TODO` markers are the point: the mapping is lossy in exactly the places that matter — `varchar(50)` loses its length, `uuid` and `inet` have no representation at all, and a `CHECK` constraint is invisible.

## Why this is not shipped

The type mapping is the whole difficulty, and it is not a matter of writing more cases:

- **It is not injective.** `SqlType` has ten members; Postgres has a few hundred types. `varchar(50)` and `varchar(500)` both come back as `character varying` plus a separate length column, and `uuid`, `inet`, `tsvector` and every extension type map to nothing — see [Database Extensions](./db-extensions.html).
- **Three catalogues.** `information_schema` covers Postgres and MySQL unevenly; SQLite needs `pragma table_info` plus parsing the stored `CREATE TABLE` text for anything else.
- **Silent wrongness is worse than absence.** A generator that emits `text()` for a `varchar(50)` produces a schema object that type-checks, generates DTOs, and then generates a migration that widens the column in production. A wrong schema object is more dangerous than no schema object, because everything downstream trusts it.

A drift _checker_ — comparing a snapshot against the catalogue and reporting differences without trying to name types it does not know — is a much smaller and safer feature, and is the more likely thing to land first.

---

See also: [Schema-first](./schema-first.html) · [check](./cli-check.html) · [Database Extensions](./db-extensions.html)
