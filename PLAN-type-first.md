# Implementation plan — type-first declaration

Implements [`DESIGN-type-first.md`](DESIGN-type-first.md) / PRD §6.7 (`REQ-TF-1` … `REQ-TF-13`).

**Read §1 and §2 first.** They contain the one architectural decision the rest of the
plan depends on, and the five choices that shape it — all five resolved on 2026-09-02.

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

**And the type layer disagrees with the runtime about presence, not just about types.**
`CreateDTO` _omits_ a serial column, so naming it is a compile error. `validatePayload`
builds its result as a whitelist (`repository/src/index.ts:794`, `if
(col.flags.autoIncrement) continue;` with `out` populated from scratch), so a supplied
`id` is **silently dropped** — as is any key not in `schema.columns`. One layer says
"impossible", the other says "no-op". A consequence worth stating plainly: **REQ-RP-3's
AC passes for the wrong reason.** `create({ bogus: 1 })` rejects because the required
columns are missing, not because `bogus` is excess; `create({ ...valid, bogus: 1 })` is
accepted and the key dropped, and no test covers it. Phase 7b has to decide which
behaviour is correct, because the emitted validator replaces that function.

**So the first deliverable is not tags. It is a single IR that all of them consume.**

```
      FRONT-ENDS                    IR                      BACK-ENDS
                                                    ┌── predicate JS       (is)
  tagged interface ──┐                              ├── issue-collecting JS (assert/validate)
   (checker)         ├──▶  TypeIR / ColumnIR  ──────┼── excess-key JS      (equals)
                     │      (pure data)             ├── sample generator   (random)
  defineSchema ──────┘                              ├── JSON Schema        (openapi/llm/web)
   (value, temporary)                               ├── runtime CoreSchema (query-compiler)
                                                    └── IR walker          (runtime fallback)
```

Three consequences that shape everything downstream:

1. **REQ-TF-7's "byte-identical" AC becomes structural.** Both declaration styles
   produce IR; the JSON Schema emitter is a pure function of IR. Identical output is
   not a test we have to chase — it is the only thing the code can do.
2. **The two front-ends are how the tagged path gets proven, not a compatibility
   layer.** Per **D2**, `defineSchema` is being deleted, so the value→IR front-end is
   scaffolding: it exists so that "IR from `User` equals IR from `UserSchema`" can be
   asserted against the existing SQL and JSON Schema snapshots, and it is removed in
   Phase 9 along with `defineSchema` itself.
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

## 2. Decisions — all five resolved 2026-09-02

These five changed the shape of the work. All are now settled; each records what was
rejected, because that is the part that gets forgotten.

### D1 — `PrimaryKey` name collision. **Resolved: rename the derivation.**

`schema-core` already exports `PrimaryKey<S>` — the _value_ type of a row's key
(`index.ts:144`). The tag wants the same name, and it is the name users type most.
Since `export *` is banned (REQ-UM-3), the umbrella would surface an explicit
collision.

The derivation becomes `PrimaryKeyOf<S>` and the tag takes the good name. Because D2
removes the backwards-compatibility requirement, `PrimaryKey<S>` is not kept as a
deprecated alias — it is renamed outright, in one commit, with the call sites updated.

**Landed.** The rename is done: `schema-core/src/index.ts:144` plus the seven
`repository` signatures, the two type-test assertions, the composite-PK spec and the
umbrella export. The collision was real and was already visible —
`zmdb/src/index.ts` exported the derivation as `PrimaryKey` while `zmdb/src/tags.ts`
exports the tag under the same name.

_Rejected:_ namespaced tag imports (`import type * as t from 'zmdb/tags'` →
`t.PrimaryKey`), which is uglier at every declaration site — and declaration sites are
where this library is read.

### D2 — Dual-input derivations. **Resolved: tagged types only. `defineSchema` is deleted.**

The recommendation was a conditional dispatch:

```ts
export type Entity<T> = T extends { readonly columns: ColumnsMap } ? EntityFromSchema<T> : EntityFromTags<T>;
```

That conditional existed for exactly one reason: to keep the existing
`Entity<typeof UserSchema>` call sites compiling. Backwards compatibility is not a
requirement here, so the conditional has no other job and is removed. Three things
follow, and they are all simplifications:

1. **No dispatch, no instantiation risk.** `Entity<T>`, `CreateDTO<T>`,
   `UpdateDTO<T>`, `WhereDTO<T>` and `PrimaryKeyOf<T>` take a tagged type and nothing
   else. The `extends` test per use disappears, and with it the main reason RISK-6
   (type-level derivation cost) was on this plan's critical path. The Phase 3
   instantiation budget test stays — it is still worth having a committed ceiling —
   but it is now a ratchet rather than a go/no-go.
2. **`defineSchema` goes away rather than becoming a peer front-end.** Keeping it
   would mean maintaining two front-ends, two sets of derivations and two paths
   through every emitter forever, to serve a declaration style the PRD's own P2
   describes as inverted (RISK-8). The only genuine use case for a value-shaped schema
   is one not known at compile time, which is outside the compile-time thesis this
   whole project rests on — and if it is ever needed, it is a separate feature built on
   the IR, not a second way to declare a table.
