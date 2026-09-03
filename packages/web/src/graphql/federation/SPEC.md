# SPEC — federation: the directive set, key derivation, and reference resolvers (frozen, not planned)

> **Not planned.** GraphQL is out of scope for zmdb: the epics and every sub-issue under
> them are closed as wontfix, and no code in this tree implements this document. It stays
> frozen as the record of what was decided and why — the failure modes it names are the
> ones anyone building this outside zmdb will meet.

Part of `@zmdb/web`, exported from the `./graphql` subpath, with the emission half in
`@zmdb/schema-core/sdl`. `../SPEC.md` owns resolvers; this file owns what makes a subgraph composable.

The deliverable is **a subgraph schema a real composer accepts**, not a gateway. The epic's non-goal says so
and the reason is worth keeping in front of the reader: a federated schema that is subtly wrong composes
successfully and then resolves the wrong thing at runtime, in the gateway, in a different service from the one
that got it wrong. So every rule here is written to fail at build time instead, and the arbiter of correctness
is a real composer in CI (§7) rather than this document's reading of the specification.

## 1. Directives are tags, because an entity is an interface

The issue spells the federation surface as decorators — `Key(fields): ClassDecorator`,
`External(): PropertyDecorator`. **None of those positions exist.** A zmdb entity is a TypeScript `interface`,
and an interface has no class to decorate and no fields that can carry a decorator; `PropertyDecorator` is also
the legacy decorator type, which Stage 3 does not have at all. So federation metadata travels the way every
other declarative fact about a column travels — as an intersection tag, in `@zmdb/schema-core/tags`:

```ts
export type Key<Fields extends string> = { readonly [zmdbKey]?: Fields };
export type External = { readonly [zmdbExternal]?: true };
export type Requires<Fields extends string> = { readonly [zmdbRequires]?: Fields };
export type Provides<Fields extends string> = { readonly [zmdbProvides]?: Fields };
export type Shareable = { readonly [zmdbShareable]?: true };
```

`Key` sits on the type (alongside `Table<'…'>`); the other four sit on fields. This is the same mechanism
`../../../../schema-core/src/sdl/SPEC.md` §14.2 uses for `Deprecated<Reason>`, and for the same reason: the
emitter has no runtime, so it can only read what the type carries.

The one genuine decorator is `@ResolveReference`, because it goes on a **resolver class method**, which is a
position Stage 3 does have (§5).

## 2. `@key` comes from the primary key, and a second declaration would drift

```ts
export interface Product extends Table<'products'> {
  sku: string & Sql<'text'> & PrimaryKey;
  name: string & Sql<'text'>;
}
```

→ `type Product @key(fields: "sku")`.

**Nothing is written twice.** The key fields come from `PrimaryKey`, which already exists, is already what the
DDL uses, and is already what `findById` reads — so `@key` cannot disagree with the row's actual identity. A
`Key<'sku'>` tag that restated it would be a second declaration of the same fact and would eventually say
something different from the primary key, at which point the gateway resolves entities by one identity and the
database by another.

`Key<Fields>` exists for the two cases the primary key cannot express:

| Case                  | Declaration                                   | Emitted                                 |
| --------------------- | --------------------------------------------- | --------------------------------------- |
| a compound key        | `Key<'tenantId sku'>`                         | `@key(fields: "tenantId sku")`          |
| an additional key     | `Key<'sku'> & Key<'upc'>` is **refused** (§3) | —                                       |
| a non-resolvable stub | `Key<'id'> & NotResolvable`                   | `@key(fields: "id", resolvable: false)` |

A field set is a space-separated list of field names, matching the federation syntax, and **every name in it
must be a declared field of that type or the build fails** naming the type, the directive and the missing name.
A `@key` that names a field the type does not have is the canonical federation mistake: the composer may accept
it, and entity resolution then fails at runtime for one field path.

## 3. What is refused, and where

Each of these is a build-time error from the emitter, with the type name and the field name in the message.

