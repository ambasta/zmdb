# Type-First Declaration Tags — Spec (PRD §6.7)

> Part of `@zmdb/schema-core` (module `src/tags/`). Types only — the module has no
> runtime export at all, and `erasure.spec.ts` enforces that.
> Implements REQ-TF-1 … REQ-TF-3. Design: `DESIGN-type-first.md` §3.

## 1. What a declaration looks like

```ts
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255> & Unique & Pattern<'^\\S+@\\S+$'>;
  age: number & Sql<'integer'> & Min<18> & Max<120>;
  nickname: (string & Sql<'varchar'> & Length<64> & HasDefault) | null;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  passwordHash: string & Sql<'text'> & Sensitive;
}
```

The interface is the source of truth. DTOs, validators, JSON Schema and DDL are
derived from it; nothing is declared twice.

## 2. Encoding

Every tag is an optional `unique symbol` slot:

```ts
declare const zmdbSerial: unique symbol;
export type Serial = { readonly [zmdbSerial]?: true };
```

All three parts are load-bearing.

| Part                | Why it is required                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `unique symbol`     | Un-forgeable; cannot collide with a data property of the same name.                             |
| `?` (optional)      | No runtime value is ever required, so the tag erases to nothing.                                |
| all-optional (weak) | A weak object type is not assignable from an unrelated type, so `T[K] extends Serial` is exact. |

There are no conditional types, no recursion and no template-literal arithmetic in
the module. REQ-TF-3's "zero type-level computation" therefore holds by
construction rather than by discipline.

## 3. What is deliberately not tagged

Nullability, optionality, enums, arrays, `readonly`, and nested JSON shape. TypeScript
already says those as `| null`, `?`, a literal union, `T[]`, `readonly` and a nested
interface, and the reflection reads them off the type directly (REQ-TF-2). A second
spelling would be a second source of truth.

`Nullable<T>` and `NonNull<T>` are exported as readability aliases. They are **not**
tags: `Nullable<string>` is exactly `string | null`.

## 4. Vocabulary

### Entity-level (applied via `extends`)

