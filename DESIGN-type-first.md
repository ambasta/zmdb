# Design goal — type-first declaration, AOT-generated runtime

**Status:** implemented. `defineSchema` is gone, the tags are the only front-end, and every `REQ-TF-*` acceptance criterion names a script or a test that enforces it (PRD §6.7). **Owns:** PRD §6.7
(`REQ-TF-*`). **Plan:** [`PLAN-type-first.md`](PLAN-type-first.md). **Specs:** `packages/schema-core/src/tags/SPEC.md`, `.../src/ir/SPEC.md`, `packages/compiler/src/reflect/SPEC.md`,
`.../src/emit/SPEC.md`, `.../src/codegen/SPEC.md`.

---

## 1. The goal

> Shift domain rules, state transitions, and business invariants directly into the compile-time type system to guarantee static correctness before deployment. Harnessing type-level computation
> eliminates entire classes of runtime defects while providing zero-cost safety for core application logic. Runtime code must be restricted to dynamic I/O and side-effect boundaries, preventing
> compile-time performance regression and hyper-complex type abstractions.
>
> — PRD §4, principle **P3**

At the pre-implementation baseline a schema was a **value** and the types were inferred from it:

```ts
const UserSchema = defineSchema('users', { id: serial(), email: text() });
type User = Entity<typeof UserSchema>; //          ^ types flow OUT of the value
```

The goal inverts that. A schema is a **type**, and every runtime artefact is generated from it:

```ts
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey & Min<1>;
  email: string & Sql<'varchar'> & Length<255> & Unique & Pattern<'…'>;
}
//        ^ the declaration IS the type; values flow OUT of it
```

This is not a stylistic preference. `defineSchema` is a standing violation of principle **P2** (single source of truth / pure derivation): the column facts are written as runtime data and the types
are a shadow of them, so the runtime data is the source and the type system is downstream. Inverting it makes P2 and P3 true rather than aspirational.

## 2. Why this is possible now, and was not before

The blocker was always type resolution: a transformer that cannot resolve `is<User>(x)` to `User`'s members cannot generate anything. The pre-implementation `packages/aot-validator/src/transformer.ts`
worked around this with a hand-written **text parser** over the type-argument source (`parseType`), which understood primitives and inline object literals and nothing else. The implemented
checker-driven front end now lives in `packages/compiler/src/transform/index.ts`.

**TypeScript 7.0.2 — already in `node_modules` — ships a type checker over `typescript/unstable/sync`.** `Checker` exposes `getTypeFromTypeNode`, `getPropertiesOfType`, `getTypeOfSymbolAtLocation`,
`getTypeArguments`, `isTypeAssignableTo`, the `isXType()` predicates, and `Symbol.flags` for optionality.

At the pre-`@zmdb/ai` six-package baseline, one `API` instance measured **3 ms** to construct, **57 ms** to open the six package projects, **4 ms** to add a second project to an already-open snapshot,
and **0 ms** to invalidate a changed file. Full semantic diagnostics cost 56–104 ms per project, but the transformer never needs them — that is `tsc`'s job. The seventh package requires a fresh
whole-repository timing before a new current total is claimed.

## 3. The encoding

A tag is an **optional `unique symbol` slot**:

```ts
declare const zmdbMin: unique symbol;
export type Min<N extends number> = { readonly [zmdbMin]?: N };
```

Three properties make this the right shape, and each is load-bearing:

- `unique symbol` — un-forgeable, and cannot collide with a real data property.
- `?` — no runtime value is ever required, so the tag erases completely. Zero bytes.
- **all-optional (weak) object type** — TypeScript's weak-type detection means an unrelated type is _not_ assignable to it. This is what makes `T[K] extends Serial ? K : never` return an exact answer.
  Verified: `SerialKeys<User>` resolves to exactly `"id"`, `DefaultKeys<User>` to exactly `"createdAt"` — `string & Pattern<…>` does not false-positive as `Serial`.

The tag only has to **name** the constraint, not prove it. Everything the AOT needs is a string or number literal in a type position — no conditional types, no recursion, no template-literal
arithmetic. That is what satisfies the objective's closing clause ("no compile-time performance regression, no hyper-complex type abstractions") **by construction** rather than by discipline.

A rejected alternative is to _prove_ the constraint in the type system:

```ts
type PositiveInteger<N extends number> = number extends N ? never : /* … */ N;
```

That works, and is worth having for **literal arguments in our own code** (chunk sizes, page limits — see §7). It is the wrong tool for I/O: it can only reject a dynamic `number`, never validate one,
and it puts type-level computation on the hot path of every build. The tag encoding does the same job with no computation.

