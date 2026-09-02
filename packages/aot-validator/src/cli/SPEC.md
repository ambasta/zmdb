# `zmdb-codegen` — Spec (PRD §6.3 REQ-AV-3, §6.7 REQ-TF-11)

> Part of `@zmdb/aot-validator` (module `src/cli/`). Build-time; the only binary the
> monorepo publishes (`bin: { "zmdb-codegen": "./src/cli/bin.ts" }`).
> Package spec: `../../SPEC.md`. Design: `PLAN-type-first.md` Phase 5.

## 1. Why a CLI exists at all

The unplugin gets its type information for free: a bundler hands it a module, it asks the
compiler about the type arguments in it, and it hands back rewritten source that only the
bundler ever sees. A project built by plain `tsc`, or run straight off `node
--strip-types`, has nowhere to put that step.

REQ-AV-3 says the compiled path may not be a reward for choosing a particular bundler. So
this writes the rewrite down: the output is checked in, and a fresh clone builds the fast
path with no tool at all in the way.

```
zmdb-codegen [--project <tsconfig.json>] [--check] [--watch]
```

`--project` defaults to `./tsconfig.json`. Exit codes: `0` clean, `1` a real problem or a
stale tree under `--check`, `2` a usage error. `--check` and `--watch` together are refused
rather than resolved — they ask for opposite things.

## 2. What it rewrites

`src/cli/scan.ts` finds calls to the eight callees the transformer knows — `is`, `assert`,
`equals`, `assertEquals`, `validate`, `random`, `toJsonSchema`, `schemaOf` — with a type
argument. The scan is textual and deliberately cheap, because most files have none; the
compiler is only asked about the files that do.

Per source file that validates anything, **three files beside it and one edit to the
source**. `is<User>(data)` becomes `zmdbIsUser(data)`, imported from a generated module.
For `src/app.ts`:

| File                      | What it is                                                 |
| ------------------------- | ---------------------------------------------------------- |
| `app.zmdb.witness.ts`     | one wrapper per call site, written against the runtime API |
| `app.zmdb.generated.js`   | the emitter's output for those wrappers                    |
| `app.zmdb.generated.d.ts` | their signatures                                           |

Commit all four. `.tsx` sources get a `.ts` witness — a wrapper has no JSX in it — and a
path with no recognised extension falls back to appending rather than replacing.

## 3. Why three files

The rewrite is **destructive**. After a run the source says `zmdbIsUser(data)` and the
`is<User>(data)` it came from is gone — so the type argument, the only input the whole
pipeline has, would be gone with it. The witness keeps it, in a form the consumer's own
`tsc` checks. A renamed or deleted `User` therefore becomes a build error in a generated
file, rather than a compiled validator that quietly keeps describing a type nobody declares
any more.

The witness is also the transform input, and its output cannot be the artifact: the emitted
helpers are untyped JavaScript (`function _zmdbFreeze(_v)`), which under `noImplicitAny` is
an error per parameter. Hence a `.js` the compiler never looks at, plus a `.d.ts` carrying
the signatures.

That split pays for itself twice. There is not one type assertion anywhere in the generated
code; and `schemaOf<T>()`'s phantom — `TaggedSchema<T>`'s `unique symbol` slot, which no
object literal can satisfy — is **declared** in the `.d.ts` rather than asserted into
existence.

The JavaScript is extracted from the transformer's output by sentinel comments
(`/*zmdb:begin:NAME*/` … `/*zmdb:end:NAME*/`, and `/*zmdb:imports*/` around the header),
which is only sound because `witness.ts` wrote every line around them: the transformer
replaces call spans and prepends a prelude, and never moves a statement or touches a
comment.

## 4. The order is not the obvious one

Every witness is written **before** any of them is transformed.

The reason is cost. Telling the compiler about a new file is a snapshot update, and one
update per file would make a hundred-file project a hundred re-checks. Two updates for the
whole run is the difference between this being usable and being a thing people turn off
(REQ-TF-11). `verify:build-budget` watches a 64-module run and asserts the project is opened
once.

A caller may supply an already-open `ReflectSession`, as the plugin does, and keeps
ownership of it — closing someone else's compiler is not this module's call.

## 5. `--check` writes nothing, and still checks everything

A check that had to write the witnesses in order to verify them would dirty the tree it is
auditing. It does not have to: a witness is a pure function of the scan, so a stale one is
caught by comparing text. And if every witness matches, the compiled modules are derivable
from files already on disk — the transform runs against those, and its output is compared
the same way.

A stale tree is reported as a sentence, not a bare exit code: it is an error in the tree
rather than in the code, and whoever reads the CI log needs to know which.

## 6. Verified

- [x] A generated file is not itself scanned (`isGeneratedPath`), so a second run is a no-op.
- [x] `--check` on the committed fixture writes nothing and reports `ok` — the same call CI makes.
- [x] The rewritten source, the witness, the `.js` and the `.d.ts` are asserted as text, not as shapes.
- [x] `fixtures/consumer-cli/` compiles its generated output under `strict: true` in its own project (`node scripts/typecheck.mjs`), so the `.js`/`.d.ts` split is checked rather than argued.
- [x] The CLI route and the plugin route print byte-identical output, and the CLI route runs under plain `node` with no build tool present.
- [x] The snapshot update log is identical at 8 modules and at 64, so the project is opened once however large the project is (`yarn verify:build-budget`).
- [x] The quote style of the source file is preserved in the import the rewrite adds.

## 7. Non-goals (rejected)

- **Generating into a build directory.** The output is checked in on purpose; a `dist`
  nobody reads cannot be reviewed and cannot make a fresh clone fast.
- **Keeping the original call alongside the rewritten one.** Two spellings of the same
  check is the drift this package exists to remove.
- **Parsing type arguments without the compiler.** `../../SPEC.md` §2 records what that
  cost the first time.
