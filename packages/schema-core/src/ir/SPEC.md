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
  sql: SqlType | ExtensionType; // abstract core type or extension descriptor (§4.3)
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

### 4.2 Physical names (frozen — epic "Naming strategy")

A column has a property name and a database name, and both are always present:

```ts
interface ColumnIR {
  name: string; // the property, as declared
  physicalName: string; // what SQL uses
}
interface SchemaIR {
  table: string; // the declared name, and the schema set's identity for this table
  physicalTable: string; // what SQL uses
}
```

Neither field is optional and neither defaults at the point of use. With no strategy configured
`physicalName === name` and `physicalTable === table`, which is the identity case written out rather
than left absent. An optional field would put a `?? name` in every reader, and there are roughly
twenty of them; the one that forgets it emits a statement naming a column the database does not have,
and the symptom arrives at query time in a different package.

The direction is fixed: **derived types read `name`, SQL reads `physicalName`.** `Entity<User>`,
`CreateDTO<User>`, the JSON Schema document, the OpenAPI paths and the HTTP payload are all in
property vocabulary; DDL, snapshots, `WHERE` clauses and result-set aliases are all in physical
vocabulary. A layer that mixes the two is a layer that has to know a strategy, which is the thing
this design exists to avoid.

And one hard rule, which is the whole cost argument in a sentence: **nothing outside the IR producer
may compute a physical name.** No strategy function is called downstream of the reflection — not in
the query compiler, not in a repository, not per row. A naming strategy that is reachable at runtime
is a function call per column per row, forever, and every other ORM's naming support is exactly that
call (§1 north star 1). Here it runs once per column per build; see
`aot-validator/src/reflect/SPEC.md` §7a for where.

`schemaFromIR` (§5) is the one place the vocabulary switches. It keys `columns` by `physicalName` and
sets `table` to `physicalTable`, so a `CoreSchema` value is entirely in SQL vocabulary, while the `ir`
it carries is entirely in declaration vocabulary. Every existing consumer is already on the correct
side of that line by accident of what it reads: the DDL emitter and `snapshot` take the value, the
derived types and the validator take the IR.

**Explicit beats strategy**, through one new tag:

```ts
interface User extends Table<'users'>, Physical<'user_accounts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  createdAt: Date & Sql<'timestamp'> & Physical<'created_ts'>;
}
```

One tag rather than a `Column<'…'>` for columns and something else for tables, because the table needs
the same escape hatch and cannot borrow the one it already has. `Table<'users'>` is the table's
**identity** — `References<'users.id'>`, `OneToMany<'posts', …>` and every `populate` name it by that
string — so it cannot double as the physical name without making the table strategy unable to ever
apply. `Physical<N>` in interface position names the physical table, in property position the physical
column, and the position is unambiguous. On a relation property it is refused: a relation is not a
column and has no name in the database.

Two properties reaching the same physical name is a build error, and the message names both
**properties**, because the physical name is the one string in the failure that does not appear in the
source:

```
users: `createdAt` and `created_at` both map to the column `created_at`; rename one property or give
one an explicit `Physical<'…'>`
```

Two declared tables reaching the same physical table is the same error one level up:

```
`userAccount` and `user_accounts` both map to the table `user_accounts`; give one an explicit
`Physical<'…'>`
```

The check runs over the strategy's **output**, not over the strategy, so an explicit override that
lands on a name the strategy also produced is caught by the same rule. The column check is per table;
the table check needs the whole set and therefore runs where the set is known.

**Cross-table names stay in declared vocabulary.** `ColumnIR.references`, `RelationIR.target` and
`RelationIR.via` are identifiers into the schema set, not fragments of SQL, and they are not
translated when the IR is built. The tempting alternative is to re-run the strategy on the foreign
name — `strategy.table('users')` is pure and right there — and it is wrong for a reason no test would
catch quickly: it misses a `Physical<'…'>` on the target, so the foreign key points at a column that
does not exist while every unit test on `users` alone still passes. A foreign name is resolved by
looking the target up in the schema set, at the one point where the whole set is in hand
(`snapshot(schemas)`, the DDL pass, a resolver handed to `resolveRelation`).

