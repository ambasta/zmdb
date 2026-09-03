# SPEC — SDL emission from declared types (frozen)

Part of `@zmdb/schema-core`, a new `./sdl` subpath. The GraphQL back-end of the IR: a declared TypeScript type
in, SDL text out, and a refusal with a path for everything GraphQL cannot say. Epic "GraphQL core — SDL
derived from types, and resolvers on the container".

`../../../web/src/graphql/SPEC.md` owns the resolver side — the decorators, the chain, execution. This file
owns the mapping, and the mapping is where the feature is won or lost: every hard case here is one that
produces plausible-looking wrong SDL if it is decided during implementation instead of before it.

## 1. What this emits, and what it does not

```ts
/** Every definition reachable from `T`, rooted at one named type. */
export declare function sdlOf<T>(name: string, opts?: { readonly kind?: 'output' | 'input' }): string;

/** A type whose fields take arguments: a root `Query`/`Mutation`, or an `extend type`. */
export declare function sdlFields<F>(name: string): string;

/** A named scalar, backed by the wire half of a codec. */
export declare function scalar<Wire, TS>(name: string, codec: ScalarCodec<Wire, TS>): ScalarDefinition;
```

**The product is a string.** Not a `GraphQLSchema`, not a `DocumentNode`, not an AST. `graphql` is not a
dependency of this package, not a peer dependency, and not an optional one — the same position
`../llm/adapters/SPEC.md` §1 takes for LangChain and the AI SDK, for the same reason: a string plus a plain
resolver map is what `buildSchema`, `makeExecutableSchema` and `createSchema` all accept, so a caller composes
them in one line and nobody negotiates a version range. The epic's constraint list says `graphql` is a peer
dependency; this freeze is stricter, and strictly cheaper for a consumer who never writes a resolver.

`sdlOf<T>` and `sdlFields<F>` read a **type argument**, which means they are compiled away by the transform
and have no runtime. That is not an implementation detail — it is the property that makes §10's mapped types
work at all — and it puts two new names on `CALLEES` (§12).

## 2. The mapping is a function of the wire `TypeIR`

Every row below reads a `TypeIR` node, produced by `wireTypeOf(col)` for a column and by the reflector for
anything nested. **Nothing in the emitter names `SqlType`, `ColumnMeta` or `ColumnsMap`**, and that is a hard
constraint rather than a style preference: a table keyed by SQL type — which is exactly what
`docs-site/content/web-graphql-schema-first.md` sketches, and what a reader would write first — is the sixth
walker `.github/scripts/verify-one-walker.mjs` exists to stop. It would also be wrong in the ordinary way: a
`Codec<'Money'> & WireAs<string>` column is `integer` in SQL and a string on the wire, and a table keyed by
`sql` emits `Int` for a field the resolver returns as a string.

| Wire `TypeIR` node                       | SDL                                                       |
| ---------------------------------------- | --------------------------------------------------------- |
| `scalar` `string`, no `format`           | `String`                                                  |
| `scalar` `string`, `format: 'date-time'` | `DateTime` (§8)                                           |
| `scalar` `string`, `format: 'int64'`     | `BigInt` (§8)                                             |
| `scalar` `integer`                       | `Int`                                                     |
| `scalar` `number`                        | `Float`                                                   |
| `scalar` `boolean`                       | `Boolean`                                                 |
| `union` of `string` literals             | an `enum` (§5)                                            |
| `union` of `[X, null]`                   | `X`'s form, nullable (§3)                                 |
| `array` of `X`                           | `[X!]`, the `!` following `X`'s own nullability           |
| `object` with a `name`                   | `type Name` or `input NameInput` (§4)                     |
| `ref`                                    | the name it refers to — which is how recursion works (§5) |
| `object` without a `name`                | **refused** (§4)                                          |
| any other `union`                        | **refused** (§7)                                          |
| `tuple`, `undefined`, `unknown`, `null`  | **refused** (§7)                                          |
| `unsupported`                            | **refused**, carrying the node's own `reason` (§7)        |

