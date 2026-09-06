# `@zmdb/compiler` — TypeScript front end and AOT tooling SPEC

> Status: **IMPLEMENTED** by GitHub sub-issue #628. This file defines the shipped compiler package and its boundary with the runtime validator.

## 1. Responsibility

`@zmdb/compiler` is the only package that opens a TypeScript project and the only package that turns TypeScript declarations into `TypeIR`. It owns:

- reflection sessions, call-site collection, `TypeIR` production and reflection diagnostics;
- JavaScript emission, source transforms, generated witnesses and generated declarations;
- the unplugin adapter, Metro adapter, lint integration and compiler test utilities;
- project compilation for the no-bundler path; and
- discovery, validation and resolution of `zmdb.config.*`.

The exact current-file move map is frozen in [`../../.github/scripts/verify-tooling-ownership.SPEC.md`](../../.github/scripts/verify-tooling-ownership.SPEC.md). Thirty-four shipped/build-input files
have this owner. Runtime validation and serialization remain in `@zmdb/aot-validator`; they are not compiler responsibilities. Protobuf reflection and emission remain compiler work, while #656 moved
the public calls, artifact types, and wire runtime to `@zmdb/protobuf`.

## 2. Package DAG

Required package edges are one-way:

```text
@zmdb/ai ─────────────┐
@zmdb/query-compiler ─┐
@zmdb/schema-core ────┼──> @zmdb/compiler
@zmdb/aot-validator ──┘
```

`typescript >=7.0.2 <8` is a peer dependency and exact `7.0.2` is the development and packed-consumer version. `oxlint`, `metro` and `metro-babel-transformer` are optional peers reached only by their
explicit integration subpaths. The package has no dependency on `@zmdb/migrations`, `@zmdb/cli`, `@zmdb/web` or `zmdb`. No runtime foundation package imports `@zmdb/compiler`.

The `@zmdb/ai` edge supplies provider-neutral tool-document emission. The `@zmdb/query-compiler` edge exists for the config's dialect and structural query/driver protocols. It does not let compiler
code emit SQL. The `@zmdb/aot-validator` edge is the runtime ABI that generated validators call; it never points back to this package.

## 3. Public surface

The package exports exactly these subpaths:

| Subpath                    | Contract                                                                        |
| -------------------------- | ------------------------------------------------------------------------------- |
| `@zmdb/compiler`           | project compilation and generated-artifact materialisation                      |
| `@zmdb/compiler/reflect`   | `ReflectSession`, reflection functions, IR results and diagnostics              |
| `@zmdb/compiler/emit`      | IR-to-JavaScript emitters and emitter options                                   |
| `@zmdb/compiler/transform` | source transforms; replaces the old `transformer` spelling                      |
| `@zmdb/compiler/unplugin`  | Vite/Rollup/esbuild/webpack-compatible unplugin adapter                         |
| `@zmdb/compiler/metro`     | Metro configuration and worker adapter                                          |
| `@zmdb/compiler/lint`      | Oxlint/ESLint-shaped rules and configs                                          |
| `@zmdb/compiler/testing`   | compiler-backed schema/IR helpers and deterministic project fixtures            |
| `@zmdb/compiler/errors`    | project-compilation diagnostic type; never imported by emitted application code |
| `@zmdb/compiler/config`    | canonical project-config types, discovery, validation and resolution            |

There is no `./plugin`, `./codegen` or `./transformer` compatibility subpath. The new names are the only names.

The stable product entry is `zmdb/compiler`, an identity facade over this package's approved public surface. `zmdb/unplugin` may exist only as a release-governed compatibility alias; it never owns an
adapter or a second compiler path.

The exact #627 package/type freeze preserves the implementation's existing operation names rather than adding aliases from #628's planning sketch:

- source transformation is `transformFile`, not `transformSource`;
- reflection is `ReflectSession`, `irFromType`, and `schemaIrFromType`, while multi-file schema helpers are under `./testing`;
- emission is the stateful `Emitter` API, not parallel `emitValidator` wrappers;
- the lint plugin is the `./lint` default export alongside `configs`; and
- no compiler-side `emitSerializer` exists. Serialization remains a runtime-validator concern until its own frozen AOT-serialization work implements an emitter.

These names all delegate to one front end. Adding synonym wrappers would widen the public API without adding a capability, while inventing `emitSerializer` here would claim an implementation the
repository does not have.

### 3.1 Project compilation

```ts
export interface CompileProjectOptions {
  readonly project: string;
  readonly files?: readonly string[];
  readonly naming?: NamingStrategy;
}

export interface CompiledArtifact {
  readonly source: string;
  readonly witnessPath: string;
  readonly runtimePath: string;
  readonly declarationPath: string;
  readonly witness: string;
  readonly runtime: string;
  readonly declaration: string;
}

export interface CompileResult {
  readonly project: string;
  readonly files: readonly string[];
  readonly artifacts: readonly CompiledArtifact[];
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly dependencies: readonly string[];
}

export interface WriteCompileResultOptions {
  readonly check?: boolean;
}

export interface WriteCompileResult {
  readonly written: readonly string[];
  readonly deleted: readonly string[];
  readonly stale: readonly string[];
}

export declare function compileProject(options: CompileProjectOptions): Promise<CompileResult>;
export declare function writeCompileResult(result: CompileResult, options?: WriteCompileResultOptions): Promise<WriteCompileResult>;
```

