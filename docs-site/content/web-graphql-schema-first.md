> **Not planned.** `@zmdb/web` has no SDL-first workflow because
> [GraphQL is out of scope](./web-graphql.html). More generally, zmdb derives
> external schemas from TypeScript declarations instead of treating SDL or
> OpenAPI documents as a second source of truth.

## Why the project is code-first by construction

Schema-first means the SDL is the source of truth and your types are generated from it. zmdb's central design decision points the other way: the TypeScript declaration is the source of truth, and everything else is _derived_ from it —

```ts
import type { HasDefault, Length, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'varchar'> & Length<200>;
  published: boolean & HasDefault;
}
```

```ts
type Row = Entity<Post>; // the row
type NewPost = CreateDTO<Post>; // the insert shape
const schema = toJsonSchema(schemaOf<Post>(), 'create'); // JSON Schema / OpenAPI
const validate = assert<NewPost>; // AOT-compiled validator
const sql = compiler.selectFrom('posts'); // typed queries
const migration = diff(previous, snapshot([schemaOf<Post>()]));
```

Six derived artefacts, one declaration, and none of them can drift. Adding an SDL file as a second source of truth would reintroduce exactly the duplication the derivation exists to remove — and the drift would be silent, because nothing checks an SDL file against a table.

That is the reason schema-first is frozen as refused rather than merely unbuilt — see "What it would have taken" below, where even the emitter half is now out of scope.

## Generating SDL, rather than consuming it

The direction that fits: emit the schema language from the tables. `toJsonSchema` already does this for JSON Schema, and the same IR produces SDL — which is what the frozen design does, one function per named type:

```ts
const sdl = [
  sdlOf<Entity<Post>>('Post'),
  sdlOf<CreateDTO<Post>>('CreatePost', { kind: 'input' }),
  sdlFields<PostQueries>('Query'),
].join('\n\n');
```

A hand-written version would use a `Record<SqlType, string>` lookup over
`schema.columns`. That design was rejected for three reasons:

- A table keyed by the **SQL** type is wrong for any column that declares a wire form: `Codec<'Money'> & WireAs<string>` is `integer` in the database and a string on the wire, so the lookup emits `Int` for a field your resolver returns as a string.
- `?? 'String'` is a silent degradation. Every construct GraphQL cannot express — a tuple, a map, an anonymous nested object — becomes a `String` field that no longer describes its data, and nothing fails.
- It is a fifth walker over column metadata, and `yarn verify:one-walker` exists because there were four and no two of them agreed. The emitter reads the shared IR for exactly this reason.

`nullable ? '' : '!'` is the fourth problem, and the subtlest: a column can be non-nullable and still optional — `HasDefault` makes it optional on insert — so the `!` has to follow the position, not the column. See [GraphQL Scalars](./web-graphql-scalars.html) for the frozen mapping, including why `bigint` is a string and `numeric` is not.

Generate the SDL as a build artefact, commit it, and diff it in CI. You get the thing schema-first is actually prized for — a reviewable contract — without a second source of truth:

```json
{ "scripts": { "gen:sdl": "node scripts/emit-sdl.ts > schema.graphql" } }
```

```bash
yarn gen:sdl && git diff --exit-code schema.graphql
```

A failing diff in CI means someone changed the public contract, which is precisely the review gate you want.

## If you must consume an existing SDL

You have an SDL you do not own — a partner's federated subgraph, or a contract agreed elsewhere. Then the SDL and your tables are genuinely two things, and the clean arrangement is to treat the SDL as an external interface and map to it explicitly:

```ts
const resolvers = {
  Query: {
    post: async (_: unknown, args: unknown) => {
      const { id } = assert<{ id: number }>(args);
      const row = await posts.findById(id);
      return row === undefined ? null : { id: row.id, title: row.title, isPublished: row.published };
    },
  },
};
```

The explicit field mapping (`isPublished` from `published`) is the adapter layer. Verbose, and it means a rename in either place is a compile error rather than a silent mismatch.

Write a test that asserts every SDL field has a mapping, or the adapter rots. `sdlDiff` (below) is that test for the subset of the SDL you also emit; the hand-written mapping is what covers the rest.

## The introspection gap, which is the related real one

There is no `db pull` — nothing reads an existing database and emits
declarations. That is the substantive missing piece in this area, and it blocks
adopting zmdb against a legacy schema and [`cli-pull`](./cli-pull.html).
[`cli-studio`](./cli-studio.html) is deliberately narrower: it browses the
declarations already selected by the config and does not introspect the
database.

Schema-first GraphQL and database introspection are the same shape of problem — deriving code from an external declaration — and introspection is the one with real demand.

## What it would have taken

The direction is frozen, in `packages/schema-core/src/sdl/SPEC.md` §11: an SDL **emitter**, and no SDL consumer. Neither half is being built — the emitter went out of scope with the rest of GraphQL — but the asymmetry is the part worth keeping, because it is why `db pull` above is a different question with a different answer.

The emitter is what the section above describes — `sdlOf` and `sdlFields` over the shared IR, a committed `schema.graphql`, and `git diff --exit-code` in CI. Nothing here parses GraphQL, so `graphql` is not a dependency, not a peer, and not an optional peer.

An SDL _consumer_ — parsing `.graphql` and generating TypeScript types — is refused for the same reason generating validators from an OpenAPI document is refused: it is a second code generation front end, and `ARCHITECTURE.md` §2.9 allows one. The transform reads types from the TypeScript checker; a generator that reads SDL instead would be a parallel path with its own idea of what a nullable field means, describing a document somebody else owns.

What you get instead, for the case where you genuinely have someone else's SDL, is a comparison rather than a generator:

```ts
import { parse } from 'graphql';

const drift = sdlDiff(parse, theirDocument, ourSchema);
```

`parse` is passed in, so the GraphQL parser is the application's dependency and not zmdb's. The result names every field where the two disagree — a field they declare that you do not emit, a nullability mismatch, a type mismatch — which is the assertion the section below asks you to write by hand, done once.

The compile-time half of that is `ResolversOf<F>`: your resolver class declares `implements ResolversOf<PostQueries>`, so a signature that drifts from the emitted schema fails to compile at the `implements` clause rather than at a call site.

---

See also: [GraphQL Resolvers](./web-graphql-resolvers.html) · [GraphQL Scalars](./web-graphql-scalars.html) · [Schema Introspection](./cli-pull.html)
