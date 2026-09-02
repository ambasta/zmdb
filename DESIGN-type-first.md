# Design goal — type-first declaration, AOT-generated runtime

**Status:** accepted design goal, not yet implemented.
**Owns:** PRD §6.7 (`REQ-TF-*`).
**Plan:** [`PLAN-type-first.md`](PLAN-type-first.md).
**Prototype:** `scripts/prototypes/type-first/` — runnable, 25 asserted expectations.

---

## 1. The goal

> Shift domain rules, state transitions, and business invariants directly into the
> compile-time type system to guarantee static correctness before deployment.
> Harnessing type-level computation eliminates entire classes of runtime defects
> while providing zero-cost safety for core application logic. Runtime code must be
> restricted to dynamic I/O and side-effect boundaries, preventing compile-time
> performance regression and hyper-complex type abstractions.
>
> — PRD §4, principle **P3**

Today a schema is a **value** and the types are inferred from it:

```ts
const UserSchema = defineSchema('users', { id: serial(), email: text() });
type User = Entity<typeof UserSchema>; //          ^ types flow OUT of the value
```

The goal inverts that. A schema is a **type**, and every runtime artefact is
generated from it:

```ts
interface User extends Table<'users'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey & Min<1>;
  email: string & Sql<'varchar'> & Length<255> & Unique & Pattern<'…'>;
}
//        ^ the declaration IS the type; values flow OUT of it
```

This is not a stylistic preference. `defineSchema` is a standing violation of
principle **P2** (single source of truth / pure derivation): the column facts are
written as runtime data and the types are a shadow of them, so the runtime data is
the source and the type system is downstream. Inverting it makes P2 and P3 true
rather than aspirational.

## 2. Why this is possible now, and was not before

The blocker was always type resolution: a transformer that cannot resolve
`is<User>(x)` to `User`'s members cannot generate anything. `packages/aot-validator/src/transformer.ts`
works around this with a hand-written **text parser** over the type-argument source
(`parseType`), which understands primitives and inline object literals and nothing
else. A named type is silently skipped and falls through to a runtime path that
throws without a hand-built `TypeDescriptor` (`src/utilities/index.ts:83`). That is
why `benchmarks/harness/framework/app.ts` hand-writes `columnKind` and
`createDtoDescriptor`: the library cannot bridge schema to descriptor.

**TypeScript 7.0.2 — already in `node_modules` — ships a type checker over
`typescript/unstable/sync`.** `Checker` exposes `getTypeFromTypeNode`,
`getPropertiesOfType`, `getTypeOfSymbolAtLocation`, `getTypeArguments`,
`isTypeAssignableTo`, the `isXType()` predicates, and `Symbol.flags` for
optionality.

Measured on this repo, one `API` instance: **3 ms** to construct, **57 ms** to open all
six package projects, **4 ms** to add a second project to an already-open snapshot, and
**0 ms** to invalidate a changed file. Full semantic diagnostics cost 56–104 ms per
project, but the transformer never needs them — that is `tsc`'s job. So the whole-repo
reflection budget is one 60 ms payment per build, and the only way to get it wrong is
to pay it per file.

## 3. The encoding

A tag is an **optional `unique symbol` slot**:

```ts
declare const zmdbMin: unique symbol;
export type Min<N extends number> = { readonly [zmdbMin]?: N };
```

Three properties make this the right shape, and each is load-bearing:

- `unique symbol` — un-forgeable, and cannot collide with a real data property.
- `?` — no runtime value is ever required, so the tag erases completely. Zero bytes.
- **all-optional (weak) object type** — TypeScript's weak-type detection means an
  unrelated type is _not_ assignable to it. This is what makes
  `T[K] extends Serial ? K : never` return an exact answer.
  Verified: `SerialKeys<User>` resolves to exactly `"id"`, `DefaultKeys<User>` to
  exactly `"createdAt"` — `string & Pattern<…>` does not false-positive as `Serial`.