Two rows are absent because they are unreachable, and saying so is what stops someone adding them: `scalar`
`bigint` and `scalar` `date` are **app** types. `wireTypeOf` turns a `bigint` column into a string with
`format: 'int64'` and a `timestamp` into a string with `format: 'date-time'`, so the wire IR never carries
either. An emitter that handled them would be describing a value that never crosses the boundary.

`Constraints` — `minimum`, `maximum`, `minLength`, `maxLength`, `pattern` — do **not** appear in the SDL,
because GraphQL has no keyword for any of them. That is not a loss: `../../../web/src/graphql/SPEC.md` §3
requires every argument through an AOT validator before the resolver runs, so `Length<320>` is enforced on the
input path either way. `web-graphql-resolvers.md`'s "GraphQL validates against its schema, which covers types
but not your rules" is the same observation from the reader's side.

### 2.1 `numeric` is `Float`, and the docs page is wrong about it

`web-graphql-scalars.md` says `numeric` must map to `String` and that "zmdb's drivers already return `numeric`
as a string for exactly this reason". The second half is false — nothing in `packages/repository` or
`packages/query-compiler` converts a `numeric` result, and `appBaseOf` maps the column to `number`, so
`Entity<T>` has a `number` and a resolver returns a `number`. Emitting `String` for it would make the SDL
disagree with the value, which is a worse failure than the precision it was trying to avoid: the client gets a
serialisation error, or a number stringified by the engine, and the type no longer describes the resolver.

So the mapping follows the declaration, and the honest route to a decimal string is to declare one:
`amount: Money & Sql<'numeric'> & Codec<'Money'> & WireAs<string>` emits `String`, because the wire type says
so. **A degradation has to be requested in the declaration; the emitter never chooses one.** That rule is
applied again in §5 and §7, and it is the single idea this file is built on.

## 3. Nullability, and the one distinction GraphQL cannot carry

GraphQL has one null and no notion of absence, so three TypeScript states collapse into two SDL forms:

| Declared               | Output field | Input field |
| ---------------------- | ------------ | ----------- |
| required, not nullable | `T!`         | `T!`        |
| required, nullable     | `T`          | `T`         |
| optional, not nullable | `T`          | `T`         |
| optional, nullable     | `T`          | `T`         |

The rule in one line: **a field is non-null iff the property is required and its wire type does not include
`null`.** An optional property becomes nullable because there is no third form to emit, and on the output side
that is the end of it — a field the resolver did not produce comes back as `null`, which is what a client of
any GraphQL API already expects.

On the **input** side the collapse is load-bearing and has to be stated, because `UpdateDTO<T>` means
something by the difference. `PATCH`-shaped semantics are "an absent key leaves the column alone; an explicit
`null` sets it to null", and both spellings arrive as the same nullable SDL field. The resolution, frozen:

- The SDL says nullable, and nothing pretends otherwise.
- A GraphQL arguments object contains **only the fields the document actually provided**, so
  `Object.hasOwn(args.input, 'nickname')` distinguishes the two at the resolver. That is the same test a
  `PATCH` handler makes against a parsed JSON body, and it is why `UpdateDTO<T>` survives the trip.
- `assert<UpdateDTO<T>>(args.input)` then rejects an explicit `null` on a column that is not nullable, which
  is the check the SDL could not express.

An input field is emitted **without a default value**, always. GraphQL's `= 20` default is applied by the
engine before the resolver sees the arguments, which would put a value in `args` that the document did not
send and destroy the `hasOwn` test above. A column's `HasDefault` belongs to the insert, and the insert is
where it stays.

## 4. Every type needs a name, and an anonymous one is refused

### 4.1 The input/output split

A GraphQL input object cannot be used as an output type, so a TypeScript type reachable from both positions
emits two definitions. Frozen: **the `Input` suffix is applied to every input object unconditionally**, not
only when a type happens to be used in both positions.

