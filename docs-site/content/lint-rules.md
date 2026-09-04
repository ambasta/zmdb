`@zmdb/aot-validator/lint` ships six syntactic rules for mistakes that TypeScript
accepts or reports later than a linter can. The same plugin object loads in
Oxlint and ESLint. This repository uses Oxlint and runs the complete
`recommended` set in its ordinary CI lint step.

The rules deliberately do not use type information. Oxlint JavaScript plugins
receive no parser services, so a rule that must resolve an alias, inspect a
schema, or read a bundler configuration does not ship as a noisy approximation.

## Install with Oxlint

```bash
npm add --save-dev @zmdb/aot-validator oxlint@1.81
```

Load the published subpath and spell out the recommended severities in
`.oxlintrc.json`:

```jsonc
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "jsPlugins": [
    {
      "name": "zmdb",
      "specifier": "@zmdb/aot-validator/lint",
    },
  ],
  "rules": {
    "zmdb/no-distributed-nullable-tags": "error",
    "zmdb/no-empty-patch": "warn",
    "zmdb/no-interpolated-sql": "error",
    "zmdb/no-unbounded-find": "warn",
    "zmdb/no-unknown-json-column": "error",
    "zmdb/require-sql-on-number": "warn",
  },
}
```

Use `--max-warnings 0` when warnings should fail CI. To use the strict preset
manually, change the three `warn` entries to `error`.

Oxlint's JavaScript-plugin interface is alpha. The package therefore declares
the supported Oxlint range explicitly rather than assuming later plugin API
versions are compatible.

## ESLint flat config

The package also exports ESLint-shaped flat configs:

```js
// eslint.config.mjs
import { configs as zmdb } from '@zmdb/aot-validator/lint';

export default [...zmdb.recommended];
// Or: export default [...zmdb.strict];
```

Install and run ESLint separately if that is your project's host. zmdb itself
does not run a second ESLint pass: its repository uses Oxlint for both the
built-in rules and this plugin.

## Presets

| Rule                           | `recommended` | `strict` | Automatic action  |
| ------------------------------ | ------------- | -------- | ----------------- |
| `no-distributed-nullable-tags` | error         | error    | safe autofix      |
| `no-unknown-json-column`       | error         | error    | editor suggestion |
| `no-interpolated-sql`          | error         | error    | none              |
| `require-sql-on-number`        | warn          | error    | none              |
| `no-unbounded-find`            | warn          | error    | none              |
| `no-empty-patch`               | warn          | error    | none              |

The warning rules match a method name or a literal syntax without knowing the
receiver's type. They are useful, but that is not the precision bar for an
error. The three error rules report no shipped-source finding in this
repository; the warning matches that remain are deliberate tests.

## `no-distributed-nullable-tags`

Tags belong on the non-null arm:

```ts
interface Account extends Table<'accounts'> {
  email: (string | null) & Unique; // reported
}
```

Intersection distributes over a union. `null & Unique` is `never`, so the
declaration above silently becomes non-nullable. The rule rewrites it without
changing the inhabited type:

```ts
interface Account extends Table<'accounts'> {
  email: (string & Unique) | null;
}
```

The autofix runs only inside an interface extending an imported `Table<...>`
and only when every outer intersection member is a known declaration tag
imported from `@zmdb/schema-core/tags` or `zmdb/tags`. It leaves arbitrary local
markers alone because moving those could change behaviour.

**Legitimate exception:** none for the matched zmdb-tag shape. If the
intersection member is not a declaration tag, the rule does not match it.

## `no-unknown-json-column`

`unknown & X` simplifies to `X`, so this declaration has a SQL tag but no JSON
value shape:

```ts
interface Account extends Table<'accounts'> {
  preferences: unknown & Sql<'json'>; // reported
}
```

Use `object` when any non-primitive JSON object is acceptable, or describe the
actual shape:

```ts
interface Account extends Table<'accounts'> {
  preferences: Record<string, boolean> & Sql<'json'>;
}
```

The rule offers “Replace unknown with object” as a suggestion, not an
autofix. `object` and a declared record are different contracts, and the linter
cannot choose that contract for you. Standalone `unknown` is not reported.

**Legitimate exception:** none inside an intersection. If the value really is
unknown, keep it standalone and validate or narrow it before adding a database
column contract.

## `no-interpolated-sql`

Values belong in the parameter array:

```ts
await driver.execute({
  text: `SELECT * FROM users WHERE id = ${id}`, // reported
  parameters: [],
});
```

```ts
await driver.execute({
  text: 'SELECT * FROM users WHERE id = $1',
  parameters: [id],
});
```