3. **The IR keeps both entry points during the migration only.** `irFromSchema()`
   still gets built in Phase 1 — the repo's entire correctness proof for the tagged
   path is "the IR from `User` equals the IR from `UserSchema`", and the existing SQL
   and JSON Schema snapshots are the differential. It is scaffolding with a demolition
   date: `irFromSchema` and `defineSchema` are deleted together in Phase 9, once the
   equivalence tests have served their purpose and every in-repo schema is tagged.

So the migration path is a codemod plus a deletion, not a compatibility layer.
**`REQ-TF-12` is rewritten accordingly** — it promised `defineSchema` would keep
working, and it will not.

### D3 — `timestamp`: `Date`, `string`, or both? **Resolved: dialect-specific, three types per column.**

This is the one genuine semantic hole the work exposes rather than creates.
`TsType` says `timestamp` → `Date`. `toJsonSchema` says
`{type:'string',format:'date-time'}`. `valueMatchesColumn` accepts `Date | string`.
Three answers for one column, and a generated validator must pick one.

The resolution is that all three are right about different things, and each layer
renders the one it owns:

|      | Type                   | `timestamp` renders as                           | Rendered by                       |
| ---- | ---------------------- | ------------------------------------------------ | --------------------------------- |
| wire | what arrives over HTTP | `string`, ISO-8601 (`date-time`)                 | the JSON Schema / OpenAPI emitter |
| app  | what handler code sees | `Date`                                           | `Entity<T>` and its validator     |
| db   | what the driver binds  | `TIMESTAMPTZ` on Postgres, per-dialect elsewhere | the DDL emitter                   |

Two consequences for the design:

- **The IR's `sql` field stays abstract** — it carries `'timestamp'`, not
  `'TIMESTAMPTZ'`. Rendering a dialect's spelling is the dialect's job. This matters
  because the IR is meant to be serialisable and dialect-agnostic; baking a Postgres
  spelling into it would make every other back-end parse it back out.
- **The DDL emitter needs a per-dialect type map, and does not have one.**
  `query-compiler/src/migrations/index.ts:115` interpolates `col.type` verbatim
  (`${quoteIdentifier(d, col.name)} ${col.type}`), so a `timestamp` column emits the
  literal word `timestamp` on Postgres, MySQL and SQLite alike. Only identifiers are
  dialect-aware today; types are not. Adding the map is small and concrete, but it
  **will change existing DDL snapshots** (Postgres `timestamp` → `timestamptz`), so it
  is a behaviour change to land deliberately, not a refactor.

`Wire<T>` is therefore accepted as a first-class derivation alongside `Entity<T>`, with
`CustomType<TS, DB>` extended to `CustomType<Wire, TS, DB>` as the codec and a
`Codec<'Name'>` tag naming it. `Entity<T>` validators check `instanceof Date`;
`Wire<T>` validators check the ISO string; the web pipeline decodes wire→app once at
the boundary. **This is still a sub-project (Phase 7b) and still the most likely thing
to blow the schedule** — the answer settles the semantics, not the volume of work. It
can be deferred by scoping Phase 4 to non-`timestamp` columns; it cannot be skipped,
because `REQ-TF-7` fails on any schema with a timestamp until it lands.

### D4 — Unresolvable types: error, warn, or silent? **Resolved: error, with an opt-out.**

Today an unresolvable `is<T>` silently falls through to a runtime path that throws
`'runtime descriptor required'`. That policy is exactly what produced the miscompile
fixed in `f70186c6`. New policy: the reflection emits a **build diagnostic naming the
file, the type, and the unsupported construct**, and fails the build unless
`{ onUnsupported: 'warn' | 'runtime' }` is set. `is<T>` where `T` is an unresolved
type _parameter_ is always a hard error — it cannot be made to work, and silently
compiling it is a lie.

### D5 — Tag identity across duplicate installs. **Resolved: name-based reflection, plus a build error. Verified, not assumed.**

A tag is `declare const zmdbSerial: unique symbol`. The concern was that a consumer
with two copies of `@zmdb/schema-core` gets two different `unique symbol`s, so
`T[K] extends Serial` stops matching. This section previously asserted that as fact; it
has now been checked, and the checked version is worse than the asserted one in one
specific way.

**What the type checker does.** The fixture is two tag modules whose _source text_ is
byte-identical — `b.ts` is a copy of `a.ts` — standing in for two installed copies of
the package. Their **types are not** identical, and that is the finding: each
`declare const … : unique symbol` gets its own identity, so copying the file does not
copy the tag.

| Probe                               | Result  |                                          |
| ----------------------------------- | ------- | ---------------------------------------- |
| `(number & TagA) extends TagA`      | `true`  | control — the tag works within one copy  |
| `(number & TagA) extends TagB`      | `false` | **the duplicate-install case**           |
| `number extends TagB`               | `false` | no false positive from a bare primitive  |
| `(number & {foo?: 1}) extends TagB` | `false` | no false positive from any object member |
| `Identical<TagA, TagB>`             | `false` | same source text, different type         |

