# AOT Validator Build Plugin — Frozen Spec (Issue #79)

> Status: **IMPLEMENTED** and moved by #628. Part of `@zmdb/compiler`. Targets: Node 26+, ESM, TS 7. The AOT path is produced by the same transform used by project compilation and Metro.

## Current package after #628

The unplugin, Metro adapter, transform orchestration, and benchmark support live in `@zmdb/compiler`. TypeScript, Metro, and bundler-facing dependencies are tooling-only and cannot be reached from
`@zmdb/aot-validator`.

## 1. Plugin surface

The transformer is packaged as an unplugin, while custom compiler hosts call the direct transform:

```ts
// unplugin (vite/esbuild/webpack/rollup)
import { zmdbAot } from '@zmdb/compiler/unplugin';

// direct host
import { transformFile } from '@zmdb/compiler/transform';
```

`transformFile(fileName, code, context)` is the core; packaging wrappers adapt it.

The lower-level `zmdbAot({ naming })` accepts the same named or custom strategy as project compilation, resolves it once when the plugin is created, and passes it into reflection. The `zmdb/unplugin`
umbrella entry discovers `zmdb.config.ts` asynchronously and supplies its project and `resolvedNaming`, avoiding a static dependency cycle from this package back to `zmdb`.
## 2. Intercepted calls

The transformer recognizes the seventeen generic calls in `CALLEES`: `is<T>(x)`, `isShallow<T, D>(x)`, `assert<T>(x)`, `assertShallow<T, D>(x)`, `validate<T>(x)`, `validateShallow<T, D>(x)`,
`equals<T>(x)`, `assertEquals<T>(x)`, `random<T>()`, `toJsonSchema<T>()`, `schemaOf<T>()`, `toolFor<T>(provider, name, opts)`, `protoDescriptor<T>()`, `protoDecode<T>(bytes)`, `protoEncode<T>(value)`,
`grpcDescriptor<S>(service, package)` and `loadGrpcService<S>(service, package)`. It reads the type argument (and the shallow depth or required gRPC string literals) from the TS checker and replaces
the call with emitted JavaScript.

The five protobuf/gRPC artifact calls are recognised only through a resolved direct, aliased, or namespace binding to `@zmdb/protobuf`. The plugin leaves local shadows, foreign same-named exports, and
removed AOT/umbrella spellings unchanged.

## 3. Emitted-JS contract (frozen)

For `is<T>(x)` where `T = { a: number; b: string }` the transformer emits an **inline, monomorphic, allocation-free, early-exit** boolean expression — NOT a walk over a runtime witness:

```
is<T>(x)  →  (typeof x === "object" && x !== null
              && typeof x.a === "number"
              && typeof x.b === "string")
```

- No object/array allocation on the success path.
- Nested objects recurse inline; arrays emit an inline `for` with early return.
- `assert<T>` wraps the inline check with a structured throw on failure.
- `equals/assertEquals` add inline excess-key checks (strict).

## 4. Golden fixtures (before → after)

```
BEFORE: const ok = is<{ n: number }>(input);
AFTER:  const ok = (typeof input === "object" && input !== null && typeof input.n === "number");

BEFORE: const v = assert<{ s: string }>(input);
AFTER:  const v = ((() => { if (!(typeof input === "object" && input !== null && typeof input.s === "string")) throw new AssertError(...); return input; })());
```

Identity: a source with no zmdb validator calls is returned unchanged.

## 5. Benchmark acceptance target (frozen)

Re-running the moltar suite with the transformer-built output MUST show, for the fixed data model:

- AOT `assert`/`is` ≥ **5×** the runtime path, and
- AOT within **2×** of TypeBox-JIT on `assertLoose`.

If unmet, #83 documents why and the architecture claim is revised (no silent overclaim).

## 6. Metro, for React Native and Expo (frozen — epic "React Native")

Metro is the third route into the same transform, after the bundler plugin (§1) and project compilation. It is not a fourth implementation: `transformFile` is the transform, `ARCHITECTURE.md` §2.9
allows one front end, and `yarn verify:fixtures` asserts that all three routes agree. What this section freezes is the integration, because Metro's shape differs from unplugin's in three ways that
each have a wrong answer that looks right.

### 6.1 Wrapping, because a project has exactly one transformer

Metro has two transformer knobs, and both are single-valued:

| Config field           | What it is                                                                  | Default                                 |
| ---------------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| `transformerPath`      | the worker: reads the file, collects dependencies, handles assets, minifies | `metro-transform-worker`                |
| `babelTransformerPath` | source text in, Babel AST out                                               | React Native's, or Expo's, or the app's |

Bare React Native points `babelTransformerPath` at its own transformer; Expo points it at Expo's _and_ replaces `transformerPath`; Reanimated's plugin is a Babel plugin inside whichever one is
installed. So there is no free slot. **`withZmdb` wraps `babelTransformerPath` and never `transformerPath`**, and never replaces either:

