`parse` is JSON parsing that reports malformed input as a structured result rather than throwing. It does not check the shape — that is a separate step, and keeping the two separate is what lets a handler answer "that is not JSON" differently from "that is JSON, and `age` is missing".

## Basic Usage

```ts
import { parse } from '@zmdb/aot-validator/serialization';

const result = parse('{"name": "alice", "age": 30}');
// { success: true, data: { name: 'alice', age: 30 } }

const bad = parse('not valid json');
// {
//   success: false,
//   issues: [{ path: 'input', expected: 'valid JSON', value: 'not valid json',
//              message: 'Unexpected token o in JSON at position 0' }],
// }
```

The `message` is the engine's own, passed through — it is the only part of an issue here that zmdb does not choose, and it says where in the text the syntax went wrong.

## `ParseResult<T>`

```ts
interface ParseResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly issues?: readonly ValidationIssue[];
}
```

> [!WARNING]
> `parse<T>()`'s type argument is an **unvalidated claim** — exactly what `JSON.parse` gives
> you, and no more. `parse<User>(text)` types `data` as `User` without having checked one
> property of it. Use it when you are about to check the value anyway; do not use it as the
> check.

```ts
import { parse } from '@zmdb/aot-validator/serialization';

interface User {
  name: string;
  age: number;
}

const result = parse<User>('{"name": "bob", "age": 25}');

if (result.success) {
  result.data; // User — claimed, not proven
} else {
  console.error(result.issues?.[0]?.message);
}
```

## Parsing, then checking

The pairing that does prove it is `parse` followed by [`validate<T>`](./validators-validate.html) or [`assert<T>`](./validators-assert.html), both of which take the type as their argument and get their IR from the transformer:

```ts
import { parse } from '@zmdb/aot-validator/serialization';
import { validate } from '@zmdb/aot-validator/utilities';
import type { Min, Pattern } from 'zmdb/tags';

interface Signup {
  email: string & Pattern<'^[^@]+@[^@]+$'>;
  age: number & Min<18>;
}

const parsed = parse(text);
if (!parsed.success) return reply.status(400).send({ errors: parsed.issues });

const checked = validate<Signup>(parsed.data);
if (!checked.success) return reply.status(422).send({ errors: checked.errors });

checked.data; // Signup — checked, every property
```

Two steps and two status codes, which is the argument for writing it this way: a syntax error is the client's framing (400) and a shape error is the client's content (422). Both carry the same `ValidationIssue` shape, so the response body is one format either way.

## `decode`

`decode` does both in one call, and takes the schema as a **runtime argument**:

```ts
import { decode } from '@zmdb/aot-validator/serialization';

const ok = decode('{"email": "test@example.com", "age": 25}', ir);
// { success: true, data: … }

const invalid = decode('{"email": "bad", "age": 15}', ir);
// { success: false, issues: [ /* validation issues, exact paths */ ] }

const malformed = decode('not json', ir);
// { success: false, issues: [{ path: 'input', expected: 'valid JSON', … }] }
```

> [!IMPORTANT]
> `decode` is **not** one of the calls the transformer rewrites — the fifteen it currently does are
> `is`, `isShallow`, `assert`, `assertShallow`, `equals`, `assertEquals`, `validate`,
> `validateShallow`, `random`, `toJsonSchema`, `schemaOf`, `toolFor`, `protoDescriptor`, `protoDecode`
> and `protoEncode`. So
> `decode<Signup>(text)` with no second argument does not get an inlined schema; it throws
> `runtime type witness required in test/fallback mode`. `decode` only converts an
> `AssertError` into a failed result, so that plain `Error` escapes the result object
> entirely.
>
> Until `decode` joins the list, prefer `parse` + `validate<T>` above. It is one extra line,
> it is transformed, and it gives you the two failure modes separately.

`assertStringify(value, schema?)` has the same shape of gap on the way out; `stringify(value)` alone is the transformed-free path and is byte-identical to `JSON.stringify`, except that a `bigint` anywhere in the graph throws a `TypeError` with one message rather than the engine's.

## JSON columns

A `json` column's shape is part of its declaration, so the type to check a parsed payload against is already written:

```ts
import type { Sql, Table, PrimaryKey, Serial } from 'zmdb/tags';

interface Payload {
  kind: string;
  attempts: number;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  payload: Payload & Sql<'json'>;
}
```

Postgres drivers hand back `json`/`jsonb` already parsed; MySQL and SQLite hand back a string. That difference is the driver's, so the read side is:

```ts
const raw = row.payload;
const payload = typeof raw === 'string' ? assert<Payload>(JSON.parse(raw)) : raw;
```

`assert` rather than a cast, because a JSON column's contents are only as good as whatever last wrote them — including a hand-run `UPDATE`. See [Serialization](./serialization.html) and [JSON Properties](./json-properties.html).

---

- [json-stringify](./json-stringify.html) — serialization
- [json-schema](./json-schema.html) — JSON Schema generation
- [validators-validate](./validators-validate.html) — full validation