The part worth writing down is **how** it fails. A key filter like
`{[K in keyof T]-?: T[K] extends Serial ? K : never}[keyof T]` collapses to `never`,
and `never` is assignable to everything, so nothing complains at the filter or at the
DTO definition. Concretely, `CreateDTO<T> = Omit<T, SerialKeys<T> | DefaultKeys<T>> &
Partial<Pick<T, DefaultKeys<T>>>` becomes `Omit<T, never> & {}` — which is `T`. A
database-generated `id` stops being omitted and becomes a **required field on create**,
and a defaulted column stops being optional.

So "silent" needs splitting. The _filter_ fails silently; the _symptom_ is loud but
lands somewhere useless — a missing-property error at every `create()` call site,
pointing at the DTO rather than at the duplicate install. The genuinely silent half is
the reflection asymmetry below. The first probe written for this was fooled by the
`never`: it asserted `SerialKeys<User>` was _assignable to_ `'id'`, which `never`
satisfies, and passed while the tag was not matching at all. Exact identity is the only
assertion that catches this.

**What the reflection does** — the escaped property names carry a disambiguating id:

```
number & TagA  ->  props: [..., "__@symA@1"]
number & TagB  ->  props: [..., "__@symB@12"]
```

The prototype matches `/^__@(\w+?)@?\d*$/`, stripping the id, so reflection sees both
copies as the same tag while the type-level filters see two different ones. That
asymmetry is the actual risk: the emitted validator and the derived DTO type would
disagree, which is the precise failure mode this project exists to eliminate.

Resolution: keep `unique symbol` (un-forgeable, collision-proof, erases to nothing),
keep name-based reflection — and because the reflector can see the ids, make **two
distinct declarations of the same tag name within one program a hard build error**,
naming both files. Same philosophy as D4: a divergence the type system cannot express
becomes a loud diagnostic instead of a silent wrong answer. That is strictly better
than the "documented caveat" originally recommended, and it costs one check.

_Rejected:_ a branded string key (`{ readonly '~zmdbSerial'?: true }`) instead of a
symbol. It is structural, so duplicate installs match, but it is forgeable by any
consumer who types the key, and it shows up in `keyof` and index signatures. Trading
un-forgeability for install-agnosticism is the wrong trade when the alternative is a
build error that cannot be ignored.

### D6 — A third spelling of the same five constraints. **Found while building Phase 2. Settled in Phase 5.**

Not one of the original five. It surfaced when the umbrella export map was extended
and is the same class of problem as §1's four walkers, so it belongs here.

`@zmdb/aot-validator` already exports a **runtime** constraint vocabulary
(`index.ts:19`) covering exactly the constraints the tags cover:

| aot-validator (value) | `defineSchema` (`ValidationRule.kind`) | tag (type)        |
| --------------------- | -------------------------------------- | ----------------- |
| `tags.Minimum(n)`     | `{ kind: 'minimum', value: n }`        | `Min<N>`          |
| `tags.Maximum(n)`     | `{ kind: 'maximum', value: n }`        | `Max<N>`          |
| `tags.MinLength(n)`   | `{ kind: 'minLength', value: n }`      | `MinLength<N>`    |
| `tags.MaxLength(n)`   | `{ kind: 'maxLength', value: n }`      | `MaxLength<N>`    |
| `tags.Pattern(re)`    | `{ kind: 'pattern', value: re }`       | `Pattern<S>`      |
| `tags.Enum(...v)`     | `{ kind: 'enum' }` / `jsonEnum(v)`     | — (literal union) |

Three spellings, and the first two are **already mixed in the same field**:
`openapi.spec.ts:47` passes `{ kind: 'Pattern', args: [...] }` to a `defineSchema`
column, which is why `scalarSchema` accepted both the PascalCase and the camelCase
kind and both `value` and `args[0]`. `ir/index.ts`'s `normaliseKind`/`ruleArgument`
reproduce that tolerance, so nothing regressed — but a case-folding bridge is not a
decision, it is a symptom, and it is now the only thing holding the two together.

**Recommendation:** align on the tag names and let the runtime vocabulary become
internal to the AOT. Only two names actually differ (`Minimum`→`Min`,
`Maximum`→`Max`); `MinLength`, `MaxLength` and `Pattern` already agree, and
`tags.Enum` has no tag counterpart on purpose because a literal union is how you
declare that (REQ-TF-2). Once a constraint is declared as `number & Min<18>`, the
`tags.Minimum(18)` **call** has no declaration role left — the `Rule` object is just
the AOT's pre-transform fallback representation, which is an implementation detail
that happens to be exported.

**Where it lands:** Phase 5, where the emitter is rewritten against the IR and the
`Rule` kinds are being touched anyway. Doing it now would mean renaming across the
transformer and its tests mid-migration for no gain. What must not happen is shipping
1.0 with all three.

**Done.** The runtime vocabulary is `tags.Min(n)`/`tags.Max(n)`, so the two spellings a
declaration can use now agree, and the IR field keeps the JSON Schema keyword because
that is what it emits. The case fold is replaced by an explicit alias table with a test
that it stays total, so a sixth constraint kind cannot be added without a spelling — it
would otherwise become a named custom rule in silence. `ValidationRule.args` is now
declared rather than merely read, because the only two writers of that field already
disagreed with the type.

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

### Landed so far