| Refused                                                         | Because                                                                                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a field set naming an undeclared field                          | §2 — resolves to nothing at runtime, and the composer may not catch it.                                                                                    |
| `External` on a field of a `Table<…>` interface                 | §4 — it would emit a column for data this service does not own.                                                                                            |
| `Requires<F>` on a field whose `F` names a non-`External` field | The federation rule: `@requires` selects fields the subgraph does not resolve itself.                                                                      |
| `Requires`/`Provides` on a type with no `@key`                  | Both are entity-only. Silently ignored by a composer, so it must not be silent here.                                                                       |
| two `Key` tags on one type                                      | Intersection would give one string, arbitrarily. Multiple keys are a real feature and are a non-goal until one declaration can express them unambiguously. |
| `Provides<F>` on a field whose type is not an entity            | Nothing to provide — the target has no `@key`.                                                                                                             |
| any federation tag with no `subgraph` option set (§6)           | The tags would be read and nothing emitted, which is the quietest possible failure.                                                                        |

## 4. `External` cannot go on a column, and that is the finding

`@external` means "another subgraph owns this field; it appears here so I can reference it". In zmdb the entity
interface is what generates the DDL, so a tag on a column of a `Table<…>` interface would create a column in
**this** service's table for data another service owns — a duplicated, never-written, silently stale column.
That is worse than the missing feature.

So an entity this subgraph extends but does not own is declared as a plain interface, with no `Table<…>`:

```ts
/** Owned by the users subgraph. Not a table here — nothing in this service stores it. */
export interface User {
  id: number & Sql<'integer'> & PrimaryKey;
  email: string & Sql<'text'> & External;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  /** Needs the owner's email to compute; the gateway fetches it and hands it over. */
  receiptTo?: string & Requires<'email'>;
}
```

An interface with no `Table<…>` never reaches the DDL walk, never appears in a migration and has no repository
— so "this service does not store it" is enforced by the absence of a table name rather than by a convention.
The emitter refuses `External` on anything that does have one, naming the field, because that mistake is
otherwise found by a migration review months later.

## 5. `@ResolveReference` is typed from the key, not from `any`

```ts
export declare function ResolveReference(): (target: Function, context: ClassMethodDecoratorContext) => void;

/** The representation a gateway sends: `__typename` plus exactly the key fields. */
export type Reference<T, K extends keyof T> = { readonly __typename: string } & Readonly<Pick<T, K>>;
```

```ts
@Resolver('Product')
class ProductResolver {
  @Inject(PRODUCTS) private readonly products!: ProductRepo;

  @ResolveReference()
  product(ctx: GqlCtx<Reference<Entity<Product>, 'sku'>, undefined, AppContext>) {
    return this.products.findOne({ sku: { eq: ctx.parent.sku } });
  }
}
```

**Both sides come from the key declaration.** `Reference<Entity<Product>, 'sku'>` is a `Pick`, so a resolver
that reads `ctx.parent.id` when the key is `sku` does not compile, and the return type is checked against the
entity by the same `implements ResolversOf<F, R>` the rest of the package uses (`../SPEC.md` §1). The gateway
sends a representation containing only the key fields and `__typename`; typing it as anything wider is how a
reference resolver comes to depend on a field that is not actually there.

`Reference`'s `K` is **not** inferred from the tags — a type-level parse of a space-separated field set is
possible and unreadable. It is written once, next to the resolver, and `#552` pins that a mismatch with the
declared key is a compile error via a type-test.

The method lands in the resolver map under `__resolveReference`, which is the key
`buildSubgraphSchema` reads. No new machinery: it is one more entry in the plain map `parts()` already returns.

## 6. The subgraph prelude, and what stays the app's

A Federation 2 subgraph must opt in with a schema-level `@link`, or a composer treats it as Federation 1 and
composes something different. That is a document-level statement, so it cannot come from `sdlOf<T>` — it comes
from the registry:

```ts
createGraphqlRegistry({
  types: [sdlOf<Entity<Order>>('Order'), sdlOf<User>('User'), sdlFields<OrderQueries>('Query')],
  subgraph: { version: 'v2.3' },
});
```

→ `typeDefs` begins with

```graphql
extend schema @link(url: "https://specs.apollo.graphql.org/federation/v2.3", import: ["@key", "@external", "@requires"])
```

**The `import` list contains only the directives actually emitted.** Importing a directive nothing uses is
harmless and importing one that is used is mandatory, so computing the list from the emitted output removes the
failure mode entirely — a new tag cannot be forgotten in the prelude.

`version` is **dated vendor data**, the same treatment `../../../../schema-core/src/sdl/SPEC.md` §8.1 gives
`graphql`'s `Kind` strings: `v2.3` is pinned as a conservative baseline that covers every directive in §1, it
is a string in the specification's own URL space rather than something we control, and §7 is what makes a wrong
choice a red build rather than a subtly wrong schema. It is an option and not a constant precisely because the
right answer changes without us.