```js
// metro.config.js
const { withZmdb } = require('@zmdb/compiler/metro');
module.exports = withZmdb(getDefaultConfig(__dirname));
```

Three reasons for that knob rather than the other, and the third is the one that decides it:

1. The contract matches. `transformFile(fileName, code, context)` is source text in, source text out, which is what a Babel transformer is handed and returns; the worker's contract additionally covers
   assets, dependency collection and minification, none of which this package has an opinion about.
2. Wrapping the worker means re-exporting its whole surface, and Expo already has one — so zmdb would be choosing between Expo's worker and its own on behalf of the app.
3. **The offsets.** §3 rewrites by byte offset into the text the compiler parsed, and `transformFile` degrades the whole file to the tag-only path when the text it is handed differs. The Babel
   transformer is handed the file as Metro read it from disk, before any AST edit; the worker is where those edits are arranged. Metro has no `enforce: 'pre'` — there is no ordering field at all — so
   position in the pipeline is chosen by which knob you take, and only one of the two is early enough.

The delegate cannot be captured in a closure. A transformer is named by a **module path** because Metro loads it in worker processes, so what `withZmdb` does in `metro.config.js` is read the existing
`babelTransformerPath`, resolve it to an absolute path there (where `require.resolve` and `__dirname` are meaningful), and record it in a serialisable field on `config.transformer` alongside the
absolute `tsconfig.json` path.

The wrapper module in the worker reads those two fields, and requires the delegate by path. `#520` pins the one fact this rests on — that Metro forwards unknown `config.transformer` keys to the
transformer — with `process.env.ZMDB_METRO_DELEGATE` as the fallback channel if it does not, and asserts that an app with a second transformer installed still gets that transformer's output.

The example above is `require`, not `import`, and that is not sloppiness: `metro.config.js` is CommonJS in every React Native and Expo template. This package is ESM-only, so `withZmdb` is reached
through Node's `require` of an ES module — which works, and stops working the moment anything in that module's import graph uses a top-level `await`.

**The Metro entry point and everything it reaches must be free of top-level `await`.** This constraint applies only to `./metro`.

A file zmdb has nothing to do with is delegated unchanged: `node_modules`, `.d.ts`, anything that is not a source extension, and — before the compiler is involved at all — anything whose text does not
contain one of the names in `CALLEES`. That scan is measured at over a megabyte a second (SPEC §7), which matters here more than in a bundler plugin because it is what keeps an app's three thousand
unrelated modules on the path they would take with zmdb uninstalled.

### 6.2 One session per worker process, which is what REQ-TF-11 means here

A `ReflectSession` is an `API`, which is a `tsgo` child process reached over a **synchronous** pipe owned by the process that opened it. It cannot be shared across a process boundary, and Metro
transforms in a pool of `jest-worker` children sized by `transformer.workerCount`. So the number REQ-TF-11 asks for — one compiler session per build — is unreachable through Metro in the literal
sense, and pretending otherwise would mean either opening one per file or claiming a number that is not true.

Frozen: **at most one session per transform process**, opened lazily on the first file that survives the `CALLEES` scan and held for the life of the process. `apiInstanceCount()` is the measurement,
and in the Metro tests it is asserted per worker rather than per build, with the reason recorded next to it.

The cost is stated rather than buried: a project loaded N times for N workers, and the ceiling is memory, not CPU — loading the project is the expensive half and it happens once per worker either way.

Two escapes, both documented rather than automatic:

- `withZmdb(config, { workerCount })` lowers Metro's top-level `maxWorkers` for a machine that cannot hold N programs. It is not defaulted to 1, because a bundle is mostly files with no call site in
  them and those files want the parallelism.
- An `@zmdb/compiler` project prebuild is the route for a build that cannot afford N sessions at all: one process, one session, transformed sources on disk, and Metro then sees no `CALLEES` name
  anywhere and does no TS work. Same transform, so the outputs are comparable — which is what makes this a tuning choice and not a different product.

### 6.3 The cache key, and the staleness that a version number does not fix

Metro caches a transform result under a key derived from the file's contents plus the transformer's `getCacheKey()`. Two distinct staleness bugs follow, and only the first is the well-known one.

**The upgrade case.** If `getCacheKey()` does not move when zmdb does, an upgrade serves yesterday's emitted checks — or untransformed output from before zmdb was installed. So the key folds in: the
delegate's own `getCacheKey()`, this package's version, the resolved options, and the absolute `tsconfig.json` path with its text.

**The case the issue does not mention, and the one that can ship wrong data.** This transform's output for `usage.ts` is a function of a type declared in `models.ts`.

Metro's key is per file and its contents are `usage.ts`'s, so editing `models.ts` alone leaves a cached inline check for the previous shape of `User` — and for `schemaOf<T>()`, a cached _schema_,
which is a wrong table rather than a slow one. `getCacheKey()` is called once per build and not once per file, so a per-file dependency set has nowhere to go: the only key Metro's model can carry is a
project-wide one.

