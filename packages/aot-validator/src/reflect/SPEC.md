# Reflection: TypeScript type → IR — Spec (PRD §6.7 REQ-TF-4 … REQ-TF-7)

> Part of `@zmdb/aot-validator` (module `src/reflect/`). Build-time only; never bundled.
> Design: `DESIGN-type-first.md` §5, `PLAN-type-first.md` Phase 4.

## 1. Why it exists

`@zmdb/schema-core/ir` gave the repo one vocabulary and one set of back-ends. This is
the front-end that lets a **type** reach it, so that

```ts
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255> & Unique;
}
```

becomes a `SchemaIR`, and through it a schema value, a set of DDL statements, a validator
and a JSON Schema document. It is the only front-end there is: `defineSchema` and its
column builders were the other one, and they were deleted once this one could say
everything they could and five things they could not (§8).

While both existed, the gate was deep equality — `schemaIR` of a tagged interface against `irFromSchema` of the matching `defineSchema` call, table for table. That test did its job and went with the API it was comparing against.

What replaced it is stronger, because it does not need a second front-end to be true: every SQL snapshot, DDL golden and JSON Schema contract in the repository is now produced from a declaration through this module, so the back-ends are exercised on real output rather than on output certified equal to something else's.

The module is three files, and the split is deliberate:

| File           | Responsibility                                                      |
| -------------- | ------------------------------------------------------------------- |
| `session.ts`   | The only place that imports the compiler. Owns the server process.  |
| `callsites.ts` | Finds `f<T>(...)` calls in a source file and hands back `T`'s node. |
| `index.ts`     | `Reflector` — `Type` → `TypeIR` / `SchemaIR`. No AST, no I/O.       |

`codemod.spec.ts` lives here too, and it belongs here rather than beside the codemod it
tests: `scripts/codemod-tagged-schema.mjs` writes the declarations this module has to be
able to read, so the corpus it converts and the corpus this module reflects are the same
argument seen from two ends.

## 2. Three rules

1. **Total.** `typeIR` never throws. Every input produces a node; anything the
   reflection cannot model produces `{ kind: 'unsupported', reason }`. Throwing would
   make one bad property abort a file, and guessing is worse: `f70186c6` was a
   transformer that inlined a _partial_ parse of a type it only half understood, and a
   partial answer is indistinguishable from a correct one until production.
2. **Refusals are named.** `reason` is prose a human can act on, and it becomes the
   build error (plan D4). `'unknown'` would be a wasted afternoon.
3. **Budgeted.** `maxDepth` (32), `maxNodes` (20 000) and `maxHelpers` (512) are caps
   against pathological input. Exceeding one produces an `unsupported` node like any
   other — a budget overrun stops the build the same way an unmodellable type does,
   and two mechanisms for one outcome would be two things to keep in sync.

## 3. `session.ts` — the compiler boundary

`typescript@7` is the Go compiler behind a thin JS client. `import('typescript')`
resolves to two keys (`version`, `versionMajorMinor`); the real surface is behind
subpath exports, and the checker is `typescript/unstable/sync`. Every call is a
round-trip to a `tsgo` child process over a synchronous pipe.

Two consequences:

- **One session per build, not per type.** Spawning the server and loading the project
  is the expensive part; a checker call is cheap.
- **`close()` is not optional.** The child outlives the import if nobody closes it,
  which in a test runner is a hung worker. `ReflectSession` is `Disposable`, and
  `withSession` exists for callers that cannot use `using`.

`unstable` is the compiler's word, not ours: the API carries no stability guarantee, so
it is contained in this one file rather than spread across the reflection and the
emitter.

`diagnostics(fileName)` is here because a type read out of a file that does not compile
is a guess. Callers check it before trusting anything derived from the program.

## 4. What the checker actually gives us

Measured, not assumed. Each row cost a probe, and each one is load-bearing — the code
does the "instead" column at a commented site.

