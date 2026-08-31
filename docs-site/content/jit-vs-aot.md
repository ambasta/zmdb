Runtime validators build a checker when they first see a type. zmdb's build one at compile time. The difference shows up in three places: startup, throughput, and what can go wrong.

## What "AOT" means here

```ts
// what you write
const user = assert<User>(body);

// what the transformer emits (in essence)
const user = assert<User>(body, {
  kind: 'object',
  properties: {
    id: { kind: 'number' },
    email: { kind: 'string' },
    active: { kind: 'boolean' },
  },
});
```

The descriptor is a literal in your bundle. There is no schema to interpret at runtime, no first-call compilation, and — importantly — **no `new Function` and no `eval` anywhere in the packages**. That last point is not incidental: it is what lets the validators run under a strict Content Security Policy, in Cloudflare Workers, and in any environment where dynamic code generation is unavailable.

## Against the JIT approach

A library like Zod builds a validator object graph at module load and walks it per call. `ajv` and `typebox`'s compiler generate a function with `new Function`, which is fast per call but needs code generation at runtime.

|                         | JIT (interpreted)   | JIT (codegen)                 | zmdb (AOT)       |
| ----------------------- | ------------------- | ----------------------------- | ---------------- |
| Startup cost            | schema construction | schema construction + codegen | none             |
| Per-call cost           | tree walk           | near-optimal                  | near-optimal     |
| Needs `new Function`    | no                  | **yes**                       | **no**           |
| Works under strict CSP  | yes                 | no                            | yes              |
| Works in Workers / edge | yes                 | often not                     | yes              |
| Schema declared         | separately          | separately                    | it _is_ the type |
| Build step              | none                | none                          | **required**     |

The last two rows are the trade. You get no duplicate schema declaration and no runtime codegen; you pay with a build-step dependency.

## The cost: the build step is mandatory

Without the transformer, the descriptor argument is absent and the call has nothing to check against. It does not throw. It returns success.

```ts
is<User>({ email: 42 }); // transformed: false. untransformed: no descriptor, no check.
```

This is the single most consequential fact about the AOT approach, and it fails open — the worst direction for a validation layer to fail. Every project needs the canary:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

The environments where this bites are the ones with their own transpilers: [Bun](./connect-bun.html), Metro ([React Native](./connect-react-native.html)), esbuild-only pipelines, and `ts-node` without the plugin. See [AOT Setup](./aot-setup.html).

## Where the advantage actually is

The [measured numbers](./benchmarks.html) are on the benchmarks page, taken from the `typescript-runtime-type-benchmarks` harness rather than from a microbenchmark written to flatter the result. Two things to take from them:

- The gap is largest on **cold start**, because there is nothing to build. In a serverless function invoked once per request, schema construction is paid on every invocation for a JIT validator and never for this one. See [Serverless Performance](./perf-serverless.html).
- On **steady-state throughput** the codegen JIT libraries are competitive. If your process is long-lived and validation is not on your critical path, the honest answer is that this is not the reason to choose zmdb — the single-schema derivation is.

## Where AOT does not help

- **Dynamic shapes.** A type known only at runtime — a user-defined form schema — cannot be a type parameter. Use [JSON Schema and ajv](./interop-zod.html) for that, or `evalRule` in [advanced validation](./unions-refinements.html).
- **Bundle size.** The descriptors are literals in your output. Many large types means more bytes, where a JIT library ships one interpreter. Rarely decisive, occasionally noticeable at the edge.

## What is not AOT

The rest of zmdb has no transformer and no runtime codegen either. The query compiler is string concatenation over data. The DTO types are types — zero runtime footprint. `defineSchema` builds a plain object. So a project that uses the schema, compiler and repository but not the validators needs no build step at all.

---

See also: [AOT Setup](./aot-setup.html) · [Benchmarks](./benchmarks.html) · [Serverless Performance](./perf-serverless.html)