Frozen: the key also folds in a **type fingerprint** — for every file in the loaded project that is neither under `node_modules` nor a `.d.ts`, its path, byte length and mtime, concatenated. Three
notes on that:

- zmdb hashes nothing. `getCacheKey()` returns a string that Metro folds into its own digest, so the material is returned and Metro does the hashing — which is also why `.oxlintrc.json`'s ban on
  `node:crypto` costs nothing here.
- Length and mtime rather than content: a cache key has to survive accidents, not adversaries, and this is the same bet Metro's own file watcher already makes. A file rewritten to the same length
  within the same millisecond is a stale entry, and that is accepted explicitly.
- The consequence, said out loud: any source edit changes the key, so a cold build after an edit re-transforms every module. For the files with no call site that is the delegate alone, which is what
  an app without zmdb pays.

**Inside a running dev server this is still not sound, and the freeze says so rather than implying otherwise.** The fingerprint is taken once at startup; after that Metro re-transforms only the file
that changed, so editing a type leaves its consumers holding the previous emission until they are touched too. The remedy is `--reset-cache` (`expo start --clear`), and the page documents it.

Fixing it properly needs something that does not exist yet: `TransformResult` would have to report which files the IR was read from, so the integration could compare their mtimes per file. That field
is the precondition, and **#521 may not claim dev-mode correctness without it** — an integration that quietly serves a stale schema is the failure this whole section is arranged around.

### 6.4 A refusal fails the bundle, and an untransformed build already fails loudly

The Metro wrapper passes no `onDiagnostic`, so the default applies and a refused call site throws during transform: a red screen in dev, a non-zero `expo export` in CI. That is deliberate.

The alternative is a bundle that ships a call the transform declined, and on this platform the fallback is not a slower correct answer — `schemaOf<T>()` has no runtime implementation and throws by
design, and `is<T>(x)` with no witness throws `runtime type witness required in test/fallback mode`.

Neither silently accepts anything, which is the epic's third architecture constraint holding by construction rather than by a new check. `docs-site/content/connect-react-native.md` used to claim the
opposite ("validators silently accept everything"); #520 corrects that present-tense statement while leaving the setup rewrite to #523.

### 6.5 Expo has no config-plugin form of this, and the page must not offer one

`withZmdb(getDefaultConfig(__dirname))` is the Expo instruction as well as the bare-RN one, and §6.1's "read what is already there" is exactly why one line covers both: Expo's default config has
already set both knobs, and the wrapper takes what it finds.

There is no Expo config plugin here. Config plugins run at prebuild and edit the native projects; they have no access to the Metro config a later `expo start` composes. An app that never runs prebuild
still needs the transform, so the instruction cannot live there.

This is written down because "Expo has a plugin system" is the plausible wrong answer, and a page that offers a config plugin would be offering something that cannot work. Expo Router, `expo export`
and EAS Build all run the same Metro pipeline and need nothing further.

### 6.6 What #520 has to measure

1. A real Metro bundle of a fixture app contains the inlined schema and no surviving `schemaOf` call.
2. An app with a pre-existing `babelTransformerPath` still gets that transformer's output — the delegation is asserted, not assumed, including that the delegate is reached by path across the worker
   boundary.
3. `getCacheKey()` changes when a type in another file changes, and does not change when nothing does.
4. `apiInstanceCount()` is 1 per transform process, and 0 for a bundle with no `CALLEES` name in it.
5. The transformed output is byte-identical to the unplugin route's for the same fixture, which is `verify:fixtures` gaining a third row rather than a new assertion style.

## 7. Non-goals (rejected)

- No walk over a runtime witness on the emitted hot path (that is the runtime fallback).
- No async validation. No reflection at runtime.
- **No replacing `transformerPath` or `babelTransformerPath`.** §6.1 — Expo ships both, and an integration that works only in an app with no other transformer works in no real app.
- **No Metro-specific transform implementation.** §6 — one front end, and `verify:fixtures` is how that claim stays true.
- **No dev-mode flag that skips the transform.** The device path has no runtime fallback to skip to (§6.4).
- **No Expo config plugin.** §6.5 — it runs at prebuild and cannot reach the Metro config.
- **No claim of one compiler session per build under Metro.** §6.2 — the pipe is synchronous and process-owned, so the valid number is one per worker.

## 8. Package owner after tooling extraction (#626/#628)

The unplugin implementation, inline benchmark and Metro adapter live in `@zmdb/compiler`. Canonical implementation entries are `@zmdb/compiler/unplugin` and `@zmdb/compiler/metro`, exposed to product
users through `zmdb/compiler`. The old `@zmdb/aot-validator/plugin`, `/unplugin` and `/metro` entries were removed rather than forwarded. `zmdb/unplugin` is only a release-governed compatibility alias
for the stable product surface.

Both adapters load project configuration from `@zmdb/compiler/config` and reuse `@zmdb/compiler/reflect`, `/emit` and `/transform`. The package move does not create an adapter-specific type walk or
emitter. Runtime validator roots cannot reach either adapter.
