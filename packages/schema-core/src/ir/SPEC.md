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
FRONT-END              IR                  SHAPE (§7)             BACK-ENDS
                                                       ┌── JSON Schema    (openapi/llm/web)
                                ┌─ shapeOfVariant ─────┤
tagged type ──▶ SchemaIR / TypeIR                      └── validator type (repository/web, §8)
                  (pure data)   │
                                ├─ schemaFromIR ──▶ schema value ──▶ SQL / DDL (query-compiler)
                                └─ decodeWire / encodeWire / decodeDbValue (§9) ──▶ JSON ⇄ app ⇄ db
```

There was a second front-end here — `defineSchema` — and it is now a back-end instead:
`schemaFromIR` produces the schema value the query compiler reads, from the same IR
everything else reads. That is the whole shape of the type-first change in one diagram.
One arrow in, four out, and nothing downstream can disagree about a column.

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

### 4.1 Keys (frozen — epic "Composite primary keys and expression indexes")

`SchemaIR.primaryKey` is **the** key. It is an ordered list, and the order is the
declaration order of the key columns in the interface — not alphabetical, not the column
order of the table. Order is normative rather than incidental, because two things read it:
the trailing `PRIMARY KEY (…)` clause the DDL emits, and the index a planner picks for a
prefix lookup. A key spelled `(orgId, userId)` and one spelled `(userId, orgId)` are the
same set and different indexes.

`ColumnIR.primaryKey` is a **projection** of that list: it is `true` exactly when the
column's name appears in `SchemaIR.primaryKey`. The direction is fixed and one-way. Nothing
may reconstruct the list by filtering columns on the flag, because the flag has lost the one
fact the list carries — `['a','b']` and `['b','a']` project to identical flags. The flag
exists only so a per-column consumer (`columnDdl`, `CreateDTO`'s serial drop) does not have
to carry the table around; a consumer that needs to know _the key_ reads the list.

A table may declare no key at all, and `primaryKey` is then `[]`. That is a legal IR, not a
defect to normalise: a join table written as two `References` columns with no `PrimaryKey`
tag is expressible, and the back-ends each refuse it in their own terms (the repository
throws on any key operation, the DDL emits no key clause). What is _not_ legal is a
`primaryKey` naming a column the table does not have, and the reflector refuses that at
derivation rather than letting the DDL emit a clause over a phantom column.

Four back-ends read the key, and before this section they each read something different —
`PrimaryKeyOf` an object-or-scalar, the repository `primaryKey[0]` for `pkColumn`, the DDL
emitter the per-column flag, `resolveRelation` `primaryKey[0]`. Three of those are the
single-column case written as if it were the general one. The list above is what they must
all agree on; each of the four specs below says what that boundary does with it.

A composite key may not contain a `serial` column. Auto-increment inside a multi-column key
is a MySQL-specific shape (the auto-increment column must _lead_ the key), and expressing
that constraint would mean the declaration order of an interface silently deciding whether
the schema is portable. The reflector refuses instead:

```
users.id: a `Serial` column cannot be part of a composite primary key (key is (id, tenantId));
give the table a single-column surrogate key or drop `Serial`
```

## 5. Back-end: `schemaFromIR(ir)`

Turns a `SchemaIR` into the `CoreSchema` value the query compiler and the repositories
read. It is what `schemaOf<T>()` becomes at build time, and it carries the IR it was built
from on the value's required `ir` field, so nothing downstream has to choose between the
two or reconstruct one from the other.

`schemaFromIR(schemaFromIR(ir).ir)` equals `schemaFromIR(ir)`, and
`schemaFromIR(schema.ir)` equals `schema` — both asserted in `ir.spec.ts`. That is the
property the required field rests on: the value holds everything the IR does.

There was an `irFromSchema` going the other way, and its job was to prove the tagged
front-end equal to the value one — "the IR from `User` equals the IR from `UserSchema`" —
so that the existing SQL and JSON Schema snapshots could serve as the correctness argument
for type-first declaration. It did that, and went with `defineSchema` (plan D2). It could
not have stayed: a `CoreSchema` cannot express a numeric precision, a codec, a wire type, a
json payload shape or a relation, so going value → IR meant inventing a default for each of
the five. Relations were the visible one — it returned `relations: []` unconditionally.

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

A `format` in the wire column above comes with the `pattern` that enforces it. In JSON
Schema a `format` is an annotation — a conforming validator may ignore it — and neither the
runtime walk nor the emitter reads one at all, so a wire type that said only
`format: 'date-time'` accepted `"tomorrow"` and this table's first row was a claim no
validator made. `date-time` is RFC 3339, so the offset is required: `2026-01-01T12:30:00`
is valid ISO-8601 and `new Date()` reads it as local time, which is the same lost-offset
bug `timestamptz` is here to prevent, and the wire is the last layer that can still see it.
`int64`'s pattern is the decoder's own, so what the validator accepts and what
`decodeWireValue` can convert are one expression. The published document still says
`format` and nothing else — that is the keyword JSON Schema has for the idea, and a
consumer that honours it needs no help.

A codec column is the case where nothing can be inferred: it is stored as one type, held
as another and crossed as a third, and only the declaration knows the last two.
`payload` carries the app type and `WireAs<W>` the wire type. Without the tag,
`wireTypeOf` returns an `unsupported` node naming the column — "the same as the app type"
is the guess that puts a class instance through `JSON.stringify` (plan D4).

## 7. The shared middle: `ShapeIR`

A variant is not six special cases. `shapeOfVariant(ir, variant)` rewrites one into the
only two facts a back-end needs — which columns the document has, and which of them it does
not require:

```ts
interface ShapeColumnIR {
  readonly column: ColumnIR;
  readonly optional: boolean;
}
type ShapeIR = readonly ShapeColumnIR[];
```

The rules, once: a response variant (`entity`/`get`/`list`/`search`) has every column; an
input variant (`create`) drops `serial` columns and marks `hasDefault` and nullable ones
optional; `update` marks everything optional and also drops the primary key, because a
patch identifies its row in the URL. Each is exactly what the corresponding derived type
does to `Entity<T>`, which is why the translation exists rather than being a coincidence.

Two back-ends read a `ShapeIR`, and they disagree about exactly one thing on purpose:
`Sensitive`. §8's document filters it, §9's validator type keeps it. `CreateDTO<User>` has
to be able to carry a password; the published document must not name it.

## 8. Back-ends: JSON Schema, and the validator type

`jsonSchemaForColumn(col)` and `jsonSchemaFromIR(ir, variant)` produce the document
that `openapi/toJsonSchema` publishes — which is now a one-line delegation:

```ts
export function toJsonSchema(schema, variant = 'entity') {
  return jsonSchemaFromIR(schema.ir, variant);
}
```

So naming a variant and naming a derived type cannot produce different documents: both are
read off the same `SchemaIR`, and the schema value carries it rather than being walked to
reconstruct it. REQ-TF-7 stops being a test to chase and becomes the only thing the code
can do.

Variant rules are unchanged: keys are sorted, `required` is sorted, `required` means "not
optional and not nullable", sensitive columns are filtered in the emitter rather than in the
shape, and a nullable column widens its `type` keyword — except a `json` column, which has
no `type` to widen. That last quirk is pre-existing published behaviour and is preserved
deliberately.

`objectTypeFromIR(ir, variant, layer)` is the other back-end onto the same shape, and it
answers a different question: not "what document do I publish" but "what type is a legal
payload for this". It returns an `ObjectIR`, which the one runtime walker in
`@zmdb/aot-validator` checks — the same walker the emitted code is differentially tested
against. It replaced the repository's own `valueMatchesColumn`, the fourth walker of §1,
which accepted `Date | string` for a `timestamp` while `toJsonSchema` said ISO string and
the derived type said `Date`.

`Layer` is `'app' | 'wire'`, and it selects which of §6's three renderings each property
gets. A validator has to pick one — accepting both is how that disagreement went unnoticed
— so the caller states which side of the boundary it is on. Column order is preserved
rather than sorted, because nothing serialises a `TypeIR`.

## 9. Crossing between the layers

Three renderings are only useful if something converts between them, once, at the boundary.
Otherwise every handler decides for itself whether the `createdAt` it was handed is a string
or a `Date`.

| Function                        | Direction  | Used by                              |
| ------------------------------- | ---------- | ------------------------------------ |
| `decodeWire(ir, variant, body)` | JSON → app | the HTTP boundary, before validation |
| `encodeWire(ir, row)`           | app → JSON | the HTTP boundary, on the way out    |
| `decodeDbValue(col, value)`     | db → app   | the repository's read path           |
| `dbDecodedColumns(ir)`          | —          | so a read path can skip the walk     |

They convert and nothing else. A value they cannot convert is passed through untouched for
the validator to reject: a decoder that produced `new Date('nonsense')` would hand the app
layer an `Invalid Date`, which passes `instanceof Date` and reaches the driver as `NULL` or
an error. Leaving the string alone makes the validator say `expected Date`, which is true
and actionable. `decodeWire` copies through keys the variant does not have, for the same
reason: deciding what a payload may contain belongs to exactly one place, and this is not it.

Only `timestamp` and `bigint` need a conversion of their own, which is not a coincidence —
they are the same two columns that need a wire type, for the same reason. `decodeDbValue` is
written in terms of what _arrived_ rather than in terms of the dialect: `pg` hands back a
`Date` for a `timestamptz` and a string for an `int8`, SQLite hands back the `TEXT` it
stored, and a third driver will do something else again. A `bigint` a driver read into a
`number` is converted only when it is a safe integer; past 2^53 the digits are already gone,
and `BigInt(9007199254740993)` would state a value the database never held.

A `Codec<'Name'>` column is converted by the application's own `CodecRegistry`, and a name
with nothing behind it **throws** rather than passing the value through — the column's whole
point is that it needs converting (plan D4).

## 10. Verified

- [x] The IR survives a `JSON.stringify` round-trip unchanged.
- [x] Every `SqlType` appears in `SQL_TYPES` and nothing else does (compile-time).
- [x] `ConstraintKind` and `keyof Constraints` cannot drift (compile-time).
- [x] All five constraint keywords survive from schema value to JSON Schema.
- [x] An unrecognised rule kind is retained as a named rule, not dropped.
- [x] `appTypeOf`/`wireTypeOf` differ for `timestamp` and `bigint` and agree elsewhere.
- [x] The 30 pre-existing `openapi` golden tests pass against the IR-backed emitter, unchanged.
- [x] `encodeWire(decodeWire(body))` is the identity on a body, and a value neither can convert is passed through untouched.
- [x] A named codec absent from the registry throws, in both directions, naming the column and the codec.
- [x] `decodeDbValue` converts a `bigint` a driver read into a `number` only while it is a safe integer.
- [x] `objectTypeFromIR` keeps sensitive columns and `jsonSchemaFromIR` drops them, at every variant.

## 11. Non-goals (rejected)

- Dialect SQL spellings in `ColumnIR.sql`.
- Carrying a `ts.Type` or any compiler object in the IR.
- Silently defaulting an unresolvable type to `unknown` — see plan D4.