Phases 1–3 in part plus Phases 4, 5, 6 and 7a in full, with five refinements worth
recording because they differ from what is written below.

| On disk                                                      | What it is                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `schema-core/src/ir/index.ts`                                | The IR, `irFromSchema`, `schemaFromIR`, `appTypeOf`/`wireTypeOf`, JSON Schema        |
| `schema-core/src/ir/ir.spec.ts`                              | 24 runtime assertions incl. both `JSON.stringify` round-trips                        |
| `schema-core/src/ir/vocabulary.type-test.ts`                 | Phase 1's coverage gate, both directions                                             |
| `schema-core/src/tags/index.ts`                              | The full vocabulary — 19 tags                                                        |
| `schema-core/src/tags/erasure.spec.ts`                       | REQ-TF-3, as a byte comparison of a tagged fixture and its twin                      |
| `schema-core/src/tags/duplicate-install.type-test.ts`        | D5's failure mode, `_D1`…`_D7`                                                       |
| `schema-core/src/derive/index.ts`                            | The tagged DTO suite                                                                 |
| `schema-core/src/derive/tagged-dto.type-test.ts`             | ~35 `Equal`-based assertions                                                         |
| `schema-core/src/derive/type-derivation-tagged.type-test.ts` | The tagged derivations against the schema-value ones, name for name                  |
| `schema-core/src/derive/instantiation-budget.spec.ts`        | Phase 3's ceiling, watched by `verify:build-budget`                                  |
| `schema-core/src/index.ts`                                   | `TaggedSchema<T>`, `schemaOf<T>()`, and the four brand-aware derivation arms         |
| `schema-core/src/schema-of.type-test.ts`                     | The brand discriminates: tagged types one side, `defineSchema`'s the other           |
| `schema-core/src/openapi/index.ts`                           | Rewritten: `scalarSchema` **deleted**, delegates to the IR; `toJsonSchema<T>()`      |
| `aot-validator/src/reflect/session.ts`                       | The compiler boundary: one `tsgo` session per build, `Disposable`                    |
| `aot-validator/src/reflect/callsites.ts`                     | Finds `f<T>(…)` calls and hands back `T`'s type node                                 |
| `aot-validator/src/reflect/index.ts`                         | `Reflector` — `typeIR`/`schemaIR`/`shapeIR`, total, budgeted, named refusals         |
| `aot-validator/src/reflect/__fixtures__/`                    | The construct table, the equivalence corpus, the codemod corpus, the documents       |
| `aot-validator/src/reflect/reflect.spec.ts`                  | 61 assertions incl. the tagged-vs-`defineSchema` deep equality                       |
| `aot-validator/src/reflect/documents.spec.ts`                | REQ-TF-7 as a byte equality, on documents the emitted module actually produced       |
| `aot-validator/src/reflect/schema-values.spec.ts`            | REQ-TF-10 on the object the emitted module ships, against the twin's IR              |
| `aot-validator/src/reflect/SPEC.md`                          | Including §4, the measured checker limitations                                       |
| `aot-validator/src/emit/index.ts`                            | Six targets — check, excess, issues, sample, document, schema — one hoisting context |
| `aot-validator/src/emit/differential.spec.ts`                | REQ-AV-4: the emitted check against the runtime walker on the same IR                |
| `aot-validator/src/transformer.ts`                           | Checker-driven rewriting by text offset; the hand-rolled type parser deleted         |
| `aot-validator/src/plugin/index.ts`                          | The bundler hook: `enforce: 'pre'`, one session per build, watch-mode refresh        |
| `scripts/codemod-tagged-schema.mjs`                          | `defineSchema` → tagged interface, with `verify:codemod` over every schema           |
| `web/src/openapi/generated-schemas.spec.ts`                  | `toOpenApi` fed from generated literals, through the real plugin                     |
| `repository/src/generated-schema.spec.ts`                    | REQ-TF-10's runtime half: identical DDL and identical CRUD, three dialects           |
| `repository/src/tagged-schema.type-test.ts`                  | `defineRepository(schemaOf<User>(), driver)` typed from the declaration              |

**Refinement 1 — the third walker is already gone.** Phase 1 says "replacing nothing
yet", but `openapi`'s `scalarSchema` turned out to be replaceable immediately:
`toJsonSchema` is now `jsonSchemaFromIR(irFromSchema(schema), variant)` and all 30
golden `openapi` tests pass unchanged. That is the strongest evidence available that
the IR reproduces the published contract, so it is worth taking early rather than
saving for Phase 5. Four walkers → three.

**Refinement 2 — the derivations keep their names and change module.** Phase 3 reads
like a big-bang rename of `Entity`/`CreateDTO`/`UpdateDTO` in place. Doing that would
break the repository, the web package and every fixture in one commit. Instead the
tagged versions carry the **same canonical names** in a new module, `./derive`, and the
schema-value versions stay in the package root untouched. Phase 9 deletes those and
re-points the root at `./derive`. The end state is identical — exactly one `CreateDTO`,
per D2 — but the tree stays green throughout. The cost is a temporary second import
path, and `verify:no-defineschema` is what stops it becoming permanent.

