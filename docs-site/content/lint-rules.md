> **ToDo / reference gap.** The `@zmdb/aot-validator/lint` subpath ships six syntactic rules and
> ESLint flat configs. This repository runs the complete recommended set through `yarn lint` and CI;
> this page is still rationale rather than a complete consumer setup and rule reference.

## What the shipped rules catch

Each of these corresponds to a mistake documented elsewhere in these docs, which is the argument for automating it.

**`no-distributed-nullable-tags`.** The highest-value one, because TypeScript accepts it and the reflector
does not refuse it until the build transform runs. A lint rule moves that same finding under the cursor.
Intersection distributes over a union, so tags written outside the parentheses of a nullable column are destroyed:

```ts
email: (string | null) & Unique; // flag: null & Unique is never — the column stops being nullable
email: (string & Unique) | null; // want
```

A rule sees this as a syntactic pattern on a property type inside an `interface X extends Table<'…'>`, with an obvious fix. See [Tag Reference](./tags-reference.html).

**`no-unknown-json-column`.** `unknown & X` _is_ `X`, so `unknown & Sql<'json'>` is a tag with no type behind it — the reflector refuses it with "the tags carry no type". The spelling for an unshaped payload is `object`:

```ts
prefs: unknown & Sql<'json'>; // flag this — collapses to the bare tag
prefs: object & Sql<'json'>; // want, for an unshaped payload
prefs: Record<string, boolean> & Sql<'json'>; // better, where the shape is known
```

**`require-sql-on-number`.** `Sql<T>` is needed only where TypeScript is ambiguous, and `number` is the one case refused outright: it spells both `integer` and `numeric`. `string` defaults to `text`, `boolean`, `bigint` and `Date` are unambiguous. The reflector still refuses this at build time; the shipped warning puts it under the cursor first.

**`no-unbounded-find`.** `find({})` compiles to an unfiltered `SELECT` with no limit. Suggest `list()` with a `page`.

**`no-empty-patch`.** `update(id, {})` performs no write: the repository validates the empty patch, runs
`preUpdate`, and reads the matching row back. The warning catches that literal spelling; it cannot see a
patch assembled conditionally that happens to be empty at runtime.

**`no-interpolated-sql`.** A template literal with any substitution in a `{ text, parameters }` query
object, or passed directly to `.execute`, is reported as an injection risk. The syntactic rule cannot
distinguish a value from a generated placeholder position, so direct sinks must use a literal query string
and bound parameters. See [Raw SQL](./raw-sql.html).

## What you can enforce today

Several of these fall out of rules you probably already have:

```jsonc
{
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/no-unnecessary-type-assertion": "error",
    "@typescript-eslint/strict-boolean-expressions": "error", // catches the truthiness bug
  },
}
```

`strict-boolean-expressions` is the one that pays for itself here — it flags `if (q.minAge)` on a `number | undefined`, which is the conditional-filter bug directly.

And in `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
  },
}
```

`noUncheckedIndexedAccess` matters more than usual with zmdb, because `rows[0]` on a query result is genuinely `T | undefined` and pretending otherwise is how an empty result becomes a `TypeError` two frames later.

## What zmdb enforces about itself

The repository's own rules are stricter than a consumer's would need to be: no `any`, no `as T`, no non-null `!`, no lint suppressions, and no `new Function`/`eval` in package sources — the last verified by a grep in CI, because it is what lets the validators run under a strict CSP and in edge runtimes. That is a discipline for library code, not a recommendation for yours.

## Host and package boundary

The shipped `./lint` subpath of `@zmdb/aot-validator` loads as an oxlint JavaScript plugin or as an
ESLint-shaped plugin. Oxlint gives JavaScript plugins no parser services, so this surface is deliberately
syntactic: type-aware proposals such as `no-select-star-with-sensitive` do not ship, and
`@typescript-eslint/strict-boolean-expressions` remains the answer to the truthiness bug.
`no-distributed-nullable-tags` has the best ratio of value to effort because it is purely syntactic and
the mistake it catches type-checks.

---

See also: [Gotchas](./gotchas.html) · [AOT Setup](./aot-setup.html) · [Dynamic Queries](./dynamic-queries.html)