**A derived name is derived from physical names.** Three exist today and each is a live case rather
than a hypothetical: the FTS shadow table (`fts/index.ts` builds `${table}_fts`), the Postgres primary
key constraint (`${table}_pkey`, §1.3 of the migrations spec), and any index name zmdb generates
rather than being handed. A `Table<'userAccount'>` under a snake_case-plural strategy gets
`user_accounts_fts`, not `userAccount_fts` — otherwise a snake_case database ends up with exactly one
camelCase object in it, which is the shape of every naming-strategy bug report other ORMs receive. A
name the caller supplies — `IndexDef.name`, a check constraint's name — is used as typed.

### 4.3 Extension-backed column types (frozen — epic "Database extensions")

`SqlType` stays closed, and `ColumnIR.sql` gains an alternative rather than a wider union:

```ts
interface ExtensionType {
  readonly extension: string; // 'vector' | 'postgis' | 'citext' — the installable thing
  readonly name: string; // 'vector' | 'geometry' | 'citext' — the type it provides
  readonly args?: readonly (string | number)[]; // [1536] | ['Point', 4326]
}

interface ColumnIR {
  sql: SqlType | ExtensionType;
}
```

A `string` and an object are distinguishable in one `typeof`, so every existing switch over `SqlType`
keeps its exhaustive shape behind that guard instead of growing a `default`. The two alternatives were
cheaper to write and both cost more than they save:

- **Widening `SqlType` with `'vector' | 'geometry' | 'citext'`** is a three-line diff, and it puts
  Postgres extension types in the core vocabulary of a library that also targets MySQL and SQLite —
  where `DDL_TYPES` would then owe them a row each, and the honest row is a refusal. It also cannot
  carry `1536`, so it needs a second field beside it anyway, which is `length` again for a type that
  is not `varchar`.
- **`SqlType | string`** deletes the property `vocabulary.type-test.ts` exists to pin. Note that the
  runtime is already open in the direction that matters least: `DDL_TYPES` is keyed by `string` and
  `ddlType` falls back to `?? col.type`, so an unrecognised abstract type is passed through today. What
  is closed is the _type_, and that is what makes the `appTypeOf` / `wireTypeOf` switches total. Open
  it and both need a default, and a default is how a vector column becomes `unknown` on the wire
  without anybody noticing.

The cost of the chosen shape, stated so the implementation slice does not discover it: every consumer
of a column's type handles both arms. Those are `ddlType`, `snapshot`, `diff`'s type comparison (which
becomes structural, not `!==`), `appTypeOf`, `wireTypeOf`, `decodeDbValue` and
`jsonSchemaForColumn` — seven, all of them already in the `verify:one-walker` exemption list, which is
what makes the audit finite.

The declaration side is one tag:

```ts
type Ext<E extends string, N extends string, A extends readonly (string | number)[] = []> = {
  readonly __zmdbExt?: [E, N, A];
};

interface Item extends Table<'items'> {
  embedding: number[] & Ext<'vector', 'vector', [1536]>;
  location: GeoJsonPoint & Ext<'postgis', 'geometry', ['Point', 4326]>;
  handle: string & Ext<'citext', 'citext'>;
}
```

**`args` has exactly two kinds, and the distinction is enforced rather than conventional.** A `number`
is emitted bare. A `string` is emitted bare as an identifier — `geometry(Point, 4326)` — and must match
`/^[A-Za-z_][A-Za-z0-9_]*$/`, refused at derivation otherwise. That check is not defensive tidiness:
`args` is the one place in the DDL where a value the author supplied reaches SQL without going through
`quoteIdentifier` or a placeholder, which makes it the same shape as #364 one layer down. A quoted
string literal is deliberately **not** a third kind — no extension type in scope takes one, and adding
the tagged form now would be a field with no test and no caller, which is how a `params: string[]`
dumping ground starts.

