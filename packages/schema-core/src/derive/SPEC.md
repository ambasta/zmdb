# Derived DTOs from a Tagged Type — Spec (PRD §6.7 REQ-TF-4 … REQ-TF-6)

> Part of `@zmdb/schema-core` (module `src/derive/`). Types only; no runtime export.
> Design: `DESIGN-type-first.md` §4.2, `PLAN-type-first.md` Phase 3.

## 1. One set of names

These are the same names the schema-value derivations in `../index.ts` use, and that
is deliberate: per plan D2 there is to be exactly one `Entity`/`CreateDTO`/`UpdateDTO`,
and these are the ones that survive. They live in a separate module only so the
repository, the web package and every fixture keep compiling while the migration runs;
Phase 9 deletes the schema-value versions and re-points the package root here.

Every derivation takes a tagged type and nothing else. There is no conditional
dispatch on `{ columns: … }` — backwards compatibility is not a requirement (plan D2),
which also means no per-use `extends` test and no instantiation cost from a dispatch.

## 2. Key filters

```ts
type KeysCarrying<T, Tag> = {
  [K in keyof T]-?: NonNullable<T[K]> extends Tag ? (K extends string ? K : never) : never;
}[keyof T];
```

| Export              | Selects                                 |
| ------------------- | --------------------------------------- |
| `SerialKeys<T>`     | `Serial` — database-generated           |
| `DefaultKeys<T>`    | `HasDefault`                            |
| `PrimaryKeyKeys<T>` | `PrimaryKey`                            |
| `SensitiveKeys<T>`  | `Sensitive`                             |
| `UniqueKeys<T>`     | `Unique`                                |
| `NullableKeys<T>`   | `null extends T[K]` — native, not a tag |

Three details are load-bearing:

- **`NonNullable<T[K]>`, not `T[K]`.** A nullable defaulted column is declared
  `(string & HasDefault) | null`, and `null` is not assignable to a weak object type,
  so the union as a whole does not match `HasDefault`. Testing the non-nullable arm is
  what makes such a column optional on insert instead of required.
- **`-?` on the probe**, so an already-optional property is still examined under
  `exactOptionalPropertyTypes`.
- **`K extends string`**, so entity-level tags (`Table`, `Fts`) arriving through
  `extends` never show up in `keyof`.

## 3. The DTO suite

| Type              | Shape                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| `Entity<T>`       | Every column, required, sensitive included, tags preserved.             |
| `CreateDTO<T>`    | `Serial` columns **absent**; `HasDefault` columns present and optional. |
| `UpdateDTO<T>`    | `Serial` and `PrimaryKey` dropped; everything else optional.            |
| `WhereDTO<T>`     | Every column optional.                                                  |
| `ReadDTO<T>`      | `Sensitive` columns removed.                                            |
| `PrimaryKeyOf<T>` | Scalar for one key, object map for a composite, `unknown` for none.     |

`CreateDTO` omits a generated column rather than making it optional. Supplying a
defaulted column is legitimate; supplying a generated one is a mistake, so the two
tags produce different shapes — that is the whole reason they are separate tags.

Tags survive every derivation. If a derivation dropped one, the AOT would emit a
weaker check for the update path than for the insert path, silently (REQ-TF-5). The
type tests assert the full intersection, tags included, on both.

`PrimaryKeyOf` is named for plan D1 so the _tag_ can be `PrimaryKey` — which is the
name typed at every declaration site.

## 4. The wire shape (plan D3 / REQ-TF-13)

`Entity<T>` is the **app** type. `Wire<T>` and `WireCreateDTO<T>` are what a JSON body
actually contains: a `timestamp` becomes `string` and a `bigint` becomes `string`,
because neither survives JSON. Nullability is carried through (`string | null`). The
web pipeline decodes wire → app once at the boundary so handlers keep seeing `Date`.

## 5. Test strategy: exact identity, never assignability

Every assertion about a derivation uses `Expect<Equal<…>>`.

A key filter that stops matching resolves to `never`, and `never` is assignable to
everything — so `SerialKeys<User> extends 'id'` passes even when the filter is
completely broken, and `Omit<T, never>` is `T`, and `Partial<Pick<T, never>>` is `{}`.
The first probe written for plan D5 was fooled by exactly that and reported success
while no tag was matching at all. `../tags/duplicate-install.type-test.ts` records the
trap as `_D6_asserts_nothing` so nobody lays it again.

## 6. Verified

- [x] All six key filters return the exact expected key union, and `never` where nothing matches.
- [x] Entity-level tags do not leak into `keyof Entity<T>`.
- [x] A nullable defaulted column is optional on insert, not required.
- [x] `id` is absent from `CreateDTO`; supplying it is a compile error (`@ts-expect-error`).
- [x] Constraint tags survive `Omit`, `Pick` and `Partial` on both the insert and update paths.
- [x] Reading a `Sensitive` column off a `ReadDTO` is a compile error.
- [x] `PrimaryKeyOf` yields a scalar for a single key and an object map for a composite one.
- [x] `Wire<T>['createdAt']` is `string` while `Entity<T>['createdAt']` is `Date & …`.
- [x] The module has zero runtime exports (`../tags/erasure.spec.ts`).

## 7. Non-goals (rejected)

- A conditional dispatch accepting either a schema value or a tagged type. It existed
  only to keep `Entity<typeof UserSchema>` compiling, and it costs an `extends` test at
  every use (plan D2).
- Making a generated column optional on insert rather than absent.
- Runtime stripping as the mechanism for `Sensitive`. The type must make the leak
  impossible; stripping is the belt, not the braces.
