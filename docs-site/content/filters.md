`where` accepts a column, operator and value. Chained `where` clauses are ANDed; use `orWhere` for OR.

```ts
.where('role', '=', 'admin')
.where('createdAt', '>', someDate)
.where('id', 'in', [1, 2, 3])
.where('email', 'like', '%@example.com')
```

Supported operators include `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not in`, `like`, `is null`, `is not null`. Values are always parameterized.

> [!WARNING] Values are parameterized, but operators are inserted into the SQL text. This allows dialect-specific operators such as `@>`, even when the builder does not know about them. It also means
> an operator from an HTTP request must not be passed directly to `.where()`:
>
> ```ts
> // measured: SELECT * FROM "users" WHERE "role" = 'x' OR 1=1 -- $1
> qb.selectFrom('users').where('role', "= 'x' OR 1=1 --", 1).compile();
> ```
>
> For user input, use the typed `WhereDTO` below or validate the operator against an allowlist before calling `.where()`.

## Typed filters — WhereDTO

For the repository/read side there is a **typed** filter DTO derived from your schema (`@zmdb/schema-core/dto`). Each column is keyed to its value type with an operator set, and `compileWhere` folds
it into the query builder.

```ts
import { compileWhere, type WhereDTO } from '@zmdb/schema-core/dto';

const where: WhereDTO<User> = {
  age: { gte: 18, lt: 65 }, // ANDed comparisons
  role: 'admin', // bare value ⇒ eq
  email: { like: '%@corp.com' }, // like/ilike only on string fields
  or: [{ id: { in: [1, 2] } }, { email: { isNull: true } }],
};
compileWhere(builder, where); // → parameterized WHERE clauses
```

Operators: `eq/ne/lt/lte/gt/gte`, `in/nin`, `like/ilike`, `isNull/notNull`, with `and`/`or` group composition. `like`/`ilike` are a **compile-time error** on non-string fields.

An **empty** operator map is a `ValidationError` too — `{ age: {} }` names a column and constrains it in no way, which is every row. `{}` as the whole filter stays legal, because an unfiltered
`list()` is a real query; naming a column and then saying nothing about it is not.

Any other operator key is a **`ValidationError`** naming the column and the key. That matters for the untyped case — a `WhereDTO` assembled from parsed JSON rather than written as a literal — because
the alternative is a query that looks filtered and is not: a dropped predicate on a `SELECT` over-discloses, and on an `UPDATE` or `DELETE` it is the whole table. Inherited keys are refused for the
same reason, so `{"email": {"toString": "x"}}` is a `ValidationError` and not a 500.