### 3.1 What needs a tag, and what does not

The most important design decision is how _little_ needs tagging. TypeScript already expresses most column semantics natively, and the generator reads them from the type directly:

| Column fact                                                        | Encoding                                | Tag needed                         |
| ------------------------------------------------------------------ | --------------------------------------- | ---------------------------------- |
| Nullable                                                           | `T \| null` (`Nullable<T>` is an alias) | **no**                             |
| Non-nullable                                                       | the default                             | **no**                             |
| Optional on insert                                                 | `?`                                     | **no** — falls out of `HasDefault` |
| Enum / `jsonEnum`                                                  | `'admin' \| 'editor' \| 'viewer'`       | **no**                             |
| JSON column shape                                                  | a nested interface                      | **no**                             |
| Read-only column                                                   | `readonly`                              | **no**                             |
| Array                                                              | `T[]`                                   | **no**                             |
| Primary key                                                        | `PrimaryKey`                            | yes                                |
| Serial / auto-increment                                            | `Serial`                                | yes                                |
| Unique                                                             | `Unique`                                | yes                                |
| Has a DB default                                                   | `HasDefault`                            | yes                                |
| SQL type (`integer` vs `bigint` vs `numeric` — all `number` in TS) | `Sql<'integer'>`                        | yes                                |
| `varchar` length                                                   | `Length<255>`                           | yes                                |
| Sensitive (never serialised)                                       | `Sensitive`                             | yes                                |
| Foreign key                                                        | `References<'users'>`                   | yes                                |
| Table name                                                         | `Table<'users'>` on the interface       | yes                                |
| Min/Max/MinLength/MaxLength/Pattern                                | `Min<18>` …                             | yes                                |
| FTS table                                                          | `Fts<'users_fts'>` on the interface     | yes                                |
| Custom type codec                                                  | `Codec<'Money'>`                        | yes                                |
| Relation cardinality                                               | `ManyToOne<Post, 'authorId'>` …         | yes                                |

Everything in the left column that needs no tag is a fact TypeScript models better than a flag ever did. `ColumnFlags.nullable` becomes `| null`; `ColumnFlags.enum: readonly string[]` becomes a
literal union that also narrows at every call site. This is a net **reduction** in vocabulary versus today's `ColumnFlags` + `SqlType` + `ValidationRule[]`.

## 4. Required surface

### 4.1 ORM tags — the full set

Must cover every fact currently reachable through `defineSchema`. The mapping is 1:1 against `packages/schema-core/src/index.ts`:

- `SqlType` (`serial`, `integer`, `bigint`, `numeric`, `text`, `varchar`, `boolean`, `timestamp`, `json`, `jsonEnum`) → `Sql<T>`, with `jsonEnum` subsumed by a literal union and `json` by a nested
  interface.
- `ColumnFlags` (`nullable`, `primaryKey`, `unique`, `autoIncrement`, `hasDefault`, `length`, `enum`, `sensitive`) → per §3.1.
- `ColumnMeta.references` → `References<Target>`, keeping the existing `ValidateFkType` compile-time FK type check.
- `ColumnMeta.validation: ValidationRule[]` → `Min`/`Max`/`MinLength`/`MaxLength`/`Pattern`, plus an escape hatch for a named custom rule.
- `SchemaOptions.ftsTable` → `Fts<Name>`.
- `custom-types`' `CustomType<TS, DB>` → `Codec<Name>` naming a registered codec.
- `relations`' `Cardinality` / `manyToOne` / `oneToMany` / `oneToOne` / `manyToMany` → relation tags, so `Populated<T, K>` derives from types rather than a value.

### 4.2 DTO converters

Every derivation currently keyed off `ColumnsMap` must be re-pointed at the tagged interface. **The conditional types themselves do not change** — this is the cheapest part of the migration:

| Existing                                                                 | Becomes                                                                                                         |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `Entity<S>`                                                              | `Entity<T>`                                                                                                     |
| `CreateDTO<S>` (strips `AutoIncrementKeys`/`DefaultKeys`, §index.ts:120) | `Omit<T, SerialKeys<T> \| DefaultKeys<T>> & Partial<Pick<T, DefaultKeys<T>>>`                                   |
| `UpdateDTO<S>`                                                           | `Partial<Omit<T, SerialKeys<T> \| PrimaryKeyKeys<T>>>`                                                          |
| `PrimaryKey<S>`                                                          | `PrimaryKeyOf<T>` = `Pick<T, PrimaryKeyKeys<T>>` — renamed so the tag can be `PrimaryKey` (D1)                  |
| `WhereDTO<S>`, `OrderByDTO`, `PaginationDTO`, `ListDTO`, projection      | keyed off `keyof T`                                                                                             |
| `PopulatedEntity` / `Populated` / `JoinRow`                              | keyed off relation tags                                                                                         |
| `StateUpdateDTO`, `TransitionPatch`, `PatchableFields`                   | **unchanged** — already pure type-level                                                                         |
| — (new)                                                                  | `ReadDTO<T>` = `Omit<Entity<T>, SensitiveKeys<T>>`, so `sensitive` is enforced by the type, not by a serializer |

Verified in the prototype: the tags survive `Omit`, `Pick` and `Partial`. `Min<18> & Max<120>` still generates `>= 18 && <= 120` inside `Partial<Omit<User, "id">>`.

### 4.3 JSON Schema / OpenAPI / LLM converters

`toJsonSchema(schema: CoreSchema, variant)` (`schema-core/src/openapi/index.ts:82`) takes a runtime value and switches on `ColumnMeta`. It becomes type-driven, with the **same** output shape, so
`toOpenApi`, `toJsonSchemaWithRelations`, `toOpenApiComponents`, `toListSchema`, `toSearchSchema` and `toolFromSchema` keep their contracts:

- `toJsonSchema<T>()` — a build-time call the transformer replaces with the emitted JSON Schema **object literal**. No walk at runtime.
- The existing `Variant` union (`entity`/`create`/`update`/`get`/`list`/`search`) becomes a type argument: `toJsonSchema<CreateDTO<User>>()`.
- Tag → keyword mapping is direct: `Min<n>` → `minimum`, `MaxLength<n>` → `maxLength`, `Pattern<s>` → `pattern`, `Length<n>` → `maxLength`, a literal union → `enum`, `| null` → a nullable type,
  `Sensitive` → omitted from read variants.

This is the point where the "one schema, one lifecycle" claim in PRD §7 stops needing a runtime schema object at all.

### 4.4 What the AOT must emit

Four generation targets, in dependency order:

1. **Predicates** — `is<T>(x)` → an inlined boolean chain. _Prototyped._
2. **Assertions and issue lists** — `assert<T>`/`validate<T>` → the same walk plus a structured `{ path, expected, value }` on failure, with **no allocation on the success path** (REQ-AV-7).
3. **JSON Schema literals** — `toJsonSchema<T>()` → a frozen object literal.
4. **The runtime schema value** — the query compiler needs the table name and column SQL types as _data_ to build SQL. It gets a generated `const` instead of a hand-written `defineSchema` call. This
   is the practical boundary of the design: **types can generate the runtime data; they cannot be the runtime data.** The difference from today is that the value is derived, not authored, so P2 holds.

## 5. What the prototype established, and what carries each claim now

There was a prototype — `scripts/prototypes/type-first/`, 25 asserted expectations — and it existed so this document's claims could be checked rather than believed. It has been **deleted**, because
the shipped implementation answers the same questions against real code, and a second tag vocabulary sitting beside the real one is precisely the two-front-ends problem that deleting `defineSchema`
was about. `git log` has it if the sketch is ever wanted again.

Each thing it proved, and where the claim lives now:

| Prototype claim                                                          | Now carried by                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| The checker resolves a named interface, its aliases and its nested types | `packages/compiler/src/reflect/reflect.spec.ts`, against `packages/compiler/src/reflect/__fixtures__/constructs.ts` |
| Tags read off an intersection as literal types                           | `packages/compiler/src/reflect/index.ts` `#readTags`; `packages/schema-core/src/ir/vocabulary.type-test.ts`         |
| Tags drive key filtering exactly (`SerialKeys<User>` → `'id'`)           | `packages/schema-core/src/derive/type-derivation-tagged.type-test.ts`, with `Equal` not `extends`                   |
| Resolution **through** mapped types (`Partial<Omit<User, 'id'>>`)        | `packages/compiler/src/reflect/SPEC.md` §6a — no branch in the code, asserted property lists                        |
| Constraints survive `Omit`/`Pick`/`Partial`                              | the same tests                                                                                                      |
| `                                                                        | null`, `?` and literal unions read correctly                                                                        | `packages/compiler/src/reflect/SPEC.md` §4's two normalisation facts, with fixtures |
| `Sensitive`/`Serial`/`HasDefault` land in the right DTO                  | `packages/schema-core/src/ir/ir.spec.ts` variants + `derive`'s type tests                                           |
| No tag symbol appears in emitted code                                    | `packages/schema-core/src/tags/erasure.spec.ts`                                                                     |