The conditional version is the tempting one and it is wrong for the reason `operationId` is derived rather
than counted (`packages/web/src/openapi/SPEC.md`): under a conditional rule, adding one mutation that takes an
`Address` renames the `Address` input that some other mutation was already using. A rename is a new type to
every client and every generated artefact downstream, so a rule under which an unrelated addition renames an
existing type is a rule that breaks consumers at a distance. Unconditional suffixing costs a slightly
redundant `AddressInput` in a schema that has only inputs, and it costs it visibly, once.

Collisions are refused rather than resolved. If a declared type is itself named `AddressInput` and is reachable
as an input, the derived name and the declared name collide; the emitter refuses, naming both paths. The
alternative — `AddressInput1` — is a name nobody chose appearing in a public contract.

### 4.2 Anonymous types are refused, not named

`ObjectIR` carries `name` only when the type had one, so the emitter can tell the two cases apart exactly. For
a nested object with no name — `shipTo: { line1: string; city: string }` written inline — the choice was
refuse or derive (`OrderShipTo`). **Refused**, with a diagnostic naming the path and the site.

The reason is that a derived name is a public identifier the emitter invented. Every client's generated types,
every persisted query and every reviewer's mental model then depend on `OrderShipTo`, and it changes when the
property is renamed, when the property moves to another type, or when a second type nests the same shape and
gets `InvoiceShipTo` for the identical object. The fix on the reader's side is one line — give the interface a
name — and the diagnostic says so:

```
zmdb/sdl: Order.shipTo is an anonymous object type and GraphQL requires every type to be named.
  Extract it: `interface ShipTo { line1: string; city: string }`.
  at src/orders.ts:14
```

This is also where the epic's `"shipTo": {}` defect does _not_ get inherited. That hole is
`jsonSchemaForColumn`'s `case 'json': break;` — a column with no `type` keyword — and it exists because that
function emits per column and never descends. The SDL emitter descends by construction: it walks `TypeIR`, so a
`json` column reaches its `payload`, and the nested type is emitted or refused. Nothing is silently `{}`,
because `{}` is not a thing SDL can spell.

## 5. Enums, and recursion

A union of string literals is an `enum`. The name is the owning type plus the field in Pascal case —
`User.plan` yields `enum UserPlan` — because `ColumnIR.enum` is a sorted list of values with no name of its
own. The values are emitted in that sorted order, which is what makes the golden SDL a function of the
declaration rather than of the checker's member ordering (see the note on `ColumnIR.enum`).

**An enum member that is not a valid GraphQL enum value name is refused.** GraphQL serialises an enum by its
_name_, and names match `/^[_A-Za-z][_0-9A-Za-z]*$/` — so `'free-tier'` has no enum value name, and inventing
`FREE_TIER` would promise a client a value the resolver never returns. The diagnostic offers the declaration
that requests the degradation explicitly:

```
zmdb/sdl: User.plan has the value "free-tier", which is not a GraphQL enum value name.
  Rename the member, or declare the column as a plain string on the wire with `WireAs<string>`.
```

Uppercase is a convention and is not enforced: `enum UserPlan { free pro enterprise }` is valid SDL and it
matches the values the resolver actually returns, which matters more than looking idiomatic.

Recursion needs nothing special. `RefIR` is a back-reference to a named `ObjectIR` already on the walker's
stack, and a named reference is how SDL expresses a cycle natively — `type Comment { parent: Comment }` is
ordinary. It is only §4.2 that makes this true: an anonymous recursive type has no name to refer back to, and
refusing it early is what keeps the walker from needing a cycle-breaking invention.

## 6. Relations become fields, and a missing resolver is a boot failure

A relation is the reason to have GraphQL at all, so `sdlOf<T>` emits `SchemaIR.relations` as fields on the
**output** type only — inputs take foreign keys, not nested objects, which is what `CreateDTO<T>` already
describes. `toJsonSchemaWithRelations` makes the same output-only split for the same reason.

