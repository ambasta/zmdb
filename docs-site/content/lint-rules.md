> **ToDo / feature gap.** There is no ESLint plugin and no lint rules shipped with
> zmdb. The project lints itself with oxlint, and none of its rules are published
> for consumers.

## What rules would be worth having

Each of these corresponds to a mistake documented elsewhere in these docs, which is the argument for automating it.

**`no-distributed-nullable-tags`.** The highest-value one, because it is silently wrong rather than loud. Intersection distributes over a union, so tags written outside the parentheses of a nullable column are destroyed:

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

**`require-sql-on-number`.** `Sql<T>` is needed only where TypeScript is ambiguous, and `number` is the one case refused outright: it spells both `integer` and `numeric`. `string` defaults to `text`, `boolean`, `bigint` and `Date` are unambiguous. Today the refusal arrives from `schemaOf<T>()` at build time; a lint rule would put it under the cursor instead of in the build log.

**`no-unbounded-find`.** `find({})` compiles to an unfiltered `SELECT` with no limit. Suggest `list()` with a `page`.

**`no-truthiness-in-where-builder`.** The classic conditional-filter bug:

```ts
if (q.minAge) where.age = { gte: q.minAge }; // drops 0
if (q.minAge !== undefined) where.age = { gte: q.minAge }; // correct
```

See [Dynamic Queries](./dynamic-queries.html).

**`no-interpolated-sql`.** A template literal containing a value inside `driver.execute({ text })` is an injection vector. Placeholders interpolated from generated positions are fine; values are not. See [Raw SQL](./raw-sql.html).

**`no-select-star-with-sensitive`.** A table with a `Sensitive` column, read without a `select`, still fetches that column — [`Sensitive` affects the emitted documents and `ReadDTO`, not queries](./gotchas.html). Suggest a projection.

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

## What it would take

An `@zmdb/eslint-plugin` package. Most of the rules above are AST patterns over recognisable declaration or call shapes, so they are not hard — the work is in avoiding false positives, and in the ones that need type information (`no-select-star-with-sensitive` has to resolve the declared type to see the tag). `no-distributed-nullable-tags` is the one with the best ratio of value to effort, because it is purely syntactic and the mistake it catches type-checks.

---

See also: [Gotchas](./gotchas.html) · [AOT Setup](./aot-setup.html) · [Dynamic Queries](./dynamic-queries.html)