Two bugs it caught, kept because they are the kind that come back:

- `boolean` is `true | false` — a **union**, not an intrinsic type. Classify it before any property-bearing fallback, or a primitive gets an object check. (Pinned:
  `packages/compiler/src/reflect/SPEC.md` §9.)
- Stripping nullability early (`getNonNullableType` at the top of the walk) destroys legitimate `T | null` columns. Optionality and nullability are handled at the property and the union level
  respectively.

## 6. The open questions, and where each landed

This table was "what is not yet established". One row is still open — and it is a matter of taste, not of correctness; the rest are settled, and each names what settles it so the claim can be
rechecked rather than trusted.

| Question                | Where it landed                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build wiring            | **Closed.** One `API` per build, refreshed per file change. `apiInstanceCount()` makes it measurable and `yarn verify:build-budget` asserts the snapshot update log is identical at 8 modules and at 64.                                                                                                                                                                                                                      |
| No in-memory overlay    | **Closed, as a constraint rather than a fix.** `fileChanges` only invalidates, so the plugin declares `enforce: 'pre'` and `transformFile` compares the text before it trusts an offset.                                                                                                                                                                                                                                      |
| `tsc`-driven builds     | **Closed.** `@zmdb/compiler` project compilation writes the rewrite to disk; `fixtures/consumer-cli/` and `fixtures/consumer-plugin/` are asserted to produce byte-identical output. `packages/compiler/src/codegen/SPEC.md`.                                                                                                                                                                                                 |
| Three types per column  | **Closed** (plan D3): `appTypeOf`/`wireTypeOf` in `schema-core/ir`, `ddlType(dialect, col)` in `@zmdb/migrations`. `timestamp` is an ISO `string` in JSON Schema, a `Date` in `Entity<T>`, `TIMESTAMPTZ` on Postgres and `TEXT` on SQLite.                                                                                                                                                                                    |
| Recursive entity graphs | **Closed.** `RefIR` plus a seen-set; mutual recursion (`Folder` ↔ `FileEntry`) closes with a `ref`, not only self-recursion.                                                                                                                                                                                                                                                                                                  |
| Scale                   | **Closed enough to state a number.** `yarn verify:instantiations` typechecks a tagged project against an untagged baseline and fails on a regression; the budget script covers 64 modules. A 60-column entity behind four layers of conditionals is still untested.                                                                                                                                                           |
| Excess properties       | **Closed.** `excess` is one of the emitter's four targets, and `hasExcessCheck` in `packages/compiler/src/emit/shape.ts` is the single place that decides whether a shape has one.                                                                                                                                                                                                                                            |
| Migration path          | **Closed** (plan D2): `defineSchema` is deleted, `yarn verify:no-defineschema` keeps it deleted, and `scripts/codemod-tagged-schema.mjs` converts a project.                                                                                                                                                                                                                                                                  |
| Declaration ergonomics  | **Open, and a judgement rather than a gap.** `number & Sql<'integer'> & Min<18> & Max<120>` reads worse than a builder chain. Named aliases (`Age`, `Email`, `PositiveInteger`) recover it, and the reflection sees through aliases.                                                                                                                                                                                          |
| `dts` build break       | **Closed.** tsup is gone: `rollup-plugin-dts` reads `ts.sys` off the `typescript` package, which TS 7 does not ship, so `tsc -p tsconfig.build.json` emits `dist` mirroring `src` instead (`scripts/build-package.mjs`). Chasing it also found `exports` pointing at `./src/*.ts`, which cannot be imported once installed — `yarn verify:publish` packs, installs and imports every published subpath from outside the repo. |

## 7. Adjacent, not part of this goal

Type-level _proof_ (as opposed to declaration) still earns its keep for **literal arguments inside our own code**, where there is no I/O and no brand to carry:

```ts
type PositiveIntegerLiteral<N extends number> = number extends N ? never : N extends 0 ? never : `${N}` extends `-${string}` ? never : `${N}` extends `${bigint}` ? N : never;
```

Candidates: `chunkArray`'s `chunkSize` (`query-compiler/src/index.ts:68`, currently a runtime `throw`), `tags.MinLength(n)` (`aot-validator/src/index.ts:26`, where `MinLength(-5)` compiles today and
inlines a vacuous check), `OffsetPage.limit`. Note that `DIALECT_PARAM_LIMITS: Record<Dialect, number>` erases its own literals — as `as const satisfies Record<Dialect, number>` the lookup types as
`30000 | 60000` and becomes checkable.