| `RelationKind`          | Field type   | Nullability                                                |
| ----------------------- | ------------ | ---------------------------------------------------------- |
| `manyToOne`, `oneToOne` | `Target`     | `Target!` iff the `via` foreign-key column is not nullable |
| `oneToMany`             | `[Target!]!` | a to-many is an empty list, never null                     |
| `manyToMany`            | `[Target!]!` | same                                                       |

A relation field carries no value on the row, so it needs a resolver. `../../../web/src/graphql/SPEC.md` §4
freezes the consequence: the schema builder **refuses at boot** when an emitted relation field has no
`@ResolveField`. A field that always resolves `null` is worse than a field that is not in the schema, because
a client writes against it and the failure looks like missing data rather than a missing implementation.

## 7. What is refused, and the rule that there is no `JSON` scalar

Every refusal below is an `EmitDiagnostic` carrying the property path and the source location, and every one of
them fails the build. **None of them degrades to a `JSON` scalar, and no `JSON` scalar is emitted at all.**

| Construct                                    | Why it cannot be said                                     |
| -------------------------------------------- | --------------------------------------------------------- |
| a union of scalars (`string \| number`)      | GraphQL unions are over object types only                 |
| a discriminated union with a non-object arm  | same, and the arm is the reason                           |
| an index-signature map (`Record<string, T>`) | no field names, so no fields                              |
| a tuple                                      | a list is homogeneous and unbounded                       |
| an intersection that is not an object merge  | nothing to merge into fields                              |
| a `json` column with no declared payload     | `JSON_CONTAINER` is "anything JSON", which is `{}` (§4.2) |
| an anonymous object type                     | §4.2                                                      |
| an unnameable enum value                     | §5                                                        |
| `unknown`, `undefined`, `never`              | no wire form                                              |

`docs-site/content/web-graphql-scalars.md` already argues the `JSON` case from the other end — "a hole in your
schema", arbitrary depth, unvalidated data — and this is the section that turns that paragraph into a rule. A
`JSON` scalar would make every refusal above unnecessary, which is precisely the problem: the emitter would
always succeed, and the type would stop describing the data at whichever field first got difficult. A build
error names the field; a `JSON` field names nothing and is discovered by a client.

A discriminated union of _object_ types is expressible and is **not** refused — it is a GraphQL `union`, with
each arm a named object type, subject to §4.2 for the arms' names. The refusal is for the arms GraphQL has no
form for.

## 8. Custom scalars: the wire half of a codec, and both parse paths

```ts
export interface ScalarCodec<Wire, TS> {
  readonly toWire: (value: TS) => Wire;
  readonly fromWire: (raw: Wire) => TS;
}

export interface ScalarDefinition {
  readonly name: string;
  readonly sdl: string; // `scalar DateTime`
  readonly serialize: (value: unknown) => unknown;
  readonly parseValue: (value: unknown) => unknown;
  readonly parseLiteral: (node: unknown, variables?: Readonly<Record<string, unknown>>) => unknown;
}
```

The issue's signature is `scalar<Wire, TS>(name, type: CustomType<Wire, TS, never>)`, and it cannot be
satisfied: `CustomType<Wire, TS, DB>` requires `toDb: (value: TS) => DB`, so `DB = never` demands a function
that cannot return. More importantly it asks for the wrong pair. `encodeValue`/`decodeValue` apply
`toDb`/`fromDb` — the **database** crossing — whereas a GraphQL scalar serialises to JSON and parses from it,
which is `toWire`/`fromWire`, the **wire** crossing. A scalar built on the DB pair would send a driver
representation to a browser.

So `scalar` takes the wire half as its own interface, and a `CustomType<Wire, TS, DB>` is structurally
assignable to it — one declaration serves the column and the scalar, with no adapter and no `never`.

