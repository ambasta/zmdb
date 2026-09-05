# @zmdb/schema-core — Spec (Issue #11)

> Targets: Node 26+, ESM-only, TypeScript 7 semantics.
>
> It was frozen for TDD against issues #12–#15, and #12, #13 and #15 — the column builders, the modifiers and `defineSchema` — have since been deleted rather than revised. §1 says why and what
> replaced them. The type derivation of #14 is still here, and now has two spellings; see §4.

## 1. How a table is described

A table is declared once, as a **type**, in the tag vocabulary of `src/tags` — see `src/tags/SPEC.md`. This package holds the other end: the data model that declaration becomes, and the compile-time
derivations read off it.

```ts
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

const users = defineRepository(schemaOf<User>(), driver);
```

There used to be a second way — `defineSchema('users', { id: serial().primaryKey() })`, ten column builders and eight function-style modifiers, all specified by §1–§3 of this document. They are gone,
and `.github/scripts/verify-no-defineschema.mjs` is what keeps them gone.

The reason is not that the DSL was bad on its own terms: it is that two front-ends give two answers to "what are this table's columns", the emitted validator only agrees with one of them, and the
divergence is silent. `git log` has the surface if you need it; the codemod at `scripts/codemod-tagged-schema.mjs` converts a codebase that still uses it.

## 2. What a column is, as data

`ColumnMeta` is what the query compiler reads. It is deliberately small — a core SQL type or extension descriptor and a flag map — and it is **lossy**, which is why §3's `ir` field exists.

```ts
interface ColumnMeta {
  readonly type: SqlType | ExtensionType;
  readonly flags: ColumnFlags;
  readonly default?: unknown;
  readonly references?: { readonly target: string };
  readonly validation?: readonly ValidationRule[];
}
```

`SqlType` remains the closed string union (`serial | integer | bigint | numeric | text | varchar | boolean | timestamp | json | jsonEnum`). An extension-backed column uses the object arm
`{ extension, name, args? }`, preserving the installable extension, its provided type, and any type arguments without admitting arbitrary strings into the core vocabulary.

A `Serial` column carries `autoIncrement: true` **and** `hasDefault: true`. Both, always, and not as a convenience: the sequence belongs to the database, so `INSERT` may omit the column, and
`hasDefault` is what tells `CreateDTO` and the JSON Schema's `required` list so. `aot-validator/src/reflect/SPEC.md` §7 is the long version.

What a `ColumnMeta` **cannot** hold: a numeric precision, a codec name, a wire type, a json payload's shape, or a relation. Five facts a declaration states and this shape has nowhere to put — see §8
of the reflection spec, and §3 below for what carries them.

## 3. `CoreSchema` — a table as data

```ts
interface CoreSchema<T extends string = string> {
  readonly table: T;
  readonly columns: ColumnsMap;
  readonly primaryKey: readonly string[];
  readonly references: readonly { readonly column: string; readonly target: string }[];
  readonly ftsTable?: string | boolean | undefined;
  readonly ir: SchemaIR; // required
}
```

`schemaOf<T>()` is the only way to get one. It has no runtime implementation and cannot have one — the answer is a function of a type argument — so `@zmdb/aot-validator` replaces the call with a
frozen literal at build time, and an untransformed build throws a message saying exactly that rather than returning a plausible empty schema.

`ir` is required, and that is the whole design. `columns` is the lossy projection §2 describes; `ir` is the complete one. Every back-end reads the IR — DDL, validator, JSON Schema, seeder — so they
cannot disagree about a column, and `schemaFromIR(schema.ir)` reproduces `schema` exactly (asserted in `src/ir/ir.spec.ts`). A `CoreSchema` that had to reconstruct the IR from its own columns is what
the deleted `irFromSchema` did, and it guessed a default for each of the five facts §2 lists.

`src/ir/SPEC.md` is the long version: the `TypeIR`/`SchemaIR` shapes, the `ShapeIR` every back-end reads, the JSON Schema and validator-type emitters, and the three functions that cross between a
column's wire, app and db renderings.

`columns` is not generic. It used to be, so that `Entity<S>` could read property types out of a literal map; §4 explains why nothing does that any more.

`TaggedSchema<T> extends CoreSchema<string>` adds one required `unique symbol` slot holding `T`, so a schema value remembers the type it came from. That slot is the only way back from a value to a
declaration, and §4 is why there needs to be exactly one.

## 4. Type derivation (compile-time only)

```ts
type Entity<T extends DeclaredTable> // full row type
type CreateDTO<T extends DeclaredTable> // omit Serial; HasDefault/nullable → optional
type UpdateDTO<T extends DeclaredTable> // Partial, minus Serial and the primary key
type PrimaryKeyOf<T extends DeclaredTable> // the key value: bare for one column, an object for a composite
```

`T` is the **declared type** — the interface the table was written as — not a schema value. `@zmdb/schema-core/derive` owns all of them and every one is a mapped type over the declaration, keyed by
`ColumnKeys<T>` and reading the tags in §1:

- `Entity`: every column, mutable and required; a `| null` in the declaration stays.
- `CreateDTO`: `Serial` columns are omitted, `HasDefault` and nullable ones become optional — omitting a nullable key inserts `NULL`, which is what passing `null` does, and the generated document has
  always said so.