Tracked separately; it does not block or depend on the work above.

## 8. Definition of done

Each item names what enforces it, because a definition of done that is only a document is the thing this whole design is a reaction to.

| #   | Done                                                                                                              | Enforced by                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every `REQ-TF-*` acceptance criterion in PRD §6.7 is met, or says in the row what is not.                         | the scripts named in each row; all thirteen read ✅. `yarn verify:tf-acceptance` audits the table itself — a row that cites a test or a gate that does not exist, or a gate CI does not run, fails          |
| 2   | A tagged interface expresses everything `defineSchema` could.                                                     | `packages/schema-core/src/ir/vocabulary.type-test.ts` — a new `ColumnFlags` member without a tag fails to compile; `yarn verify:tf-coverage`                                                                |
| 3   | `is`/`assert`/`validate`/`equals` on any named type, mapped type or derived DTO are transformed — no silent skip. | `packages/compiler/src/reflect/reflect.spec.ts` + `packages/compiler/src/emit/differential.spec.ts`; a refusal is a named build error, not a skip                                                           |
| 4   | No `TypeDescriptor` is hand-written in the repo or the benchmarks.                                                | `yarn verify:no-descriptors` — 871 files, an empty allow-list and a count of zero. The type is deleted, not fenced off, so the gate also fails on a re-declaration of the name                              |
| 5   | `parseType` and the text-scanning reading of a type argument are deleted.                                         | `packages/aot-validator/SPEC.md` §2 and its eight byte-identical pass-through assertions. `transformCode` survives for `validate(tags.X, expr)`, which carries its rule at the call site and needs no types |
| 6   | The conformance suite passes identically against the generated and the runtime path.                              | `packages/compiler/src/emit/differential.spec.ts`, four assertions per case over a 22-value wild corpus; non-vacuous by construction                                                                        |
| 7   | `benchmarks/harness/framework/app.ts` contains no schema→descriptor bridge.                                       | the same descriptor ratchet as row 4                                                                                                                                                                        |
| 8   | Build time is measured and published, with the one-`API`-instance property asserted rather than assumed.          | `yarn verify:build-budget`, on `apiInstanceCount()` and the session's update log                                                                                                                            |
| 9   | `defineSchema` no longer exists, and a codemod converts a project that used it.                                   | `yarn verify:no-defineschema` (export names, not a grep) + `packages/compiler/src/reflect/codemod.spec.ts`                                                                                                  |
| 10  | The result is publishable: it builds, and an installed copy of it loads and typechecks.                           | `yarn verify:publish` — `npm pack`, extract into a throwaway `node_modules`, import every published subpath and typecheck a consumer against the shipped `.d.ts` with no `paths` and no `skipLibCheck`      |

## 9. Decision log

Full reasoning and rejected alternatives in [`PLAN-type-first.md`](PLAN-type-first.md) §2.

| #   | Decided                                                                                                                                                                                                                                                                                                                                     | On         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D1  | The derivation `PrimaryKey<S>` is renamed `PrimaryKeyOf<S>` so the tag takes the good name. No deprecated alias — D2 removes the reason for one.                                                                                                                                                                                            | 2026-09-02 |
| D2  | Derivations take a tagged type only; there is no dispatch on a schema value. **`defineSchema` is deleted**, with a codemod for existing projects. Backwards compatibility is explicitly not a requirement. The value→IR front-end survives only as the differential proof that the tagged path is correct, and is removed with it.          | 2026-09-02 |
| D3  | A column has three types — wire / app / db — and each layer renders the one it owns. `timestamp`: ISO `string` in JSON Schema, `Date` in `Entity<T>`, `TIMESTAMPTZ` on Postgres. The IR keeps the abstract type; the dialect renders the spelling. The per-dialect DDL type map it needed is exported as `ddlType` from `@zmdb/migrations`. | 2026-09-02 |
| D4  | An unresolvable type is a **build error** naming the file, the type and the construct, with `{ onUnsupported: 'warn' \| 'runtime' }` as the opt-out. An unresolved type _parameter_ is always fatal.                                                                                                                                        | 2026-09-02 |
| D5  | Keep `unique symbol` tags and name-based reflection, and make two declarations of one tag name in a program a **build error**. Verified: a cross-copy key filter resolves to `never`, which is assignable to anything, so it fails silently — the type tests must assert exact identity, never assignability.                               | 2026-09-02 |
