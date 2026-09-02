`validate<T>()` is non-throwing validation: it returns a result object rather than raising. Use it where a failure is an expected outcome you have to render — a request body, a config file, a queue message — and [`assert`](./validators-assert.html) where a failure means a bug.

```ts
interface ValidateResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly errors?: readonly ValidationIssue[];
}
```

## Basic Usage

The type argument is the schema. There is nothing to pass and nothing to keep in step:

```ts
import { validate } from '@zmdb/aot-validator/utilities';
import type { Min, Pattern } from 'zmdb/tags';

interface Signup {
  email: string & Pattern<'^[^@]+@[^@]+$'>;
  age: number & Min<18>;
}

const ok = validate<Signup>({ email: 'user@example.com', age: 25 });
// { success: true, data: { email: 'user@example.com', age: 25 } }

const bad = validate<Signup>({ email: 'invalid', age: 15 });
// { success: false, errors: [ … ] }
```

On success, `data` is narrowed to `T`; on failure it is absent and `errors` is populated. The
two are never both present, so the discriminator to branch on is `success`:

```ts
const result = validate<Signup>(body);
if (!result.success) return reply.status(400).send({ errors: result.errors });
result.data; // Signup
```

> [!NOTE]
> The transformer rewrites `validate<Signup>(body)` into a call carrying `Signup`'s IR,
> reflected from the type at build time. The second parameter — a `RuntimeSchema`, either a
> `TypeIR` or a `TypeDescriptor` — is the escape hatch for a caller that already holds one;
> the transformer normally supplies it and you do not write it. Without the transformer, an
> untransformed call with no second argument throws.

## Error Structure

Each issue carries where and what:

```ts
interface ValidationIssue {
  readonly path: string; // 'input.items[2].name'
  readonly message: string; // human-readable
  readonly expected?: string; // 'string', 'maxLength 50', 'no excess properties'
  //                             a violated bound reads `<keyword> <value>`;
  //                             a wrong type reads the type
  readonly value?: unknown; // the offending value
}
```

`path` is exact, including array indices and nested keys:

```ts
import type { MaxLength } from 'zmdb/tags';

interface Roster {
  users: { name: string & MaxLength<10> }[];
}

validate<Roster>({ users: [{ name: 'LongNameTooLong' }] });
// errors[0].path === 'input.users[0].name'
```

`validate` collects every issue rather than stopping at the first, which is what makes it usable for a form: one round trip, every field.

## Validating a table's write shape

The DTO types are the useful arguments here — they are the shapes a client actually sends:

```ts
import { validate } from '@zmdb/aot-validator/utilities';
import type { CreateDTO, UpdateDTO } from 'zmdb/derive';
import type { Min, Pattern, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+$'>;
  age: number & Sql<'integer'> & Min<18>;
}

const create = validate<CreateDTO<User>>(body); // `id` is absent — it is Serial
const patch = validate<UpdateDTO<User>>(body); // every column optional, `id` absent
```

`CreateDTO<User>` and not `User`: passing an `id` to an insert is an error worth reporting, and the DTO type is what makes it one. See [DTO Helpers](./read-dtos.html).

## Integration with Repository

You get this without asking on every write. `create`, `upsert` and `update` validate the payload
against the same IR before any SQL is compiled:

```ts
await repo.create({ email: 'new@example.com', age: 25 }); // OK
await repo.create({ email: 'bad', age: 10 }); // throws ValidationError
```

The thrown `ValidationError` carries `.issues`, the same `ValidationIssue[]` shape, so a handler can render a repository failure and a boundary failure the same way:

```ts
import { validationIssuesOf } from '@zmdb/schema-core';

try {
  await repo.create(payload);
} catch (err) {
  const issues = validationIssuesOf(err);
  if (issues) return reply.status(400).send({ errors: issues });
  throw err;
}
```

`validationIssuesOf` is structural rather than an `instanceof` check — it accepts anything carrying a well-formed `issues` array, so a zod or io-ts error from elsewhere in the same handler lands in the same branch — and it drops entries missing a `path` or a `message` rather than serialising them half-formed into a response body.

Two things it checks that a hand-written walk over the columns would not: the bounds (`Min`, `Pattern`, `MaxLength`) that the declaration carries, and excess keys — supplying a `Serial` column gets you `the database generates "id", so a payload cannot supply it` rather than a silent drop.

## `validate` against the others

| Function             | On failure                   | On success                              |
| -------------------- | ---------------------------- | --------------------------------------- |
| `is<T>(x)`           | `false`                      | `true`, narrows `x`                     |
| `validate<T>(x)`     | `{ success: false, errors }` | `{ success: true, data }`               |
| `assert<T>(x)`       | throws `AssertError`         | returns `x` as `T`                      |
| `equals<T>(x)`       | `false`                      | `true` — and no excess keys             |
| `assertEquals<T>(x)` | throws                       | returns `x` as `T` — and no excess keys |

---

- [assert](./validators-assert.html) — throwing variant
- [is](./validators-is.html) — boolean type guard
- [tags](./validators-tags.html) — the constraints (`Min`, `Pattern`, …)
- [unions-refinements](./unions-refinements.html) — union types and custom refinements
