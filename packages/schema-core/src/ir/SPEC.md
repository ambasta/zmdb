# Schema IR — Spec (PRD §6.7 REQ-TF-7)

> Part of `@zmdb/schema-core` (module `src/ir/`). Build-time; plain data.
> Design: `DESIGN-type-first.md` §4, `PLAN-type-first.md` §1.

## 1. Why it exists

The repo grew four independent walkers over the same column metadata, each with its
own vocabulary and its own gaps:

| Walker                        | Location                                     |
| ----------------------------- | -------------------------------------------- |
| AOT emitter                   | `aot-validator/src/transformer.ts`           |
| AOT runtime fallback          | `aot-validator/src/utilities/index.ts`       |
| JSON Schema (`scalarSchema`)  | `schema-core/src/openapi/` — **now deleted** |
| Repository payload validation | `repository/src/index.ts`                    |

They disagreed. `TypeDescriptor` carried `minimum` and `maxLength` but neither
`maximum` nor `minLength`, so those two checks were simply never emitted; nullability
was absent entirely. Adding a fifth walker for tagged types would have made it worse,
so the tags land on top of one IR instead and the back-ends become pure functions of
it.

```
FRONT-ENDS                  IR                       BACK-ENDS
tagged type ──┐                          ┌── predicate JS  (is)
              ├──▶ SchemaIR / TypeIR ────┼── JSON Schema   (openapi/llm/web)
defineSchema ─┘        (pure data)       ├── runtime walker (fallback)
                                         └── SQL / DDL     (query-compiler)
```

## 2. Two hard constraints

1. **The IR is serialisable JSON.** No symbols, no functions, no class instances.
   That is what lets the codegen CLI write it to disk, lets golden tests snapshot it,
   and keeps `typescript` out of every runtime bundle. `ir.spec.ts` round-trips it
   through `JSON.stringify`.
2. **`sql` stays abstract.** A `timestamp` column carries `'timestamp'`, never
   `'timestamptz'`. Rendering a dialect's spelling is the dialect's job; baking one in
   would force every other back-end to parse it back out. `vocabulary.type-test.ts`
   asserts a dialect spelling is not even expressible as a `Sql<…>` argument.

## 3. TypeIR

```ts
type TypeIR =
  | ScalarIR // { scalar: 'string'|'number'|'integer'|'bigint'|'boolean'|'date', format?, constraints? }
  | LiteralIR // { value: string | number | boolean }
  | NullIR
  | UndefinedIR
  | UnknownIR
  | UnionIR // { members: TypeIR[] }
  | ArrayIR // { element: TypeIR, constraints? }
  | TupleIR // { elements: TypeIR[] }
  | ObjectIR // { name?, properties: PropertyIR[] }
  | RefIR // { name } — back-reference to a named ObjectIR; cycle guard
  | UnsupportedIR; // { reason, source? }
```

`integer` is separate from `number` so an emitter can produce `Number.isInteger`, and
`date` is separate from `string` so the app type and the wire type can differ without
either lying.

`UnsupportedIR` is a **node, not an absence**. The transformer bug fixed in `f70186c6`
happened because an unrecognised type produced a partial answer that looked like a
real one. A gap has to be visible so the emitter can refuse and the build can fail
with a reason (plan D4).

`Constraints` is a flat record — `minimum`, `maximum`, `minLength`, `maxLength`,
`pattern` — rather than a `ValidationRule[]`, precisely so a missing keyword is a
compile error instead of a check that never runs.

## 4. SchemaIR

```ts
interface ColumnIR {
  name: string;
  sql: SqlType; // abstract
  nullable: boolean;
  primaryKey: boolean;
  serial: boolean;
  unique: boolean;
  hasDefault: boolean;
  sensitive: boolean;
  length?: number;
  precision?: readonly [number, number];
  enum?: readonly string[];
  references?: string;
  codec?: string;
  wire?: TypeIR; // the declared wire type (WireAs<W>)
  constraints: Constraints;
  rules: readonly string[]; // named custom rules an emitter must resolve or refuse
  default?: unknown;
  payload?: TypeIR; // the declared app type: a json payload shape, or a codec's type
}

interface SchemaIR {
  table: string;
  columns: readonly ColumnIR[];
  primaryKey: readonly string[];
  relations: readonly RelationIR[];
  ftsTable?: string | boolean;
}
```

