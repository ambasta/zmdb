# @zmdb/schema-core — Spec (Issue #11)

> Targets: Node 26+, ESM-only, TypeScript 7 semantics.
>
> It was frozen for TDD against issues #12–#15, and #12, #13 and #15 — the column
> builders, the modifiers and `defineSchema` — have since been deleted rather than
> revised. §1 says why and what replaced them. The type derivation of #14 is still here,
> and now has two spellings; see §4.

## 1. How a table is described

A table is declared once, as a **type**, in the tag vocabulary of `src/tags` — see
`src/tags/SPEC.md`. This package holds the other end: the data model that declaration
becomes, and the compile-time derivations read off it.

```ts
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255> & Unique;
}

const users = defineRepository(schemaOf<User>(), driver);
```

There used to be a second way — `defineSchema('users', { id: serial().primaryKey() })`,
ten column builders and eight function-style modifiers, all specified by §1–§3 of this
document. They are gone, and `.github/scripts/verify-no-defineschema.mjs` is what keeps
them gone. The reason is not that the DSL was bad on its own terms: it is that two
front-ends give two answers to "what are this table's columns", the emitted validator only
agrees with one of them, and the divergence is silent. `git log` has the surface if you
need it; the codemod at `scripts/codemod-tagged-schema.mjs` converts a codebase that still
uses it.

## 2. What a column is, as data

`ColumnMeta` is what the query compiler reads. It is deliberately small — a SQL type and a
flag map — and it is **lossy**, which is why §3's `ir` field exists.

```ts
interface ColumnMeta {
  readonly type: SqlType; // serial | integer | bigint | numeric | text | varchar | boolean | timestamp | json | jsonEnum
  readonly flags: {
    readonly nullable: boolean; // required: every column is one or the other
    readonly primaryKey?: boolean;
    readonly unique?: boolean;
    readonly autoIncrement?: boolean;
    readonly hasDefault?: boolean;
    readonly length?: number; // varchar only
    readonly enum?: readonly string[]; // jsonEnum only
    readonly sensitive?: boolean;
  };
  readonly default?: unknown;
  readonly references?: { readonly target: string };
  readonly validation?: readonly ValidationRule[];
}
```

A `Serial` column carries `autoIncrement: true` **and** `hasDefault: true`. Both, always,
and not as a convenience: the sequence belongs to the database, so `INSERT` may omit the
column, and `hasDefault` is what tells `CreateDTO` and the JSON Schema's `required` list
so. `aot-validator/src/reflect/SPEC.md` §7 is the long version.

What a `ColumnMeta` **cannot** hold: a numeric precision, a codec name, a wire type, a
json payload's shape, or a relation. Five facts a declaration states and this shape has
nowhere to put — see §8 of the reflection spec, and §3 below for what carries them.

## 3. `CoreSchema` — a table as data

```ts
interface CoreSchema<T extends string = string, C extends ColumnsMap = ColumnsMap> {
  readonly table: T;
  readonly columns: C;
  readonly primaryKey: readonly string[];
  readonly references: readonly { readonly column: string; readonly target: string }[];
  readonly ftsTable?: string | boolean | undefined;
  readonly ir: SchemaIR; // required
}
```

`schemaOf<T>()` is the only way to get one. It has no runtime implementation and cannot
have one — the answer is a function of a type argument — so `@zmdb/aot-validator` replaces
the call with a frozen literal at build time, and an untransformed build throws a message
saying exactly that rather than returning a plausible empty schema.

`ir` is required, and that is the whole design. `columns` is the lossy projection §2
describes; `ir` is the complete one. Every back-end reads the IR — DDL, validator, JSON
Schema, seeder — so they cannot disagree about a column, and `schemaFromIR(schema.ir)`
reproduces `schema` exactly (asserted in `src/ir/ir.spec.ts`). A `CoreSchema` that had to
reconstruct the IR from its own columns is what the deleted `irFromSchema` did, and it
guessed a default for each of the five facts §2 lists.

`C` carries the _literal_ column map, which is what lets `Entity<S>` and friends derive
real property types. It defaults to the erased `ColumnsMap`, so `CoreSchema<string>` still
means "any table" for code that does not care — repositories, OpenAPI, seeding.

`TaggedSchema<T> extends CoreSchema<string>` adds one required `unique symbol` slot
holding `T`, so a schema value remembers the type it came from and the derivations in §4
can defer to the declaration instead of rebuilding it from `columns`.

## 4. Type derivation (compile-time only)

```ts
type Entity<S extends CoreSchema<string>>    // full row type
type CreateDTO<S extends CoreSchema<string>> // omit autoIncrement; hasDefault/nullable → optional
type UpdateDTO<S extends CoreSchema<string>> // Partial<CreateDTO<S>>
```

- `Entity`: every column mapped to its TS type; `nullable` columns become `| null`.
- `CreateDTO`: columns with `flags.autoIncrement` are omitted; columns with
  `flags.hasDefault` or `flags.nullable` become optional — omitting a nullable key
  inserts `NULL`, which is what passing `null` does, and the generated document has
  always said so.
- `UpdateDTO`: `Partial<CreateDTO<S>>`.

TS type mapping: serial/integer→`number`, bigint→`bigint`, numeric→`number`,
text/varchar→`string`, boolean→`boolean`, timestamp→`Date`, json→`unknown`,
jsonEnum→union of the enum literals.

Each of these has **two spellings**, and which one applies is a question about the schema
rather than about the caller:

- a `TaggedSchema<T>` defers to `@zmdb/schema-core/derive`, which reads `T` — the
  declaration already states every property type these mapped types would reconstruct, so
  reconstructing them is work that can only lose information;
- an erased `CoreSchema<string>` walks `columns` as described above. That is the branch
  above, and it is what a schema read back out of a `SchemaIR` gets.

`json` is `unknown` on the second branch and exact on the first. That asymmetry is the
ceiling of reading a `ColumnMeta` rather than an omission: a payload's shape is a type, and
§2's data model has nowhere to put a type. Collapsing the two branches into one is a
follow-up (`PLAN-type-first.md` Phase 9) and needs every consumer re-parameterised on the
declared type, not on the schema value.

## 5. Non-goals / anti-patterns (rejected)

- No runtime reflection, no proxies, no decorators-required API.
- No mutation of column objects after creation (immutability enforced by `Object.freeze`).
