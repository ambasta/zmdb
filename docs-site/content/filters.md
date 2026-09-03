`where` accepts a column, operator and value. Chained `where` clauses are ANDed; use `orWhere` for OR.

```ts
.where('role', '=', 'admin')
.where('createdAt', '>', someDate)
.where('id', 'in', [1, 2, 3])
.where('email', 'like', '%@example.com')
```

Supported operators include `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not in`, `like`, `is null`, `is not null`. Values are always parameterized.

> [!WARNING]
> The **value** is parameterized; the **operator** is not. An operator the builder does
> not recognise is passed through into the SQL text verbatim, which is what makes
> `.where('ts', '@>', range)` work for a dialect-specific operator the builder has never
> heard of. So `.where(col, op, value)` must never be handed an operator that came from
> a request:
>
> ```ts
> // measured: SELECT * FROM "users" WHERE "role" = 'x' OR 1=1 -- $1
> qb.selectFrom('users').where('role', "= 'x' OR 1=1 --", 1).compile();
> ```
>
> Use the typed `WhereDTO` below for anything user-supplied — it maps a closed set of
> operator names to SQL and refuses the rest — or check the operator against your own
> allowlist before calling `.where`.

## Typed filters — WhereDTO

For the repository/read side there is a **typed** filter DTO derived from your schema (`@zmdb/schema-core/dto`). Each column is keyed to its value type with an operator set, and `compileWhere` folds it into the query builder.

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

An **empty** operator map is a `ValidationError` too — `{ age: {} }` names a column and
constrains it in no way, which is every row. `{}` as the whole filter stays legal, because an
unfiltered `list()` is a real query; naming a column and then saying nothing about it is not.

Any other operator key is a **`ValidationError`** naming the column and the key. That matters for the untyped case — a `WhereDTO` assembled from parsed JSON rather than written as a literal — because the alternative is a query that looks filtered and is not: a dropped predicate on a `SELECT` over-discloses, and on an `UPDATE` or `DELETE` it is the whole table. Inherited keys are refused for the same reason, so `{"email": {"toString": "x"}}` is a `ValidationError` and not a 500.
