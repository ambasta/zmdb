# @zmdb/aot-validator — Spec (Issue #21; PRD §6.3, §6.7)

> Targets: Node 26+, ESM-only, `typescript@7` (the Go compiler behind its JS client).
> Module specs: `src/reflect/SPEC.md`, `src/emit/SPEC.md`, `src/utilities/SPEC.md`,
> `src/plugin/SPEC.md`, `src/cli/SPEC.md`, `src/serialization/SPEC.md`,
> `src/advanced/SPEC.md`.

## 1. What the package is

`is<T>(x)` should cost a few `typeof`s, and the type should be the only place the schema
is written. That takes four stages, one module each:

| Module               | Stage                                          | When    |
| -------------------- | ---------------------------------------------- | ------- |
| `src/reflect/`       | a TypeScript `Type` → `TypeIR`                 | build   |
| `src/emit/`          | `TypeIR` → JavaScript                          | build   |
| `src/transformer.ts` | source text in, source text out                | build   |
| `src/plugin/`        | the unplugin adaptor and the per-build session | build   |
| `src/cli/`           | the same rewrite, written to disk              | build   |
| `src/utilities/`     | the same walks over `TypeIR` at runtime        | runtime |

The last two build-time modules are the **two routes into the compiled path**, and they
share stages 1–3 rather than reimplementing them: the plugin hands its output to a bundler,
`zmdb-codegen` commits it. REQ-AV-3 is why there are two — the fast path may not be a reward
for choosing a particular bundler — and `fixtures/consumer-plugin/` and
`fixtures/consumer-cli/` are asserted to produce byte-identical output. See
`src/cli/SPEC.md`.

`@zmdb/schema-core/ir` owns the IR itself, so the SQL back-ends, the JSON Schema
back-ends and this package all speak one vocabulary.

## 2. Two call forms, two mechanisms

**`f<T>(expr)`** — `is`, `assert`, `equals`, `assertEquals`, `validate`, `random`. The
transformer asks the checker what `T` is, reflects it, and emits. Every type TypeScript
can express is therefore either understood exactly or refused by name (REQ-TF-8).

**`validate(rule, expr)`** — the tag-rule form, which carries its rule at the call site
and so needs no types at all. This is the whole of `transformCode`, and it is the only
thing left in it:

| Tag call            | Emitted inline JS                          |
| ------------------- | ------------------------------------------ |
| `tags.Min(n)`       | `(typeof E === "number" && E >= n)`        |
| `tags.Max(n)`       | `(typeof E === "number" && E <= n)`        |
| `tags.MinLength(n)` | `(typeof E === "string" && E.length >= n)` |
| `tags.MaxLength(n)` | `(typeof E === "string" && E.length <= n)` |
| `tags.Pattern(re)`  | `(typeof E === "string" && /re/.test(E))`  |
| `tags.Enum(...v)`   | `(E === v0 \|\| E === v1 \|\| …)`          |

There used to be a third mechanism: a hand-rolled text parser that read type arguments
without a compiler. `f70186c6` is what it cost — it read `string[]` as `string` and
`number | string` as `number`, so a call got inlined to a check that answers a different
question, in a build that reported no problem. It is **deleted, not kept as a fallback**
(REQ-TF-8). A call site the checker cannot reach is left alone, and the refusal is
reported.

## 3. Rewriting is by offset

`sourceFile.text` is byte-identical to the file on disk (measured), so the transformer
replaces byte ranges rather than reprinting an AST: comments, formatting and line breaks
survive untouched. The price is that the offsets are only valid for the exact text the
compiler parsed, so `transformFile` compares before it trusts one, and the plugin declares
`enforce: 'pre'` so nothing edits the module first.

A file where every call site was refused gets **no prelude**. A refused site can still
have hoisted a helper on the way to its refusal, and emitting that alone would leave dead
code in a file the transformer decided not to touch.

## 4. The runtime/build-time split

`typescript@7` is a Go binary behind a JS client that spawns a child process. A runtime
module that reaches it does not merely bloat a bundle — it fails to build one. So the
manifest publishes two sets of entry points:

| Runtime (bundled)                                                         | Build-time (compiler)                                                            |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `.`, `./utilities`, `./errors`, `./emit`, `./serialization`, `./advanced` | `./plugin`, `./reflect`, `./transformer`, `./unplugin`, `./codegen`, `./testing` |

