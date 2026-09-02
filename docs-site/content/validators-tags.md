The validation tags system provides a declarative way to express constraints on primitive values. These tags (`Min`, `Max`, `MinLength`, `MaxLength`, `Pattern`, `Enum`) are building blocks that can be combined with schema definitions or used directly in validation code.

> [!TIP]
> Tags are the primitive constraint language — they compose with the `validate()` and `assert()` functions, and the AOT transformer inlines them to zero-overhead runtime checks.

## Available Tags

The `@zmdb/aot-validator` package exports a `tags` object with all validation rules:

```ts
import { tags } from '@zmdb/aot-validator';

tags.Min(18); // number >= 18
tags.Max(100); // number <= 100
tags.MinLength(1); // string length >= 1
tags.MaxLength(255); // string length <= 255
tags.Pattern('^\\d+$'); // matches regex
tags.Enum('admin', 'user', 'guest'); // one of these values
```

## Using Tags with Schema

Tags integrate directly with schema definitions:

```ts
import { defineSchema, text, integer, jsonEnum } from '@zmdb/schema-core';
import { tags } from '@zmdb/aot-validator';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate(tags.Pattern('^[^@]+@[^@]+\\.[^@]+$')).validate(tags.MaxLength(255)),
  age: integer().validate(tags.Min(0)).validate(tags.Max(150)),
  role: jsonEnum(['admin', 'user', 'guest']).notNull().defaultTo('user'),
});
```

```sql
-- Generated DDL includes inline CHECK constraints where supported:
-- CREATE TABLE "users" (
--   "id" serial PRIMARY KEY,
--   "email" varchar(255) NOT NULL CHECK ("email" ~* '^[^@]+@[^@]+\.[^@]+$'),
--   "age" integer CHECK ("age" >= 0 AND "age" <= 150),
--   "role" varchar CHECK ("role" IN ('admin', 'user', 'guest')) DEFAULT 'user'
-- );
```

## Two functions named `validate`

This is the one thing to get right about tags. The package exports **two** different `validate` functions from two entry points, and they take their arguments in opposite orders:

| Import                          | Signature                                                 | Returns                        |
| ------------------------------- | --------------------------------------------------------- | ------------------------------ |
| `@zmdb/aot-validator`           | `validate(rule: Rule, value: unknown)`                    | `boolean`                      |
| `@zmdb/aot-validator/utilities` | `validate<T>(value: unknown, descriptor: TypeDescriptor)` | `{ success, data? , errors? }` |

**The root one is the tag evaluator** — it takes a single tag and a value, and it is the call the AOT transformer rewrites into an inline boolean:

```ts
import { tags, validate } from '@zmdb/aot-validator';

validate(tags.Min(18), 21); // true
validate(tags.MaxLength(5), 'too long'); // false
validate(tags.Enum('admin', 'user'), 'guest'); // false
```

The transformer scans for `validate(` whose first argument is a `tags.KIND(...)` call and replaces the whole expression with the equivalent comparison — `21 >= 18` — so there is no function call and no rule object at runtime. That rewrite is the reason the argument order is rule-first: it is what makes the call recognisable in the source.

**The `utilities` one is the whole-value validator.** It takes a `TypeDescriptor`, not tags, and gives you a result object instead of a boolean:

```ts
import { validate } from '@zmdb/aot-validator/utilities';

validate(25, { kind: 'number', minimum: 18, maximum: 65 });
validate('user@example.com', { kind: 'string', pattern: '^[^@]+@[^@]+$' });
validate({ email: 'a@b.c', age: 25 }, { kind: 'object', fields: {/* … */} });
```

> [!WARNING]
> Passing a tag to the `utilities` version — `validate(tags.Min(18), 21)` after importing from `/utilities` — treats the tag object as the _value_ and `21` as the _descriptor_. Import the one you mean; the two are not interchangeable and neither is a type error against the other's arguments in every case.

In practice: use `tags` on columns via `.validate()` and let the schema carry them, use `assert<T>`/`is<T>` from `/utilities` at request boundaries, and reach for either bare `validate` only for a one-off check.

## Tag Semantics

| Tag               | Input Type | Constraint             |
| ----------------- | ---------- | ---------------------- |
| `Min(n)`          | number     | value >= n             |
| `Max(n)`          | number     | value <= n             |
| `MinLength(n)`    | string     | value.length >= n      |
| `MaxLength(n)`    | string     | value.length <= n      |
| `Pattern(regex)`  | string     | regex.test(value)      |
| `Enum(...values)` | string     | values.includes(value) |

## Runtime vs AOT

The runtime fallback validates by evaluating each tag rule:

```ts
// Runtime fallback (what runs without AOT):
function validate(rule: Rule, expr: unknown): boolean {
  switch (rule.kind) {
    case 'Min':
      return typeof expr === 'number' && expr >= rule.args[0];
    case 'Pattern':
      return typeof expr === 'string' && new RegExp(rule.args[0]).test(expr);
    // ...
  }
}
```

With AOT transformation enabled, the same validation becomes inlined:

```ts
// Authored:
validate(
  tags.Min(18),
  userAge,
)(
  // AOT output:
  typeof userAge === 'number' && userAge >= 18,
);
```

> [!IMPORTANT]
> The AOT transformer currently inlines `validate(tags.X(...), expr)` calls. Complex compositions may still fall back to the runtime validator in some cases.

- [validate](./validators-validate.html) — non-throwing validation
- [assert](./validators-assert.html) — throwing validation
- [unions-refinements](./unions-refinements.html) — custom validation rules