| Surface                  | Reality                                                    | Instead                                               |
| ------------------------ | ---------------------------------------------------------- | ----------------------------------------------------- |
| `getTypeArguments(t)`    | **Panics the server** (Go nil deref) unless `t` is a ref   | Guarded by `isArrayType` / `isTupleType` first        |
| `t.symbol`               | `undefined` over the wire                                  | `t.getSymbol()`                                       |
| `t.isTupleType()`        | `false` for real tuples                                    | `checker.isTupleType(t)`                              |
| `TupleType.elementFlags` | `undefined`                                                | Optional/rest elements refused via the printed form   |
| `getPropertiesOfType`    | Does not surface index signatures at all                   | `getIndexInfosOfType(t).length`                       |
| `IndexInfo.keyType`      | Throws when read                                           | Presence is detectable, the key type is not → refused |
| Optional property type   | `nickname?: string` is `string`, not `string \| undefined` | `PropertyIR.optional` is the only record of absence   |
| `readonly`               | Not marshalled onto the symbol                             | Recorded `false` rather than guessed                  |

Two normalisation facts shape the fixtures rather than the code:

- The checker sorts `null`/`undefined` to the **front** of a union; `../ir`'s `withNull`
  puts them at the **back**. `#union` reorders, so member order is stable either way.
- `(T | null) & Unique` normalises to `(T & Unique) | (null & Unique)`, and
  `null & Unique` is `never` — silently dropping the nullability. The canonical
  spelling is therefore **`(T & Tags) | null`**: tags inside, `| null` outside. This is
  a trap with a mechanism, not a style preference.

## 5. How a tag is recognised

`schema-core/src/tags` is types-only and must stay that way, so the reflection cannot
import the tags. A tag is a `declare const zmdbSerial: unique symbol` property slot,
and the checker reports it as the escaped name `__@zmdbSerial@1`. `TAG_NAMES` in
`../ir` is the table, `vocabulary.type-test.ts` asserts every constraint kind and every
column flag is reachable through it, and a tag with no entry is a tag the reflection
cannot see.

Two questions need different answers. "Is this property _data_?" is determined
by whether its escaped name starts with `__@`, which identifies any
`unique symbol` slot. "Which IR field does this tag set?" is answered by
`TAG_NAMES`.

Testing the second question in place of the first made `Brand<number, 'UserId'>` a build error: the brand object looked like a second data part of the intersection, so the refusal was "an intersection of unrelated non-object types".

A symbol-keyed property cannot cross a JSON boundary, so there is nothing to check and nothing lost by treating every one of them as phantom.

The `@<id>` suffix is what makes plan **D5** detectable: two installed copies of
`@zmdb/schema-core` declare `zmdbSerial` twice, the two `unique symbol`s are nominally
distinct, and the escaped names differ only in that number. `#readTags` keeps a
basename → first-seen-escaped-name map and refuses with both spellings named, because
the alternative symptom is "my `Serial` tag does nothing" with no explanation.

## 6. Refusals, and the one rule behind most of them

`#object` tries in a fixed, load-bearing order: array → tuple → `Date` → class → call
signatures → index signature → property walk. `Date` before the property walk because
it has methods; class before it because an instance is not a plain object.

Then a single rule: **a validatable object has only data properties.** A property whose
type has a call signature makes this a behavioural type, and refusing it there — naming
the offending property — is what rules out `Map`, `Set`, `Promise`, every typed array
and any class with a prototype method. One principle instead of five special cases,
and the message points at the property that gave it away.

Bare `number` is also refused: `integer` and `numeric` are different columns, and the
IR has no way to say "we did not decide". The reason asks for
`Sql<'integer' | 'numeric' | 'serial'>`.

## 6a. Type operators need no code

`Omit`, `Pick`, `Partial`, `Required`, mapped types and conditional types have no branch
anywhere in this module, and that is the design rather than an omission: the checker
resolves them before we look, so the reflection reads structure and never syntax. The
tests assert the resolved property lists so the claim is measured rather than asserted.

## 6b. Template literal types

`` `${string}@${string}` `` becomes a `string` with `constraints.pattern` derived from
the segments — `^[\s\S]*@[\s\S]*$`. This needs a branch of its own for two reasons: it
is worth having, and without it a template literal type falls through to `#object`,
where `string`'s numeric index signature collects the "`Record<string, T>` cannot be
modelled" refusal — a message about neither the type nor the problem.

Only exact placeholders are derived: `string`, and string or number literals.
`${number}` is **refused**. TypeScript accepts exponents, signs and `Infinity` there, so
any regex short enough to write is either stricter than the type — rejecting values the
type accepts — or looser. Both are wrong in a validator, so the reason asks for an
explicit `Pattern<…>` and lets the author pick the numeric grammar they mean.
`Uppercase<string>` and friends are refused the same way.