**The timestamp rule, applied.** A `timestamp` column is a `Date` in `Entity<T>` (`appBaseOf`), an ISO-8601
string on the wire (`wireTypeOf`), and `TIMESTAMPTZ` in Postgres DDL. The SDL name for it is `DateTime`, and
the shipped scalar is exactly that mapping: `serialize` refuses anything that is not a `Date`, `parseValue`
refuses a string that does not parse, and neither ever returns `Invalid Date`. `BigInt` is the same shape for
`format: 'int64'` — a decimal string on the wire, a `bigint` in the app.

### 8.1 `parseValue` and `parseLiteral` are one implementation, reached two ways

A variable arrives as an already-parsed JSON value and goes to `parseValue`. A literal written into the query
document arrives as an AST node and goes to `parseLiteral`. A scalar that implements one is broken for the
other, and the break is invisible in tests that only use variables.

Frozen: `parseLiteral` converts the node to a JSON value and then calls `parseValue`. One implementation, two
entry points, and they cannot disagree. The conversion handles the node kinds by their `kind` string —
`StringValue`, `IntValue`, `FloatValue`, `BooleanValue`, `EnumValue`, `NullValue`, `ListValue`, `ObjectValue`,
`Variable` — recorded as data with the specification revision they were read from, the same discipline
`../llm/SPEC.md` §2.1 sets for provider keyword tables and `../llm/mcp/SPEC.md` §2 for a protocol version. Reading
them as strings is also what keeps `graphql`'s `Kind` enum from becoming an import (§1).

Two rules that the docs page currently gets wrong, and which are the point of specifying this at all:

1. **A `Variable` node inside a literal is resolved from the `variables` argument, and throws when it is
   absent.** GraphQL passes variables to `parseLiteral` precisely because `{ at: $when }` is legal.
2. **An unhandled node kind throws.** `web-graphql-scalars.md:54` returns `null` for any non-string literal,
   four lines above its own instruction to "throw on invalid input rather than returning `null`" — and a
   scalar that returns `null` for a malformed literal turns a client's typo into a null column.

## 9. `sdlFields<F>`: root types, and why the fields are declared as data

A resolver method's signature is not readable at runtime, and the transform rewrites _calls_ — it cannot read
a class's methods. `TypeIR` has no function node either, so reflecting `(args: { id: number }) => Post` yields
`unsupported`. Adding a signature node to the IR would touch every back-end's exhaustive switch for the
benefit of one target, so the fields are declared as an ordinary object type instead:

```ts
interface PostQueries {
  post: { args: { id: number }; result: Entity<Post> | null };
  posts: { args: { limit?: number }; result: readonly Entity<Post>[] };
}

const QUERY_SDL = sdlFields<PostQueries>('Query');
// type Query {
//   post(id: Int!): Post
//   posts(limit: Int): [Post!]!
// }
```

Each property is a field: `args` becomes the argument list (mapped as an **input** position, §4.1), `result`
becomes the field type (an **output** position). A field with no arguments declares `args: Record<never,
never>` — an empty object type — rather than omitting the key, because an omitted key is indistinguishable
from a typo in the field name.

The same function emits `extend type Post { comments(first: Int): [Comment!]! }` for a name that is already
defined elsewhere in the document, which is how a field resolver that takes arguments is declared.

What makes this a single source of truth rather than a second one is on the web side:
`ResolversOf<PostQueries>` (`../../../web/src/graphql/SPEC.md` §1) is a mapped type over the same declaration,
so `class PostResolver implements ResolversOf<PostQueries>` is a compile error naming the method whenever the
SDL and the resolver disagree. The declaration is written once and checked from both directions.

## 10. Mapped types: TypeScript's operators, and no `PartialType` family

There is no `PartialType`, `PickType`, `OmitType` or `IntersectionType`, and there will not be. Those
functions exist in decorator-based libraries because a type there is a class carrying runtime metadata, so
deriving one type from another means copying that metadata at runtime.
`docs-site/content/web-graphql-mapped-types.md` already makes the argument in full; what changes with this
freeze is the page's conclusion:

