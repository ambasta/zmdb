`where` accepts a column, operator and value. Chained `where` clauses are ANDed; use `orWhere` for OR.

```ts
.where('role', '=', 'admin')
.where('createdAt', '>', someDate)
.where('id', 'in', [1, 2, 3])
.where('email', 'like', '%@example.com')
```

Supported operators include `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not in`, `like`, `is null`, `is not null`. Values are always parameterized.

## Typed filters — WhereDTO

For the repository/read side there is a **typed** filter DTO derived from your schema (`@zmdb/schema-core/dto`). Each column is keyed to its value type with an operator set, and `compileWhere` folds it into the query builder.

```ts
import { compileWhere, type WhereDTO } from '@zmdb/schema-core/dto';

const where: WhereDTO<typeof UserSchema> = {
  age: { gte: 18, lt: 65 }, // ANDed comparisons
  role: 'admin', // bare value ⇒ eq
  email: { like: '%@corp.com' }, // like/ilike only on string fields
  or: [{ id: { in: [1, 2] } }, { email: { isNull: true } }],
};
compileWhere(builder, where); // → parameterized WHERE clauses
```

Operators: `eq/ne/lt/lte/gt/gte`, `in/nin`, `like/ilike`, `isNull/notNull`, with `and`/`or` group composition. `like`/`ilike` are a **compile-time error** on non-string fields.