An unrecognised `ValidationRule.kind` becomes a named entry in `rules`, never a
dropped check.

## 5. Front-end: `irFromSchema(schema)`

Turns a `defineSchema` value into `SchemaIR`. It exists so the tagged front-end can be
_proved_ against it — "the IR from `User` equals the IR from `UserSchema`" is what
lets the existing SQL and JSON Schema snapshots serve as the correctness argument for
type-first declaration. Per plan D2 it is scaffolding with a demolition date: it goes
when `defineSchema` does.

## 6. The three types of a column (plan D3 / REQ-TF-13)

One column has three renderings, and each layer owns one:

| Column      | wire (JSON)                     | app (handler code) | db (DDL)                             |
| ----------- | ------------------------------- | ------------------ | ------------------------------------ |
| `timestamp` | `string`, `format: 'date-time'` | `Date`             | `timestamptz` (pg) / `TEXT` (sqlite) |
| `bigint`    | `string`, `format: 'int64'`     | `bigint`           | `bigint`                             |
| `jsonEnum`  | literal union                   | literal union      | `text` + check                       |
| `Codec<N>`  | `WireAs<W>`, or refused         | `payload`          | whatever `sql` says                  |

`appTypeOf(col)` and `wireTypeOf(col)` return the first two; `ddlType(dialect, col)` in
`query-compiler/migrations` returns the third.

A codec column is the case where nothing can be inferred: it is stored as one type, held
as another and crossed as a third, and only the declaration knows the last two.
`payload` carries the app type and `WireAs<W>` the wire type. Without the tag,
`wireTypeOf` returns an `unsupported` node naming the column — "the same as the app type"
is the guess that puts a class instance through `JSON.stringify` (plan D4).

## 7. Back-end: JSON Schema

`jsonSchemaForColumn(col)` and `jsonSchemaFromIR(ir, variant)` produce the document
that `openapi/toJsonSchema` publishes — which is now a one-line delegation:

```ts
export function toJsonSchema(schema, variant = 'entity') {
  return jsonSchemaFromIR(irFromSchema(schema), variant);
}
```

So a schema value and a tagged type cannot produce different documents: both become
`SchemaIR` first. REQ-TF-7 stops being a test to chase and becomes the only thing the
code can do.

Variant rules are unchanged: `entity`/`get`/`list`/`search` include all non-sensitive
columns with `required` = non-nullable; `create` additionally drops `serial` columns
and treats `hasDefault` and nullable as optional; `update` requires nothing. Keys are
sorted, `required` is sorted, and a nullable column widens its `type` keyword — except
a `json` column, which has no `type` to widen. That last quirk is pre-existing
published behaviour and is preserved deliberately.

## 8. Verified

- [x] The IR survives a `JSON.stringify` round-trip unchanged.
- [x] Every `SqlType` appears in `SQL_TYPES` and nothing else does (compile-time).
- [x] `ConstraintKind` and `keyof Constraints` cannot drift (compile-time).
- [x] All five constraint keywords survive from schema value to JSON Schema.
- [x] An unrecognised rule kind is retained as a named rule, not dropped.
- [x] `appTypeOf`/`wireTypeOf` differ for `timestamp` and `bigint` and agree elsewhere.
- [x] The 30 pre-existing `openapi` golden tests pass against the IR-backed emitter, unchanged.

## 9. Non-goals (rejected)

- Dialect SQL spellings in `ColumnIR.sql`.
- Carrying a `ts.Type` or any compiler object in the IR.
- Silently defaulting an unresolvable type to `unknown` — see plan D4.