```ts
sdlOf<Entity<Post>>('Post');
sdlOf<CreateDTO<Post>>('CreatePost', { kind: 'input' });
sdlOf<Partial<CreateDTO<Post>>>('PostDraft', { kind: 'input' });
sdlOf<Omit<Entity<Post>, 'authorEmail'>>('PublicPost');
sdlOf<Pick<Entity<Post>, 'id' | 'title'>>('PostSummary');
```

The page says a hypothetical emitter "would work from a _schema object_, and `Omit<PostRow, 'authorEmail'>` is
a TypeScript type with no runtime representation", and concludes that a composed shape would have to be
post-processed by deleting keys from a JSON Schema, with a wished-for `omitFromSchema` helper. That is only
true of a value-taking emitter. `sdlOf<T>` takes a **type argument** and is compiled away, so the checker
resolves the composition and the emitter never sees a value — every operator TypeScript has works, including
ones no helper library offers. `omitFromSchema` is therefore not needed and is refused: it would be a second
way to compose a shape, reachable only from the JSON Schema side, and the two would drift.

Consistency with the DTO family is by construction rather than by convention: `Partial<CreateDTO<Post>>` for
SDL is the same type as `Partial<CreateDTO<Post>>` for a validator, because it is the same type.

## 11. The SDL direction, and why schema-first is refused

`web-graphql-schema-first.md` argues that an SDL file as a second source of truth reintroduces exactly the
drift the derivation removes, and that the drift is silent because nothing checks an SDL file against a table.
This freeze agrees, and goes further: **generating resolver signature types from an SDL document is refused.**

It is the same refusal `../llm/http/SPEC.md` §6 makes for generating validators and interfaces from an
OpenAPI document, and the reasons carry over unchanged — it is a second codegen front end, whose checked-in
output describes a document somebody else owns, and `ARCHITECTURE.md` §2.9 allows one front end. It would also
need an SDL parser, which is either a dependency this package refuses (§1) or a hand-written one.

What ships instead, in the two situations the page distinguishes:

1. **You own the schema.** `sdlOf`/`sdlFields` emit it, a build script writes `schema.graphql`, it is
   committed, and CI runs `yarn gen:sdl && git diff --exit-code schema.graphql`. That is the reviewable
   contract schema-first is actually prized for, with no second source of truth — the page already recommends
   exactly this, and it becomes the supported path.
2. **You do not own the schema** — a partner's subgraph, a contract agreed elsewhere. Then
   `sdlDiff(parse, theirs, ours)` reports every field that is missing, extra or differently typed, with `parse`
   **injected** by the caller from their own `graphql` (the injection precedent is `aiSdkTool`'s `jsonSchema`
   in `../llm/adapters/SPEC.md` §4). It runs in the build script, and a disagreement is a non-zero exit naming
   each field.

**Where a disagreement surfaces as a compile error** — which is what the issue's step 10 asks for — is
`implements ResolversOf<F>` (§9), on the resolver class, naming the method. That is total for a schema you own,
because `F` and the SDL are one declaration. For a schema you do not own there is no declaration to check
against, so the honest answer is a build-script diff and not a compile error, and pretending otherwise would
mean generating the declaration — which is the thing being refused.

This changes the epic's Definition of Done item 5 and two of #539's test titles;
`../../../web/src/graphql/SPEC.md` §8 lists the replacements.

## 12. What this target adds to existing gates

- **`CALLEES` in `packages/aot-validator/src/transformer.ts` gains `sdlOf` and `sdlFields`.** An
  untransformed call is a runtime type walk, and there is no runtime to walk to — both throw the same
  "was not replaced at build time" error `schemaOf` does. The test that pins the list,
  `it('names eight calls, and every one of them is a function somebody can call', …)`, asserts the members
  literally but names a count in its own title; the count should come out of the title, as
  `packages/aot-validator/src/emit/SPEC.md` §7 already concluded for the same reason.
