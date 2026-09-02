# Implementation plan — type-first declaration

Implements [`DESIGN-type-first.md`](DESIGN-type-first.md) / PRD §6.7 (`REQ-TF-1` … `REQ-TF-12`).

**Read §1 and §2 first.** They contain the one architectural decision the rest of the
plan depends on, and the five choices that need making before any code is written.

---

## 1. The spine: one IR, two front-ends, N back-ends

The repo currently contains **four independent walkers over the same column
metadata**, each with its own vocabulary, its own gaps, and its own bugs:

| Walker                      | Location                                     | Produces         | Knows about                                   |
| --------------------------- | -------------------------------------------- | ---------------- | --------------------------------------------- |
| `emitCheck`                 | `aot-validator/src/transformer.ts:75`        | inlined JS       | 3 primitives + inline objects                 |
| `matches` / `collectIssues` | `aot-validator/src/utilities/index.ts:52,90` | boolean / issues | 6 kinds, `minimum`/`maxLength`/`pattern` only |
| `scalarSchema`              | `schema-core/src/openapi/index.ts:14`        | JSON Schema      | all 10 `SqlType`s, 5 validation rules         |
| `valueMatchesColumn`        | `repository/src/index.ts:827`                | boolean          | all 10 `SqlType`s, no constraints at all      |

They disagree. `TypeDescriptor` has no `minLength`, no `maximum`, no nullability and
no optionality, so a `Min<18> & Max<120>` column validates differently in each. The
repository accepts `Date | string` for a `timestamp` while `TsType` says `Date` and
`toJsonSchema` says `{type:'string',format:'date-time'}` — three answers for one
column. Adding tags to this without restructuring would make it five walkers.

**So the first deliverable is not tags. It is a single IR that all of them consume.**

```
      FRONT-ENDS                    IR                      BACK-ENDS
                                                    ┌── predicate JS       (is)
  tagged interface ──┐                              ├── issue-collecting JS (assert/validate)
   (checker)         ├──▶  TypeIR / ColumnIR  ──────┼── excess-key JS      (equals)
                     │      (pure data)             ├── sample generator   (random)
  defineSchema ──────┘                              ├── JSON Schema        (openapi/llm/web)
   (value)                                          ├── runtime CoreSchema (query-compiler)
                                                    └── IR walker          (runtime fallback)
```

Three consequences that shape everything downstream:

1. **REQ-TF-7's "byte-identical" AC becomes structural.** Both declaration styles
   produce IR; the JSON Schema emitter is a pure function of IR. Identical output is
   not a test we have to chase — it is the only thing the code can do.
2. **REQ-TF-12 (migration) is free.** `defineSchema` keeps working because the
   value→IR front-end is one of two peers, not a legacy path.
3. **REQ-AV-4 (identical runtime fallback) becomes structural too.** The runtime
   walker and the emitter consume the same IR. `TypeDescriptor` is _replaced by_ IR
   rather than extended alongside it — which also deletes a vocabulary instead of
   adding one.

The IR must be **serialisable JSON**. That is what lets the codegen CLI (§4, Phase 8)
write it to disk, lets golden tests snapshot it, and keeps the reflection layer
(which needs `typescript`) out of every runtime bundle.

### 1.1 Package layout

Constraint: `@zmdb/schema-core` imports **no sibling and no third-party runtime
dependency** (REQ-SC-8), and `typescript` must never become a runtime dependency of
anything.

