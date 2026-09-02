TypeBox is the closest neighbour zmdb has, because it targets JSON Schema. That makes the interop genuinely useful rather than just a migration path: zmdb _emits_ JSON Schema, and TypeBox _is_ JSON Schema.

```ts
// TypeBox
const User = Type.Object({ id: Type.Number(), email: Type.String() });
type User = Static<typeof User>;
const check = TypeCompiler.Compile(User); // codegen via new Function
check.Check(body);

// zmdb
interface User {
  id: number;
  email: string;
}
is<User>(body);
```

## The `new Function` difference

This is the substantive one. `TypeCompiler.Compile` generates a function with `new Function`, which is fast and needs runtime code generation. zmdb's validators contain **no `new Function` and no `eval` anywhere in the packages** — the descriptor is a literal produced at build time.

|                                                 | TypeBox `TypeCompiler`     | zmdb                       |
| ----------------------------------------------- | -------------------------- | -------------------------- |
| Codegen                                         | at runtime, `new Function` | at build time, transformer |
| Strict CSP (`script-src` without `unsafe-eval`) | **no**                     | yes                        |
| Cloudflare Workers / edge                       | **generally no**           | yes                        |
| Cold-start cost                                 | compile per process        | none                       |
| Steady-state speed                              | very fast                  | comparable                 |

TypeBox's uncompiled `Value.Check` avoids codegen but is much slower. So the choice under a strict CSP is between slow TypeBox and fast zmdb, which is the case where this actually matters. See [JIT vs AOT](./jit-vs-aot.html).

## Real interop: zmdb schema → JSON Schema → TypeBox

`toJsonSchema` emits JSON Schema, and TypeBox consumes JSON Schema by construction — so a declared table can validate through TypeBox, ajv, or anything else in that ecosystem:

```ts
import { toJsonSchema, toOpenApiComponents } from '@zmdb/schema-core/openapi';

const createSchema = toJsonSchema(posts, 'create'); // omits serial, respects defaults
const components = toOpenApiComponents([users, posts]);
```

```ts
import Ajv from 'ajv';
const validate = new Ajv().compile(createSchema);
```

The variants are `entity | create | update | get | list | search`, so you get the right shape per operation rather than one schema you narrow by hand. See [OpenAPI Schemas](./openapi.html).

This is the pattern for the dynamic case too: where you need a runtime-defined validator, generate JSON Schema from your data and hand it to ajv, rather than trying to make a type parameter dynamic.

## Going the other way

There is no JSON-Schema-to-declaration importer. If you have JSON Schema as your source of truth — a shared API contract, say — you have two options:

- Generate TypeScript types from it (`json-schema-to-typescript`) and validate those with `assert<T>`. The generated types are compile-time input to the transformer, so this works cleanly.
- Keep ajv for that boundary and use zmdb for your own types.

## Mapping the API

| TypeBox                                | zmdb                                         |
| -------------------------------------- | -------------------------------------------- |
| `Value.Check(S, x)` / `check.Check(x)` | `is<T>(x)`                                   |
| `Value.Assert`                         | `assert<T>(x)`                               |
| `Value.Errors(S, x)`                   | `validate<T>(x).errors`                      |
| `Value.Clean(S, x)`                    | `validateObject(x, 'strip')`                 |
| `Value.Convert(S, x)`                  | [`coerce`](./unions-refinements.html)        |
| `Type.Union([...])`                    | [`union`](./unions-refinements.html)         |
| `Type.Union` with a literal tag        | [`discriminated`](./unions-refinements.html) |
| `additionalProperties: false`          | `validateObject(x, 'strict')`                |
| `Static<typeof S>`                     | the type itself                              |

## When to stay on TypeBox

- JSON Schema is genuinely your contract and other services consume it.
- You need runtime-constructed schemas.
- Your toolchain cannot run a TypeScript transformer.

## And the canary, as ever

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

TypeBox fails loudly when misconfigured. zmdb fails open. If you are replacing one with the other, this test is what keeps the swap honest.

---

See also: [OpenAPI Schemas](./openapi.html) · [JIT vs AOT](./jit-vs-aot.html) · [Zod](./interop-zod.html)