Also landed from Phase 0: the umbrella subpaths `zmdb/tags`, `zmdb/ir` and
`zmdb/derive`, with `verify:exports` extended to hold the umbrella to REQ-UM-3 — no
bare `export *`, and nothing re-exported from outside the workspace. And **D1**: the
`PrimaryKey<S>` → `PrimaryKeyOf<S>` rename, in full.

**Refinement 3 — the checker API is smaller than its `.d.ts`.** Phase 4 below is
written as if `ts.Type` behaves the way it did in TypeScript 6. It does not.
`typescript@7` is the Go compiler behind a thin marshalling client, so several members
that exist in the type declarations arrive `undefined` over the wire, one of them
_panics the server process_, and one throws when read. `reflect/SPEC.md` §4 is the
measured table; the two that changed the design rather than just the code:

- **Index signatures are detectable but not readable.** `getPropertiesOfType` ignores
  them entirely, `getIndexInfosOfType(t).length` is safe, and reading `info.keyType`
  throws. So `Record<string, T>` is a named refusal. Modelling it as "an object with no
  properties" would have emitted a validator that accepts `{}` and everything else,
  which is the failure mode D4 exists to prevent.
- **An optional property's type does not carry `| undefined`.** The checker reports
  `nickname?: string` as `string`, even under `exactOptionalPropertyTypes`. So
  `PropertyIR.optional` is the only record that absence is allowed, and an emitter that
  ignores it produces a validator that rejects every value the type accepts.

Also worth recording, because each replaced a plan row with a better answer:

- `Map`, `Set`, `Promise`, typed arrays and classes with methods are refused by **one**
  rule — a validatable object has only data properties — rather than by five special
  cases, and the message names the property that gave it away.
- **A brand is phantom, not data.** Any `unique symbol`-keyed property is ignored, not
  just the ones in `TAG_NAMES`. Testing for _our_ names in that position made
  `Brand<number, 'UserId'>` a build error, because the brand object looked like a second
  data part of the intersection.
- **Template literal types are derivable and worth deriving.** `TemplateLiteralType.texts`
  and `getTypes()` both marshal, so `` `${string}@${string}` `` becomes a `string` with
  `pattern: '^[\s\S]*@[\s\S]*$'`. `${number}` is refused rather than approximated: TS
  accepts exponents, signs and `Infinity` there, so a short regex is either stricter than
  the type or looser, and both are wrong in a validator.
- `Omit`/`Pick`/`Partial`/`Required`, mapped and conditional types needed **no code at
  all** — the checker resolves them before we look. The tests assert the resolved
  property lists anyway, so the claim stays measured.
- Nullability must be spelled `(T & Tags) | null`, because TypeScript distributes an
  intersection over a union and `null & Unique` is `never`, which silently drops the
  nullability.

**Refinement 4 — a variant name and a derived type are two spellings of one thing.**
Phase 6 below reads as if the type-driven `toJsonSchema<T>()` needs its own generator,
one that reads optionality off `CreateDTO<User>` the way the old one read it off the
string `'create'`. It does not, and building one would have been the fifth walker this
whole plan exists to avoid. Instead the back-end takes a **shape** — a column plus
whether the document requires it — and the two front-ends are adapters onto it:
`shapeOfVariant` for the value path, `Reflector.shapeIR` for the type path. `required`
then collapses to "not optional and not nullable", which is the single rule the three
variants were three cases of, and REQ-TF-7 is structural instead of tested.

Two things fell out of that. The `update` variant had kept the primary key while
`UpdateDTO<T>` dropped it — the two only agreed because every key in every fixture was a
`serial()`, which was already dropped for a different reason. And the sensitive filter
stayed in the emitter rather than moving into the shape, because a published document is
where REQ-TF-6 has to be unconditional: `CreateDTO<User>` deliberately _keeps_ a
sensitive column, since you have to be able to send a password.

**Refinement 5 — the schema value carries its type, so nothing downstream reconstructs
it.** Phase 7a below says "emit `schemaFromIR` output as a generated const" and stops
there, which would have been half an answer. The generated const is enough for the query
compiler, which only wants the table name and the column types as data — but
`defineRepository(generated, driver)` would then derive its DTOs from the _columns of a
value_, re-running the schema-value derivations and losing every fact only the
declaration has: a branded key, a literal union, a `Codec`.

So `schemaOf<T>()` returns a `TaggedSchema<T>`: a `CoreSchema<string>` with one
`unique symbol`-keyed phantom property holding `T`. The property is **required**, unlike
every tag in `./tags`, and that is what makes `S extends TaggedSchema<infer T>` a real
discriminator — a `defineSchema` value does not have it and takes the other branch.

Four conditionals buy the entire surface. `Entity`, `CreateDTO`, `UpdateDTO` and
`PrimaryKeyOf` each gained a `S extends TaggedSchema<infer T> ? Tagged…<T> : <existing>`
arm, and `WhereDTO`/`OrderByDTO`/`PaginationDTO`/`ListDTO` are all built out of
`Entity<S>`, so they follow for free. `packages/repository` needed **no edits at all** —
which is the claim `tagged-schema.type-test.ts` exists to keep true. All four arms are
deleted by Phase 9's collapse, when the root simply _is_ `./derive`.

