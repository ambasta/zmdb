Runtime validators build a checker when they first see a type. zmdb's build one at compile time. The difference shows up in three places: startup, throughput, and what can go wrong.

## What "AOT" means here

```ts
// what you write
const ok = is<{ n: number }>(input);
```

<!-- prettier-ignore -->
```text
// what the transformer emits
const ok = typeof input === "object" && input !== null && !Array.isArray(input) && typeof input.n === "number" && !Number.isNaN(input.n);
```

Not a descriptor argument — a **boolean expression**. No call, no closure, no
allocation. For a larger type the checker is hoisted into one function per distinct
shape, shared by every call site in the file that asks the same question, matched by
the shape of the reflected type rather than by the name you wrote.

`assert<T>` adds one thing to that: the gate above runs first, and the issue walk only
runs once a throw is already certain, so the success path allocates nothing at all.

There is no schema to interpret at runtime, no first-call compilation, and — importantly
— **no `new Function` and no `eval` anywhere in the packages**. That last point is not
incidental: it is what lets the validators run under a strict Content Security Policy, in
Cloudflare Workers, and in any environment where dynamic code generation is unavailable.
It is also why `refine()` takes a function rather than a predicate source string.

## Against the JIT approach

A library like Zod builds a validator object graph at module load and walks it per call. `ajv` and `typebox`'s compiler generate a function with `new Function`, which is fast per call but needs code generation at runtime.

|                         | JIT (interpreted)   | JIT (codegen)                 | zmdb (AOT)                   |
| ----------------------- | ------------------- | ----------------------------- | ---------------------------- |
| Startup cost            | schema construction | schema construction + codegen | none                         |
| Per-call cost           | tree walk           | near-optimal                  | straight-line, no allocation |
| Needs `new Function`    | no                  | **yes**                       | **no**                       |
| Works under strict CSP  | yes                 | no                            | yes                          |
| Works in Workers / edge | yes                 | often not                     | yes                          |
| Schema declared         | separately          | separately                    | it _is_ the type             |
| Build step              | none                | none                          | **required**                 |

The last two rows are the trade. You get no duplicate schema declaration and no runtime codegen; you pay with a build-step dependency.

## The cost: the build step is mandatory

Without the transformer there is no schema in the call, and the call says so:

```text
runtime type witness required in test/fallback mode
```

It throws. That matters more than it sounds: an earlier version of this returned success
when it had nothing to check against, which is failing **open** — the worst direction for
a validation layer to fail, because a misconfigured build looked like a passing one.
`schemaOf<T>()` refuses the same way, at more length:

```text
schemaOf<T>() was not replaced at build time. It is compiled away by the zmdb transform
(the unplugin, or `zmdb-codegen`), which did not run over this file — a type argument
cannot be read at runtime, so there is nothing to fall back to.
```

A refused call site is also a build error rather than a silent fallback: a type the
emitter cannot model stops the build, because the alternative is a build that succeeded
and a program that throws on first use.

The canary is still worth writing, since it catches a plugin that runs over some files
and not others:

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

- **Dynamic shapes.** A type known only at runtime — a user-defined form schema — cannot be a type parameter. For that, pass a `TypeIR` as the second argument (the escape hatch the transformer normally fills), or use [JSON Schema and ajv](./interop-zod.html).
- **Bundle size.** The emitted checkers are code in your output. Many large types means more bytes, where a JIT library ships one interpreter and builds the rest at runtime. Rarely decisive, occasionally noticeable at the edge.

## What is not AOT

The query compiler is string concatenation over data, with no transformer and no
codegen. The derived types — `Entity`, `CreateDTO`, `UpdateDTO`, `WhereDTO` — are types,
so they have no runtime footprint at all, and the tag vocabulary in `zmdb/tags` is types
only too: those imports disappear from your output.

What _does_ need the build step is the crossing from the type to a value. `schemaOf<T>()`
is that crossing, and the repository and the migration snapshot both take a schema value,
so a project that uses them is a project that runs the transformer even if it never calls
a validator. Only the query compiler, used directly against table and column names, is
genuinely build-free — see [Pure TypeScript](./pure-typescript.html).

---

See also: [AOT Setup](./aot-setup.html) · [Benchmarks](./benchmarks.html) · [Serverless Performance](./perf-serverless.html)