The three types, each answering §6's three renderings, because a type that cannot answer all three is a
type that will be guessed at somewhere:

| Column                  | wire (JSON)                              | app                     | db (Postgres)          |
| ----------------------- | ---------------------------------------- | ----------------------- | ---------------------- |
| `vector(1536)`          | `number[]`, `minItems`/`maxItems` 1536   | `readonly number[]`     | `vector(1536)`         |
| `geometry(Point, 4326)` | GeoJSON `{ type: 'Point', coordinates }` | the same GeoJSON object | `geometry(Point,4326)` |
| `citext`                | `string`                                 | `string`                | `citext`               |

The dimension becoming `minItems` and `maxItems` is validation the declaration already implied and the
document was going to omit; a 1535-element embedding is the error this catches at the HTTP boundary
instead of at the driver.

Both non-scalar types need `decodeDbValue` to do real work, and what arrives depends on whether the
driver has a type parser registered:

- A **vector** arrives as an array (parser registered) or as pgvector's text form `'[1,2,3]'` (not
  registered). Both are converted; anything else is passed through for the validator to reject, per §9.
  A malformed text form is _not_ partially parsed — `Number('')` is `0`, so a lenient parse turns a
  truncated payload into a valid-looking embedding, which is the failure mode that has no symptom.
- A **geometry** arrives as WKB hex by default, which is not convertible without a PostGIS function.
  So the projection is where this is solved rather than the decoder: a geometry column is selected as
  `ST_AsGeoJSON("location") AS "location"` and written through `ST_GeomFromGeoJSON($n)`. That costs
  nothing per row beyond the function call the database was going to have to do anyway, and it means
  `decodeDbValue` sees JSON text and nothing dialect-specific. A geometry column reached by a bare
  `SELECT *` is therefore a bug in the projection, not something the decoder papers over.

`citext` needs no conversion, and it overlaps with the expression-index recipe on purpose:
`{ expr: 'lower(email)' }` plus `Unique` gets case-insensitive uniqueness on every dialect, and a
`citext` column gets it on Postgres only, in exchange for every comparison being case-insensitive rather
than just the index. Prefer the expression index unless the column's _semantics_ are
case-insensitive.

**MySQL and SQLite refuse an extension type, and there is no fallback.** The refusal is an
`UnsupportedFeatureError` at DDL time naming the dialect, the column and the extension:

```
sqlite does not support the extension type vector(1536) on "items"."embedding" (extension `vector`);
there is no equivalent, and storing it as TEXT would produce an embedding no query can search
```

Mapping to `TEXT` is the tempting fallback and it is a data-loss bug wearing a green test suite: the
inserts succeed, the reads round-trip, and every similarity query silently returns nothing useful.

### 4.4 Soft delete in the IR — and why general filters are not (frozen — epic "Entity filters")

```ts
interface SchemaIR {
  softDelete?: { readonly column: string };
}
```

From one tag: `interface User extends Table<'users'>, SoftDelete<'deletedAt'>`. It is in the IR because
three things downstream have to know about it and none of them can be told at call time — `delete` is
redefined into an `UPDATE`, the column is managed rather than written, and a `check` against a live
database has to know the column is expected.

The tag is validated at reflection, not at query time, and refuses rather than warning:

- The named column must **exist**. A typo in a `SoftDelete<'deleted_at'>` on a table whose column is
  `deletedAt` would otherwise produce a filter over a column that is not there, and the first symptom is a
  SQL error on every read.
- It must be **nullable**. The whole predicate is `IS NULL` meaning "live", so a `NOT NULL` column cannot
  express a live row.
- It must be a `timestamp`. A boolean `isDeleted` is expressible and deliberately not accepted: it records
  that a row was deleted and not when, and the answer to "when" is the reason anybody keeps the row.

```
users: SoftDelete<'deletedAt'> names a column that is not NOT NULL-able; a soft-delete column must be
nullable, because IS NULL is what "live" means
```