The gate is an equality over machinery that already exists rather than a new corpus:
`schemaFromIR(irFromSchema(s))` compiles byte-identical DDL and byte-identical CRUD to
`s` for three awkward tables in three dialects, and the emitted literal deep-equals that
value. So every dialect test in the repo now covers the tagged front-end.

Two things a `CoreSchema` cannot carry, recorded here because the tests that pin them
down read like curiosities otherwise. `Numeric<P, S>` precision, `Codec<'Name'>` and a
`json` payload shape are **dropped** by `schemaFromIR` — `ColumnFlags` has nowhere to
put them, the emitted validator and the DDL type map read the IR directly, and
`defineSchema` cannot express them either. And **relations do not travel with a schema
value**: `SchemaIR.relations` is read, is not a column, and stops at the boundary, so
`defineRepository(schemaOf<User>(), driver)` cannot populate without `opts.relations`.
Closing that is Phase 7c's business at the earliest, and probably wants
`defineRepository<T>()` — a call the transform reads a _declaration_ from, not a value.

**Not yet done in Phases 1–3:** the relation-driven
`PopulatedEntity`/`Populated`/`JoinRow`, and the `dto/` module's
order-by/pagination/projection shapes. The codemod and the instantiation-budget ratchet
are done. The reflection half of the D5 guard is now done, in `#readTags`.

From Phase 0, the `typescript` optional-peer-dep move and its reachability guard move to
**Phase 5**, not because they are hard but because they cannot land yet: the package
root re-exports `transformCode`, which imports `typescript/unstable/ast`, so the guard
would fail on the entry it is meant to protect. Phase 5 rewrites that transformer, which
is when the leak closes and the peer dep becomes honest. `aot-validator`'s `./reflect`
subpath is registered now, with `typescript` externalised in the tsup config.

---

### Phase 0 — Decisions and scaffolding · S

1. **Done** — **D1–D5** are resolved in §2 above with their rejected alternatives.
   Copy them into `DESIGN-type-first.md` §9 so the design document and the plan do not
   drift, and update PRD §6.7's `REQ-TF-12` row, which still promises `defineSchema`
   keeps working.
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
- **The D5 duplicate-declaration check.** Two parts, because the type-level half and
  the reflection half fail differently:
  - a `tags.type-test.ts` fixture with a second copy of the tag module, asserting the
    key filters resolve to **exactly** the expected union — `Identical<X, Y>`, never
    assignability, because `never` satisfies an assignability check and that is what
    made the first probe of this pass while the tag was not matching. Assert the
    consequence too, not just the filter: `CreateDTO<User>` must not have an `id`
    property, since a broken filter turns `Omit<T, never>` back into `T` and makes a
    database-generated column required;
  - a reflection-side guard that two distinct `unique symbol` declarations resolving to
    the same tag name in one program is a build error naming both files.

**Gate:** REQ-TF-1, REQ-TF-2, REQ-TF-3. Coverage test green in both directions; the
duplicate-declaration fixture produces a diagnostic, not wrong output.

---

### Phase 3 — DTO converters · M

**Deliverables**

Per **D2** these are **single-input**: they take a tagged type, and there is no
conditional dispatch on a schema value. That is the simplification the "no backwards
compatibility" answer buys, and it removes the largest instantiation-cost worry.

- `SerialKeys`, `DefaultKeys`, `PrimaryKeyKeys`, `SensitiveKeys`, `UniqueKeys`,
  `NullableKeys` over tagged types.
- `Entity`, `CreateDTO`, `UpdateDTO`, `WhereDTO`, `PrimaryKeyOf` rewritten to take the
  tagged type, along with the `dto/` module's order-by, pagination, projection, list and
  populated shapes. `PrimaryKey<S>` → `PrimaryKeyOf<S>` (**D1**), renamed outright with
  no deprecated alias.
- **New:** `ReadDTO<T>` = `Omit<Entity<T>, SensitiveKeys<T>>` (**REQ-TF-6**) and
  `Wire<T>` (**D3**).
- Relation-tag-driven `PopulatedEntity` / `Populated` / `JoinRow`.
- **A codemod**, `scripts/codemod-tagged-schema.mjs`: `defineSchema` call →
  tagged interface. It has to exist for the in-repo migration anyway — every package's
  fixtures, the benchmarks and the docs examples all declare schemas — so it costs
  little to make it consumer-runnable and it is the whole of the migration story now
  that `defineSchema` is being deleted.

**Tests**

