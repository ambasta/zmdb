> **ToDo / feature gap.** There is no GraphQL layer, and no SDL-first workflow —
> no `typePaths`, no `GraphQLDefinitionsFactory`, no type generation from a
> `.graphql` file.

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

That is the reason schema-first is unlikely ever to be the recommended path here, rather than merely unbuilt.

## Generating SDL, rather than consuming it

The direction that fits: emit the schema language from the tables. `toJsonSchema` already does this for JSON Schema, and the same traversal produces SDL:

```ts
const TYPES: Record<string, string> = {
  serial: 'Int',
  integer: 'Int',
  bigint: 'String',
  numeric: 'String',
  text: 'String',
  varchar: 'String',
  boolean: 'Boolean',
  timestamp: 'DateTime',
  json: 'JSON',
  jsonEnum: 'String',
};

export function toSdl(schema: AnySchema): string {
  const fields = Object.entries(schema.columns).map(([name, column]) => {
    const type = TYPES[column.type] ?? 'String';
    return `  ${name}: ${type}${column.nullable ? '' : '!'}`;
  });
  return `type ${pascal(schema.table)} {\n${fields.join('\n')}\n}`;
}
```

Note `bigint` and `numeric` mapping to `String` — GraphQL's `Int` is 32-bit and `Float` loses monetary precision. See [GraphQL Scalars](./web-graphql-scalars.html) for why those two rows matter more than the rest.

Generate the SDL as a build artefact, commit it, and diff it in CI. You get the thing schema-first is actually prized for — a reviewable contract — without a second source of truth:

```json
{ "scripts": { "gen:sdl": "node scripts/emit-sdl.ts > schema.graphql" } }
```

```bash
yarn gen:sdl && git diff --exit-code schema.graphql
```

A failing diff in CI means someone changed the public contract, which is precisely the review gate you want.

## If you must consume an existing SDL

You have an SDL you do not own — a partner's federated subgraph, or a contract agreed elsewhere. Then the SDL and your tables are genuinely two things, and the honest arrangement is to treat the SDL as an external interface and map to it explicitly:

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

Write a test that asserts every SDL field has a mapping, or the adapter rots.

## The introspection gap, which is the related real one

There is no `db pull` — nothing reads an existing database and emits declarations. That is the substantive missing piece in this area, and it blocks adopting zmdb against a legacy schema, [`cli-pull`](./cli-pull.html) and [`cli-studio`](./cli-studio.html).

Schema-first GraphQL and database introspection are the same shape of problem — deriving code from an external declaration — and introspection is the one with real demand.

## What it would take

An SDL emitter is small and would be welcome (the sketch above is most of it). An SDL _consumer_ — parsing `.graphql` and generating TypeScript types — would mean a GraphQL parser dependency and a code generation step, both of which sit awkwardly with the project's zero-dependency, zero-generation posture.

If GraphQL support lands, expect code-first with an SDL emitter, not schema-first.

---

See also: [GraphQL Resolvers](./web-graphql-resolvers.html) · [GraphQL Scalars](./web-graphql-scalars.html) · [Schema Introspection](./cli-pull.html)
