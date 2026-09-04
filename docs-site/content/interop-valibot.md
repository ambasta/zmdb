Valibot's pitch is bundle size: a pipeline of tree-shakeable functions instead of a class-based schema. It ends up architecturally close to Zod, and the comparison with zmdb is the same one — schema-as-value versus type-as-schema.

```ts
// Valibot
const User = v.object({ id: v.number(), email: v.pipe(v.string(), v.email()) });
type User = v.InferOutput<typeof User>;
const parsed = v.parse(User, body);

// zmdb
interface User {
  id: number;
  email: string;
}
const parsed = assert<User>(body);
```

## Bundle size

Valibot's advantage over Zod is real: you import the validators you use, so a small schema pulls in a small amount of code.

zmdb's position is different rather than strictly better:

- **No schema objects at all.** Nothing to import per type.
- **But** the AOT transformer emits a descriptor literal per validated type, inline in your output. Ten small types cost less than Valibot; a hundred large nested types may cost more.
- **No runtime library to load** on top of either.

If bundle size is the deciding factor, measure your actual types rather than trusting either claim. The [benchmarks](./benchmarks.html) cover throughput, not bytes.

## Where zmdb wins outright

Valibot still needs the schema written twice in effect — once as a pipeline, once as the type you get back from `InferOutput`. It reads as one declaration, but any type you already have (from an OpenAPI generator, a shared package, a database schema) must be re-expressed as a pipeline to validate it. `assert<T>` takes the type you have.

## Where Valibot wins

- Runtime-constructed schemas — the pipeline is data, so you can build it dynamically.
- No build step, so it works anywhere: Bun, Metro, Deno, an esbuild-only pipeline.
- `v.pipe` transforms compose in a way that is more ergonomic than chaining [`transform`](./unions-refinements.html) calls.

## Using both

The sensible split is the same as with Zod: Valibot for anything defined at runtime, zmdb for your own fixed DTOs.

```ts
const dto = assert<CreatePostDto>(body); // fixed shape
const custom = v.parse(buildPipeline(tenantConfig), extra); // tenant-defined shape
```

## Mapping the API

| Valibot                            | zmdb                                           |
| ---------------------------------- | ---------------------------------------------- |
| `v.parse(S, x)`                    | `assert<T>(x)`                                 |
| `v.safeParse(S, x)`                | `validate<T>(x)`                               |
| `v.is(S, x)`                       | `is<T>(x)`                                     |
| `v.pipe(S, v.check(fn))`           | [`refine`](./unions-refinements.html)          |
| `v.pipe(S, v.transform(fn))`       | [`transform`](./unions-refinements.html)       |
| `v.union([...])`                   | [`union`](./unions-refinements.html)           |
| `v.variant('kind', [...])`         | [`discriminated`](./unions-refinements.html)   |
| `v.strictObject` / `v.looseObject` | `validateObject(x, 'strict' \| 'passthrough')` |
| `v.optional(S)`                    | `T \| undefined` in the type                   |

`validateObject` also has a `'strip'` mode, which drops unknown keys instead of accepting or rejecting them — the right choice for a public API where extra fields should not be persisted. See [Object Modes](./unions-refinements.html).

## Migrating

Same three steps as [the Zod migration](./interop-zod.html): keep the inferred type as a real interface, swap `parse`/`safeParse` for `assert`/`validate`, and add the transformer canary **first** — without it the swap replaces working validation with unconditional success.

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

---

See also: [Zod](./interop-zod.html) · [Unions](./unions-refinements.html) · [Object Modes](./unions-refinements.html)
