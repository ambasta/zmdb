There are **two** things called tags, and this page is mostly about telling them apart.

- **Type tags** — `Min<N>`, `Max<N>`, `MinLength<N>`, `MaxLength<N>`, `Pattern<S>`, `Rule<'…'>` from `zmdb/tags`. These go on a column in a declaration. They are types; they erase. This is what you
  want almost always, and the [Tag Reference](./tags-reference.html) is their home.
- **Rule values** — `tags.Min(18)` from `@zmdb/aot-validator`. Runtime objects for a one-off check against a bare value that is not part of any table.

They have the same names because they mean the same constraints. They are not interchangeable: one is a type argument, the other is a function call.

> [!TIP] Both forms compile away. A type tag becomes part of the validator the transformer emits for `assert<T>`; a rule value in `validate(tags.Min(18), x)` is rewritten in place to `x >= 18`.

## Constraints on a column

This is the common case, and there is no `validate()` call in it:

```ts
import type { Max, MaxLength, Min, Pattern, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\\.[^@]+$'> & MaxLength<255>;
  age: (number & Sql<'integer'> & Min<0> & Max<150>) | null;
  role: 'admin' | 'user' | 'guest';
}
```

`assert<CreateDTO<User>>(body)` now checks the pattern, both lengths and both bounds, because they are part of the type it was generated from. The same constraints reach the
[JSON Schema](./json-schema.html) and [OpenAPI](./openapi.html) output.

Note what `role` does _not_ have: there is no `Enum` type tag, because a literal union already says it and TypeScript checks it at every assignment rather than only at the boundary.

## Rule values, for a value with no table

The `@zmdb/aot-validator` package exports a `tags` object of rule constructors:

```ts
import { tags } from '@zmdb/aot-validator';

tags.Min(18); // number >= 18
tags.Max(100); // number <= 100
tags.MinLength(1); // string length >= 1
tags.MaxLength(255); // string length <= 255
tags.Pattern('^\\d+$'); // matches regex
tags.Enum('admin', 'user', 'guest'); // one of these values
```

## Two functions named `validate`

This is the one thing to get right about tags. The package exports **two** different `validate` functions from two entry points, and they take their arguments in opposite orders:

| Import                          | Signature                                      | Returns                       |
| ------------------------------- | ---------------------------------------------- | ----------------------------- |
| `@zmdb/aot-validator`           | `validate(rule: Rule, value: unknown)`         | `boolean`                     |
| `@zmdb/aot-validator/utilities` | `validate<T>(value: unknown, schema?: TypeIR)` | `{ success, data?, errors? }` |

**The root one is the tag evaluator** — it takes a single tag and a value, and it is the call the AOT transformer rewrites into an inline boolean:

```ts
import { tags, validate } from '@zmdb/aot-validator';

validate(tags.Min(18), 21); // true
validate(tags.MaxLength(5), 'too long'); // false
validate(tags.Enum('admin', 'user'), 'guest'); // false
```

The transformer scans for `validate(` whose first argument is a `tags.KIND(...)` call and replaces the whole expression with the equivalent comparison — `21 >= 18` — so there is no function call and
no rule object at runtime. That rewrite is the reason the argument order is rule-first: it is what makes the call recognisable in the source.

**The `utilities` one is the whole-value validator.** It takes a type argument, not tags, and gives you a result object instead of a boolean:

```ts
import { validate } from '@zmdb/aot-validator/utilities';

validate<Age>(25);
validate<CreateDTO<User>>(body);
```

The second parameter is the escape hatch, not the interface: it accepts a schema built by hand for the rare caller that has one, and the transformer supplies it from the type argument otherwise. An
untransformed call with neither throws rather than passing everything.

> [!WARNING] Passing a tag to the `utilities` version — `validate(tags.Min(18), 21)` after importing from `/utilities` — treats the tag object as the _value_ and `21` as the _descriptor_. Import the
> one you mean; the two are not interchangeable and neither is a type error against the other's arguments in every case.

In practice: put constraints on columns as type tags and let the declaration carry them, use `assert<T>`/`is<T>` from `/utilities` at request boundaries, and reach for `validate(tags.X(…), value)`
only for a one-off check on a value that is not part of a table.

## Semantics

The two spellings mean exactly the same thing, which is the point:

| Type tag        | Rule value        | Input Type | Constraint             |
| --------------- | ----------------- | ---------- | ---------------------- |
| `Min<N>`        | `Min(n)`          | number     | value >= n             |
| `Max<N>`        | `Max(n)`          | number     | value <= n             |
| `MinLength<N>`  | `MinLength(n)`    | string     | value.length >= n      |
| `MaxLength<N>`  | `MaxLength(n)`    | string     | value.length <= n      |
| `Pattern<S>`    | `Pattern(regex)`  | string     | regex.test(value)      |
| a literal union | `Enum(...values)` | string     | values.includes(value) |

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

> [!IMPORTANT] The AOT transformer currently inlines `validate(tags.X(...), expr)` calls. Complex compositions may still fall back to the runtime validator in some cases.

- [Tag Reference](./tags-reference.html) — the full type-tag vocabulary
- [validate](./validators-validate.html) — non-throwing validation
- [assert](./validators-assert.html) — throwing validation
- [unions-refinements](./unions-refinements.html) — custom validation rules
