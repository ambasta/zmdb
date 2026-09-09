`parse` is JSON parsing that reports malformed input as a structured result rather than throwing. It does not check the shape — that is a separate step, and keeping the two separate is what lets a
handler answer "that is not JSON" differently from "that is JSON, and `age` is missing".

## Basic Usage

```ts {"mode":"compile","id":"example-001"}
import { parse } from '@zmdb/validator/serialization';

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

## `ValidateResult<unknown>`

```ts {"mode":"compile","id":"example-002"}
import type { ValidateResult } from '@zmdb/validator';
import { parse } from '@zmdb/validator/serialization';

const result: ValidateResult<unknown> = parse('{}');
```

`parse` returns a discriminated result: success provides `data` of type `unknown`, and failure provides `issues`. It takes no type argument; validate the parsed value to prove its shape.

```ts {"mode":"compile","id":"example-003"}
import { parse } from '@zmdb/validator/serialization';

const result = parse('{"name": "bob", "age": 25}');

if (result.success) {
  result.data; // unknown — shape has not been checked
} else {
  console.error(result.issues[0]?.message);
}
```

## Parsing, then checking

The pairing that does prove it is `parse` followed by [`validate<T>`](./validators-validate.html) or [`assert<T>`](./validators-assert.html), both of which take the type as their argument and get
their IR from the transformer:

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies text; this excerpt does not repeat those declarations."}
import { parse } from '@zmdb/validator/serialization';
import { validate } from '@zmdb/validator';
import type { Min, Pattern } from '@zmdb/core/tags';

interface Signup {
  email: string & Pattern<'^[^@]+@[^@]+$'>;
  age: number & Min<18>;
}

const parsed = parse(text);
if (!parsed.success) return reply.status(400).send({ errors: parsed.issues });

const checked = validate<Signup>(parsed.data);
if (!checked.success) return reply.status(422).send({ errors: checked.issues });

checked.data; // Signup — checked, every property
```

Two steps and two status codes, which is the argument for writing it this way: a syntax error is the client's framing (400) and a shape error is the client's content (422). Both carry the same
`ValidationIssue` shape, so the response body is one format either way.

## `decode`

`decode` does both in one call, and takes the schema as a **runtime argument**:

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies ir; this excerpt does not repeat those declarations."}
import { decode } from '@zmdb/validator/serialization';

const ok = decode('{"email": "test@example.com", "age": 25}', ir);
// { success: true, data: … }

const invalid = decode('{"email": "bad", "age": 15}', ir);
// { success: false, issues: [ /* validation issues, exact paths */ ] }

const malformed = decode('not json', ir);
// { success: false, issues: [{ path: 'input', expected: 'valid JSON', … }] }
```

> [!IMPORTANT] `decode` is **not** one of the calls the transformer rewrites — the seventeen it currently does are `is`, `isShallow`, `assert`, `assertShallow`, `equals`, `assertEquals`, `validate`,
> `validateShallow`, `random`, `toJsonSchema`, `schemaOf`, `toolFor`, `protoDescriptor`, `protoDecode` `protoEncode`, `grpcDescriptor` and `loadGrpcService`. So `decode<Signup>(text)` with no second
> argument does not get an inlined schema. Supply an explicit generated schema; otherwise `decode` returns a failed result whose issues contain `runtime type witness required in test/fallback mode`.
>
> Until `decode` joins the list, prefer `parse` + `validate<T>` above. It is one extra line, it is transformed, and it gives you the two failure modes separately.

`assertStringify(value, schema?)` has the same shape of gap on the way out; `stringify(value)` alone is the transformed-free path and is byte-identical to `JSON.stringify`, except that a `bigint`
anywhere in the graph throws a `TypeError` with one message rather than the engine's.

## JSON columns

A `json` column's shape is part of its declaration, so the type to check a parsed payload against is already written:

```ts {"mode":"compile","id":"example-006"}
import type { Sql, Table, PrimaryKey, Serial } from '@zmdb/core/tags';

interface Payload {
  kind: string;
  attempts: number;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  payload: Payload & Sql<'json'>;
}
```

Postgres-family drivers hand back `json`/`jsonb` already parsed; MySQL-family, SQLite and SQL Server drivers hand back a string. That difference is the driver's, so the read side is:

```ts {"mode":"illustrative","id":"example-007","reason":"The surrounding example supplies Payload, assert, row; this excerpt does not repeat those declarations."}
const raw = row.payload;
const payload = typeof raw === 'string' ? assert<Payload>(JSON.parse(raw)) : raw;
```

`assert` rather than a cast, because a JSON column's contents are only as good as whatever last wrote them — including a hand-run `UPDATE`. See [Serialization](./serialization.html) and
[JSON Properties](./json-properties.html).

---

- [json-stringify](./json-stringify.html) — serialization
- [json-schema](./json-schema.html) — JSON Schema generation
- [validators-validate](./validators-validate.html) — full validation
