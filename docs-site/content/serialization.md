Turning rows into JSON, and JSON into rows, with the type doing the work in both directions.

## Out: `stringify`

```ts
import { stringify } from '@zmdb/aot-validator/serialization';

const json = stringify(row);
```

`stringify` is byte-identical to `JSON.stringify` for every value it accepts. The one
difference is `bigint`: it throws a `TypeError` with one fixed message wherever in the graph
the value sits, rather than the engine's own wording.

> [!NOTE]
> There is no type argument and no specialised serializer. `stringify` is **not** one of the
> eight calls the transformer rewrites, so nothing is emitted for a known shape and every key
> present on the object appears in the output. A specialised emitter built from the same
> `TypeIR` the validators use is the plan; it is not the behaviour today, and a document that
> told you extra keys were dropped was describing something that does not happen.

To drop keys, drop them from the value — a projection, not a serializer:

```ts
import type { ReadDTO } from 'zmdb/derive';

const { passwordHash, ...visible } = row;
const json = stringify(visible satisfies ReadDTO<User>);
```

## Out, with checking: `assertStringify`

```ts
import { assertStringify } from '@zmdb/aot-validator/serialization';

const json = assertStringify(row, ir); // throws AssertError if row is wrong
```

`assertStringify` is not transformed either, so its schema is a runtime argument. The
transformed equivalent is two calls, and it is the one to write today:

```ts
const json = stringify(assert<Entity<User>>(row));
```

Use it on anything assembled by hand or arriving from raw SQL. Use plain `stringify` on values you already validated on the way in — checking the same object twice buys nothing.

## In: `parse`

```ts
import { parse } from '@zmdb/aot-validator/serialization';

const result = parse(text);
if (!result.success) throw new ValidationError('invalid payload', result.issues ?? []);
```

`parse` reports malformed JSON as `issues` rather than throwing, which makes it the right
function at an HTTP boundary: a syntax error is a value you turn into a 400, not an exception
you have to catch to avoid a 500. Note the field is `issues`, not `errors` — `validate`'s
result uses `errors`, and the two shapes are otherwise the same.

Throw, or return a response the router recognises. An **object literal** is not one: the router serialises an untagged return value as a **200**, so a returned `{ status: 400, … }` becomes a 200 whose body happens to contain the number 400. `json(body, { status: 400 })` is recognised and really is a 400, and so is a throw carrying an `issues` property — see [Request Lifecycle](./web-request-lifecycle.html).

> [!WARNING]
> `parse<T>()`'s type argument is an **unvalidated claim** — the same one `JSON.parse` gives
> you. It checks nothing. The checking step is separate:
>
> ```ts
> const parsed = parse(text);
> if (!parsed.success) return reply.status(400).send({ errors: parsed.issues });
> const dto = assert<CreateDTO<User>>(parsed.data); // this is the check
> ```

## In, from an object

When the JSON text has already been parsed by something else — a body parser, a queue client — there is nothing to parse and the whole job is the check:

```ts
const dto = assert<CreateDTO<User>>(alreadyParsed);
```

`decode(text, schema)` is the combined form, but it takes a **string** and its schema is a runtime argument, so it is the wrong tool for an already-parsed value. See [json-parse](./json-parse.html).

## Excluding fields

`ReadDTO<T>` is the type-level answer, and it is unconditional: a `Sensitive` column is _removed from the type_, so naming it is a compile error rather than something a serializer has to remember.

```ts
import type { PrimaryKey, Sensitive, Serial, Sql, Table } from 'zmdb/tags';
import type { Entity, ReadDTO } from 'zmdb/derive';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  passwordHash: string & Sql<'text'> & Sensitive;
}

type Public = ReadDTO<User>; // { id: number; email: string } — no passwordHash
```

Three consequences worth knowing, because they are different from each other:

- **`Entity<User>` keeps it.** The column is still selected and still on the row — the tag changes what a _read endpoint_ may return, not what a query returns.
- **`CreateDTO<User>` keeps it too**, deliberately: you have to be able to send a password.
- **The generated JSON Schema and OpenAPI documents never name it**, in any variant, including `create`. The filter is applied at the last step before a document is published, so no derived type a caller invents can route around it.

If the value must never leave the database at all, do not select it:

```ts
await repo.list({ select: ['id', 'email'] });
```

For per-endpoint shapes, name the type:

```ts
type PublicUser = Pick<Entity<User>, 'id' | 'email'>;
```

## Dates

`Sql<'timestamp'>` gives you a `Date` in the app type, and `stringify` emits it as an ISO-8601 string exactly as `JSON.stringify` does.

> [!IMPORTANT]
> Coming back the other way, nothing revives it. `parse` is `JSON.parse`, so a `Date`-typed
> field arrives as a **string**, and `assert<Entity<User>>` on that value fails — correctly,
> because a string is not a `Date`.
>
> The boundary that converts is `wireDecoder`, which reads the column's wire type
> (`string`, `format: 'date-time'`) and produces a `Date` for the app type. Use it, or
> convert the field yourself before asserting.

## Numbers that arrive as strings

`bigint` and `numeric` columns come back as strings from several drivers. `assert`ing a row against `Entity<S>` will _fail_ on those, correctly — the row does not match the type. Fix it in the driver, which is the only layer that knows which client it wraps. See [bigint keys](./bigint-keys.html).

A `bigint` column's **wire** type is a string with `format: 'int64'` automatically, since `JSON.stringify(1n)` throws. That is the one place the three types of a column — wire, app, db — are visibly all different, and none of them is a mistake.

## In `@zmdb/web`

Handlers return a value and the framework serializes it into the text arm of
`WebResponse.body`. Reach for `stringify` explicitly when you want the `bigint`
policy, and for `wireEncoder` when the response has codec or `bigint` columns
that need converting. The `bytes()` and `stream()` factories bypass JSON
serialization deliberately.

---

See also: [stringify](./json-stringify.html) · [parse](./json-parse.html) · [Projections](./projections.html) · [DTO Helpers](./read-dtos.html)
