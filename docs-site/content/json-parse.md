`parse` is JSON parsing that reports malformed input as a structured result rather than throwing. It does not check the shape — that is a separate step, and keeping the two separate is what lets a
handler answer "that is not JSON" differently from "that is JSON, and `age` is missing".

## Basic Usage

<!-- snippet: json-parse.ts#snippet-1 -->

The `message` is the engine's own, passed through — it is the only part of an issue here that zmdb does not choose, and it says where in the text the syntax went wrong.

## `ParseResult<T>`

<!-- snippet: json-parse.ts#snippet-2 -->

> [!WARNING] `parse<T>()`'s type argument is an **unvalidated claim** — exactly what `JSON.parse` gives you, and no more. `parse<User>(text)` types `data` as `User` without having checked one property
> of it. Use it when you are about to check the value anyway; do not use it as the check.

<!-- snippet: json-parse.ts#snippet-3 -->

## Parsing, then checking

The pairing that does prove it is `parse` followed by [`validate<T>`](./validators-validate.html) or [`assert<T>`](./validators-assert.html), both of which take the type as their argument and get
their IR from the transformer:

<!-- snippet: json-parse.ts#snippet-4 -->

Two steps and two status codes, which is the argument for writing it this way: a syntax error is the client's framing (400) and a shape error is the client's content (422). Both carry the same
`ValidationIssue` shape, so the response body is one format either way.

## `decode`

`decode` does both in one call, and takes the schema as a **runtime argument**:

<!-- snippet: json-parse.ts#snippet-5 -->

> [!IMPORTANT] `decode` is **not** one of the calls the transformer rewrites — the seventeen it currently does are `is`, `isShallow`, `assert`, `assertShallow`, `equals`, `assertEquals`, `validate`,
> `validateShallow`, `random`, `toJsonSchema`, `schemaOf`, `toolFor`, `protoDescriptor`, `protoDecode` `protoEncode`, `grpcDescriptor` and `loadGrpcService`. So `decode<Signup>(text)` with no second
> argument does not get an inlined schema; it throws `runtime type witness required in test/fallback mode`. `decode` only converts an `AssertError` into a failed result, so that plain `Error` escapes
> the result object entirely.
>
> Until `decode` joins the list, prefer `parse` + `validate<T>` above. It is one extra line, it is transformed, and it gives you the two failure modes separately.

`assertStringify(value, schema?)` has the same shape of gap on the way out; `stringify(value)` alone is the transformed-free path and is byte-identical to `JSON.stringify`, except that a `bigint`
anywhere in the graph throws a `TypeError` with one message rather than the engine's.

## JSON columns

A `json` column's shape is part of its declaration, so the type to check a parsed payload against is already written:

<!-- snippet: json-parse.ts#snippet-6 -->

Postgres-family drivers hand back `json`/`jsonb` already parsed; MySQL-family, SQLite and SQL Server drivers hand back a string. That difference is the driver's, so the read side is:

<!-- snippet: json-parse.ts#snippet-7 -->

`assert` rather than a cast, because a JSON column's contents are only as good as whatever last wrote them — including a hand-run `UPDATE`. See [Serialization](./serialization.html) and
[JSON Properties](./json-properties.html).

---

- [json-stringify](./json-stringify.html) — serialization
- [json-schema](./json-schema.html) — JSON Schema generation
- [validators-validate](./validators-validate.html) — full validation
