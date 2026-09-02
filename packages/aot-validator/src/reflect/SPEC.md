# Reflection: TypeScript type → IR — Spec (PRD §6.7 REQ-TF-4 … REQ-TF-7)

> Part of `@zmdb/aot-validator` (module `src/reflect/`). Build-time only; never bundled.
> Design: `DESIGN-type-first.md` §5, `PLAN-type-first.md` Phase 4.

## 1. Why it exists

`@zmdb/schema-core/ir` gave the repo one vocabulary and one set of back-ends. This is
the front-end that lets a **type** reach it, so that

```ts
interface User extends Table<'users'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255> & Unique;
}
```

produces the same `SchemaIR` as the equivalent `defineSchema` call. Once that holds,
every SQL snapshot, DDL golden and JSON Schema contract already in the repo covers the
tagged front-end too — the back-ends are pure functions of the IR and cannot tell the
two apart.

The module is three files, and the split is deliberate:

| File           | Responsibility                                                      |
| -------------- | ------------------------------------------------------------------- |
| `session.ts`   | The only place that imports the compiler. Owns the server process.  |
| `callsites.ts` | Finds `f<T>(...)` calls in a source file and hands back `T`'s node. |
| `index.ts`     | `Reflector` — `Type` → `TypeIR` / `SchemaIR`. No AST, no I/O.       |

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

Two questions get different answers, and conflating them was a bug worth recording.
"Is this property _data_?" is answered by the escaped name starting `__@` — any
`unique symbol` slot, ours or not. "Which IR field does this tag set?" is answered by
`TAG_NAMES`. Testing the second question in place of the first made
`Brand<number, 'UserId'>` a build error: the brand object looked like a second data part
of the intersection, so the refusal was "an intersection of unrelated non-object types".
A symbol-keyed property cannot cross a JSON boundary, so there is nothing to check and
nothing lost by treating every one of them as phantom.

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

Not a convenience. `serial()` sets `{ autoIncrement: true, hasDefault: true }`, so the
tagged front-end must too — otherwise the equivalence test below is comparing two
different things and calling them equal.

## 8. What only a tagged declaration can say

Five capabilities have no `defineSchema` spelling, and one runtime fact has no type
spelling. They are kept out of the equivalence corpus so its deep-equality assertion
stays total, and asserted separately instead — an asymmetry that lives only in a
comment is an asymmetry nobody measures.

| Capability                | Why the other front-end cannot                         |
| ------------------------- | ------------------------------------------------------ |
| `Numeric<P, S>` precision | `ColumnFlags` has no precision field                   |
| `Codec<Name>`             | No flag carries it                                     |
| `WireAs<W>`               | A value has no way to name a type                      |
| A `json` payload shape    | `json<Line[]>()` erases the parameter at runtime       |
| Relations                 | `irFromSchema` returns `relations: []` unconditionally |
| A default **value**       | `HasDefault` means "has one", not "has this one"       |

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
- [x] `schemaIR` of a tagged interface is deep-equal to `irFromSchema` of the matching `defineSchema` call, for every table in the corpus. Confirmed to _fail_ when a fixture bound is perturbed, so the assertion bites.
- [x] The two halves of the corpus have identical label sets, so a table added on one side and forgotten on the other fails.
- [x] All three fixture files compile with zero semantic diagnostics before any type is read.
- [x] `boolean` reflects as a scalar, not as the `true | false` union the checker models it as.
- [x] `maxDepth` and `maxNodes` overruns each produce an `unsupported` node naming the cap.
- [x] A duplicate tag installation is refused with both escaped names in the message (plan D5).
- [x] Each of the six tagged-only capabilities in §8 has its own assertion.
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
  module-resolution pass for a fixture-finding helper, and the emitter that will use
  this in Phase 5 already knows its own callees.
- **`Record<string, T>` and index signatures.** Detectable but not readable through the
  API (§4). Modelling one as "an object with zero properties" would emit a validator
  that accepts `{}` and everything else, so it is a named refusal instead.
- **A regex for `${number}`.** §6b. Being wrong in either direction is worse than
  asking.
- **A discrimination strategy in the IR.** The reflection records that a property is a
  `literal`; which key to switch on, and whether to switch at all, is the emitter's
  decision in Phase 5. Baking it in here would make the IR a plan rather than a
  description.
- **A separate error channel for budget overruns.** See rule 3.
- **Defaulting an unresolvable type to `unknown`.** Plan D4: it is a build error.