The rule reports a substituting template literal in either of two visible SQL
sinks:

- the `text` property of an object that also has a `parameters` property;
- an argument passed directly to a method named `execute`.

It does not report static templates, ordinary strings, interpolation outside
those sinks, string concatenation, or a template assigned to a variable before
that variable reaches the sink. This is an injection guard for precise local
shapes, not a whole-program taint analysis.

There is no autofix: placeholder spelling is dialect-specific, and moving a
value into `parameters` is a semantic edit.

**Legitimate exception:** compiler-generated placeholder positions or
identifiers that were validated against a closed set. Prefer constructing that
text in a small trusted helper. If the direct sink still needs a suppression,
disable only this rule on that line and state the invariant:

```ts
// oxlint-disable-next-line zmdb/no-interpolated-sql -- slot is generated as "$" plus an integer
driver.execute(`SELECT * FROM users WHERE id = ${slot}`);
```

Use `eslint-disable-next-line` for the same narrowly scoped exception under
ESLint.

## `require-sql-on-number`

A bare `number` does not say whether the database column is an integer or a
numeric:

```ts
interface Invoice extends Table<'invoices'> {
  total: number; // reported
}
```

```ts
interface Invoice extends Table<'invoices'> {
  total: number & Sql<'numeric'>;
}
```

This is an early version of a build error: `schemaOf<T>()` also refuses the
ambiguous declaration. The rule remains a warning because it sees only a
literal `number` annotation. It intentionally cannot resolve aliases, so both a
correct `type Money = number & Sql<'numeric'>` alias and an incorrect
`type Quantity = number` alias are outside its view.

**Legitimate exception:** none for a literal bare `number` on a zmdb table
property. A named alias is not an exception; it is simply beyond this syntactic
rule and remains the build transform's responsibility.

## `no-unbounded-find`

`find()` and `find({})` read every matching row with no page limit:

```ts
const users = await usersRepo.find({}); // reported
```

Use a bounded list when this is an application read:

```ts
const users = await usersRepo.list({
  page: { limit: 100, offset: 0 },
});
```

The rule does not report a non-empty literal filter, a filter variable, or
`Array.prototype.find(callback)`. It matches the method name without resolving
the receiver, which is why it is a warning.

**Legitimate exception:** a deliberate whole-table read, such as a small
reference table, an export, or a test whose purpose is to load every row. Use an
exact-file override or a one-line suppression that names the bounded external
assumption. Also suppress it when an unrelated API happens to expose a
zero-argument method named `find`.

## `no-empty-patch`

An empty keyed update is not a write in the current repository contract:

```ts
const row = await usersRepo.update(id, {}); // reported
```

It validates the key, runs `preUpdate`, and reads the matching row back. That
looks like a write at the call site and is easy to mistake for one. Use the
operation you intend:

```ts
const row = await usersRepo.findById(id);
await usersRepo.update(id, { active: true });
```

The rule sees only the literal `{}`. A patch variable that becomes empty at
runtime is not reported, and a method named `update` on an unrelated receiver
can match. Deleting the call is not an autofix because the caller may use the
returned row or the hook.

**Legitimate exception:** a regression test that deliberately freezes the
empty-patch behaviour, or an unrelated API with the same method shape. A
production call should use `findById` if it wants a read.

## Disable one rule, not the plugin

Prefer an exact `overrides` entry for generated files, fixtures, or another
audited class of call:

```jsonc
{
  "overrides": [
    {
      "files": ["tests/empty-patch-contract.spec.ts"],
      "rules": {
        "zmdb/no-empty-patch": "off",
      },
    },
  ],
}
```

For a one-line exception, use the host's normal disable directive, name only
the rule, and write the invariant after `--`. A project-wide plugin disable
hides the other five independent checks and is not a responsible workaround.

## What does not ship

Some useful-sounding rules cannot meet the precision bar without type or build
configuration information:

- `no-truthiness-in-where-builder` is better handled by
  `@typescript-eslint/strict-boolean-expressions`.
- `no-select-star-with-sensitive` and
  `no-find-by-id-without-key` require resolved schema types.
- `no-untransformed-schema-of` cannot prove whether Vite, Rollup, webpack,
  ts-patch, or `zmdb-codegen` performs the rewrite.

For the last case, add a build smoke test that calls `schemaOf<YourTable>()`.
An untransformed call throws instead of returning a plausible empty schema. See
[AOT Setup](./aot-setup.html).

---

See also: [AOT Setup](./aot-setup.html) · [Tag Reference](./tags-reference.html) · [Raw SQL](./raw-sql.html) · [Dynamic Queries](./dynamic-queries.html)
