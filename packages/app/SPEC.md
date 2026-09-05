# `@zmdb/app` — protocol-neutral application kernel SPEC

> **Target contract — issue #645.** This specification freezes the package split before runtime files or manifests move. The measured baseline is commit `e66621a5`: the current `@zmdb/web` package
> exposes 318 distinct public symbols through 36 manifest entries, and 105 of those symbols belong to this application kernel.

## 1. Ownership

`@zmdb/app` owns the server capabilities that do not require HTTP:

- Stage-3 metadata access and its `Symbol.metadata` polyfill;
- dependency injection, modules, lazy module construction and the construction ledger;
- application lifecycle and extension orchestration;
- command applications, application events, CQRS and domain state machines;
- transport-neutral message dispatch, clients, publishers and the transport strategy SPI;
- narrow observability ports, W3C propagation, message spans and driver instrumentation;
- protocol-neutral liveness/readiness checks and repository injection tokens.

It does not own HTTP routing or response types, queues and scheduling, external broker clients, gRPC, OpenTelemetry, database clients, a TypeScript checker, TypeIR reflection, or code emission.

## 2. Package and dependency contract

The package is ESM-only and publishes these concern entry points:

```text
@zmdb/app
@zmdb/app/commands
@zmdb/app/cqrs
@zmdb/app/data
@zmdb/app/di
@zmdb/app/events
@zmdb/app/health
@zmdb/app/lifecycle
@zmdb/app/messaging
@zmdb/app/modules
@zmdb/app/observability
@zmdb/app/state
```

Its direct runtime dependencies are exactly the workspace packages needed by the moved implementations:

```text
@zmdb/aot-validator
@zmdb/query-compiler
@zmdb/repository
@zmdb/schema-core
```

It declares no third-party `dependencies`, `optionalDependencies` or `peerDependencies`. Node built-ins are allowed. It must not import `@zmdb/web`, `@zmdb/jobs`, an optional integration package,
`typescript`, or any private sibling source path.

## 3. Public application and extension surface

```ts
export interface ApplicationExtensionContext {
  readonly container: Container;
  readonly controllers: readonly object[];
  readonly commands: readonly object[];
  readonly observability: Observability;
}

export interface ApplicationExtension {
  readonly name: string;
  start(context: ApplicationExtensionContext): void | Promise<void>;
  stop(options: { readonly graceMs: number }): void | Promise<void>;
}

export interface ApplicationOptions {
  readonly extensions?: readonly ApplicationExtension[];
  readonly observability?: Observability;
  readonly graceMs?: number;
}

export interface Application extends AsyncDisposable {
  readonly container: Container;
  readonly lazy: readonly LazyModuleHandle[];
  init(): Promise<void>;
}

export function createApplication(rootModule: ModuleClass, options?: ApplicationOptions): Application;
```

`ApplicationMetadata` is the application-owned name of the type currently exported as `WebMetadata`. `AppOptions` is deleted and replaced by `ApplicationOptions`; it is not retained as an alias.
`createApplication` is the protocol-neutral bootstrap. The HTTP package owns `createApp` and `WebApplication`.

The extension context is one frozen snapshot from the compiled eager graph. Its arrays are immutable, object identities are the identities constructed by `compileModule`, and all extensions receive
the same context object. Lazy modules do not mutate those arrays after startup. An integration that needs a lazy capability must obtain it through an explicit app-owned port rather than hidden graph
discovery.

## 4. Construction and lifecycle state machine

`createApplication` performs only synchronous declaration work:

1. validate extension names and `graceMs`;
2. compile the complete module declaration graph;
3. construct eager providers, controllers and commands;
4. snapshot extensions, instances and the extension context.

It opens no external resource and calls no lifecycle hook. The state machine is:

```text
created -> starting -> running -> stopping -> stopped
                  \-> failed-cleaned
created -----------------------> stopping -> stopped
```

- `init()` is idempotent and concurrent callers receive the same promise.
- `[Symbol.asyncDispose]()` is idempotent and concurrent callers receive the same promise.
- `init()` after shutdown begins rejects with `@zmdb/app: application is shutting down`.
- Disposal before `init()` shuts down constructed instances without starting extensions.
- Disposal during `init()` waits for startup or startup rollback to settle, then completes the one applicable cleanup path.
- A failed initialization is terminal. A later `init()` returns the same rejection and no resource is reopened.

Extension names are non-empty and unique. Invalid options fail synchronously before hooks or extensions run.

## 5. Startup, rollback and shutdown order

Normal startup is strictly ordered:

