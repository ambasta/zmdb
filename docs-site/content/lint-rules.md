> **ToDo / feature gap.** There is no ESLint plugin and no lint rules shipped with
> zmdb. The project lints itself with oxlint, and none of its rules are published
> for consumers.

## What rules would be worth having

Each of these corresponds to a mistake documented elsewhere in these docs, which is the argument for automating it.

**`require-transformer-canary`.** The highest-value one. If the transformer is not running, `is<T>()` and `assert<T>()` [return success and check nothing](./gotchas.html) — it fails open. A rule cannot detect the build configuration, but it can require that a project using the validators has a test asserting a known-bad value is rejected.

**`no-untyped-json-column`.** `json()` without a type parameter is `unknown`, which propagates into `Entity<S>` and forces a cast at every use:

```ts
prefs: json(),                         // flag this
prefs: json<Record<string, boolean>>() // want this
```

**`require-as-const-in-json-enum`.** Without `as const` the array widens to `string[]` and `jsonEnum` gives you `string` instead of a union — silently losing the narrowing that was the point:

```ts
status: jsonEnum(['draft', 'published']),           // flag: widens to string
status: jsonEnum(['draft', 'published'] as const),  // want
```

**`no-chained-references`.** `references` is a function, not a modifier. `.references()` does not exist on `Column`, so this is a type error already — but the error message is opaque enough that a rule with a fix would be kinder.

**`no-unbounded-find`.** `find({})` compiles to an unfiltered `SELECT` with no limit. Suggest `list()` with a `page`.

**`no-truthiness-in-where-builder`.** The classic conditional-filter bug:

```ts
if (q.minAge) where.age = { gte: q.minAge }; // drops 0
if (q.minAge !== undefined) where.age = { gte: q.minAge }; // correct
```

See [Dynamic Queries](./dynamic-queries.html).

**`no-interpolated-sql`.** A template literal containing a value inside `driver.execute({ text })` is an injection vector. Placeholders interpolated from generated positions are fine; values are not. See [Raw SQL](./raw-sql.html).

**`no-select-star-with-sensitive`.** A schema with a `sensitive()` column, read without a `select`, still fetches that column — [`sensitive()` affects serialization, not queries](./gotchas.html). Suggest a projection.

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

An `@zmdb/eslint-plugin` package. Most of the rules above are AST patterns over recognisable call shapes, so they are not hard — the work is in avoiding false positives, and in the ones that need type information (`no-select-star-with-sensitive` needs to resolve the schema object). The canary rule is the one with the best ratio of value to effort.

---

See also: [Gotchas](./gotchas.html) · [AOT Setup](./aot-setup.html) · [Dynamic Queries](./dynamic-queries.html)
