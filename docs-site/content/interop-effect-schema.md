`@effect/schema` is part of Effect, and that is the whole story of the comparison: it is not primarily a validator, it is the data-description layer of an effect system with typed errors, dependency injection, resource safety and structured concurrency.

zmdb is not competing with that. If you are using Effect, use its schema; the value is in the integration with the rest of Effect, not in the validation.

## What interop looks like

The useful boundary is the driver, because `Driver` is one method:

```ts
import { Effect } from 'effect';
import type { Driver, CompiledQuery } from '@zmdb/query-compiler';

const query = (q: CompiledQuery) =>
  Effect.tryPromise({
    try: () => pool.query(q.text, [...q.parameters]).then(r => r.rows),
    catch: cause => new DatabaseError({ cause, sql: q.text }),
  });
```

Now the query compiler and repository sit inside Effect's error channel, with typed failures, retries and interruption handled by Effect rather than by zmdb — which is the right division, since zmdb has [no cancellation support](./query-cancellation.html) of its own.

The compiler is the cleanest integration point: `compile()` is a pure function returning `{ text, parameters }`, so it composes with anything. Wrap it and you have a data layer inside Effect with none of zmdb's async assumptions leaking in.

## Schemas at the boundary

Two workable arrangements.

**Effect Schema at the edges, zmdb inside.** Decode HTTP input with `Schema.decodeUnknown`, then work with plain objects and zmdb's derived DTO types internally. Effect owns the boundary, zmdb owns the SQL.

**zmdb schema → JSON Schema → Effect.** `toJsonSchema(schema, variant)` gives you a JSON Schema per operation shape, which you can convert or use to generate an Effect schema:

```ts
import { toJsonSchema } from '@zmdb/schema-core/openapi';
const createShape = toJsonSchema(posts, 'create');
```

There is no direct bridge in either direction, and adding one would mean a runtime dependency on Effect — which [Directive 7](./anti-patterns.html) rules out. So the bridge is yours to write, and it is small.

## Validators: pick one

Do not run `assert<T>` and `Schema.decode` over the same value. The failure shapes differ, the coercion behaviour differs, and you get two places to look when something is rejected. If you are in Effect, its schema wins on integration; if you have one Effect module in an otherwise plain codebase, `assert<T>` wins on not making the rest of your code learn Effect.

|                  | `@effect/schema`                   | zmdb validator                                   |
| ---------------- | ---------------------------------- | ------------------------------------------------ |
| Errors           | typed, in the Effect error channel | thrown, or `{ success, errors }`                 |
| Async validation | native                             | not supported                                    |
| Transforms       | bidirectional (encode/decode)      | one-way [`transform`](./unions-refinements.html) |
| Build step       | none                               | **required**                                     |
| Dependencies     | Effect                             | zero                                             |
| Dynamic schemas  | yes                                | no                                               |

Effect Schema supports bidirectional transforms: it encodes as well as decodes.
zmdb has no equivalent for applications that depend on the encode direction.

## Do not wrap zmdb in Effect wholesale

The temptation is a `ZmdbRepository` service wrapping every `BaseRepository` method in `Effect.tryPromise`. It works, and it is a lot of code that adds nothing beyond the one wrapper above — the repository methods are all `Promise`-returning and untyped in their failures, so a single generic adapter covers them:

```ts
const eff = <A>(f: () => Promise<A>) => Effect.tryPromise({ try: f, catch: c => new DatabaseError({ cause: c }) });

eff(() => repo.findById(1));
```

## The canary

Same as everywhere: if you use `assert<T>` at all, prove the transformer runs.

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

---

See also: [Writing a Driver](./custom-driver.html) · [Query Cancellation](./query-cancellation.html) · [Zod](./interop-zod.html)
