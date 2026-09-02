zmdb used to describe a table as a value — `defineSchema('users', { id: serial().primaryKey() })`, ten column builders and eight modifiers. It describes a table as a [type](./schema-declaration.html) now, and the builders are gone rather than deprecated. The codemod converts a codebase that still uses them.

```bash
node scripts/codemod-tagged-schema.mjs src/schema/*.ts          # print what it would do
node scripts/codemod-tagged-schema.mjs --write src/schema/*.ts  # rewrite in place
yarn fmt                                                        # rewritten files are not formatted
```

## What it does to a file

```ts
// before
import { defineSchema, serial, text, varchar } from '@zmdb/schema-core';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: varchar(255).unique(),
  bio: text().nullable(),
});
```

```ts
// after
import type { Length, PrimaryKey, Serial, Sql, Table, Unique } from '@zmdb/schema-core/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255> & Unique;
  bio: (string & Sql<'text'>) | null;
}
```

Three edits, collected against the original offsets and applied in one back-to-front pass so none invalidates another's positions:

1. the `const … = defineSchema(…);` statement becomes the interface;
2. a `import type { … } from '@zmdb/schema-core/tags'` line is added after the last existing import, naming exactly the tags the conversion used;
3. the DSL names the rewrite made unused are pruned from their import clause — and a file that still calls `text()` outside a schema keeps its import, because "unused" is computed on the tree rather than by counting occurrences.

`UserSchema` → `User`, `users` → `Users`: the `Schema` suffix is dropped and the first letter capitalised. Never derived from the _table_ name, so a rename cannot silently repoint an interface.

## What you have to do by hand

The interface replaces the `const`, so **every use of the old schema value is now a reference to a type**. Change the call sites:

```ts
- const users = defineRepository(UserSchema, driver);
+ const users = defineRepository(schemaOf<User>(), driver);

- type Row = Entity<typeof UserSchema>;
+ type Row = Entity<User>;
```

`schemaOf<T>()` needs the build step — the [transformer](./aot-setup.html) or the [codegen CLI](./cli-codegen.html) — because it has no runtime implementation and cannot have one. An untransformed call throws a message saying exactly that.

## Two things do not survive the round trip

**A default value.** `HasDefault` means "has one", not "has this one". A default is a runtime value and no type holds it, so `defaultTo('now()')` converts to `HasDefault` and the codemod prints what it dropped:

```
// dropped: the default *value* of `createdAt`. HasDefault says it has one, not which one.
```

Put the value in the migration, which is where the DDL is written anyway.

**A `json<T>()` payload, in the other direction.** It converts _out_ perfectly well — the phantom type argument is right there in the source, and `prefs: Preferences & Sql<'json'>` keeps it — but it could never have come _back_, because the old `irFromSchema` had no payload to read. This is the gap the type-first direction closes rather than one it opens.

Relations are not a gap: `defineSchema` had none to read. They lived in a separate `relations` map and are a separate, smaller migration to `ManyToOne` / `OneToMany` / `OneToOne` / `ManyToMany`. See [Relations](./relations.html).

## It refuses rather than guesses

The codemod walks a real parse tree from the TypeScript compiler and abstractly interprets each builder chain. It does not pattern-match text, and the reason is on the record: a hand-rolled parser in this repository once read `string[]` as `string`, and the build reported no problem at all. `references(integer().primaryKey(), 'users', 'id')` is not something a regex reads correctly either.

The interpretation is exact rather than best-effort because the DSL was **closed** — ten builders, seven fluent modifiers, the same seven function-style, and `references`. Anything outside that list is refused **by name**, and its call site is left untouched:

```
[refused] src/schema/orders.ts: Orders.total: unknown modifier `precision`
[refused] src/legacy/adhoc.ts: no tsconfig.json above it, so there is no program to read it from
```

The exit code is non-zero when anything was refused, so it drops into a script without a wrapper. A wrong interface is far worse than an unconverted one: the wrongness is silent, and the DDL that comes out of it still looks fine.

Refusals you may hit, and what each means:

| Refusal                                               | Do this                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| ``unknown modifier `x` `` / `unknown column function` | it was never part of the DSL; convert that column by hand             |
| `the table name must be a string literal`             | inline the name — a computed table name has no type-level spelling    |
| `` `jsonEnum` members must be string literals ``      | inline the array, or drop `as const` and use a literal union directly |
| `` `references` needs a string table name … ``        | the target schema is in a file this run did not load; pass it too     |
| `no tsconfig.json above it`                           | pass `--project`, or leave the file out                               |
| `a schema with no columns converts to nothing`        | delete it                                                             |

## Flags

| Flag                   | Effect                                                      |
| ---------------------- | ----------------------------------------------------------- |
| `--project <tsconfig>` | the program to read the files from (default: nearest above) |
| `--write`              | rewrite each file in place                                  |
| `--json`               | machine-readable records on stdout                          |
| `--quiet`              | suppress the human-readable report                          |

Files are grouped by project so a repository-wide run loads each package once:

```bash
node scripts/codemod-tagged-schema.mjs --write $(git ls-files '*.ts')
```

That is safe to run over everything. A file whose _text_ never contains `defineSchema` is skipped before a program is loaded for it, so `vitest.config.ts` does not come back as thirty refusals about files that have no schemas in them.

## Is the conversion correct?

The codemod's test suite converts each corpus file and asserts that the resulting interface reflects to the **same `SchemaIR`** as the original `defineSchema` value — field for field, modulo exactly the default value and the json payload above, and nothing else. Not "looks equivalent": the same bytes reaching the same back-ends.

---

See also: [Schema Declaration](./schema-declaration.html) · [Tag Reference](./tags-reference.html) · [AOT Setup](./aot-setup.html) · [Codegen CLI](./cli-codegen.html)