| New surface                                                   | Package                                | Deps                            | Why there                                                                  |
| ------------------------------------------------------------- | -------------------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `zmdb/tags` — the tag vocabulary                              | `schema-core/src/tags/index.ts`        | none (types only)               | Every package's derivations need it; it is pure types so it costs nothing. |
| `zmdb/ir` — IR types + `irFromSchema()` + JSON Schema emitter | `schema-core/src/ir/index.ts`          | none                            | Pure data in, pure data out. Keeps REQ-SC-8.                               |
| `irFromType(checker, type)`                                   | `aot-validator/src/reflect/index.ts`   | `typescript` (peer, build-time) | Only the build path may see the checker.                                   |
| IR → JS emitters                                              | `aot-validator/src/emit/index.ts`      | none                            | Strings in, strings out; testable without a checker.                       |
| IR runtime walker (replaces `TypeDescriptor`)                 | `aot-validator/src/utilities/index.ts` | `import type` only              | Ships to consumers; must stay dependency-free.                             |
| `zmdb-codegen` CLI                                            | `aot-validator/src/cli/index.ts`       | `typescript` (peer)             | The `tsc`-without-a-plugin answer. See Phase 8.                            |

`typescript` moves to `peerDependencies` + `peerDependenciesMeta.optional` on
`@zmdb/aot-validator`, imported **only** from `./reflect`, `./plugin` and `./cli`.
A `verify:exports` addition asserts no runtime entrypoint reaches it.

---

## 2. Decisions to make before Phase 1

These five change the shape of the work. Recommendations given; each is cheap to
reverse only before Phase 3.

### D1 — `PrimaryKey` name collision. **Recommend: rename the derivation.**

`schema-core` already exports `PrimaryKey<S>` — the _value_ type of a row's key
(`index.ts:144`). The tag wants the same name, and it is the name users type most.
Since `export *` is banned (REQ-UM-3), the umbrella would surface an explicit
collision.

Rename the derivation to `PrimaryKeyOf<S>`, keep `PrimaryKey<S>` as a deprecated
alias for one alpha cycle, and give the tag the good name. The packages are
`1.0.0-alpha.4`; this is the moment for it. _Alternative if rejected:_ tags live only
under `zmdb/tags` and users import them namespaced (`import type * as t from
'zmdb/tags'` → `t.PrimaryKey`), which is uglier at every declaration site.

### D2 — Dual-input derivations. **Recommend: conditional dispatch, one name.**

```ts
export type Entity<T> = T extends { readonly columns: ColumnsMap } ? EntityFromSchema<T> : EntityFromTags<T>;
```

Every existing `Entity<typeof UserSchema>` call site keeps compiling, and
`Entity<User>` works. Cost is one non-recursive `extends` per use. Measure it against
REQ-TF-3's AC before committing (Phase 3 has the budget test); if instantiation counts
move, fall back to distinct names (`EntityOf<T>`) and a codemod.

### D3 — `timestamp`: `Date`, `string`, or both? **Recommend: `Date` in the entity, and add `Wire<T>`.**

This is the one genuine semantic hole the work will expose rather than create.
`TsType` says `timestamp` → `Date`. `toJsonSchema` says `{type:'string',format:'date-time'}`.
`valueMatchesColumn` accepts `Date | string`. A generated validator must pick one, and
whichever it picks, one of the three existing behaviours becomes a bug.

The honest model is that a column has **three** types, not one:

|      | Type                   | Example             |
| ---- | ---------------------- | ------------------- |
| wire | what arrives over HTTP | `string` (ISO-8601) |
| app  | what handler code sees | `Date`              |
| db   | what the driver binds  | driver-dependent    |

Introduce `Wire<T>` as a first-class derivation alongside `Entity<T>`, with the
existing `custom-types` `CustomType<TS, DB>` (extended to `CustomType<Wire, TS, DB>`)
as the codec between them, named from the type by a `Codec<'Name'>` tag. `Entity<T>`
validators check `instanceof Date`; `Wire<T>` validators check the ISO string; the web
pipeline decodes wire→app once at the boundary. **This is a sub-project (Phase 7b), and
it is the single most likely thing to blow the schedule.** It can be deferred by
scoping Phase 4 to non-`timestamp` columns, but it cannot be skipped — `REQ-TF-7`'s
byte-identical AC will fail on any schema with a timestamp until it is resolved.

### D4 — Unresolvable types: error, warn, or silent? **Recommend: error, with an opt-out.**

