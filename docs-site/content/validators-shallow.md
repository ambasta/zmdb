Shallow validation is for rechecking data whose deeper contents were already validated. It deliberately makes a weaker promise than `is`, `assert` or `validate`, in exchange for emitted code and
runtime work that stop at a compile-time depth.

> [!WARNING] Do not use a shallow validator as the security boundary for an untrusted request body, queue message, config file or database value. A shallow check can accept malformed data below its
> depth and still return a value typed as `T`. Use the full-depth [`validate`](./validators-validate.html), [`assert`](./validators-assert.html) or [`is`](./validators-is.html) there.

## API

```ts
import { assert, assertShallow, isShallow, validateShallow } from '@zmdb/aot-validator/utilities';

const topLevelOkay = isShallow<Order, 1>(value);
const order = assertShallow<Order, 2>(value);
const result = validateShallow<Order, 2>(value);
```

`D` is a positive integer type argument. The top-level value is depth 1, and omitting `D` means depth 1. It cannot be a runtime variable: the transformer uses the literal to omit deeper branches from
the generated program.

The three results mirror their full-depth siblings:

- `isShallow<T, D>` returns a boolean and narrows the input to `T`.
- `assertShallow<T, D>` returns the input as `T`, or throws on a failure it reaches.
- `validateShallow<T, D>` returns `{ success, data }` or `{ success, errors }`, collecting failures it reaches.

That `T` is a TypeScript result, not a claim that every nested value was checked. The limit below is part of the contract.

## The legitimate use

Validate untrusted data once at its boundary, at full depth. A later internal boundary may recheck only the envelope when the nested values are already trusted:

```ts
const order = assert<PopulatedOrderRow>(untrustedBody); // full check, once

// Later, after storage or transport inside the same trust boundary:
const sameOrder = assertShallow<PopulatedOrderRow, 1>(order);
```

Depth 1 still checks the top-level object, required properties, top-level scalars, relation object shapes and list array-ness. It does not inspect fields inside those relations or elements inside
those lists.

If a branch has not already been validated, name it `unknown` and validate it when it is consumed instead of pretending the whole value is trusted:

```ts
interface JobEnvelope {
  kind: string;
  payload: unknown;
}

const job = assert<JobEnvelope>(body);
const payload = assert<ResizeArgs>(job.payload);
```

## What depth means

Depth counts type constructors entered:

| Type                       | `D` | Checked                                        | Stops at                    |
| -------------------------- | --- | ---------------------------------------------- | --------------------------- |
| `number`                   | 1   | `typeof value === 'number'`                    | nothing — no interior       |
| `{ a: number }`            | 1   | `a` is present and is a number                 | complete                    |
| `{ a: { b: number } }`     | 1   | `a` is a non-null object and not an array      | inside `a`                  |
| `{ a: { b: number } }`     | 2   | also `b` is present and is a number            | complete                    |
| `string[]`                 | 1   | `Array.isArray(value)`                         | every element               |
| `string[]`                 | 2   | also `typeof element === 'string'` per element | complete                    |
| `[string, number]`         | 1   | array-ness and tuple arity                     | both elements               |
| discriminated object union | 1   | the discriminant and the selected arm's shape  | inside the arm's properties |

Presence, optionality and nullability are always checked at the level reached. A tuple checks arity at depth 1 because arity belongs to the tuple constructor. A discriminated union reads its
discriminant at every depth so the validator does not narrow an arbitrary object to an arm on no evidence.

A depth larger than a finite type's nesting emits the same complete helper as full validation. A recursive type still has to be representable by reflection; shallow validation bounds its
emitted/runtime walk, but is not an escape hatch for an unsupported type.

## The emitted difference

The current transformer produced these checks for `{ user: { id: number } }`; whitespace is expanded here for readability.

Full depth:

```js
const check = input =>
  typeof input === 'object' &&
  input !== null &&
  !Array.isArray(input) &&
  typeof input.user === 'object' &&
  input.user !== null &&
  !Array.isArray(input.user) &&
  typeof input.user.id === 'number' &&
  !Number.isNaN(input.user.id);
```

Depth 1:

```js
const check = input => typeof input === 'object' && input !== null && !Array.isArray(input) && typeof input.user === 'object' && input.user !== null && !Array.isArray(input.user);
```

There is no runtime depth counter. The `input.user.id` branch is absent from the depth-1 output, which is why the generated program is smaller and why a string in that field is accepted.

## What it does not guarantee

`isShallow` returning `true`, `assertShallow` returning a value, and `validateShallow` returning `success: true` all share these limits. The wording below is the emitter specification's contract:

| Constructor              | At depth `D`, does **not** guarantee                                         |
| ------------------------ | ---------------------------------------------------------------------------- |
| object                   | anything about the contents of a property whose type is itself a constructor |
| array                    | that any element has the declared element type                               |
| tuple                    | that any element has its declared type — only that the arity is right        |
| discriminated union      | anything about the matched arm's properties beyond depth `D`                 |
| undiscriminated union    | _which_ arm matched, only that at least one matched to depth `D`             |
| record / index signature | (not applicable — an index signature is refused at reflection, §8)           |
| optional / nullable      | (nothing extra — presence and nullability are always fully checked)          |
| recursive type           | anything below depth `D`, however deep the value actually is                 |

## Measured populated-row result

The committed benchmark uses the real transformer output over eight `PopulatedOrderRow` values. Each has three populated relation objects and an `items` list with 100 rows.

| mode            | median ns/op | median ops/s | max/min spread |
| --------------- | -----------: | -----------: | -------------: |
| full            |       448.66 |    2,228,870 |         1.030x |
| shallow depth 1 |         9.95 |  100,460,099 |         1.044x |

In that run, depth 1 used 2.22% of the full validator's time: a measured 45.07× ratio. Six semantic probes ran before timing. Full validation rejected malformed fields inside a relation and a list
item; shallow depth 1 accepted both, while both modes rejected malformed top-level scalars, relation shapes and list shapes.

This is one local-machine result for one shape, not a general speed guarantee. The gain comes from the omitted work: a depth-1 array check is O(1) in its element count, while a full element walk is
O(n). Measure your own shape before choosing a depth. The [benchmark page](./benchmarks.html) documents the runner, and the [raw artifact](./site/shallow-validation.json) carries all 12 samples,
semantic probes and input hashes.

## It does not clone or prune

All three shallow functions inspect the original value. `assertShallow` returns that same value, and successful `validateShallow` data is not a stripped copy. Extra properties follow the same rules as
the full `is`/`assert`/`validate` family: they are ignored, not removed. Use an explicit projection or serializer when the goal is to produce a second shape.

---

See also: [validate()](./validators-validate.html) · [assert()](./validators-assert.html) · [is()](./validators-is.html) · [AOT Setup](./aot-setup.html)