**`_service` and `_entities` are not emitted.** They are the subgraph protocol's two synthetic root fields, and
`buildSubgraphSchema({ typeDefs, resolvers })` from `@apollo/subgraph` adds them — from exactly the two things
`parts()` already returns. So a federated app calls `buildSubgraphSchema` where a plain app calls
`createSchema`, which is the boundary `../SPEC.md` §6 already drew, one line further along. Emitting them
ourselves would mean re-implementing a protocol that the library the app is already using implements, and
getting the entity-resolution dispatch subtly wrong is the exact failure this file exists to avoid.

## 7. Composition is validated against a real composer, in CI

**Not against our reading of the specification.** `#552` composes the emitted subgraph with a second, fixed
subgraph SDL and asserts the composition succeeds and that the supergraph contains the entity join:

```ts
const result = composeServices([
  { name: 'orders', typeDefs: parse(registry.parts().typeDefs) },
  { name: 'users', typeDefs: parse(USERS_SUBGRAPH) },
]);
expect(result.errors).toBeUndefined();
```

`@apollo/composition` and `graphql` are **devDependencies**. That is consistent rather than a reversal:
`../SPEC.md` §9 already requires the resolver tests to run "against the real `graphql` engine rather than a
stub", so `graphql` is already a devDependency of the test suite while being absent from the published
dependency graph. A composer is the same arrangement one step out.

A negative case matters as much: a deliberately broken subgraph — a `@requires` naming a field the other
subgraph does not own — must produce composition **errors**, so the test proves the composer is actually
running and not silently passing everything.

## 8. What #552 has to assert

1. `emits @key from the primary key` — golden SDL, and that no `Key` tag was needed.
2. `emits a compound key from Key<'a b'>` — including the exact space-separated spelling.
3. `refuses a key naming an undeclared field` — the message contains the type and the missing name.
4. `refuses External on a column of a table interface` — §4, the message naming the field, because the
   alternative is a column in a migration.
5. `refuses Requires whose field set names a non-external field` — and refuses `Requires`/`Provides` on a type
   with no key. Three refusals, each naming the position.
6. `emits the federation link prelude with only the directives used` — two fixtures, one using `@requires` and
   one not, asserting the `import` arrays differ.
7. `puts a reference resolver in the map under __resolveReference` — by identity, and that it is absent when no
   method is decorated.
8. `a reference resolver's parent is exactly the key fields` — type-test: reading a non-key field does not
   compile, and `Reference<Entity<Product>, 'id'>` against a `sku` key is an error.
9. `composes with a real composer` — §7, plus the negative case producing errors.
10. `federation tags emit nothing without the subgraph option` — the refusal in §3's last row, so a
    half-configured registry cannot silently ship a non-federated schema.

## Non-goals (rejected)

- **No gateway and no router.** The epic's own non-goal. A composable subgraph is the deliverable; composition
  is somebody else's product and validating against it (§7) is worth more than reimplementing it.
- **No decorators for `@key`/`@external`/`@requires`/`@provides`.** §1 — an interface has no decoratable
  position, and `PropertyDecorator` does not exist under Stage 3.
- **No `_service` or `_entities` emission.** §6 — `buildSubgraphSchema` is one line in the app, at the boundary
  that already exists.
- **No multiple `@key` directives on one type.** §3 — an intersection of two `Key` tags collapses to one
  string with no defined winner. Deferred until a declaration can say it once.
- **No inferred `K` for `Reference<T, K>`.** §5 — parsing a space-separated field set at the type level is
  possible and unreadable, and the type-test catches the mismatch anyway.
- **No `@interfaceObject`, `@tag`, `@inaccessible`, `@override` or `@composeDirective`.** Each needs a
  declaration position and a failure story of its own, and shipping one whose emission is untested is how a
  schema comes to claim something the runtime does not do.
- **No hand-written SDL fragment for a federated type.** The epic's architecture constraint: directives come
  from declarations so they cannot drift, which is the same argument §2 makes for the key itself.
- **No advice to federate.** `docs-site/content/web-graphql-federation.md` argues that most applications
  reaching for federation want one deployable with real module boundaries, and that section stays. This makes
  the subgraph correct for the applications that genuinely need one; it does not become a recommendation.
