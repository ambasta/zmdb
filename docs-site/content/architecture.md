zmdb currently publishes nine implementation packages plus the `zmdb` umbrella. Direct workspace dependencies form an acyclic graph; `@zmdb/client` and `@zmdb/protobuf` are dependency-free side roots,
while `@zmdb/ai` is independently installable and is not re-exported by the umbrella.

The dependency spine is:

```
@zmdb/client        @zmdb/protobuf
      (independent dependency-free roots)

@zmdb/query-compiler
          |
  @zmdb/schema-core
          |
      @zmdb/ai
          |
 @zmdb/aot-validator
          |
 @zmdb/repository
          |
      @zmdb/app
          |
      @zmdb/web
          |
         zmdb
```

Higher packages also keep the direct lower-level dependencies listed in their manifests; the spine shows the required acyclic order rather than every shortcut edge.

## What each package owns

**`@zmdb/client`** — dependency-free structural HTTP transport, deterministic request planning, response reading, cancellation, authentication injection, and typed errors. Generated clients target
this runtime without importing web, schema, AOT, or Node-specific APIs.

**`@zmdb/schema-core`** — the tag vocabulary, the IR, the schema object and everything derived from it by types alone. The tags (`Table`, `Sql`, `PrimaryKey`, `Serial`, …, types only, zero runtime
exports), the `TypeIR`/`ColumnIR` spine and its converters, the DTO types (`Entity`, `CreateDTO`, `UpdateDTO`, `ReadDTO`, `WhereDTO`, `ListDTO`), relation metadata, JSON Schema / OpenAPI emission, and
seeding. It does not import `typescript`, which is why reflection lives in `@zmdb/aot-validator` instead.

**`@zmdb/ai`** — provider-neutral tool documents, provider-dialect framing, lenient parsing, bounded chat orchestration, shared invocation, and OpenAPI-derived tools. It depends on schema-core and has
no provider or framework SDK dependency or peer.

**`@zmdb/query-compiler`** — turns builder calls into `{ text, parameters }` for an injected `SqlDialect` object or a temporary built-in `Dialect` name (`'postgres'`, `'mysql'`, `'sqlite'`, `'mssql'`,
`'cockroach'`, `'singlestore'`). The object carries resolved traits, capabilities, migrations and introspection without registering globally. When constructed with `{ telemetry: true }`, the compiler
also attaches the compile-known database system, operation and collection for an execution wrapper to consume. The package owns joins, aggregations, full-text search, set operations, DDL for schema
objects, and the migration snapshot/diff engine. It never opens a connection.

**`@zmdb/protobuf`** — dependency-free protobuf calls, descriptors, the generated-code wire ABI, and typed gRPC artifacts. Concrete gRPC transport ownership remains outside this package.

**`@zmdb/aot-validator`** — the TypeScript transformer plus the runtime helpers it emits calls to (`is`, `assert`, `validate`, `stringify`, `parse`, `random`). The transformer runs during your build
and replaces a generic call with a specialised checker derived from the checker's view of `T`.

**`@zmdb/repository`** — the only package that touches a connection, and it does so through a driver interface with one required method and optional streaming. Holds `BaseRepository`, transactions,
replicas, embeddables, inheritance, lifecycle hooks.

**`@zmdb/app`** — the protocol-neutral application kernel: Stage-3 metadata, dependency injection, modules, lifecycle and extensions, command applications, events, CQRS, state machines, health
contracts, and generic observability ports.

**`@zmdb/web`** — HTTP-specific composition over app: controllers, request context, routing, middleware, OpenAPI assembly, gateways, HTTP-aware testing, and runtime adapters.

## The two boundaries that matter

### 1. The compiler never executes

`@zmdb/query-compiler` produces a `CompiledQuery`:

```ts
export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
  readonly telemetry?: {
    readonly system: 'postgresql' | 'mysql' | 'sqlite' | 'mssql';
    readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
    readonly collection: string;
  };
}
```

That is the whole handoff. The default compiler still returns exactly `text` and `parameters`, so existing snapshots keep their shape; telemetry appears only when a driver wrapper opts the compiler
into it. Every query can still be asserted without a database, and the compiler still has no I/O to mock.

### 2. The driver has one required method

```ts
export interface Driver<Name extends string = string> {
  readonly dialect?: SqlDialect<Name> | Dialect;
  execute(query: CompiledQuery, opts?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, opts?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}
```

Everything database-specific lives on your side of that line — pooling, retries, TLS, serverless HTTP transports. That is why [connecting](./drivers.html) to Neon, D1, Turso or PlanetScale is a page
of documentation rather than a package: they are all "implement `execute`". A driver that supplies a dialect lets the repository derive compilation and capabilities from that same value.

## No runtime code generation

There is no `new Function` and no `eval` anywhere in `packages/*/src`. Validators are emitted as source by the transformer during your build, so what runs in production is code that `tsc` type-checked
and that you can read in the output bundle. CI checks the parsed call sites, the public `refine`/`transform` signatures, and reachability from both emitter paths rather than trusting a text grep.

## No runtime reflection

There is no `reflect-metadata`, no `design:type`, and no metadata provider. The decorators in `@zmdb/app` (`@Module`) and `@zmdb/web` (`@Controller`, `@Get`) record only the declarations they own —
they never ask the runtime what type a parameter has, because at runtime that information is gone. Types are read by the transformer, at compile time, from the real checker.

> [!NOTE] The consequence: neither `@zmdb/app` nor `@zmdb/web` starts with a metadata scan. See [AOT vs JIT](./jit-vs-aot.html) for the measured difference and [Benchmarks](./benchmarks.html) for the
> numbers.

## Provider-neutral dependency boundary

`@zmdb/ai` has one runtime workspace dependency, `@zmdb/schema-core`, and no external dependency or peer. Provider and framework SDKs remain behind their opt-in integration paths, so importing the AI
root, chat, HTTP, compiler, or tool-runtime entry does not install an SDK.

## Assertion discipline

The public surface is assertion-free: no `any`, no `as T`, no non-null `!` in framework code. Where an assertion is genuinely irreducible — a primary-key name read from schema metadata cannot be
related to `Col<S>` by control flow — it carries a `// boundary:` comment stating the invariant that makes it sound. Reviews reject the label without the argument.

---

See also: [Why zmdb](./why-zmdb.html) · [AOT Setup](./aot-setup.html) · [Writing a Driver](./custom-driver.html) · [Anti-patterns](./anti-patterns.html)