A derived pattern is a constraint the _structure_ implied, so `#applyConstraints` merges
rather than replaces: an explicit `Pattern<…>` overrides the derived one, but a
`MinLength<3>` beside a template literal type does not silently erase it.

## 7. `Serial` implies `hasDefault`

Not a convenience, and not an inference either — it is what the word means. A serial
column's value comes from a sequence the database owns, so `INSERT` may omit it, and
"may be omitted on insert" is precisely what `hasDefault` says to `CreateDTO`, to the
JSON Schema's `required` list and to the seeder. A `Serial` column without `hasDefault`
would make `id` a required field on every create call, which is the opposite of the
reason anyone writes `Serial`.

The old `serial()` builder set both flags together for the same reason. This is the one
place the two front-ends had to agree by hand rather than by construction, and it is worth
a section because getting it wrong is invisible: the DDL is identical either way, and only
the create path notices.

## 7a. The naming strategy runs here, and only here (frozen — epic "Naming strategy")

```ts
export interface ReflectOptions {
  readonly limits?: Partial<ReflectLimits>;
  /** Resolved from `zmdb.config.ts` by the caller. Absent means identity. */
  readonly naming?: NamingStrategy;
}

export interface NamingStrategy {
  readonly column?: (property: string, context: { table: string }) => string;
  readonly table?: (declared: string) => string;
  readonly index?: (table: string, columns: readonly string[], unique: boolean) => string;
}
```

This module is the IR producer, so by `../../../schema-core/src/ir/SPEC.md` §4.2 it is the only place a strategy is ever called. `schemaIrFromType` calls `table` once per table and `column` once per column, writes the results into `physicalTable` and `physicalName`, and nothing downstream calls a strategy again.

The alternative — a hook in the query compiler, where names become SQL — is where every other ORM put it, and it is a function call per column per row for the lifetime of the project.

Having it here also satisfies §2.9: the DDL and the emitted validator read one set of physical names rather than resolving names twice and agreeing by luck.

The order for one column is: read the tags, then take `Physical<'…'>` if the declaration carries one,
else `naming.column(property, …)` if configured, else the property name. Explicit beats strategy, and
the strategy is never consulted for a column that already answered the question.

`context.table` is the **declared** table name, not the physical one. A user function that special-cases
a table wants the string the author wrote, and passing the declared name means that function reads the
same whether or not a `table` strategy is also configured — otherwise turning on pluralisation silently
changes which branch a `column` strategy takes.

A strategy is a function from names to names and nothing else. It never sees a type, a tag, a `SchemaIR` or a value, which is what makes it safe to run at build time and what makes the transform's cache key a fingerprint of the resolved config rather than of the project.

It also means the four things a name could plausibly be are not names for this purpose and are never passed to it: a relation property, a relation's `via`, a `References` target, and the payload of a `Rule`, `Codec` or `WireAs` tag.

A collision is reported through the existing diagnostic channel — `#refuse` / `ReflectDiagnostic`, reaching the build as a `TransformDiagnostic` — and **not** thrown. Rule 1 of §2 is why: the transformer collects diagnostics per call site, so throwing would abort a whole file over one interface.

It is a schema-level diagnostic rather than an `unsupported` node, because there is no single property to blame and neither of the two colliding columns may be dropped or quietly renamed. The message names both property names; the known defect in `EmitDiagnostic.path` (it carries an emitted-source expression rather than a property chain) must not be extended into this one.

Config loading is not this module's job and must not be reinvented here. `naming` arrives resolved, from `loadConfig` in `zmdb/src/config` — sub-issue #492 in the CLI epic, which the naming epic's implementation slice is blocked on for exactly this reason.

Both AOT routes have to resolve the same config: the unplugin transformer and `zmdb-codegen` each read it and hand it over, and `yarn verify:fixtures` is the gate that proves the two routes emit the same physical names, because `fixtures/consumer-plugin` and `fixtures/consumer-cli` declare the same tables.

## 8. What a declaration says and a schema value cannot

Five of these were the argument for deleting the value front-end, and they are still the
argument for `CoreSchema.ir` being a required field rather than a convenience: a
`ColumnMeta` is a `SqlType` and a flag map, and there is nowhere in it for any of the
first five rows to go. Reading them off `columns` was never possible; the old
`irFromSchema` returned a default for each and the back-ends believed it.

Each has its own assertion, because an asymmetry that lives only in a comment is an
asymmetry nobody measures.