The tag only has to **name** the constraint, not prove it. Everything the AOT needs
is a string or number literal in a type position — no conditional types, no
recursion, no template-literal arithmetic. That is what satisfies the objective's
closing clause ("no compile-time performance regression, no hyper-complex type
abstractions") **by construction** rather than by discipline.

A rejected alternative is to _prove_ the constraint in the type system:

```ts
type PositiveInteger<N extends number> = number extends N ? never : /* … */ N;
```

That works, and is worth having for **literal arguments in our own code** (chunk sizes,
page limits — see §7). It is the wrong tool for I/O: it can only reject a dynamic
`number`, never validate one, and it puts type-level computation on the hot path of
every build. The tag encoding does the same job with no computation.

### 3.1 What needs a tag, and what does not

The most important design decision is how _little_ needs tagging. TypeScript already
expresses most column semantics natively, and the generator reads them from the type
directly:

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

Everything in the left column that needs no tag is a fact TypeScript models better
than a flag ever did. `ColumnFlags.nullable` becomes `| null`;
`ColumnFlags.enum: readonly string[]` becomes a literal union that also narrows at
every call site. This is a net **reduction** in vocabulary versus today's
`ColumnFlags` + `SqlType` + `ValidationRule[]`.

## 4. Required surface

### 4.1 ORM tags — the full set

Must cover every fact currently reachable through `defineSchema`. The mapping is
1:1 against `packages/schema-core/src/index.ts`:

- `SqlType` (`serial`, `integer`, `bigint`, `numeric`, `text`, `varchar`, `boolean`,
  `timestamp`, `json`, `jsonEnum`) → `Sql<T>`, with `jsonEnum` subsumed by a literal
  union and `json` by a nested interface.
- `ColumnFlags` (`nullable`, `primaryKey`, `unique`, `autoIncrement`, `hasDefault`,
  `length`, `enum`, `sensitive`) → per §3.1.
- `ColumnMeta.references` → `References<Target>`, keeping the existing
  `ValidateFkType` compile-time FK type check.
- `ColumnMeta.validation: ValidationRule[]` → `Min`/`Max`/`MinLength`/`MaxLength`/`Pattern`,
  plus an escape hatch for a named custom rule.
- `SchemaOptions.ftsTable` → `Fts<Name>`.
- `custom-types`' `CustomType<TS, DB>` → `Codec<Name>` naming a registered codec.
- `relations`' `Cardinality` / `manyToOne` / `oneToMany` / `oneToOne` / `manyToMany`
  → relation tags, so `Populated<T, K>` derives from types rather than a value.

### 4.2 DTO converters

Every derivation currently keyed off `ColumnsMap` must be re-pointed at the tagged
interface. **The conditional types themselves do not change** — this is the cheapest
part of the migration:

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

Verified in the prototype: the tags survive `Omit`, `Pick` and `Partial`.
`Min<18> & Max<120>` still generates `>= 18 && <= 120` inside
`Partial<Omit<User, "id">>`.

### 4.3 JSON Schema / OpenAPI / LLM converters

`toJsonSchema(schema: CoreSchema, variant)` (`schema-core/src/openapi/index.ts:82`)
takes a runtime value and switches on `ColumnMeta`. It becomes type-driven, with the
**same** output shape, so `toOpenApi`, `toJsonSchemaWithRelations`,
`toOpenApiComponents`, `toListSchema`, `toSearchSchema` and `toolFromSchema` keep
their contracts:

- `toJsonSchema<T>()` — a build-time call the transformer replaces with the emitted
  JSON Schema **object literal**. No walk at runtime.
- The existing `Variant` union (`entity`/`create`/`update`/`get`/`list`/`search`)
  becomes a type argument: `toJsonSchema<CreateDTO<User>>()`.
- Tag → keyword mapping is direct: `Min<n>` → `minimum`, `MaxLength<n>` →
  `maxLength`, `Pattern<s>` → `pattern`, `Length<n>` → `maxLength`, a literal union
  → `enum`, `| null` → a nullable type, `Sensitive` → omitted from read variants.

This is the point where the "one schema, one lifecycle" claim in PRD §7 stops needing
a runtime schema object at all.

### 4.4 What the AOT must emit

Four generation targets, in dependency order:

1. **Predicates** — `is<T>(x)` → an inlined boolean chain. _Prototyped._
2. **Assertions and issue lists** — `assert<T>`/`validate<T>` → the same walk plus a
   structured `{ path, expected, value }` on failure, with **no allocation on the
   success path** (REQ-AV-7).
3. **JSON Schema literals** — `toJsonSchema<T>()` → a frozen object literal.
4. **The runtime schema value** — the query compiler needs the table name and column
   SQL types as _data_ to build SQL. It gets a generated `const` instead of a
   hand-written `defineSchema` call. This is the honest boundary of the design:
   **types can generate the runtime data; they cannot be the runtime data.** The
   difference from today is that the value is derived, not authored, so P2 holds.

## 5. What the prototype establishes

`scripts/prototypes/type-first/` — `node scripts/prototypes/type-first/run.mjs`,
25 asserted expectations, exit non-zero on regression.

Proven:

- The checker resolves a named interface, its aliases, and its nested types.
- Tags are readable off an intersection as string/number literal types.
- Tags drive key filtering exactly (`SerialKeys<User>` → `"id"`).
- The checker resolves **through mapped types**: `getPropertiesOfType` on
  `Partial<Omit<User, "id">>` returns the computed property set.
- Constraints survive `Omit`/`Pick`/`Partial`.
- Native nullability (`| null`), optionality (`?`) and literal unions read correctly.
- `Sensitive` strips from `ReadDTO`; `Serial` strips from `CreateDTO`; `HasDefault`
  becomes optional on insert; `Sql<'serial'>` implies `Number.isInteger`.
- No tag symbol appears in the emitted code — asserted by the runner.

Two bugs the prototype caught, both worth recording because the shipping
implementation will meet them:

- `boolean` is `true | false` — a **union**, not an intrinsic type. Classify it
  before any property-bearing fallback or a primitive gets an object check.
- Stripping nullability early (`getNonNullableType` at the top of the walk) destroys
  legitimate `T | null` columns. Optionality and nullability must be handled at the
  property and union level respectively.

## 6. What is not yet established

The implementation plan is [`PLAN-type-first.md`](PLAN-type-first.md); it resolves several
of these and states which are decisions rather than unknowns.

| Open question           | Why it matters                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build wiring            | The plugin must hold **one** `API` instance for the whole build. Measured: 60 ms once is free. Per file it is fatal. A discipline problem, not a performance one.                                                                                             |
| No in-memory overlay    | `fileChanges` only _invalidates_; the checker re-reads from disk. So the transform must run before any other plugin rewrites the module, or positions no longer line up. Plan §5.1.                                                                           |
| `tsc`-driven builds     | `ts-patch`-style program transformers do not apply to the Go compiler. The plan's answer is a codegen CLI, which also closes RISK-1 — see plan Phase 8.                                                                                                       |
| Three types per column  | **Resolved** (plan D3, §9): a column has a wire type, an app type and a db type, and each layer renders its own — `timestamp` is an ISO `string` in JSON Schema, a `Date` in `Entity<T>`, `timestamptz` in Postgres DDL. The DDL type map does not exist yet. |
| Recursive entity graphs | `User → Post[] → User` needs the seen-set/named-helper approach the prototype sketches, at real depth.                                                                                                                                                        |
| Scale                   | Untested on a 60-column entity behind four layers of conditional types, or against the checker's instantiation limits.                                                                                                                                        |
| Excess properties       | The prototype emits `is` semantics. `equals` semantics is a separate emit path (today's `emitExcessKeyGuards`).                                                                                                                                               |
| Migration path          | **Resolved** (plan D2, §9): `defineSchema` is deleted, not kept as a peer. A codemod converts a project; the value→IR front-end survives only as the differential proof and goes with it.                                                                     |
| Declaration ergonomics  | `number & Sql<'integer'> & Min<18> & Max<120>` reads worse than a builder chain. Named aliases (`Age`, `Email`, `PositiveInteger`) recover it, and the reflection sees through aliases.                                                                       |
| `dts` build break       | `yarn build` already fails at the `dts` step because tsup's bundled `rollup-plugin-dts` wants the old JS compiler API. Unrelated cause, same root: TS 7 changed the API shape.                                                                                |

## 7. Adjacent, not part of this goal

Type-level _proof_ (as opposed to declaration) still earns its keep for **literal
arguments inside our own code**, where there is no I/O and no brand to carry:

```ts
type PositiveIntegerLiteral<N extends number> = number extends N
  ? never
  : N extends 0
    ? never
    : `${N}` extends `-${string}`
      ? never
      : `${N}` extends `${bigint}`
        ? N
        : never;
```

Candidates: `chunkArray`'s `chunkSize` (`query-compiler/src/index.ts:68`, currently a
runtime `throw`), `tags.MinLength(n)` (`aot-validator/src/index.ts:26`, where
`MinLength(-5)` compiles today and inlines a vacuous check), `OffsetPage.limit`. Note
that `DIALECT_PARAM_LIMITS: Record<Dialect, number>` erases its own literals — as
`as const satisfies Record<Dialect, number>` the lookup types as `30000 | 60000` and
becomes checkable.

Tracked separately; it does not block or depend on the work above.

## 8. Definition of done

1. `REQ-TF-*` acceptance criteria in PRD §6.7 all met.
2. A tagged interface expresses everything `defineSchema` can express, asserted by a
   type test that fails if a `ColumnFlags` member has no tag equivalent.
3. `is`/`assert`/`validate`/`equals` on any named type, mapped type, or derived DTO
   are transformed — no silent skip, and no `TypeDescriptor` hand-written anywhere
   in the repo or the benchmarks.
4. `parseType` and the text-scanning transformer are deleted.
5. The AOT conformance suite passes identically against the generated and runtime
   paths (REQ-AV-4).
6. `benchmarks/harness/framework/app.ts` contains no schema→descriptor bridge.
7. Build time is measured and published, with the one-`API`-instance property
   asserted by a test rather than assumed.
8. `defineSchema` no longer exists and a codemod converts a project that used it.

## 9. Decision log

Full reasoning and rejected alternatives in [`PLAN-type-first.md`](PLAN-type-first.md) §2.

| #   | Decided                                                                                                                                                                                                                                                                                                                            | On         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D1  | The derivation `PrimaryKey<S>` is renamed `PrimaryKeyOf<S>` so the tag takes the good name. No deprecated alias — D2 removes the reason for one.                                                                                                                                                                                   | 2026-09-02 |
| D2  | Derivations take a tagged type only; there is no dispatch on a schema value. **`defineSchema` is deleted**, with a codemod for existing projects. Backwards compatibility is explicitly not a requirement. The value→IR front-end survives only as the differential proof that the tagged path is correct, and is removed with it. | 2026-09-02 |
| D3  | A column has three types — wire / app / db — and each layer renders the one it owns. `timestamp`: ISO `string` in JSON Schema, `Date` in `Entity<T>`, `timestamptz` on Postgres. The IR keeps the abstract type; the dialect renders the spelling. Requires a per-dialect DDL type map, which does not exist today.                | 2026-09-02 |
| D4  | An unresolvable type is a **build error** naming the file, the type and the construct, with `{ onUnsupported: 'warn' \| 'runtime' }` as the opt-out. An unresolved type _parameter_ is always fatal.                                                                                                                               | 2026-09-02 |
| D5  | Keep `unique symbol` tags and name-based reflection, and make two declarations of one tag name in a program a **build error**. Verified: a cross-copy key filter resolves to `never`, which is assignable to anything, so it fails silently — the type tests must assert exact identity, never assignability.                      | 2026-09-02 |
