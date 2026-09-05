# Build-time naming — Spec

Part of `@zmdb/schema-core`, exported from `@zmdb/schema-core/naming`.

## API

```ts
interface NamingStrategy {
  readonly column?: (property: string, context: { readonly table: string }) => string;
  readonly table?: (declared: string) => string;
  readonly index?: (table: string, columns: readonly string[], unique: boolean) => string;
}

type NamingStrategyName = 'snake_case' | 'snake_case_plural';

const snakeCase: NamingStrategy;
const snakeCasePlural: NamingStrategy;
function resolveNaming(config: NamingStrategy | NamingStrategyName | undefined): NamingStrategy;
```

The strategy is a build input, not a query hook. The AOT routes resolve one of these values and hand the resulting object to reflection; the reflector writes the answers into `SchemaIR`, and no SQL or
row path calls it again.

## `snakeCase`

Columns and tables use acronym-aware snake case:

| Declared name        | Physical name        |
| -------------------- | -------------------- |
| `createdAt`          | `created_at`         |
| `HTTPStatus`         | `http_status`        |
| `id2`                | `id2`                |
| `userID`             | `user_id`            |
| `already_snake_case` | `already_snake_case` |

Generated index names use the same conversion and end in `_idx` or `_uniq`. Calling the conversion again on its own output is stable.

## `snakeCasePlural`

Columns use `snakeCase`. Tables snake-case first and pluralise the final word: `userAccount` becomes `user_accounts` and `blogPost` becomes `blog_posts`.

Pluralisation is deliberately a small, deterministic rule set rather than a linguistics dependency. It contains explicit irregulars such as `person → people`, `child → children`, `matrix → matrices`
and `index → indices`, plus the common `-y` and `-es` suffix rules. Uninflected or ambiguous words such as `metadata`, `series` and `species` are left alone. A project that needs domain-specific
vocabulary supplies a custom strategy.

## Resolution

`resolveNaming` returns each built-in singleton for its config name, returns a custom strategy by identity, and returns an empty identity strategy when the config is absent. Config loading remains
outside this package.

## Verification

- [x] Acronym, digit and existing-snake-case cases are covered.
- [x] Regular, irregular, already-plural and uninflected table names are covered.
- [x] Named and custom config values resolve through one function.
- [x] The package export loads without reaching the TypeScript compiler.