| Capability                | Where a schema value would have to put it                         |
| ------------------------- | ----------------------------------------------------------------- |
| `Numeric<P, S>` precision | `ColumnFlags` has no precision field                              |
| `Codec<Name>`             | No flag carries it                                                |
| `WireAs<W>`               | A value has no way to name a type                                 |
| A `json` payload shape    | A payload is a shape, and a `ColumnMeta` holds data               |
| Relations                 | `CoreSchema` has no relations field at all                        |
| A default **value**       | The reverse gap: `HasDefault` means "has one", not "has this one" |

The last row is the one asymmetry that runs the other way — the IR carries a default
value, and no tag can state one, because a tag payload is a type-level literal and a
default may be any expression the dialect accepts. `HasDefault` records that the column
has one and leaves the value to the DDL.

`WireAs<W>` is the one tag whose payload is a _type_ rather than a literal, so `#column`
reads it with `#type` and not `literalOf`. It is what stops a codec column from being
guessed at: `Codec<'Money'>` says the app type is not the SQL type, and only `WireAs<W>`
says what crosses the wire instead. A column that says the first without the second gets
an `unsupported` wire type from the IR rather than a plausible-looking wrong one.

The declared app type lands in `payload`, which used to be a `json`-only field. A codec
over a plain scalar is the exception: `string & Length<80> & Codec<'currency'>` keeps the
sql-derived app type, because recording `string` as the payload would throw away the
constraint the declaration just made.

## 9. Verified

- [x] Every construct in `__fixtures__/constructs.ts` either reflects correctly or produces a named refusal — 61 assertions, zero rows silently wrong.
- [x] The `SchemaIR` of the two `pair` tables in `__fixtures__/tables.ts` is written out in full in `reflect.spec.ts` and compared field for field. A golden rather than a differential, and deliberately so: the differential only ever proved the two front-ends were wrong in the same way, and a written-out IR says what the right answer is.
- [x] One corpus, four back-ends: the same tables drive the IR golden, the JSON Schema documents, the validator's `TypeIR` and the emitted schema value, so a column added to the fixture is a column all four specs read.
- [x] Every fixture file compiles with zero semantic diagnostics before any type is read.
- [x] `boolean` reflects as a scalar, not as the `true | false` union the checker models it as.
- [x] `maxDepth` and `maxNodes` overruns each produce an `unsupported` node naming the cap.
- [x] A duplicate tag installation is refused with both escaped names in the message (plan D5).
- [x] Each of the six rows in §8 has its own assertion — the five a schema value cannot hold, and the one default value no declaration can state.
- [x] A `Codec` + `WireAs` column reflects all three of its types; a codec over a plain scalar records no payload.
- [x] `Serial` alone yields `serial: true` **and** `hasDefault: true`.
- [x] Mutual recursion (`Folder` ↔ `FileEntry`) closes with a `ref`, not just self-recursion.
- [x] A discriminated union keeps its discriminant as a `literal` on every arm, so the emitter can choose a strategy from the IR alone; an undiscriminated union keeps declaration order.
- [x] `Omit`/`Pick`/`Partial`/`Required`/mapped/conditional resolve to the expected property lists, optionality included, with tags on the properties intact.
- [x] `Brand<number, 'UserId'>` reflects as `number` with no diagnostic.
- [x] A template literal type derives an anchored pattern; `${number}` and `Uppercase<string>` are refused by name, and neither refusal blames an index signature.

## 10. Non-goals (rejected)

- **Resolving a call site by symbol.** `callsites.ts` matches the callee by identifier
  text. A renamed import would be missed. Kept deliberately: the alternative needs a
  module-resolution pass for a fixture-finding helper, and the transformer that drives
  this knows its own callees (`CALLEES` in `../transformer.ts`).
- **`Record<string, T>` and index signatures.** Detectable but not readable through the
  API (§4). Modelling one as "an object with zero properties" would emit a validator
  that accepts `{}` and everything else, so it is a named refusal instead.
- **A regex for `${number}`.** §6b. Being wrong in either direction is worse than
  asking.
- **A discrimination strategy in the IR.** The reflection records that a property is a
  `literal`; which key to switch on, and whether to switch at all, is the emitter's
  decision (`../emit/SPEC.md`). Baking it in here would make the IR a plan rather than a
  description.
- **A separate error channel for budget overruns.** See rule 3.
- **Defaulting an unresolvable type to `unknown`.** Plan D4: it is a build error.