The column is dropped from `CreateDTO` and `UpdateDTO` — it is managed, like a serial key — and kept in
`Entity`, because a caller who asked for deleted rows needs to see which ones they are.

**A general filter is not in the IR, and this is a hard constraint rather than a preference.** A
`FilterDef` carries `where: (params) => …`, and the IR is written to a file: `model.zmdb.generated.d.ts`
and the `.witness.ts` files are the AOT route, and `snapshot()` serialises the same values. A function
cannot survive that round trip, so an IR field holding one would be an IR that is only sometimes the IR —
present in the source route, absent in the generated one, with the filter silently off in exactly the
build the user shipped. So the IR carries the facts a tag can state in literal types, and everything
parameterised lives as a value on the repository (`../../../repository/SPEC.md` §3c). Soft delete is on
the declaration because it is a property of the table; a tenant filter is not on the declaration because
its parameter is a property of the request.

### 4.5 Protobuf vocabulary and its carriage (frozen — epic "Protobuf")

Two tags, and the encoding the issue proposing them asked for is one this project already rejected.

```ts
declare const zmdbProtoField: unique symbol;
declare const zmdbProtoScalar: unique symbol;

/** Protobuf field number. Required on every property of a message type. */
export type ProtoField<N extends number> = { readonly [zmdbProtoField]?: N };
/** Wire type, where TypeScript is ambiguous about width or signedness. */
export type Proto<K extends ProtoScalar> = { readonly [zmdbProtoScalar]?: K };

type ProtoScalar =
  | 'int32'
  | 'int64'
  | 'uint32'
  | 'uint64'
  | 'sint32'
  | 'sint64'
  | 'fixed32'
  | 'fixed64'
  | 'sfixed32'
  | 'sfixed64'
  | 'float'
  | 'double'
  | 'bool'
  | 'string'
  | 'bytes';
```

A branded-primitive encoding — `{ readonly __protoField?: N }` — is the shape
`../tags/SPEC.md` explicitly rejects: it "collides with real data properties and is forgeable". A
message type is by definition one whose values arrive from a network, so a tag that a payload could
carry as data is worse here than anywhere else in the vocabulary. `unique symbol`, optional, weak, like
the other twenty.

Carriage follows the existing mechanism exactly: `TAG_NAMES` gains `protoField: 'zmdbProtoField'` and
`protoScalar: 'zmdbProtoScalar'`, because a tag added to `../tags` without an entry there is invisible to
the reflection, and `vocabulary.type-test.ts`'s `StartsWithZmdb` assertion is what forces the naming. A
field number is a JSON number, so §2's serialisability constraint is untouched.

**`Proto<'int32'>` does not violate §2's "`sql` stays abstract" rule**, and the distinction is worth
stating because it looks like it does. `'timestamptz'` is refused as a `Sql` argument because it is _one
dialect's_ spelling of an abstract type. `int32` is not one implementation's spelling of anything — it is
the portable wire vocabulary every protobuf implementation shares, and nothing renders it further. It is
the `'timestamp'` of its layer, not the `'timestamptz'`.

`ProtoField` rather than `Field`: `Field` is the single most likely name in this vocabulary to collide in
a file that also imports a form or UI library, and every other tag is named after what it constrains.

#### Field numbers are required, and never inferred

Required on every property of a message type, unique within the message, in `1 … 536870911`, and not in
the reserved `19000 … 19999`. Each violation is a build diagnostic naming the property, the message and
the number.

They are **required rather than defaulted from declaration order**, and that is the whole reason the tag
exists. A number derived from order changes when somebody reorders two properties — a diff that looks
like formatting and is a wire break that no test in the sending codebase can see. Numbers 1–15 encode
their tag in one byte, so the spec _recommends_ them for the most frequent fields and does not enforce
it: a rule that renumbers to optimise is the rule we just refused.

#### Nested messages number independently