`compileProject` opens one reflection session, sorts the selected files, returns deterministic bytes and does not mutate the project. `writeCompileResult` is the single atomic writer. With
`check: true` it writes and deletes nothing, and reports every missing, stale or orphaned artifact. Watch mode retains one session and repeatedly invokes these same two operations; it is not another
compiler path.

`files`, when present, must be members of `project`. A missing member, a duplicate normalized path or a generated input is a diagnostic, never a silent skip. With no `files`, the compiler uses the
project file set and the same cheap call-site prefilter as the current codegen implementation.

### 3.2 One front end

`ReflectSession`, `schemaIrFromType`, transformer calls, unplugin, Metro, testing helpers and `compileProject` all use the same reflection and emission functions. Adapters may schedule work; they may
not parse types, walk TypeIR or emit validators themselves.

One ordinary build opens one TypeScript session. Metro opens one per worker process because a compiler process cannot cross a worker boundary. A caller-supplied session remains caller-owned.

## 4. Canonical project configuration

`@zmdb/compiler/config` owns the filesystem-backed discovery, validation, resolution and cache implementation and exports the same `ZmdbConfigData`, `ZmdbConfig`, `ResolvedConfig`, `defineConfig`,
`loadConfig` and `resolveConfig` identities exposed by the product facade. The behavioral contract currently frozen in [`../zmdb/src/config/SPEC.md`](../zmdb/src/config/SPEC.md) moves here without a
second discovery, validation or path-resolution implementation.

The config's driver is structural, so the compiler does not depend on `@zmdb/repository`:

```ts
export interface ToolingDriver {
  readonly dialect?: DialectTarget;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
  transaction?<T>(run: (driver: ToolingDriver) => Promise<T>): Promise<T>;
}
```

The concrete database-package drivers satisfy this interface. Config remains tooling-only; importing an application runtime never discovers or evaluates it.

`zmdb/config` is the sole stable product config entry and is a direct identity facade over this implementation. It contains no loader implementation. The current `zmdb` CLI imports the compiler
subpath directly; the future `@zmdb/cli` extraction must keep that dependency and must not publish another config API.

The `zmdb` root may expose only the dependency-free authoring contract (`defineConfig` and its author-facing type). That narrow contract must not load this module's filesystem, TypeScript or cache
implementation; the exact shared contract owner is resolved with #621 without creating a second config shape.

## 5. Emitted-runtime boundary

Generated application JavaScript may import runtime values only. The low-level emitter defaults its assertion-error import to:

```ts
import { AssertError } from '@zmdb/aot-validator/errors';
```

Project compilation preserves the source call's public runtime module when it must keep the consumer dependency-complete: a source importing validator calls from `zmdb` produces generated JavaScript
that imports `AssertError` from `zmdb`, while a direct validator-utilities source may retain that runtime subpath. If no source call supplies an owner, the generated output uses a published validator
runtime helper. It never imports a compiler module.

A generated witness may repeat the source module's type imports and validator call imports. A generated declaration may import the source types it names. No generated `.js`, declaration or witness may
import:

- `@zmdb/compiler` or any compiler subpath;
- `typescript`, `oxlint`, Metro, a bundler or a Node built-in;
- a private `packages/*/src` path; or
- config, CLI, filesystem, REPL, Studio or scaffolding code.

The compiler package may change how bytes are produced without changing the runtime ABI. Changing a generated runtime import or artifact format is a compiler/runtime protocol change and requires a
coordinated release.

## 6. Old ownership removed

Implementation removed these old public entries after their new entries worked:

- `@zmdb/aot-validator/emit`
- `@zmdb/aot-validator/lint`
- `@zmdb/aot-validator/metro`
- `@zmdb/aot-validator/plugin`
- `@zmdb/aot-validator/reflect`
- `@zmdb/aot-validator/testing`
- `@zmdb/aot-validator/codegen`
- `@zmdb/aot-validator/transformer`
- `@zmdb/aot-validator/unplugin`

The package has no permanent implementation-package forwarding files. The standalone `zmdb-codegen` executable is removed; #630 adds the replacement command to the sole unified CLI. The old
`zmdb/unplugin` product spelling may remain only for the compatibility interval selected by #721/#728. This spec does not choose a deprecation or removal release.

## 7. Verification and release

The compiler implementation is complete only when:

1. the 34-path compiler inventory has exactly one destination and the old copies are gone;
2. every public subpath imports and typechecks from a packed standalone consumer;
3. unplugin, Metro and no-bundler compilation produce byte-equivalent runtime artifacts;
4. the generated-import oracle rejects a planted compiler import;
5. config identity holds: `defineConfig` and `loadConfig` from `zmdb/config` are `===` the compiler exports;
6. one-session and snapshot-update budgets still pass at 8 and 64 files; and
7. the runtime roots of schema, query, validator, repository, web and `zmdb` cannot reach this package.

## 8. Non-goals

- Runtime validator behavior, SQL output or schema semantics do not change.
- `@zmdb/protobuf` keeps source calls, public artifact types, and the generated-code wire ABI; this package keeps TypeScript reflection and emission for those calls.
- No second TypeScript front end, config loader, formatter or generated-artifact format is added.
- No compatibility entry owns new behavior or survives beyond the release-governed interval.
