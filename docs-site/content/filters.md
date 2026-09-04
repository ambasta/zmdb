`where` accepts a column, operator and value. Chained `where` clauses are ANDed; use `orWhere` for OR.

<!-- snippet: filters.ts#snippet-1 -->

Supported operators include `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not in`, `like`, `is null`, `is not null`. Values are always parameterized.

Known operators are trimmed and canonicalized. An operator the compiler does not know by name is accepted only when it is one bounded SQL token: one to four ASCII letters or characters from
`@<>=!~*&|?-`, with `--` forbidden; PostgreSQL-family hash operators are restricted to `#>` and `#>>`. A token containing `?` is refused on MySQL, SingleStore and SQLite, where `?` is a parameter
placeholder, and one containing `@` is refused on SQL Server for the same reason. This admits extension operators such as PostgreSQL `@>`, `@@`, `<@`, `~*`, `?|` and `#>>`, SQLite `GLOB`, MySQL `<=>`
and SQL Server `!<`, while refusing quotes, whitespace, semicolons, SQL comment openers and placeholder-shaped operators.

> [!WARNING] This token check prevents an operator from breaking out into more SQL; it is not an application-level operator allowlist. A request can still choose a syntactically safe operator with
> semantics or cost the endpoint did not intend. For request input, prefer the typed `WhereDTO` below or validate against the endpoint's own allowed operators. The reported injection shape is refused
> before a query is returned:
>
> <!-- snippet: filters.ts#snippet-2 -->

## Typed filters — WhereDTO

For the repository/read side there is a **typed** filter DTO derived from your schema (`@zmdb/schema-core/dto`). Each column is keyed to its value type with an operator set, and `compileWhere` folds
it into the query builder.

<!-- snippet: filters.ts#snippet-3 -->

Operators: `eq/ne/lt/lte/gt/gte`, `in/nin`, `like/ilike`, `isNull/notNull`, with `and`/`or` group composition. `like`/`ilike` are a **compile-time error** on non-string fields.

An **empty** operator map is a `ValidationError` too — `{ age: {} }` names a column and constrains it in no way, which is every row. `{}` as the whole filter stays legal, because an unfiltered
`list()` is a real query; naming a column and then saying nothing about it is not.

Any other operator key is a **`ValidationError`** naming the column and the key. That matters for the untyped case — a `WhereDTO` assembled from parsed JSON rather than written as a literal — because
the alternative is a query that looks filtered and is not: a dropped predicate on a `SELECT` over-discloses, and on an `UPDATE` or `DELETE` it is the whole table. Inherited keys are refused for the
same reason, so `{"email": {"toString": "x"}}` is a `ValidationError` and not a 500.