| Tag                                | Meaning                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Table<Name>`                      | The table the entity maps to.                                                                   |
| `Fts<Name>`                        | Backing full-text-search table. `Fts<'users_fts'>` names it; `Fts<true>` asks the back-end to.  |
| `ShardKey<Columns>`                | SingleStore shard-key columns, as a non-empty tuple in declaration order.                       |
| `SortKey<Columns>`                 | SingleStore columnstore sort-key columns, as a non-empty tuple in declaration order.            |
| `Rowstore`                         | Select SingleStore's row-oriented storage instead of its default columnstore.                   |
| `SoftDelete<Column>`               | Nullable timestamp managed by repository `delete`, `hardDelete`, `restore`, and read filtering. |
| `ForeignKey<Local, Table, Target>` | Composite foreign key; comma-separated local and target columns are paired positionally.        |

`SoftDelete<Column>` names an existing nullable `Sql<'timestamp'>` column. The
reflector refuses a missing, non-nullable, or non-timestamp column. The managed
column remains on `Entity<T>` and read documents, but is absent from `CreateDTO<T>`
and `UpdateDTO<T>`; repository methods write it.

### Column-level, structural

| Tag                  | Meaning                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `Sql<T>`             | Abstract SQL type. Required: `integer`/`bigint`/`numeric` are all `number` in TS. |
| `PrimaryKey`         | Part of the primary key. Several columns → composite.                             |
| `Serial`             | Database-generated. **Absent** from `CreateDTO`, not optional in it.              |
| `Unique`             | Unique constraint.                                                                |
| `HasDefault`         | Has a database default, so **optional** on insert.                                |
| `Sensitive`          | Never serialised. `ReadDTO<T>` cannot name it.                                    |
| `References<Target>` | Foreign key target.                                                               |
| `OnDelete<Action>`   | `ON DELETE` action for the column's `References<…>` constraint.                   |
| `OnUpdate<Action>`   | `ON UPDATE` action for the column's `References<…>` constraint.                   |
| `Length<N>`          | `varchar(N)`; also emits `maxLength: N`.                                          |
| `Numeric<P, S>`      | `numeric(P, S)` precision and scale.                                              |
| `Codec<Name>`        | Names a `CustomType` codec.                                                       |
| `WireAs<W>`          | What the column looks like over the wire, when that is not its app type.          |

`WireAs<W>` is the only tag whose payload is a _type_ rather than a literal, and it has
to be: a codec's wire form is arbitrary — cents as a decimal string, a point as a pair —
so nothing but the type itself can name it. `Wire<T>` reads it, and a `Codec` column
without it is refused rather than assumed to cross unchanged (plan D4). `Sql<'timestamp'>`
and `Sql<'bigint'>` do not need it: their wire form follows from the SQL type.

`Serial` and `HasDefault` are distinct on purpose: supplying a defaulted column is
legitimate, supplying a generated one is a mistake, so one is optional and the
other does not exist in the insert type.

### Relations

`ManyToOne<Target, Fk>`, `OneToMany<Target, Fk>`, `OneToOne<Target, Fk>`,
`ManyToMany<Target, Through>`, plus `AnyRelation` and `RelationKind`.

`AnyRelation` matches a property carrying any of the four. `../derive` needs it because a
relation is **not** a column: `Entity<T>` has to exclude `author` and `comments`, or a
join target becomes something to `INSERT`. It is written `{ kind: RelationKind }` rather
than `unknown` — an optional slot typed `unknown` is satisfied by a payload of any shape,
and matching on `kind` keeps the four cardinalities the whole set.

Cardinality is deliberately **not** readable back out of a tag. The declared type already
says it: `author?: User & ManyToOne<…>` is to-one and `comments?: Comment[] &
OneToMany<…>` is to-many, natively (REQ-TF-2). A tag that has to be decoded is a tag that
can disagree with the declaration.

### Validation

`Min<N>`, `Max<N>`, `MinLength<N>`, `MaxLength<N>`, `Pattern<S>`, and `Rule<Name>`
as the named escape hatch. An unregistered `Rule` name is a build error, not a
silently skipped check (plan D4).

There is no `Enum` tag: a literal union is how you declare that, and TypeScript models
it better than a flag does (REQ-TF-2).

**Settled — plan D6.** `@zmdb/aot-validator` exports a _runtime_ vocabulary for the same five constraints, and a `ValidationRule` spells them with the IR's own keyword (`{ kind: 'minimum', value: n }`).

The runtime names used to be `Minimum`/`Maximum` against the tags' `Min`/`Max`, and `../ir`'s `normaliseKind` case-folded between them — which happened to work while accepting a great deal more than the two names that needed it. The runtime vocabulary is now `tags.Min(n)`/`tags.Max(n)`, so one spelling per constraint is the tag's, and the bridge is an explicit two-entries-per-constraint table.

The IR field keeps the JSON Schema keyword, because that is what it emits.

## 5. Coverage

`../ir/vocabulary.type-test.ts` asserts, at compile time, that every `SqlType`,
every `ColumnFlags` member and every interpreted constraint kind has a tag and an IR
field. Adding a flag without deciding how a tagged declaration expresses it fails to
compile.

## 6. Duplicate installs (plan D5)

`unique symbol` identity is nominal, so two copies of this module produce two
non-matching tags even though the source text is identical. The consequence is not a
type error at the tag or at the filter: the filter collapses to `never`, `Omit<T, never>`
is `T`, and a generated column silently becomes **required** on insert.

Reflection is name-based and therefore unaffected, so the emitted validator would
disagree with the derived type. That asymmetry is the hazard.

The guard cannot live here — a runtime check would give the tags a runtime cost — so it
lives in the reflection, which sees the escaped symbol ids (`__@zmdbSerial@1` vs
`__@zmdbSerial@12`) that the type system distinguishes. `#readTags` keeps a
basename → first-seen-escaped-name map per file and refuses the build with both spellings
named (`../../../aot-validator/src/reflect/SPEC.md` §5).

What that catches is a _file_ whose types reach two copies. A project where the declaration
consistently resolves to one copy and the derivation imports the other shows the reflector
one spelling per tag and is not caught — it is the same nominal-identity failure, one import
graph further out, and the accurate answer to it is `yarn dedupe` rather than a check.

`duplicate-install.type-test.ts` pins the current behaviour, including the trap that
`SerialKeys<Broken> extends 'id'` **passes** on a completely broken filter because
`never` is assignable to everything. Every assertion about a tagged derivation uses
exact identity for that reason.

## 7. Verified

- [x] Every tag is an optional `unique symbol` slot; no conditional types in the module.
- [x] The module has zero runtime exports (`erasure.spec.ts`).
- [x] A tagged declaration and its untagged twin emit byte-identical JavaScript.
- [x] No emitted byte mentions a tag name.
- [x] Vocabulary parity with `SqlType`, `ColumnFlags` and the constraint kinds is a compile-time gate.
- [x] The duplicate-install failure mode is asserted exactly, with `Equal` rather than assignability.

- [x] Two copies reaching one file are refused by the reflection, with both escaped names in the message.
- [x] `SoftDelete<Column>` is reflected only for an existing nullable timestamp and its managed column is absent from write DTOs.

## 8. Non-goals (rejected)

- Decorators or a runtime registry. Both have a runtime cost and both allow drift.
- A branded-primitive encoding (`string & { __brand: 'Email' }`): collides with real
  data properties and is forgeable.
- Tags for anything TypeScript already expresses.
