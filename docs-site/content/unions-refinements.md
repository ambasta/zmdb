Unions are TypeScript unions. There is no `union()` combinator to learn for the validator, because the type argument is already the schema — `validate<Circle | Square>(x)` is the whole declaration,
and the emitter finds the discriminant on its own.

## Unions

```ts
import { assert, validate } from '@zmdb/aot-validator/utilities';

assert<string | number>(input); // string | number
validate<string | null>(input); // the nullable-column shape
```

An **undiscriminated** union is checked arm by arm: the value satisfies the union if it satisfies any member. On failure there is no arm to blame, so you get one issue naming the whole union at the
union's own path:

```ts
validate<string | number>(true);
// errors: [{ path: 'input', expected: 'string | number', message: 'expected string | number', value: true }]
```

> [!NOTE] Excess-property checks are not defined for an undiscriminated union, and neither `equals<T>` nor `assertEquals<T>` applies one there. A value can satisfy several arms at once, so "which
> arm's property list is the declared one" has no answer. Discriminated unions do get the check, per arm.

## Discriminated Unions

A union of object types is discriminated when some non-optional property is a distinct literal in every arm. That is found automatically:

```ts
type Payment = { type: 'credit'; cardNumber: string } | { type: 'debit'; bankCode: string } | { type: 'cash' };

const payment = assert<Payment>(body);
if (payment.type === 'credit') payment.cardNumber; // narrowed, as TypeScript narrows it
```

The failure messages are the reason to prefer this shape. With a discriminant, a bad tag is reported at the tag:

```ts
validate<Payment>({ type: 'crypto' });
// errors: [{ path: 'input.type', expected: '"credit" | "debit" | "cash"', value: 'crypto' }]
```

and a good tag with a bad body is reported inside the matching arm only, rather than as "none of three arms matched":

```ts
validate<Payment>({ type: 'credit', cardNumber: 42 });
// errors: [{ path: 'input.cardNumber', expected: 'string', value: 42 }]
```

The emitted form is a `switch` on the discriminant, so a twenty-arm union costs one comparison rather than twenty attempted matches.

Two details of what counts as a discriminant, both of which are about being sound rather than clever:

- **Every** arm must have the property, non-optional, with a literal type. One arm missing it disqualifies the candidate, and the first candidate property that qualifies wins.
- Arms are keyed by `JSON.stringify` of the literal, so `1` and `'1'` are two arms rather than a collision — the emitted comparison is `===`.

## Recursive types

A type that refers to itself becomes a `ref` node, resolved by name:

```ts
interface Node {
  value: number;
  next: Node | null;
}

assert<Node>(input); // walks the whole chain
```

`random<Node>()` terminates because a back-reference arm of a union is dropped when sampling, so `next` samples to `null`. A reference with no non-recursive arm beside it is refused rather than looped
— see [random](./random.html).

## Refinements

For a check the tag vocabulary does not model, `Rule<'name'>` names one:

```ts
import type { Rule, Sql, Table, PrimaryKey, Serial } from 'zmdb/tags';

export interface Account extends Table<'accounts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  iban: string & Sql<'varchar'> & Rule<'iban'>;
}
```

The reflection records the _name_ and nothing else — a rule takes no arguments, and an unregistered name is a build error rather than a check that silently passes. `Rule<'a' | 'b'>` is how a column
carries two.

> [!WARNING] `Rule<'name'>` lands in `ColumnIR.rules`, which is the **column** IR. The general type path honours only the five constraint keywords — `minimum`, `maximum`, `minLength`, `maxLength`,
> `pattern` — so a `Rule<'iban'>` on a bare type argument to `assert<T>()` is currently ignored rather than refused. On a declared column it reaches the consumers that read `ColumnIR`; anywhere else,
> write the check yourself.

The tags that _are_ honoured everywhere:

```ts
import type { Max, MaxLength, Min, MinLength, Pattern } from 'zmdb/tags';

type Adult = number & Min<18> & Max<120>;
type Slug = string & MinLength<1> & MaxLength<64> & Pattern<'^[a-z0-9-]+$'>;

assert<Adult>(age);
assert<Slug>(slug);
```

See [Tag Reference](./tags-reference.html).

## The rule-object API

`@zmdb/aot-validator/advanced` contains the older rule-value API: `refine`, `transform`, `union`, `discriminated`, `validateObject`, and `coerce`. It predates type-first declarations and is mostly a
stub:

```ts
import { refine, validateObject } from '@zmdb/aot-validator/advanced';

const adult = refine(v => typeof v === 'number' && v >= 18, 'must be at least 18');

validateObject({ age: 17 }, { age: adult }, 'strict');
// { success: false, issues: [{ path: 'input.age', expected: '<the predicate source>',
//                             message: 'must be at least 18', value: 17 }] }
```

`refine` takes a **function**, not a source string. The string form would need `unsafe-eval`, which contradicts the entire point of ahead-of-time emission, and a function is typechecked at the call
site where a string predicate can only fail at runtime. The source text is recovered from `Function.prototype.toString`, so inlining is still possible without it.

What that module does not do:

- `validateObject` returns `{ success, issues }` and **no `data`**. `'strip'` and `'passthrough'` are therefore indistinguishable today; only `'strict'` changes behaviour, by reporting each excess key
  as `no excess property` at `input.<key>`.
- `transform()` builds a rule and nothing applies it. No value is converted.
- Of the primitive rule kinds, `validateObject` implements `Min` and `MaxLength`; every other `kind` falls through to "ok". A rule it does not know **passes** rather than refusing, which is the
  opposite of the type path's behaviour and the main reason to prefer the type path.
- `discriminated()` evaluates its chosen branch against `value.value`, not against the value itself.

For unions, discriminated unions and constraint checking, the type argument does all of this properly. Reach into `advanced` only for `coerce.number` or `Brand`.

## Branded Types

```ts
import type { Brand } from '@zmdb/aot-validator/advanced';

type UserId = Brand<number, 'UserId'>;
type OrderId = Brand<number, 'OrderId'>;

const userId = 123 as UserId;
const orderId = 456 as OrderId;
// userId = orderId; // type error, though both are numbers at runtime
```

> [!WARNING] A brand is compile-time only — it erases to the base type, so `assert<UserId>(x)` checks `number` and nothing more. That is the same phantom-symbol mechanism the declaration tags use, and
> it has the same consequence: the brand is a claim your code makes to itself, not a check. Where the value comes from outside, brand it _after_ validating whatever actually distinguishes it.

---

- [validate](./validators-validate.html) — base validation
- [assert](./validators-assert.html) — throwing validation
- [Tag Reference](./tags-reference.html) — the constraint vocabulary
- [json-schema](./json-schema.html) — JSON Schema generation