Today an unresolvable `is<T>` silently falls through to a runtime path that throws
`'runtime descriptor required'`. That policy is exactly what produced the miscompile
fixed in `30850812`. New policy: the reflection emits a **build diagnostic naming the
file, the type, and the unsupported construct**, and fails the build unless
`{ onUnsupported: 'warn' | 'runtime' }` is set. `is<T>` where `T` is an unresolved
type _parameter_ is always a hard error — it cannot be made to work and silently
compiling it is a lie.

### D5 — Tag identity across duplicate installs. **Recommend: name-based reflection, documented caveat.**

A tag is `declare const zmdbMin: unique symbol`. If a consumer ends up with two copies
of `@zmdb/schema-core`, the two `unique symbol`s are different types, so `T[K] extends
Serial` silently returns `false` and `CreateDTO` stops stripping the serial key. The
_reflection_ is immune (it matches the escaped name `__@zmdbMin`, which is textual),
but the _type-level filters_ are not.

Mitigation: reflect on names (already the prototype's behaviour), add a Phase 2 test
that a duplicated-install fixture produces a diagnostic rather than wrong output, and
document it. There is no way to make `unique symbol` install-agnostic; pretending
otherwise would be dishonest.

---

## 3. What already exists

Do not re-derive these. Measured and committed, not assumed.

- **The checker is cheap.** One `API` instance, `new API()` in **3 ms**, all six
  package projects opened in **57 ms** total (4 ms to add the second project to an
  open snapshot), invalidating a changed file in **0 ms**. `getSemanticDiagnostics` is
  56–104 ms per project but the transformer never needs it — that is `tsc`'s job.
  REQ-TF-11 is a wiring discipline, not a performance problem.
- **The prototype works** — `scripts/prototypes/type-first/`, 25 asserted
  expectations, covering tags on intersections, key filtering, resolution through
  `Omit`/`Pick`/`Partial`, nullability, optionality, literal unions, arrays, tuples,
  nested objects with a cycle guard.
- **AST node positions are available** (`pos`, `end`, `getStart()`), so rewriting is
  surgical rather than regex-based.
- **`FileChanges` is invalidation-only** — `{ changed: [...] }` tells the checker to
  re-read from **disk**. There is no in-memory overlay. See Phase 5.1; this is the
  single most consequential API constraint.
- The existing conditional types (`AutoIncrementKeys`, `DefaultKeys`,
  `StateUpdateDTO`, `TransitionPatch`, `PatchableFields`) are reusable unchanged.

---

## 4. Phases

Sizes are relative: **S** ≈ a day, **M** ≈ a few days, **L** ≈ a week or more, **XL** ≈ multi-week.
"Gate" is what must be true to call the phase done.

---

### Phase 0 — Decisions and scaffolding · S

1. Resolve **D1–D5**; record each in `DESIGN-type-first.md` §9 as a dated decision
   with its rejected alternative.
2. Add subpaths `./tags`, `./ir` to `schema-core`; `./reflect`, `./emit` to
   `aot-validator`; register both in the `zmdb` umbrella map; extend
   `verify:exports`.
3. Move `typescript` to an optional peer dep of `aot-validator`; add the guard that
   no runtime entrypoint imports it.
4. Add `scripts/prototypes/type-first/run.mjs` to CI as a smoke test so the reference
   implementation cannot rot while the real one is built.

**Gate:** `yarn verify:exports`, `yarn typecheck`, `yarn lint`, `yarn test` green; the
five decisions written down.

---

### Phase 1 — The IR · M

The linchpin. No behaviour change, no new user-facing surface.

**Deliverables**

- `schema-core/src/ir/index.ts` — the IR types. Must be JSON-serialisable and must
  express _everything_ the four existing walkers express plus everything the tags
  add:

  ```ts
  type TypeIR =
    | { kind: 'primitive'; of: 'string' | 'number' | 'bigint' | 'boolean' | 'null' | 'undefined' }
    | { kind: 'literal'; value: string | number | boolean }
    | { kind: 'date' }
    | { kind: 'array'; of: TypeIR }
    | { kind: 'tuple'; of: readonly TypeIR[] }
    | { kind: 'union'; of: readonly TypeIR[] }
    | { kind: 'object'; name?: string; properties: readonly PropertyIR[]; indexSignature?: TypeIR }
    | { kind: 'ref'; to: string } // cycles
    | { kind: 'unsupported'; reason: string; display: string };

  interface PropertyIR {
    name: string;
    type: TypeIR;
    optional: boolean;
    readonly: boolean;
    constraints: Constraints;
    column?: ColumnIR;
  }
  interface Constraints {
    min?: number;
    max?: number;
    integer?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    enum?: readonly (string | number)[];
    codec?: string;
  }
  interface ColumnIR {
    sql: SqlType;
    primaryKey?: boolean;
    serial?: boolean;
    unique?: boolean;
    hasDefault?: boolean;
    sensitive?: boolean;
    references?: string;
    length?: number;
  }
  interface SchemaIR {
    table: string;
    ftsTable?: string | boolean;
    columns: readonly PropertyIR[];
    relations: readonly RelationIR[];
  }
  ```

  `unsupported` as a **first-class node** is deliberate: gaps become data that a
  diagnostic can report, rather than a silently-emitted `false`.

- `irFromSchema(schema: CoreSchema): SchemaIR` — the value→IR front-end, replacing
  nothing yet.
- `packages/schema-core/src/ir/ir.spec.ts` — golden IR snapshots for a corpus of
  schemas: every `SqlType`, every `ColumnFlags` combination, every `ValidationRule`
  kind, nullable/defaulted/sensitive/composite-PK/FK/FTS, `json` with a payload,
  `jsonEnum`.

**Gate:** every fact reachable through `defineSchema` appears in the IR — asserted by
a test that enumerates `SqlType`, `keyof ColumnFlags` and the `ValidationRule.kind`s
handled by `scalarSchema`, and fails on any member with no IR representation. This
test is the executable form of **REQ-TF-1**'s AC and must land here, before the tags,
so the tag vocabulary is written _to_ a known target.

---

### Phase 2 — The tag vocabulary · M

**Deliverables**

- `schema-core/src/tags/index.ts` — promote the prototype's `tags.ts`, completed
  against Phase 1's coverage test. Must include what the prototype omits:
  `Fts<Name>`, `Codec<Name>`, the relation tags (`ManyToOne`, `OneToMany`,
  `OneToOne`, `ManyToMany`), `Numeric` precision/scale, and a named-custom-rule
  escape hatch (`Rule<'name'>`).
- `Nullable<T> = T | null` and `NonNull<T> = Exclude<T, null | undefined>` as
  aliases — readability only, **not** tags (REQ-TF-2).
- `tags.type-test.ts` — the coverage assertion from Phase 1 in reverse: every
  `ColumnFlags` member, `SqlType` member and `ValidationRule.kind` has a tag.
- A zero-cost assertion: a fixture whose emitted JS is byte-compared against the same
  fixture with all tags stripped (**REQ-TF-3**).
- The D5 duplicate-install fixture.

**Gate:** REQ-TF-1, REQ-TF-2, REQ-TF-3. Coverage test green in both directions.

---

### Phase 3 — DTO converters · M

**Deliverables**

- `SerialKeys`, `DefaultKeys`, `PrimaryKeyKeys`, `SensitiveKeys`, `UniqueKeys`,
  `NullableKeys` over tagged types.
- Dual-input dispatch (**D2**) for `Entity`, `CreateDTO`, `UpdateDTO`, `WhereDTO`,
  `PrimaryKeyOf`, and the `dto/` module's order-by, pagination, projection, list and
  populated shapes.
- **New:** `ReadDTO<T>` = `Omit<Entity<T>, SensitiveKeys<T>>` (**REQ-TF-6**), and
  `Wire<T>` if **D3** is accepted.
- Relation-tag-driven `PopulatedEntity` / `Populated` / `JoinRow`.

**Tests**

- The existing REQ-SC-2…REQ-SC-5 type tests, re-run with a tagged interface
  substituted for `typeof Schema` — they must pass **unchanged** (REQ-TF-4's AC).
- Constraint survival through `Omit`/`Pick`/`Partial` (REQ-TF-5).
- `@ts-expect-error` on reading a sensitive field off `ReadDTO<T>` (REQ-TF-6).
- **A type-instantiation budget test.** `--diagnostics` instantiation count on a
  fixture project, before and after D2, committed as a number with a ceiling. This is
  REQ-TF-3's other half and the answer to RISK-6.

**Gate:** REQ-TF-4, REQ-TF-5, REQ-TF-6; instantiation budget within ceiling.

---

### Phase 4 — Reflection: type → IR · L

The first phase that needs the checker. Promote and harden the prototype's
`classify`/`readTags`/`checks` into `aot-validator/src/reflect/`.

**Deliverables**

- `irFromType(checker, type, opts): TypeIR` — total, never throws, returns
  `{kind:'unsupported'}` for anything it cannot model.
- Named-helper + cycle handling via `ref`, at real depth.
- A `LimitsExceeded` path: depth cap, node-count cap, and a cap on distinct emitted
  helpers, each producing a diagnostic rather than a hang.

**Constructs that must be handled or explicitly refused** — this list is the phase's
actual scope, and each item needs a fixture:

| Construct                                                     | Expected                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| primitives, literals, literal unions                          | supported                                                              |
| `boolean` (a _union_ of two literals — see DESIGN §5)         | supported                                                              |
| `T \| null`, `T \| undefined`, optional properties            | supported                                                              |
| arrays, readonly arrays, tuples, optional/rest tuple elements | supported                                                              |
| nested objects, recursive objects, mutual recursion           | supported via `ref`                                                    |
| intersections of object types                                 | supported (merge properties)                                           |
| discriminated unions (REQ-AV-5)                               | supported — discriminant-first emit                                    |
| non-discriminated unions (REQ-AV-5)                           | supported — ordered disjunction                                        |
| `Date`, `bigint`                                              | supported                                                              |
| index signatures, `Record<string, T>`                         | **verify first** — unknown whether `getPropertiesOfType` surfaces them |
| mapped/conditional types, `Omit`/`Pick`/`Partial`/`Required`  | supported (prototype-proven)                                           |
| generic type _parameters_ (`is<T>` inside `function f<T>()`)  | hard error (D4)                                                        |
| `unknown`, `any`, `never`, `object`, `symbol`                 | explicit refusal with a diagnostic                                     |
| `Map`, `Set`, `Promise`, class instances, functions           | explicit refusal                                                       |
| template-literal types, branded types (`advanced/brands.ts`)  | supported as string + pattern where derivable, else refusal            |

**Tests**

- Golden IR snapshots per construct.
- `irFromType` vs `irFromSchema` **equivalence**: for a corpus where both a
  `defineSchema` call and a tagged interface describe the same table, the two IRs must
  be deep-equal. This single test carries most of REQ-TF-7 and REQ-TF-12.

**Gate:** the table above, every row either passing or producing a named diagnostic.
Zero rows silently wrong.

---

### Phase 5 — Emitters and the transformer · L

**5.1 The position/overlay problem — decide before writing code.**

`transformCode(code: string)` takes a string and no file identity
(`transformer.ts:216`). A checker-driven transformer needs the file's path _and_ a
program, and the checker reads content **from disk** (§3). So if an earlier plugin has
already rewritten the module, the checker's positions do not match the incoming
`code`.

Resolution: add `transformFile(fileName, code, ctx)` alongside the existing
`transformCode`, and have it **verify that `code` is byte-identical to the on-disk
text**. If it is, rewrite by position. If it is not, emit a diagnostic and skip
(never guess). Correspondingly the plugin declares `enforce: 'pre'` so it runs before
other transforms. `transformCode(code)` stays as the no-checker path for the existing
tag-call inlining (`tags.Minimum(…)`), which needs no types.

**Deliverables**

- `aot-validator/src/emit/index.ts` — IR → JS, four emitters sharing one walk:
  `predicate` (is), `issues` (assert/validate, with `path`/`expected`/`value` and
  **no allocation on the success path** — REQ-AV-7), `excess` (equals/assertEquals),
  `sample` (random).
- `aot-validator/src/reflect/session.ts` — the single `API` holder: one instance per
  build, projects opened once, `fileChanges` for watch-mode invalidation, explicit
  `close()`. **REQ-TF-11.**
- `transformFile` + `zmdbAot()` rewired to it; `enforce: 'pre'`; graceful degradation
  when no tsconfig covers the file.
- Delete `parseType`, `primType`, `PType`, `emitCheck`, `emitEqualsCheck`,
  `emitExcessKeyGuards` (**REQ-TF-8**).
- Rewrite `utilities/index.ts`'s `matches`/`collectIssues`/`hasNoExcessKeys`/`randomFor`
  to walk **IR**; `TypeDescriptor` becomes a deprecated alias of the IR object node.

**Tests**

- Snapshot the emitted output for every Phase 4 fixture.
- **The differential suite** (REQ-AV-4): for each fixture, feed a corpus of valid and
  invalid values to (a) the emitted predicate, (b) the IR runtime walker, and assert
  identical accept/reject sets _and_ identical issue paths. Corpus generated by
  `random<T>()` plus a mutator that perturbs one field at a time.
- Success-path allocation probe (REQ-AV-7).
- A build-time budget test: N-file fixture, assert one `API` instance and a wall-time
  ceiling (REQ-TF-11).
- Watch-mode test: touch one file, assert the rebuild path calls `fileChanges` and not
  `openProjects`.

**Gate:** REQ-TF-8, REQ-TF-11, REQ-AV-4, REQ-AV-7; `parseType` gone; differential
suite green.

---

### Phase 6 — JSON Schema, OpenAPI, LLM · M

**Deliverables**

- `schema-core/src/ir/json-schema.ts` — `jsonSchemaFromIR(ir, variant)`. Move
  `scalarSchema`'s logic here verbatim first, _then_ refactor, so the golden output
  cannot drift during the move.
- `toJsonSchema(schema, variant)` reduced to `jsonSchemaFromIR(irFromSchema(schema), variant)`.
- `toJsonSchema<T>()` — the type-driven form, replaced at build time by a frozen
  object literal (**REQ-TF-7**). Also a new emitter target in `emit/`.
- `toJsonSchemaWithRelations`, `toOpenApiComponents`, `toListSchema`,
  `toSearchSchema`, `toolFromSchema` re-pointed at IR; **contracts unchanged**.
- `Variant` as a type argument: `toJsonSchema<CreateDTO<User>>()`.
- `web`'s `RouteSchemas` / `toOpenApi` fed from the generated literals.

**Tests**

- Byte-identical documents from the value path and the type path for the whole Phase 1
  corpus (**REQ-TF-7**'s AC).
- Every existing openapi/llm golden test unchanged.
- No `Sensitive` key in any generated read/list/search/OpenAPI document (REQ-TF-6).

**Gate:** REQ-TF-7; `scalarSchema` deleted; zero golden-file diffs.

---

### Phase 7 — Repository, query compiler, and the generated schema value · L

**7a — the runtime schema value (REQ-TF-10)**

The query compiler needs the table name and column SQL types as _data_. Emit
`schemaFromIR` output as a generated `const satisfies CoreSchema` — derived, not
authored, so P2 holds. `defineRepository(User)` accepts a tagged type via the
generated const.

- Test: the generated const produces **identical SQL** to today's `defineSchema` call
  for every existing dialect snapshot. This is the AC, and it is a strong one — it
  reuses the entire per-dialect snapshot suite as the correctness proof.

**7b — collapse `validatePayload` (D3's home)**

`repository`'s `validatePayload`/`valueMatchesColumn` (`index.ts:783,827`) becomes a
call to the emitted `CreateDTO`/`UpdateDTO` validator. This deletes the fourth walker
and is where the `timestamp` three-types problem must be resolved, because the
repository's current `Date | string` tolerance is the reason nobody noticed the
disagreement. Ship `Wire<T>` + `Codec` here.

- REQ-RP-3's behaviour must not regress: `create({bogus:1})` still rejects at runtime
  with a structured path.

**7c — the benchmark harness (REQ-TF-9)**

Delete `columnKind` and `createDtoDescriptor` from
`benchmarks/harness/framework/app.ts:101,119`, and the hand-written descriptors in
`benchmarks/harness/validation/*`, `benchmarks/src/validation/adapter.ts`,
`benchmarks/participants/validation/cases/zmdb/`. Add the grep guard.

**Gate:** REQ-TF-9, REQ-TF-10; SQL snapshots unchanged; `valueMatchesColumn` gone;
validation and ORM benchmark numbers re-measured and committed.

---

### Phase 8 — The `tsc` path: a codegen CLI · M

TS 7's Go compiler does not run `ts-patch`-style program transformers, so REQ-AV-3's
"tsc transformer" cannot be satisfied as written. The plan does not wait for it.

`zmdb-codegen` reads a tsconfig, walks `is`/`assert`/`validate`/`equals`/`random`/
`toJsonSchema` call sites, and writes a generated module per project containing the
validators, the JSON Schema literals and the runtime schema consts. A tiny stable
import replaces the call. Plain `tsc`, plain `node --experimental-strip-types`, plain
anything then gets the AOT path with **no plugin at all**.

This is strategically larger than it looks: it converts **RISK-1** ("the AOT premise
is unearned out of the box — without the plugin, consumers get a runtime validator
slower than zod v4") from a plugin-adoption problem into a one-command build step. The
bundler plugin remains, as the optimisation that removes the last function call
(REQ-AV-1).

- Deliverables: the CLI, `--watch`, a consumer fixture project in CI that builds with
  **only** the CLI, and a second that builds with the plugin.
- Test: both fixtures produce identical accept/reject behaviour; the plugin fixture's
  bundle contains no function call on the happy path (REQ-AV-1); the CLI fixture's
  measured throughput is published beside the plugin's.

**Gate:** REQ-AV-3 closed or explicitly re-scoped in the PRD with the reason.

---

### Phase 9 — Ratchets, docs, and cleanup · M

**CI gates to add** (all of these are currently missing, and several are ACs that no
script enforces):

| Script                  | Enforces                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `verify:tf-coverage`    | tag ↔ `SqlType`/`ColumnFlags`/`ValidationRule` parity (REQ-TF-1)                                                                                                                           |
| `verify:no-descriptors` | zero hand-authored descriptors in `packages/` + `benchmarks/` (REQ-TF-9)                                                                                                                   |
| `verify:build-budget`   | one `API` instance; wall-time ceiling (REQ-TF-11)                                                                                                                                          |
| `verify:instantiations` | type-instantiation ceiling (REQ-TF-3, RISK-6)                                                                                                                                              |
| `verify:escape-hatches` | **the RISK-7 counter.** Recompute PRD §9.4, fail on any increase, fail on an assertion with no `// boundary:` comment in its enclosing function, and carry the `new Function`/`eval` grep. |

The last one is overdue independently of this work: the published figure was 23 and
the real count is 28 — it drifted up by five with nothing watching. Land it here
because Phase 5 and 7 will delete assertions and the ratchet should capture that.

**Docs**

- `docs-site` pages: type-first declaration, the tag reference, migration from
  `defineSchema`, the codegen CLI. Plus `coverage/mapping.mjs` entries, or
  `verify:docs-coverage` fails.
- `SPEC.md` for `schema-core` (tags, IR, converters) and `aot-validator` (reflect,
  emit, CLI) — `validate:spec` requires them.
- `COOKBOOK.md` recipes; `ARCHITECTURE.md` §2 for the IR spine; PRD §7.2's worked
  example rewritten type-first.
- Retire `scripts/prototypes/type-first/` once Phase 5 supersedes it, or keep it as a
  minimal-reproduction harness — decide, don't leave it ambiguous.

**Also fix, since it blocks publishing:** `yarn build` fails at the `dts` step
(`Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')`) because
tsup's bundled `rollup-plugin-dts` wants the old JS compiler API. Same root cause as
this whole project — TS 7 changed the API shape.

**Gate:** all `REQ-TF-*` ACs enforced by a script, not by a document. PRD §6.7 rows
updated from "planned" to met, with the enforcing script named in each AC.

---

## 5. Sequencing

```
Phase 0 ─┬─ Phase 1 (IR) ─┬─ Phase 2 (tags) ── Phase 3 (DTOs) ─┐
         │                │                                     ├─ Phase 6 (JSON Schema)
         │                └─ Phase 4 (reflect) ── Phase 5 (emit)┤
         │                                                      ├─ Phase 7 (ORM)
         └─ Phase 9 CI ratchets (independent, start anytime)     └─ Phase 8 (CLI)
```

- **Phase 1 blocks everything.** Do not start tags before the IR coverage test exists.
- Phases 2+3 and 4+5 are independently parallelisable once the IR is frozen — one
  track is pure types, the other pure codegen, and they meet only at the IR.
- Phase 9's ratchet scripts have no dependencies and should start immediately; they
  are what keeps phases 5–7 honest as code is deleted.
- Phase 8 needs Phase 5's emitters but not Phases 6–7.

Rough total: **6–10 weeks** of focused work, with Phase 4 and Phase 7 carrying most of
the uncertainty. The two most likely overruns are D3's three-types problem (Phase 7b)
and the union/discriminated-union emit matrix (Phase 4).

## 6. Risks specific to the implementation

| Risk                                                                                                                                                                                  | Mitigation                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D3 (`timestamp`) cascades.** Three different existing behaviours; whichever the validator picks, something that works today breaks.                                                 | Resolve in Phase 0, implement in 7b, and keep `Wire<T>` opt-in until the web pipeline decodes. Do not let Phase 4 emit timestamp checks before this lands.                |
| **Checker resolves differently from `tsc`.** The API is new; a divergence between `getTypeFromTypeNode` and what `tsc` reports would produce validators that disagree with the types. | The Phase 4 equivalence test (`irFromType` vs `irFromSchema`) catches semantic drift. Add a canary: assert `isTypeAssignableTo` agrees with a `@ts-expect-error` fixture. |
| **Position-based rewriting is fragile** under other plugins (§5.1).                                                                                                                   | `enforce: 'pre'` + byte-identity check + skip-with-diagnostic. Never guess.                                                                                               |
| **Instantiation blowup** from D2's dual dispatch on large schemas.                                                                                                                    | The Phase 3 budget test, with a committed ceiling. Fall back to distinct names + codemod.                                                                                 |
| **`unique symbol` identity across installs** (D5).                                                                                                                                    | Name-based reflection; duplicate-install fixture; documented. Unfixable in principle.                                                                                     |
| **Scale is untested.** No fixture today resembles a 60-column entity behind four layers of conditional types.                                                                         | Build that fixture in Phase 1, not Phase 7. It is cheap early and expensive late.                                                                                         |
| **`dts` build is already broken**, so nothing can be published until it is fixed regardless of this work.                                                                             | Phase 9, or earlier if a release is needed.                                                                                                                               |
| **Deleting four walkers touches every package at once.**                                                                                                                              | The IR equivalence tests are the safety net, and each walker is deleted in a separate commit with its differential test already green.                                    |

## 7. Definition of done

`DESIGN-type-first.md` §8's seven items, plus:

8. Every `REQ-TF-*` AC is enforced by a named script in CI, and PRD §6.7 names it.
9. Exactly **one** walker over column metadata exists in the repo. A test asserts the
   other four are gone.
10. A consumer fixture builds with the CLI and no bundler plugin, and gets AOT
    validation — RISK-1 closed.
11. Validation and ORM benchmarks re-measured, committed, and published; the
    type-first path is no slower than today's hand-written descriptor path.
