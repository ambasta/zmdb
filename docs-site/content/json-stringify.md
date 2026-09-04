`stringify` serializes a value to JSON. It is byte-identical to `JSON.stringify` for every value it accepts; the one difference is that a `bigint` anywhere in the graph throws one message rather than the engine's.

## Basic Usage

```ts
import { stringify } from '@zmdb/aot-validator/serialization';

stringify({ name: 'alice', age: 30, active: true });
// '{"name":"alice","age":30,"active":true}'

stringify([1, 2, 3]); // '[1,2,3]'
stringify({ user: { email: 'a@b.com' } }); // '{"user":{"email":"a@b.com"}}'
stringify(null); // 'null'
stringify(undefined); // undefined — not a string, exactly as JSON.stringify
```

No replacer and no space parameter. Where you want either, call `JSON.stringify` directly; this entry point exists for the `bigint` policy and for the AOT path to hook into later, not to wrap the whole API.

## Bigint

```ts
stringify({ id: 123n });
// TypeError: Do not know how to serialize a BigInt
```

The check is applied at the top level _and_ through a replacer, so a `bigint` nested five levels down throws the same message rather than the engine's own wording. Normalising it is the point: one message means a caller can match on it.

A `bigint` column does not need you to solve this by hand, though. The **wire** type for `Sql<'bigint'>` is a `string` with `format: 'int64'`, and you get that without asking — it is in the generated JSON Schema, the OpenAPI document, and what `wireEncoder` produces:

```ts
export interface Event extends Table<'events'> {
  id: bigint & Sql<'bigint'> & PrimaryKey;
}
// Entity<Event>['id'] is bigint; the JSON body carries "9007199254740993"
```

So the boundary encoder converts, and `stringify` throwing is the backstop for a value that reached JSON without going through one. See [bigint keys](./bigint-keys.html).

## `assertStringify`

`assertStringify(value, schema?)` validates before serializing:

```ts
import { assertStringify } from '@zmdb/aot-validator/serialization';

const json = assertStringify(payload, ir); // throws AssertError if payload is wrong
```

> [!IMPORTANT]
> `assertStringify` is **not** one of the fourteen calls the transformer currently rewrites (`is`,
> `isShallow`, `assert`, `assertShallow`, `equals`, `assertEquals`, `validate`,
> `validateShallow`, `random`, `toJsonSchema`, `schemaOf`, `protoDescriptor`, `protoDecode`,
> `protoEncode`), so its schema has to be a runtime argument. With none, it throws
> `runtime type witness required in test/fallback mode`.
>
> The transformed equivalent is two calls, and it is the one to write today:
>
> ```ts
> const json = stringify(assert<CreateDTO<User>>(payload));
> ```

## Comparison with `JSON.stringify`

| Feature             | `JSON.stringify`    | `stringify`                              |
| ------------------- | ------------------- | ---------------------------------------- |
| `bigint`            | throws `TypeError`  | throws `TypeError`, one fixed message    |
| `undefined`         | returns `undefined` | same                                     |
| `Error` objects     | `'{}'`              | same                                     |
| Circular references | throws              | same                                     |
| Custom replacer     | supported           | not exposed — the `bigint` guard uses it |
| `space` / indent    | supported           | not exposed                              |

## AOT inlining

> [!NOTE]
> Not implemented. `stringify` is not in the transformer's rewrite list, so there is no
> emitted concatenation for a known shape — the call is the runtime function in a built
> bundle as much as in dev. The plan is straight-line concatenation from the same `TypeIR`
> the validators use; the observable contract above is what will not change when it lands.

The validators _are_ inlined, and where a hot path is serializing something it just checked, the check is the part that was costing you. See [jit-vs-aot](./jit-vs-aot.html).

---

- [json-parse](./json-parse.html) — deserialization
- [json-schema](./json-schema.html) — JSON Schema generation
- [openapi](./openapi.html) — OpenAPI spec generation
