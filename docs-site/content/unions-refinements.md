Unions are TypeScript unions. There is no `union()` combinator to learn for the validator, because the type argument is already the schema — `validate<Circle | Square>(x)` is the whole declaration,
and the emitter finds the discriminant on its own.

## Unions

<!-- snippet: unions-refinements.ts#snippet-1 -->

An **undiscriminated** union is checked arm by arm: the value satisfies the union if it satisfies any member. On failure there is no arm to blame, so you get one issue naming the whole union at the
union's own path:

<!-- snippet: unions-refinements.ts#snippet-2 -->

> [!NOTE] Excess-property checks are not defined for an undiscriminated union, and neither `equals<T>` nor `assertEquals<T>` applies one there. A value can satisfy several arms at once, so "which
> arm's property list is the declared one" has no answer. Discriminated unions do get the check, per arm.

## Discriminated Unions

A union of object types is discriminated when some non-optional property is a distinct literal in every arm. That is found automatically:

<!-- snippet: unions-refinements.ts#snippet-3 -->

The failure messages are the reason to prefer this shape. With a discriminant, a bad tag is reported at the tag:

<!-- snippet: unions-refinements.ts#snippet-4 -->

and a good tag with a bad body is reported inside the matching arm only, rather than as "none of three arms matched":

<!-- snippet: unions-refinements.ts#snippet-5 -->

The emitted form is a `switch` on the discriminant, so a twenty-arm union costs one comparison rather than twenty attempted matches.

Two details of what counts as a discriminant, both of which are about being sound rather than clever:

- **Every** arm must have the property, non-optional, with a literal type. One arm missing it disqualifies the candidate, and the first candidate property that qualifies wins.
- Arms are keyed by `JSON.stringify` of the literal, so `1` and `'1'` are two arms rather than a collision — the emitted comparison is `===`.

## Recursive types

A type that refers to itself becomes a `ref` node, resolved by name:

<!-- snippet: unions-refinements.ts#snippet-6 -->

`random<Node>()` terminates because a back-reference arm of a union is dropped when sampling, so `next` samples to `null`. A reference with no non-recursive arm beside it is refused rather than looped
— see [random](./random.html).

## Refinements

For a check the tag vocabulary does not model, `Rule<'name'>` names one:

<!-- snippet: unions-refinements.ts#snippet-7 -->

The reflection records the _name_ and nothing else — a rule takes no arguments, and an unregistered name is a build error rather than a check that silently passes. `Rule<'a' | 'b'>` is how a column
carries two.

> [!WARNING] `Rule<'name'>` lands in `ColumnIR.rules`, which is the **column** IR. The general type path honours only the five constraint keywords — `minimum`, `maximum`, `minLength`, `maxLength`,
> `pattern` — so a `Rule<'iban'>` on a bare type argument to `assert<T>()` is currently ignored rather than refused. On a declared column it reaches the consumers that read `ColumnIR`; anywhere else,
> write the check yourself.

The tags that _are_ honoured everywhere:

<!-- snippet: unions-refinements.ts#snippet-8 -->

See [Tag Reference](./tags-reference.html).

## The rule-object API

`@zmdb/aot-validator/advanced` contains the older rule-value API: `refine`, `transform`, `union`, `discriminated`, `validateObject`, and `coerce`. It predates type-first declarations and is mostly a
stub:

<!-- snippet: unions-refinements.ts#snippet-9 -->

`refine` takes a **function**, not a source string. The string form would need either runtime code generation or a second expression interpreter, and a function is typechecked at the call site where a
string predicate can only fail at runtime. The constructor also checks at runtime, so plain JavaScript cannot smuggle a string past the TypeScript signature. The rule records the intrinsic
`Function.prototype.toString` result for inspection; the current emitter does not consume advanced-rule source.

What that module does not do:

- `validateObject` returns `{ success, issues }` and **no `data`**. `'strip'` and `'passthrough'` are therefore indistinguishable today; only `'strict'` changes behaviour, by reporting each excess key
  as `no excess property` at `input.<key>`.
- `transform()` builds a rule and nothing applies it. No value is converted.
- Of the primitive rule kinds, `validateObject` implements `Min` and `MaxLength`; every other `kind` falls through to "ok". A rule it does not know **passes** rather than refusing, which is the
  opposite of the type path's behaviour and the main reason to prefer the type path.
- `discriminated()` evaluates its chosen branch against `value.value`, not against the value itself.

For unions, discriminated unions and constraint checking, the type argument does all of this properly. Reach into `advanced` only for `coerce.number` or `Brand`.

## Branded Types

<!-- snippet: unions-refinements.ts#snippet-10 -->

> [!WARNING] A brand is compile-time only — it erases to the base type, so `assert<UserId>(x)` checks `number` and nothing more. That is the same phantom-symbol mechanism the declaration tags use, and
> it has the same consequence: the brand is a claim your code makes to itself, not a check. Where the value comes from outside, brand it _after_ validating whatever actually distinguishes it.

---

- [validate](./validators-validate.html) — base validation
- [assert](./validators-assert.html) — throwing validation
- [Tag Reference](./tags-reference.html) — the constraint vocabulary
- [json-schema](./json-schema.html) — JSON Schema generation
