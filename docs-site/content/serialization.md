Turning rows into JSON, and JSON into rows, with the type doing the work in both directions.

## Out: `stringify`

```ts
import { stringify } from '@zmdb/aot-validator/serialization';

const json = stringify<Entity<typeof users>>(row);
```

The transformer generates a serializer specialised to the type, so it walks known keys rather than reflecting over the object. That is where the [benchmark](./benchmarks.html) numbers come from, and it has a second consequence worth knowing: **only fields in the type are emitted.** An extra property carried on the object silently does not appear in the output.

That is usually what you want — a row that picked up an internal field on its way through a service layer does not leak — but it means `stringify` is not a drop-in for `JSON.stringify` if you were relying on extra keys surviving.

## Out, with checking: `assertStringify`

```ts
import { assertStringify } from '@zmdb/aot-validator/serialization';

const json = assertStringify<Entity<typeof users>>(row); // throws if row is not a valid User
```

Use it on anything assembled by hand or arriving from raw SQL. Use plain `stringify` on values you already validated on the way in — checking the same object twice buys nothing.

## In: `parse`

```ts
import { parse } from '@zmdb/aot-validator/serialization';

const result = parse<CreateDTO<typeof users>>(text);
if (!result.success) throw new ValidationError('invalid payload', result.errors);
const dto = result.data;
```

Throw rather than return a response object. The router serialises whatever a handler returns as a **200**, so a returned `{ status: 400, … }` becomes a 200 whose body happens to contain the number 400. Only a throw carrying an `issues` property produces a 400 — see [Request Lifecycle](./web-request-lifecycle.html).

`parse` returns a result object rather than throwing, which makes it the right function at an HTTP boundary: the failure is a value you turn into a 400, not an exception you have to catch to avoid a 500.

## In, from an object: `decode`

When the JSON text has already been parsed by something else — a body parser, a queue client — `decode` validates the resulting value without re-parsing:

```ts
import { decode } from '@zmdb/aot-validator/serialization';

const result = decode<CreateDTO<typeof users>>(alreadyParsed);
```

## Excluding fields

`sensitive()` is the schema-level answer, and it works because it changes the derived type:

```ts
export const users = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  passwordHash: text().notNull().sensitive(),
});
```

The column is still selected and still present on the row — [it affects serialization, not queries](./gotchas.html). If it must never leave the database, do not select it:

```ts
await repo.list({ select: ['id', 'email'] });
```

For per-endpoint shapes, name the type:

```ts
type PublicUser = Pick<Entity<typeof users>, 'id' | 'email'>;
const json = stringify<PublicUser>(row);
```

## Dates

`timestamp()` gives you a `Date`. `stringify` emits it as an ISO-8601 string, matching `JSON.stringify`. Coming back the other way, a `Date`-typed field in a `parse` target accepts an ISO string and produces a `Date` — so a round trip through JSON is stable, which is not true of `JSON.parse` on its own.

## Numbers that arrive as strings

`bigint` and `numeric` columns come back as strings from several drivers. `assert`ing a row against `Entity<S>` will _fail_ on those, correctly — the row does not match the type. Fix it in the driver, which is the only layer that knows which client it wraps. See [bigint keys](./bigint-keys.html).

## In `@zmdb/web`

Handlers return a value and the framework serializes it; `WebResponse.body` is a `string`. Reach for `stringify` explicitly when you want the generated serializer on a hot path, or `assertStringify` when the value was assembled from raw SQL.

---

See also: [stringify](./json-stringify.html) · [parse](./json-parse.html) · [Projections](./projections.html)
