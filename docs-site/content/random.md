`random<T>()` builds a value that satisfies `T` by construction. It is the fixture generator: you get valid test data without hand-writing a fixture, and the constraints on the type — bounds, lengths, literal unions — are honoured because the value is assembled _from_ them rather than checked against them afterwards.

> [!NOTE]
> `is<T>(random<T>()) === true` is the property the generator holds, and there is a test that
> says so. The values are not deterministic; there is no seed parameter yet.

## Basic Usage

```ts
import { random, is } from '@zmdb/aot-validator/utilities';

interface Account {
  name: string;
  age: number;
  active: boolean;
}

const sample = random<Account>();
// { name: 'k3f9qz', age: 417, active: true }

is<Account>(sample); // true
```

The type argument is the whole input. The transformer turns `random<Account>()` into a call carrying `Account`'s IR, which is also why the constraints in the type reach the generator at all — there is no second argument to keep in step with the first.

## Primitives

```ts
random<boolean>(); // true or false
random<number>(); // 0 … 1000
random<Date>(); // new Date()
random<bigint>(); // 417n
random<'admin' | 'user' | 'guest'>(); // 'user' — one member, at random
random<null>(); // null
```

A literal type samples to itself, which makes a discriminated union work the way you would hope: `random<{ kind: 'circle'; r: number }>()` always has `kind: 'circle'`.

## Constrained scalars

Constraints narrow the range rather than being validated after the fact:

```ts
import type { Max, MaxLength, Min, MinLength } from 'zmdb/tags';

random<number & Min<100> & Max<200>>(); // 100 … 200
random<string & MinLength<8> & MaxLength<8>>(); // exactly eight characters
```

An impossible bound is a thrown refusal rather than a wrong value:

```
cannot sample: a bound with minimum 200 above maximum 100
```

## Complex structures

```ts
interface Order {
  id: number;
  items: { productId: number; quantity: number & Min<1> }[];
}

const order = random<Order>();
// { id: 88, items: [{ productId: 3, quantity: 12 }, { productId: 91, quantity: 7 }] }
```

Arrays get 1–3 elements, or `MinLength`/`MaxLength` if the type says so. Tuples get exactly their arity. Objects get every property, including optional ones.

A union member is chosen at random, so `string | null` samples to a string about half the time and `null` the rest — which is what you want from a nullable column, and something to remember if a test asserts on the value.

## What it refuses, and why

The generator throws rather than returning something that does not satisfy the type. Five cases:

| Case                                      | Message                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| A `Pattern` constraint                    | `a sample cannot be built from a pattern; nothing here inverts a regular expression` |
| Contradictory numeric bounds              | `a bound with minimum 200 above maximum 100`                                         |
| Contradictory length bounds               | `a string with minLength 8 above maxLength 4`                                        |
| A type that recurs with no base arm       | `` `Node` recurs with no terminating arm, so no finite value satisfies it ``         |
| Anything the reflector marked unsupported | the reflector's own reason, passed through                                           |

The path is in the message — ``cannot sample `.shipTo.postcode`: …`` — so a refusal from deep inside a nested fixture names the property rather than the type.

> [!IMPORTANT]
> The pattern refusal is the deliberate one. The generator this replaced returned `'x'` for
> any pattern it did not recognise and an email-shaped string for anything containing `@`, so
> `is(random(d), d)` — the single property it claimed — was false for most patterns. Inverting
> a regular expression is a real problem and this does not solve it; it says so instead.

If a type you want to sample carries a `Pattern`, drop that property and supply it yourself:

```ts
const input = { ...random<Omit<CreateDTO<User>, 'email'>>(), email: 'a@b.test' };
```

Recursion through a union terminates, because a back-reference member is dropped rather than followed: `interface Node { next: Node | null }` samples to `{ next: null }` or `{ next: { next: null } }`. Only a reference with no non-recursive arm beside it is refused.

## Using with a declared table

`random<T>()` takes the type, so a table's own declaration is the fixture generator:

```ts
import { random } from '@zmdb/aot-validator/utilities';
import type { CreateDTO } from 'zmdb/derive';
import type { Max, MaxLength, Min, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'> & MaxLength<100>;
  email: string & Sql<'text'>;
  age: (number & Sql<'integer'> & Min<0> & Max<120>) | null;
}

const sampleUser = random<CreateDTO<User>>();
// { name: 'k3f9qz', email: 'p2m8t1x', age: 25 }
```

`CreateDTO<User>` rather than `User` is what makes this useful for an insert: `id` is `Serial`, so it is absent, and there is no generated id to collide with the one the database is about to assign.

Note `email` carries no `Pattern` here. Adding one would make the whole table unsamplable, which is a real tension: the tag that makes validation stricter is the tag that stops the fixture generator. Either keep the pattern and use the `Omit` form above, or keep it off the column and check the address at the boundary that actually receives one.

## Integration with Testing

```ts
import { random, is, assertEquals } from '@zmdb/aot-validator/utilities';

describe('UserRepository', () => {
  it('creates valid users', async () => {
    const input = random<CreateDTO<User>>();

    // Generated data is guaranteed valid
    is<CreateDTO<User>>(input); // true

    const created = await repo.create(input);

    // The row that came back is exactly an entity — no extra keys, none missing
    assertEquals<Entity<User>>(created);
  });

  it('rejects invalid input', async () => {
    const invalid = { email: 'not-email', name: 'x'.repeat(101), age: 15 };

    await expect(repo.create(invalid)).rejects.toThrow();
  });
});
```

## Generated value ranges

| Type               | Range / behaviour                                            |
| ------------------ | ------------------------------------------------------------ |
| `number`/`integer` | `Min` (or 0) … `Max` (or `Min` + 1000), inclusive            |
| `bigint`           | the same range, as a `bigint`                                |
| `string`           | base-36 characters, `MinLength` (or 1) … `MaxLength` (or 12) |
| `boolean`          | 50/50                                                        |
| `Date`             | now                                                          |
| literal union      | one member, uniformly                                        |
| array              | 1–3 elements unless bounded, each recursively generated      |
| tuple              | exactly its arity                                            |
| object             | every property, recursively                                  |
| `null`/`unknown`   | `null`                                                       |

> [!IMPORTANT]
> Generated values are _structurally valid_ but not _meaningful_ — `'k3f9qz'` satisfies
> `string & MaxLength<100>` and is not a name. Use these for testing validation and
> persistence, not for seeding anything a human will read. See [Seeding](./seeding.html).

## Random for fuzzing

```ts
import { random, validate } from '@zmdb/aot-validator/utilities';

for (let i = 0; i < 1000; i++) {
  const input = random<CreateDTO<User>>();

  // Should always pass — `random` builds the value from the same IR `validate` checks
  const result = validate<CreateDTO<User>>(input);
  if (!result.success) {
    console.error('Generated invalid input:', input, result.errors);
  }
}
```

That loop is a property test of the validator, not of your code: a failure means the generator and the checker disagree about the same IR. It is worth running once after a change to either.

---

- [Tag Reference](./tags-reference.html) — the constraints `random` honours
- [validators-validate](./validators-validate.html) — validation
- [validators-assert](./validators-assert.html) — assertion
- [json-parse](./json-parse.html) — JSON parsing
