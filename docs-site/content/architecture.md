zmdb is five packages with a strict dependency order. Nothing depends on anything above it, and no package reaches sideways.

```
                    @zmdb  (umbrella re-exports)
                      |
   +----------+--------+---------+----------+
   |          |                  |          |
 @zmdb/web   @zmdb/repository   @zmdb/aot-validator
   |          |
   |     @zmdb/query-compiler
   |          |
   +---- @zmdb/schema-core ----+
```

## What each package owns

**`@zmdb/schema-core`** — the schema object and everything derived from it by types alone. Column builders (`serial()`, `text()`, `primaryKey()`), `defineSchema`, the DTO types (`Entity`, `CreateDTO`, `UpdateDTO`, `WhereDTO`, `ListDTO`), relation metadata, JSON Schema / OpenAPI emission, seeding, and LLM tool specs. It knows nothing about SQL text or about a database.

**`@zmdb/query-compiler`** — turns builder calls into `{ text, parameters }` for a `Dialect` (`'postgres' | 'mysql' | 'sqlite'`). Also owns joins, aggregations, full-text search, set operations, DDL for schema objects (indexes, views, sequences, generated columns, namespaces, RLS), and the migration snapshot/diff engine. It never opens a connection.

**`@zmdb/aot-validator`** — the TypeScript transformer plus the runtime helpers it emits calls to (`is`, `assert`, `validate`, `stringify`, `parse`, `random`). The transformer runs during your build and replaces a generic call with a specialised checker derived from the checker's view of `T`.

**`@zmdb/repository`** — the only package that touches a connection, and it does so through a one-method interface you implement. Holds `BaseRepository`, transactions, replicas, embeddables, inheritance, lifecycle hooks.

**`@zmdb/web`** — HTTP. Controllers, DI container, modules, the middleware chain, adapters, gateways, OpenAPI assembly, test harness.

## The two boundaries that matter

### 1. The compiler never executes

`@zmdb/query-compiler` produces a `CompiledQuery`:

```ts
export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
}
```

That is the whole handoff. It means every query in the test suite can be asserted as a string without a database, and it means the compiler has no I/O to mock.

### 2. The driver is a one-method interface

```ts
export interface Driver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}
```

Everything database-specific lives on your side of that line — pooling, retries, TLS, serverless HTTP transports. That is why [connecting](./drivers.html) to Neon, D1, Turso or PlanetScale is a page of documentation rather than a package: they are all "implement `execute`".

## No runtime code generation

There is no `new Function` and no `eval` anywhere in `packages/*/src`. Validators are emitted as source by the transformer during your build, so what runs in production is code that `tsc` type-checked and that you can read in the output bundle. This is enforced by a grep in CI, not by convention.

## No runtime reflection

There is no `reflect-metadata`, no `design:type`, and no metadata provider. The decorators in `@zmdb/web` (`@Controller`, `@Get`, `@Module`) record route and provider information in module-local maps — they never ask the runtime what type a parameter has, because at runtime that information is gone. Types are read by the transformer, at compile time, from the real checker.

> [!NOTE]
> The consequence: `@zmdb/web` starts with no metadata scan. See [AOT vs JIT](./jit-vs-aot.html) for the measured difference and [Benchmarks](./benchmarks.html) for the numbers.

## Zero required runtime dependencies

Every `@zmdb/*` package has an empty `dependencies` field. The transformer needs `typescript` at build time; nothing needs anything at runtime. This is what makes the packages usable in a Cloudflare Worker or a Durable Object without a bundler fight.

## Assertion discipline

The public surface is assertion-free: no `any`, no `as T`, no non-null `!` in framework code. Where an assertion is genuinely irreducible — a primary-key name read from schema metadata cannot be related to `Col<S>` by control flow — it carries a `// boundary:` comment stating the invariant that makes it sound. Reviews reject the label without the argument.

---

See also: [Why zmdb](./why-zmdb.html) · [AOT Setup](./aot-setup.html) · [Writing a Driver](./custom-driver.html) · [Anti-patterns](./anti-patterns.html)