A nested object type is a nested message with its own `1 …` space. Field numbers are unique within a
message, not within a schema.

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

### 5.1 Back-end: the IR printed back to a declaration (frozen — epic "Introspection")

The reflection turns a declaration into a `SchemaIR`. `emitDeclarations` is the arrow going back, and it
belongs on this list because it is a back-end onto the same IR rather than a separate tool: it takes the
column facts and prints the tagged property that would produce them.

The property that makes it honest is a round trip, and it is the same kind of argument §5 makes for
`schemaFromIR`. **Reflecting a declaration, printing it back, and reflecting it again yields the same
`SchemaIR`** — for any declaration the reflection can read, modulo formatting. That is testable against the
existing fixture corpus rather than against a hand-written expectation, which matters because the reverse
direction is where a plausible-looking wrong answer is cheapest to produce: a column widened by one step
still compiles, still validates, and still writes.

It is one printer for both callers. `scripts/codemod-tagged-schema.mjs` already prints tagged declarations
from column facts, and it already carries the two facts a second printer would rediscover the hard way —
the tag order, and that nullability is `(T & Tags) | null` with the tags inside, because an intersection
distributes over a union and `null & Unique` is `never`. The full output contract, the per-dialect type
mapping behind it and what happens to a column no tag can express live in
`query-compiler/src/introspect/SPEC.md`.

One asymmetry stays unfixed, deliberately: a default **value** cannot survive the trip. `HasDefault` says a
column has one and not which one (§8 of the reflect spec), and a catalog default is an expression rather
than a value, so it comes back as a comment beside the tag. It is the one row of §8's table that runs
against the IR rather than in its favour, and the round-trip property above is stated modulo it.

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

`timestamp` and `bigint` are the only core types whose app and JSON wire forms differ: JSON
cannot carry a `Date` or a `bigint` directly. The db→app crossing additionally decodes an
extension `vector` when a driver returns pgvector's text form, even though its app and wire
forms are both number arrays. `decodeDbValue` is written in terms of what _arrived_ rather
than in terms of the dialect: `pg` hands back a `Date` for a `timestamptz`, a string for an
`int8`, and either an array or text for a vector; SQLite hands back the `TEXT` it stored, and
a third driver will do something else again. A `bigint` a driver read into a `number` is
converted only when it is a safe integer; past 2^53 the digits are already gone, and
`BigInt(9007199254740993)` would state a value the database never held.

A `Codec<'Name'>` column is converted by the application's own `CodecRegistry`, and a name
with nothing behind it **throws** rather than passing the value through — the column's whole
point is that it needs converting (plan D4).

## 10. Verified

- [x] The IR survives a `JSON.stringify` round-trip unchanged.
- [x] Every `SqlType` appears in `SQL_TYPES` and nothing else does (compile-time).
- [x] `ConstraintKind` and `keyof Constraints` cannot drift (compile-time).
- [x] All five constraint keywords survive from schema value to JSON Schema.
- [x] An unrecognised rule kind is retained as a named rule, not dropped.
- [x] `appTypeOf`/`wireTypeOf` differ only for core `timestamp` and `bigint`; extension vectors are arrays at both layers.
- [x] The 30 pre-existing `openapi` golden tests pass against the IR-backed emitter, unchanged.
- [x] `encodeWire(decodeWire(body))` is the identity on a body, and a value neither can convert is passed through untouched.
- [x] A named codec absent from the registry throws, in both directions, naming the column and the codec.
- [x] `decodeDbValue` converts valid vector text to a finite number array, leaves malformed text untouched, and converts a `bigint` read as a `number` only while it is a safe integer.
- [x] `objectTypeFromIR` keeps sensitive columns and `jsonSchemaFromIR` drops them, at every variant.

## 11. Non-goals (rejected)

- Dialect SQL spellings in `ColumnIR.sql`.
- Carrying a `ts.Type` or any compiler object in the IR.
- Silently defaulting an unresolvable type to `unknown` — see plan D4.