- **A new `./sdl` subpath** on `@zmdb/schema-core`, re-exported by the `zmdb` umbrella, covered by
  `yarn verify:exports` and `yarn verify:publish`. It is **not** a `BUILD_TIME_ENTRIES` addition: the emitter
  consumes IR, so nothing here imports `typescript`, exactly as `./openapi` does not.
- **`yarn verify:one-walker` stays green without an exemption**, which §2 is what makes true. An emitter that
  needed a `MAY_NAME` entry would be the second front end this epic's architecture constraints forbid.
- **`NO_GRAPHQL` in `tests/api-coverage/mapping.mjs`** currently declares `graphql-code-first/e2e/*` and
  `graphql-schema-first/e2e/*` out of scope. The code-first entries must be removed and mapped to real test
  titles. The schema-first ones stay out of scope, with `oos()` rewritten to cite §11 — a refusal with a
  reason, rather than an absence.
- `ARCHITECTURE.md`'s subpath count moves. It is a number in prose that a new subpath invalidates.

## 13. What #539 has to assert

1. The golden SDL for one fixture type set, covering every row of §2 that is reachable, both nullability
   columns of §3, an enum, a recursive type and a nested named object — one fixture so the input/output
   difference is visible in one file.
2. `emits a nested object type rather than an empty one` — the epic's `"shipTo": {}` analogue, green here
   regardless of what happens on the JSON Schema side.
3. One refusal test per row of §7's table, each asserting the **path** in the diagnostic, not just that it
   threw. A refusal that cannot say where it happened is a refusal a reader cannot act on.
4. `emits separate input and output types for a type used in both positions`, plus the unconditional-suffix
   rule: a type used _only_ as an input still emits `XInput`.
5. The `AddressInput` collision refuses.
6. `DateTime` serialises a `Date` to an ISO string, and parses `parses an ISO string from a variable and from
a query literal` — both paths through one implementation, plus a `Variable` node inside a literal, plus an
   unhandled node kind throwing rather than returning `null`.
7. `sdlFields` emits an argument list from `args` and a field type from `result`, and `extend type` for a name
   already defined.
8. `derives an SDL input from Partial<CreateDTO<T>> consistent with the DTO family` — the same golden the
   `CreateDTO` document is checked against, so the two derivations cannot drift.
9. Nothing walks a type at request time: the transformed output contains the SDL text, asserted, so §2.2 is
   machine-checked.

## 14. Non-goals (rejected)

- **No `graphql` dependency, peer dependency or optional peer.** §1 — a string and a plain map compose with
  every server, and an injected constructor covers the one thing that needs a class (§8, and
  `../../../web/src/graphql/SPEC.md` §6).
- **No `JSON` scalar, and no degradation to one.** §7 — it would make every refusal unnecessary and every
  type approximate.
- **No derived names for anonymous types.** §4.2 — an emitter-invented public identifier that moves when a
  property does.
- **No conditional `Input` suffix.** §4.1 — an unrelated addition would rename an existing type.
- **No `SqlType`-keyed mapping table.** §2 — that is the sixth walker, and it is wrong for any column with a
  declared wire form.
- **No constraints in the SDL.** §2 — GraphQL has no keyword for them and the validator already enforces them.
- **No default values on input fields.** §3 — an engine-applied default destroys the absent-versus-null test
  that `UpdateDTO` depends on.
- **No `PartialType`/`PickType`/`OmitType`/`IntersectionType`.** §10 — TypeScript's operators are strictly
  more capable, and they are already checked.
- **No `omitFromSchema` helper.** §10 — a second way to compose a shape, drifting from the first.
- **No SDL parser, and no generated resolver types.** §11 — a second codegen front end describing a document
  somebody else owns.
- **No schema stitching, no federation directives, no `@key`.** That is the subscriptions-and-federation
  epic, and emitting a directive whose runtime does not exist would be a schema that lies.
