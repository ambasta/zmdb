`zmdb-codegen` compiles zmdb's validators and schemas ahead of time **without a bundler**, by writing the result down next to your source and committing it.

```bash
npx zmdb-codegen
```

It is `@zmdb/aot-validator`'s executable, which the `zmdb` umbrella depends on — so if you installed `zmdb`, you already have it.

When `zmdb` is installed, the executable discovers `zmdb.config.ts` and uses both its TypeScript project and its resolved naming strategy. `--config <path>` selects a particular config, while
`--project <path>` overrides only the project. A standalone `@zmdb/aot-validator` install with no umbrella package keeps the `./tsconfig.json` and identity-naming defaults.

The [unplugin](./aot-setup.html) gets type information for free: a bundler hands it a module, it asks the compiler about the type arguments in it, and it hands back rewritten source that only the
bundler ever sees. A project built by plain `tsc`, or run straight off `node --strip-types`, has nowhere to put that step. The compiled path is not a reward for choosing a particular bundler, so this
exists.

## What it does

For each source file that calls one of the seventeen generic entry points with a type argument — `is`, `isShallow`, `equals`, `assert`, `assertShallow`, `assertEquals`, `validate`, `validateShallow`,
`random`, `toJsonSchema`, `schemaOf`, `toolFor`, `protoDescriptor`, `protoDecode`, `protoEncode`, `grpcDescriptor`, `loadGrpcService` — it writes three files beside it and edits the call. A
non-default shallow depth is part of the generated export name, so two checks over the same type at different depths remain different functions. The two gRPC forms additionally capture their service
and package string literals in a zero-argument generated wrapper:

The five protobuf/gRPC artifact calls must come from `@zmdb/protobuf`; aliases and namespace imports are resolved through the checker, while local or foreign same-named functions are left alone.

```
src/handlers.ts                      your source; the call is rewritten
src/handlers.zmdb.witness.ts         the type argument, kept, and checked by your tsc
src/handlers.zmdb.generated.js       the compiled validator
src/handlers.zmdb.generated.d.ts     its signatures
```

```ts
// before
import { is, schemaOf } from 'zmdb';
if (is<User>(body)) { … }
const users = defineRepository(schemaOf<User>(), driver);
```

```ts
// after
import { zmdbIsUser, zmdbSchemaUser } from './handlers.zmdb.generated.js';
if (zmdbIsUser(body)) { … }
const users = defineRepository(zmdbSchemaUser(), driver);
```

**Commit all four.** That is the point: a fresh clone builds the fast path with no tool at all in the way. Nothing in your build depends on `tsgo`, on this CLI, or on the plugin.

## Why three files

The rewrite is destructive. After a run the source says `zmdbIsUser(body)` and the `is<User>(body)` it came from is gone — so the type argument, the only input the whole pipeline has, would be gone
with it.

The **witness** keeps it, as a wrapper per entry written against the runtime API and checked by your own `tsc`. That makes a renamed or deleted `User` a build error in a generated file, rather than a
compiled validator that quietly goes on describing a type nobody declares any more.

The witness is also the transform's input, and its output cannot be the artifact: the emitted helpers are untyped JavaScript, which under `noImplicitAny` is an error per parameter. So the artifact is
a **`.js`** — nothing typechecks it, so it needs no annotations — plus a **`.d.ts`** carrying the signatures.

That split pays for itself twice: there is not one cast anywhere in the generated code, and `schemaOf<T>()`'s phantom slot (a `unique symbol` no object literal can satisfy) is _declared_ in the
`.d.ts` rather than asserted into existence.

## Flags

| Flag               | Effect                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| `--config <path>`  | use this config instead of discovery                                   |
| `--project <path>` | override the config project; without a config, default `tsconfig.json` |
| `--check`          | write nothing; exit 1 if anything on disk is out of date               |
| `--watch`          | regenerate on every save, on one compiler session                      |
| `--help`, `-h`     | usage                                                                  |

`--check` and `--watch` ask for opposite things and are rejected together. Exit codes: `0` clean, `1` a generation problem or a stale tree, `2` a bad invocation.

## In CI

```yaml
- run: npx zmdb-codegen --check
```

`--check` writes nothing and still checks everything. A check that had to write the witnesses in order to verify them would be a check that dirties the tree it is auditing — and it does not have to.

The witness is a pure function of the scan, so a stale one is caught by comparing text; and if every witness matches, the compiled modules are derivable from files already on disk, so the transform
runs against those and its output is compared the same way.

When something is stale you get a sentence rather than a bare exit code:

```
zmdb-codegen: 3 generated file(s) are out of date. Run `zmdb-codegen` and commit the result.
```

That distinction — an error in the tree, not an error in the code — matters to whoever reads the log.

## During development

```bash
npx zmdb-codegen --watch
```

One compiler session for the whole watch, so a save costs an incremental check rather than a project load.

## It is fast because of the order it works in

Every witness is written **before** any of them is transformed. Telling the compiler about a new file is a snapshot update, and a snapshot update per file would make a hundred-file project a hundred
re-checks. Two updates for the whole run is the difference between this being usable and being a thing people turn off.

There is also a cheap pre-filter: a file that does not even mention one of the seventeen callees with a `<` after it is skipped before the compiler is asked for its AST. In a real project almost every
file answers no.

A previous run's output is never scanned, so `--watch` does not chase its own tail.

## Errors

Anything that stops a file from being generated is reported and exits 1 — never skipped, and never filled in with a guess. A type the reflection cannot model produces a named refusal
(`Record<string, T>` and index signatures, bare `number`, `${number}` in a template literal), and the message says which property gave it away.

## Which one should I use?

| You have                                     | Use                                                          |
| -------------------------------------------- | ------------------------------------------------------------ |
| Vite, Rollup, esbuild, webpack, Rspack       | the [unplugin](./aot-setup.html)                             |
| plain `tsc`, `node --strip-types`, Bun, Deno | `zmdb-codegen`                                               |
| a library you publish                        | `zmdb-codegen` — ship the generated files                    |
| neither, for now                             | the [JIT fallback](./jit-vs-aot.html) — correct, just slower |

Both produce the same rewrite from the same transformer. They differ only in where the output goes.

---

See also: [AOT Setup](./aot-setup.html) · [JIT vs AOT](./jit-vs-aot.html) · [Schema Declaration](./schema-declaration.html) · [CLI Overview](./cli-overview.html)