- The existing REQ-SC-2…REQ-SC-5 type tests, re-run with a tagged interface
  substituted for `typeof Schema` (REQ-TF-4's AC). _Not_ unchanged, as first written:
  REQ-SC-2 asserts `Equal<Entity<S>['email'], string>` and REQ-TF-5 requires the tags
  to survive the derivation, so the two contradict each other. Resolved in favour of
  REQ-TF-5, with the criterion restated as identical key sets, identical optionality
  and mutual assignability with the value-side twin — see PRD §6.7's note. The tags
  erase for everything except `Equal`, so a consumer cannot tell.
- Constraint survival through `Omit`/`Pick`/`Partial` (REQ-TF-5).
- `@ts-expect-error` on reading a sensitive field off `ReadDTO<T>` (REQ-TF-6).
- **A type-instantiation budget test.** `--diagnostics` instantiation count on a
  fixture project, committed as a number with a ceiling. D2 removed the dispatch this
  was originally meant to gate, so it is now a ratchet against RISK-6 rather than a
  go/no-go — but a ratchet is what RISK-7 says we are bad at, so it still lands here.
- Codemod round-trip: every in-repo `defineSchema` fixture, converted, produces IR
  identical to the original's.

**Gate:** REQ-TF-4, REQ-TF-5, REQ-TF-6; instantiation budget within ceiling; the
codemod converts every in-repo schema.

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

| Construct                                                     | Expected                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| primitives, literals, literal unions                          | supported                                                                   |
| `boolean` (a _union_ of two literals — see DESIGN §5)         | supported                                                                   |
| `T \| null`, `T \| undefined`, optional properties            | supported                                                                   |
| arrays, readonly arrays, tuples, optional/rest tuple elements | supported                                                                   |
| nested objects, recursive objects, mutual recursion           | supported via `ref`                                                         |
| intersections of object types                                 | supported (merge properties)                                                |
| discriminated unions (REQ-AV-5)                               | supported — the discriminant survives as a `literal`; strategy is Phase 5's |
| non-discriminated unions (REQ-AV-5)                           | supported — declaration order preserved for an ordered disjunction          |
| `Date`, `bigint`                                              | supported                                                                   |
| index signatures, `Record<string, T>`                         | **verified: refusal.** Detectable, not readable — see Refinement 3          |
| mapped/conditional types, `Omit`/`Pick`/`Partial`/`Required`  | supported (prototype-proven)                                                |
| generic type _parameters_ (`is<T>` inside `function f<T>()`)  | hard error (D4)                                                             |
| `unknown`, `any`, `never`, `object`, `symbol`                 | explicit refusal with a diagnostic                                          |
| `Map`, `Set`, `Promise`, class instances, functions           | explicit refusal                                                            |
| template-literal types                                        | supported: anchored pattern from the segments; `${number}` refused          |
| branded types (`advanced/index.ts`)                           | supported: the brand is phantom, so the base type is what is checked        |

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
tag-call inlining (`tags.Min(…)`), which needs no types.

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

**7b — collapse `validatePayload`, and land D3's three types**

`repository`'s `validatePayload`/`valueMatchesColumn` (`index.ts:783,827`) becomes a
call to the emitted `CreateDTO`/`UpdateDTO` validator. This deletes the fourth walker
and is where the `timestamp` three-types problem gets implemented, because the
repository's current `Date | string` tolerance is the reason nobody noticed the
disagreement.

Per **D3**, each layer renders the type it owns, and the IR's `sql` field stays
abstract (`'timestamp'`, never `'TIMESTAMPTZ'`):

- `Wire<T>` + `CustomType<Wire, TS, DB>` + the `Codec<'Name'>` tag; the web pipeline
  decodes wire→app once at the boundary, so handlers keep seeing `Date`.
- `Entity<T>` validators check `instanceof Date`; `Wire<T>` validators check the ISO
  string. Neither accepts both.
- **A per-dialect SQL type map in the DDL emitter, which does not exist today.**
  `query-compiler/src/migrations/index.ts:115` interpolates `col.type` verbatim, so
  `timestamp` reaches Postgres, MySQL and SQLite as the literal word `timestamp`; only
  identifiers are dialect-aware. Postgres must emit `timestamptz`. This **changes
  existing DDL snapshots**, so it lands as its own commit with the snapshot diff
  reviewed, not folded into the walker deletion.

- REQ-RP-3's behaviour must not regress: `create({bogus:1})` still rejects at runtime
  with a structured path.
- **Decide what a supplied serial or unknown key does on create, and test it.**
  `Omit<T, SerialKeys<T>>` makes naming `id` a compile error while `validatePayload`
  drops it silently (§1). The emitted validator can be generated with `is` semantics
  (keeps today's drop) or `equals` semantics (rejects). Reject is the answer consistent
  with P4 — passing a value for a database-generated column is a bug in the caller, and
  a dropped write is the kind of thing that surfaces as missing data much later — but it
  is a **behaviour change**, so it needs its own commit, a `ValidationError` path, and a
  test for `create({ ...valid, bogus: 1 })` and `create({ ...valid, id: 5 })`, neither
  of which exists today.
- A test per dialect that a `timestamp` column's DDL, its `Entity` validator and its
  JSON Schema all say the three right things, in one place, so the next person cannot
  reintroduce the disagreement without a failure.

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

| Script                   | Enforces                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `verify:tf-coverage`     | tag ↔ `SqlType`/`ColumnFlags`/`ValidationRule` parity (REQ-TF-1)                                                                                                                           |
| `verify:no-descriptors`  | zero hand-authored descriptors in `packages/` + `benchmarks/` (REQ-TF-9)                                                                                                                   |
| `verify:build-budget`    | one `API` instance; wall-time ceiling (REQ-TF-11)                                                                                                                                          |
| `verify:instantiations`  | type-instantiation ceiling (REQ-TF-3, RISK-6)                                                                                                                                              |
| `verify:escape-hatches`  | **the RISK-7 counter.** Recompute PRD §9.4, fail on any increase, fail on an assertion with no `// boundary:` comment in its enclosing function, and carry the `new Function`/`eval` grep. |
| `verify:no-defineschema` | zero `defineSchema` calls and zero `irFromSchema` references outside their own deletion commit (**D2**)                                                                                    |

The last one is overdue independently of this work: the published figure was 23 and
the real count is 28 — it drifted up by five with nothing watching. Land it here
because Phase 5 and 7 will delete assertions and the ratchet should capture that.

**The D2 deletion** — this is the phase where the scaffolding comes down:

- Run the Phase 3 codemod over every remaining in-repo `defineSchema` call.
- Delete `defineSchema`, `irFromSchema`, the column-builder functions
  (`schema-core/src/index.ts:284` and siblings) and the value→IR equivalence tests,
  which have by then done their job. One commit, with `verify:no-defineschema` landing
  in the same one so the surface cannot come back.
- Note the ordering constraint: the equivalence tests are the safety net for Phases
  4–7, so this deletion **must** be last. Deleting it early to feel finished would
  remove the only differential proof that the tagged path agrees with the shipped one.

**Docs**

- `docs-site` pages: type-first declaration, the tag reference, the codemod and what
  it does to a `defineSchema` project, the codegen CLI. Plus `coverage/mapping.mjs`
  entries, or `verify:docs-coverage` fails.
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
- **`defineSchema`'s deletion is the last thing that happens** (D2, Phase 9), because
  the value→IR equivalence test is the safety net for everything between Phase 4 and
  Phase 7. Deleting it earlier would feel like progress and remove the proof.

Rough total: **6–10 weeks** of focused work, with Phase 4 and Phase 7 carrying most of
the uncertainty. The two most likely overruns are D3's three-types problem (Phase 7b)
and the union/discriminated-union emit matrix (Phase 4). D2's answer took the dual
dispatch and the second permanent front-end off the list, which is the only place the
schedule got shorter.

## 6. Risks specific to the implementation

| Risk                                                                                                                                                                                                                       | Mitigation                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D3 (`timestamp`) cascades.** Three different existing behaviours; whichever the validator picks, something that works today breaks. Resolved in principle, but the DDL type map changes Postgres snapshots.              | Implement in 7b as separate commits — codec, validators, DDL map — each with its snapshot diff reviewed. Do not let Phase 4 emit timestamp checks before this lands.                |
| **Checker resolves differently from `tsc`.** The API is new; a divergence between `getTypeFromTypeNode` and what `tsc` reports would produce validators that disagree with the types.                                      | The Phase 4 equivalence test (`irFromType` vs `irFromSchema`) catches semantic drift. Add a canary: assert `isTypeAssignableTo` agrees with a `@ts-expect-error` fixture.           |
| **Position-based rewriting is fragile** under other plugins (§5.1).                                                                                                                                                        | `enforce: 'pre'` + byte-identity check + skip-with-diagnostic. Never guess.                                                                                                         |
| **Instantiation blowup** on large schemas. D2 removed the dual dispatch, so the main suspect is gone; deep `Omit`/`Partial` chains over a 60-column entity remain.                                                         | The Phase 3 budget test, with a committed ceiling and `verify:instantiations` watching it.                                                                                          |
| **`unique symbol` identity across installs** (D5). Verified: cross-copy filters resolve to `never`, so `CreateDTO` requires the serial `id` it should omit and the emitted validator disagrees with the type it came from. | Name-based reflection, an exact-identity (not assignability) type test, and a build error on two declarations of one tag name. Not unfixable — just not fixable in the type system. |
| **`defineSchema`'s deletion removes the differential proof** that the tagged path matches the shipped one.                                                                                                                 | Phase 9, last, after every other gate is green. The equivalence tests are the net for Phases 4–7 and must outlive them.                                                             |
| **Scale is untested.** No fixture today resembles a 60-column entity behind four layers of conditional types.                                                                                                              | Build that fixture in Phase 1, not Phase 7. It is cheap early and expensive late.                                                                                                   |
| **`dts` build is already broken**, so nothing can be published until it is fixed regardless of this work.                                                                                                                  | Phase 9, or earlier if a release is needed.                                                                                                                                         |
| **Deleting four walkers touches every package at once.**                                                                                                                                                                   | The IR equivalence tests are the safety net, and each walker is deleted in a separate commit with its differential test already green.                                              |

## 7. Definition of done

`DESIGN-type-first.md` §8's seven items, plus:

8. Every `REQ-TF-*` AC is enforced by a named script in CI, and PRD §6.7 names it.
9. Exactly **one** walker over column metadata exists in the repo. A test asserts the
   other four are gone.
10. A consumer fixture builds with the CLI and no bundler plugin, and gets AOT
    validation — RISK-1 closed.
11. Validation and ORM benchmarks re-measured, committed, and published; the
    type-first path is no slower than today's hand-written descriptor path.
12. **`defineSchema` is gone** (D2), the codemod converts a `defineSchema` project in
    one command, and `verify:no-defineschema` keeps it gone. There is exactly one way
    to declare a table — which is what P2 asked for, and what RISK-8 says the repo
    does not have today.
