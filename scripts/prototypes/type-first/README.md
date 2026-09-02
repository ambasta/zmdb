# Prototype — type-first declaration

Runnable evidence for [`DESIGN-type-first.md`](../../../DESIGN-type-first.md) and PRD
§6.7 (`REQ-TF-*`). It exists so the design document's claims can be checked instead of
believed.

The question it answers: **can a domain type declared as a plain `interface` plus type
tags generate the runtime checks, with no schema value anywhere?** Yes — for the cases
listed below.

## Run it

```sh
node scripts/prototypes/type-first/run.mjs      # generate + assert 25 expectations
node scripts/prototypes/type-first/generate.mjs # just print the generated validators
yarn tsc --noEmit -p scripts/prototypes/type-first  # typecheck the model itself
```

`run.mjs` exits non-zero if the generator regresses. It is not wired into `yarn test` —
this is a prototype, and `scripts/typecheck.mjs` only walks `packages/*` and
`benchmarks`.

## The files

| File            | What it is                                                                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tags.ts`       | The tag vocabulary and the DTO converters. Pure types; every tag is an optional `unique symbol` slot, so nothing survives erasure.                                                            |
| `model.ts`      | The domain — `User` and `Post` as tagged interfaces, plus the `assert<T>()` call sites the transformer is expected to rewrite. No `defineSchema`, no `tags.Min(1)` call, no `TypeDescriptor`. |
| `tsconfig.json` | `strict` + `exactOptionalPropertyTypes`. `model.ts` must typecheck before the generator will emit.                                                                                            |
| `generate.mjs`  | Loads the TypeScript 7 checker via `typescript/unstable/sync`, resolves each `assert<T>` type argument, reads the tags off the intersection, and emits the checks.                            |
| `run.mjs`       | Imports the generated module and asserts accept/reject per fixture, then asserts no tag symbol leaked into the output.                                                                        |

## What it covers

`Sql<'serial' | 'integer' | 'bigint'>` → `Number.isInteger`; `Min`/`Max` → numeric
bounds; `MinLength`/`MaxLength`/`Length` → string lengths; `Pattern` → `RegExp`;
literal unions → membership; `| null` and `?` → the right arms and only those arms;
`T[]` and tuples → element checks; nested interfaces → named helpers with a cycle
guard; `Serial`/`HasDefault`/`PrimaryKey`/`Sensitive` → the right keys present or
absent through `Omit`/`Pick`/`Partial`.

Anything outside that emits `/* unsupported: … */ false`, deliberately: a gap should
be visible, not a check that quietly passes.

## What it is not

Not the shipping transformer. It walks `assert<T>()` call sites in one file, prints a
module, and holds one `API` instance for one project. The real implementation has to
answer the build-wiring and per-build-cost questions in `DESIGN-type-first.md` §6.