`./testing` is on the build-time side for the same reason the other five are: `schemasFrom<{
User: User }>(import.meta.url, ['User'])` opens the caller's own project and reflects the
named interfaces. It is a compiler client by definition — that is the service — and it exists
because `schemaOf<T>()` has no runtime, so a test with no build step has no other route from
a tagged interface to a schema.

A seventh joins the build-time column when the Metro integration lands: `./metro`, whose
`withZmdb(config)` wraps a project's existing Babel transformer (`src/plugin/SPEC.md` §6). It is a compiler
client like the other six, so it goes in `BUILD_TIME_ENTRIES` too — and it is the one entry point that is
reached by `require` of an ES module rather than by `import`, because `metro.config.js` is CommonJS in every
React Native template.

`typescript` is an **optional peer dependency**: installing this package to call
`is(value, ir)` at runtime should not pull down a compiler, and a build that uses the
plugin already has one.

`./errors` is published because the _emitted_ code imports it by name —
`import { AssertError } from "@zmdb/aot-validator/errors"` — so an unpublished subpath
would make every AOT build produce code that cannot resolve. It is also why a caller's
`catch (e) { e instanceof AssertError }` behaves the same built or not: both paths throw
that exact class.

`.github/scripts/verify-exports.mjs` enforces the split transitively, following `@zmdb/*`
specifiers across package boundaries — the umbrella package is the one consumers actually
import, so a guard that stopped at the boundary would miss the only graph that matters.
`BUILD_TIME_ENTRIES` is the allowlist, and adding to it is a decision about what a
consumer's bundle contains.

## 5. Runtime-safety fallback

Before transformation — dev, a plain `tsx` run, a call the checker refused — every entry
point executes a real implementation returning the same answer. REQ-AV-4 makes that
"identical accept/reject sets **and** identical issue paths", which is a property of two
independent walks and is measured rather than asserted; see `src/emit/SPEC.md` §3 and
`src/utilities/SPEC.md` §3.

## 6. One session per build (REQ-TF-11)

Every checker call is a round-trip to a `tsgo` child process. Spawning the server and
loading the project is the expensive part, so the plugin opens exactly one `API` per build
and refreshes it per file change; `apiInstanceCount()` exists so a test can assert the
count rather than trusting the claim. A session the plugin owns is closed in `buildEnd`; a
session a caller supplied is left open, because closing someone else's compiler is not the
plugin's call.

Metro is the exception, and it is stated here rather than left to be discovered: an `API` is a `tsgo` child
process on a synchronous pipe owned by whichever process opened it, and Metro transforms in a pool of worker
processes. A session cannot cross that boundary, so under Metro the number is **one per transform process**,
and the tests assert it there. "One per build" remains the requirement everywhere a build is one process; the
alternative under Metro would be one session per file, which is the cost this requirement exists to prevent.
See `src/plugin/SPEC.md` §6.2, including the two documented escapes for a machine that cannot hold N loaded
projects.

## 7. Verified

- [x] `parseType` and every other text-based reading of a type argument is gone; eight type-argument forms are asserted to pass through `transformCode` byte-identical.
- [x] A build opens exactly one `API` instance, measured as a delta on `apiInstanceCount()`; zero when there is no project.
- [x] Watch mode refreshes rather than reopens: the session's update log contains exactly one `'open'` however many files change.
- [x] A new module is announced as `created`, not `changed` — a `changed` notification for a file the program has never seen is a measured no-op, so the stale-retry path picks by `sourceFile(id)`.
- [x] Every declared export resolves, names a source path the build mirrors, imports under plain `node`, and — except for the six build-time subpaths — cannot reach `typescript` through any chain of imports.
- [x] All twelve subpaths, and the `zmdb-codegen` binary, still resolve after `npm pack` and install — checked from a project outside this repository, because the workspace's symlinks hide the one failure that matters (`yarn verify:publish`).
- [x] Removing an entry from `BUILD_TIME_ENTRIES` produces the expected errors, so the guard is not vacuous.
- [x] The tag-rule form still inlines to the table in §2, and matches the runtime fallback for good and bad input on every rule.
- [x] The scanner leaves code alone that has no validator call, matches whole identifiers rather than substrings, ignores calls inside comments and string literals, and scans faster than a megabyte a second.

## 8. Non-goals / anti-patterns (rejected)

- **No async validation.**
- **No retained runtime parser objects in transformed output.** The emitted code is
  expressions and hoisted functions; nothing is constructed per call.
- **No text parsing of types.** §2. This is the reversal of the original spec's "no
  reflection", and the reason is recorded there rather than quietly dropped.
- **No `typescript` as a hard dependency.** §4.
- **No compiler session per call site.** §6.