- `UpdateDTO`: `Partial<Entity<T>>` minus `Serial` and the primary key, because a key is not a field you patch.

There is no TS-type mapping table here, and that is the collapse: a declaration already states that `visits` is a `bigint` and `createdAt` is a `Date`, so nothing reconstructs it from a `SqlType`.

The old derivation had a second spelling that walked `columns` and did reconstruct it, and it could not be right — a `ColumnMeta` has nowhere to put a json payload's shape, so `json` came out as
`unknown` there and exact here.

Deriving from the declaration is not a better answer to the same question; it is the only one available, and the twin is gone rather than deprecated.

`DeclaredTable` is `Table<string>`, and the constraint carries weight rather than documenting an intent. `Table` is all-optional, so TypeScript's weak-type rule refuses a source with no property in
common with it — which a schema _value_ is. `Entity<typeof userSchema>`, the spelling this design replaced, is therefore a compile error instead of the schema's own five properties dressed up as a
row; it is worth constraining for precisely because the wrong answer was structurally plausible.

A row keyed by a table _name_ rather than a declaration still passes, because a string index signature is exempt from that rule — `dto/index.ts`'s `UnknownRow`, the subquery corner, is the one type
that relies on it. The whole read/query family in `./dto` carries the same constraint, so a filter, an order-by, a projection and an aggregate spec are all keyed by a declaration too.

A value still has to reach a declaration, because that is what a caller holds. It happens by inference, once, at each boundary that takes a schema: `defineRepository`, `findJoined`,
`defineEntityStateMachine` and `repositoryToken` all declare `TaggedSchema<T>` in a parameter position and let the call site supply `T`.

Two places cannot do that and say so in a comment — a relations map names its child by value, so `RelationEntity` in `@zmdb/repository` and `TargetEntityOf`/`ColumnNameOf` here read the phantom with
an explicit conditional. `src/schema-of.type-test.ts` is the gate on the crossing, including that a plain `CoreSchema<string>` is _rejected_ at those boundaries rather than deriving something empty
and plausible.

## 5. Non-goals / anti-patterns (rejected)

- No runtime reflection, no proxies, no decorators-required API.
- No mutation of column objects after creation (immutability enforced by `Object.freeze`).

## 6. Target ownership boundary: schema, not AI

Issue #703 freezes the target boundary for epic #702. This section describes the final package graph. At baseline commit `94164c53` on 2026-09-05, `packages/schema-core/src/llm/` contained 32 files.
After #705 moved provider-neutral specifications and tests, #706 moved the Anthropic driver, #707 moved the LangChain contract tests, #708 moved the Vercel adapter and its tests, and #709 moved MCP,
#710 moved the last provider-neutral and LangChain implementations. The old directory and all six historical `./llm*` exports are now absent. Provider and framework peers belong only to their
integration packages.

The final `@zmdb/schema-core` package owns only the declaration vocabulary and provider-neutral schema products:

- tags, schema values, IR and type derivation;
- DTO, naming, relation and custom-type contracts;
- the JSON Schema and OpenAPI document types derived from schema IR; and
- validation issue shapes used by higher layers without importing a validation engine.

It explicitly does **not** own:

- an `src/llm/` directory or any provider, chat, tool-runtime or MCP implementation;
- an `./llm`, `./llm/chat`, `./llm/http`, `./llm/mcp`, `./llm/langchain` or `./llm/ai-sdk` export;
- `toolFor`, `toolFromSchema`, `lenientParse`, chat-loop, OpenAPI-tool or MCP public symbols;
- a peer or development dependency on `@anthropic-ai/sdk`, `@langchain/core`, `ai` or an MCP SDK; or
- a dependency on `@zmdb/ai`, any `@zmdb/ai-*` integration package or `@zmdb/mcp`.

The dependency direction is one-way: `@zmdb/ai` depends on `@zmdb/schema-core`. Therefore a compatibility layer in this package must never re-export from `@zmdb/ai`; that would make the packages
depend on each other. The Vercel leaf moved without a forwarder in #708, MCP moved without a compatibility export in #709, and #710 removed the remaining new-to-old forwarders instead of creating a
reverse schema-core-to-AI edge.

The complete file map, public entry points, peer ranges and migration order are frozen in [`../ai/SPEC.md`](../ai/SPEC.md). Packed-package tests import all nine remaining schema-core entry points
without an AI/provider peer, and the source boundary test rejects any `@zmdb/schema-core/llm` consumer.

## 7. Issue #635 hard-cutover ownership

The AI extraction above is complete; this package is still a current-state container rather than the final foundation package. It now has 14 build-included TypeScript files and nine export-map
entries, all assigned by `.github/scripts/verify-runtime-foundation.SPEC.md` §4.

After the AI exit, `@zmdb/schema` keeps declarations, IR, derivation, pure DTO/result shapes, naming, relation metadata, custom types, and OpenAPI/JSON Schema framing. SQL folding and populate
execution move to `@zmdb/orm`; public validation errors move to `@zmdb/validator`; state-transition/state-machine symbols move to `@zmdb/app`. The old package and every `@zmdb/schema-core/*` import
are deleted at the foundation cutover rather than forwarded.