1. `onModuleInit` on constructed instances in construction order;
2. `onApplicationBootstrap` on those instances in construction order;
3. `ApplicationExtension.start(context)` in extension declaration order.

An extension enters the rollback ledger immediately before its `start` call. Therefore an extension whose `start` partially opens a resource and then rejects is itself stopped, followed by every
earlier entered extension in reverse declaration order.

Any startup failure triggers one cleanup transaction:

1. stop every entered extension in reverse declaration order;
2. run `onShutdown` on every constructed instance in reverse construction order;
3. mark the application `failed-cleaned`.

Normal disposal performs:

1. reject new lazy loads and await loads already accepted;
2. stop started extensions in reverse declaration order;
3. run `onShutdown` in reverse construction order;
4. mark the application `stopped`.

Every eligible stop and shutdown hook is attempted even after another one fails. The framework never restarts an extension and never calls one extension's `stop` twice.

## 6. Grace budget and error precedence

`ApplicationOptions.graceMs` is a positive integer and defaults to 5,000 milliseconds. It is one application-wide external-resource budget, not a fresh budget per extension. At the beginning of
extension shutdown the framework records one deadline. Each extension receives the non-negative milliseconds remaining at the moment its `stop` begins; a value of zero means stop intake and
force-close without waiting. Provider `onShutdown` hooks have no cancellation parameter and are always attempted after extensions.

Error precedence is deterministic:

- if startup fails and cleanup succeeds, `init()` rejects with the exact startup error identity;
- if startup cleanup also fails, `init()` rejects an `AggregateError` whose `cause` and first `errors` entry are the startup error, followed by cleanup errors in observation order;
- if shutdown has one error, disposal rejects with that exact error identity;
- if shutdown has multiple errors, disposal rejects an `AggregateError` ordered by extension reverse-declaration failures first and provider reverse-construction failures second;
- observation, rollback or shutdown errors never replace an earlier startup error.

`stop` must tolerate being called after partial `start`. Implementations own their internal idempotence and must not rely on another extension having stopped successfully.

## 7. Target ownership of the current application exports

The 105 current names assigned to this package are frozen in `packages/web/SPEC.md` under `#645-ownership:app`. Their target homes are:

| Current concern                                      | Target entry point          |
| ---------------------------------------------------- | --------------------------- |
| root metadata and polyfill                           | `@zmdb/app`                 |
| `di`, `modules`, lifecycle and state                 | matching `@zmdb/app/*`      |
| command applications                                 | `@zmdb/app/commands`        |
| application events and CQRS                          | `@zmdb/app/events`, `/cqrs` |
| message dispatcher, clients and transport SPI        | `@zmdb/app/messaging`       |
| observability ports, propagation and instrumentation | `@zmdb/app/observability`   |
| protocol-neutral health checks                       | `@zmdb/app/health`          |
| `repositoryToken`                                    | `@zmdb/app/data`            |

Every moved declaration is moved once. No implementation remains under `packages/web`, no package forwards an old subpath, and no copied implementation may coexist during the migration.

## 8. Reflection and hot-path invariants

- The TypeScript checker in `@zmdb/aot-validator` remains the sole TypeIR/reflection front-end. App decorators read only metadata they wrote.
- Extension dispatch occurs only during startup and shutdown. No extension list is walked per HTTP request, job claim, message dispatch or repository query.
- `createApplication` adds no ambient global registry. All application state is owned by the returned instance.
- Concern-only code stays behind its named subpath. In particular, the package root does not import command parsing, optional transports, OpenTelemetry, gRPC, jobs, HTTP, devtools or benchmark code.

## 9. Evidence required from the implementation issues

The implementation is not complete until all of the following are executable:

1. an AST oracle accounts for every current public symbol exactly once and reports the same 105-name app set frozen here;
2. a manifest/import-graph verifier proves the permitted DAG, empty third-party peer sets and forbidden reverse edges;
3. lifecycle tests cover concurrent init/dispose, partial extension startup, reverse rollback, one total grace budget and every error-precedence branch;
4. old `@zmdb/web/{di,modules,cli,events,cqrs,microservices,observability,state}` paths fail resolution and no forwarding source remains;
5. packed consumers install `@zmdb/app` outside the workspace, import every declared subpath, compile a module/DI/extension application and prove direct-package/facade runtime identity;
6. the existing startup benchmark is run before and after on the same machine in at least five interleaved samples, with raw samples and medians retained; a median regression above 5% blocks closure
   until explained and accepted;
7. a structural request-path test proves the split adds no extension dispatch or package-boundary wrapper to `Router.handle`.

CI may smoke-test positive timings, but shared-runner wall time is not used as a universal threshold.
