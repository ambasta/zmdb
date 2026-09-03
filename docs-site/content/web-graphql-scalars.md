> **Not planned.** There is no GraphQL layer, so there are no scalars to define —
> no `GraphQLScalarType` registration, no `@Scalar` decorator, no scalar mapping
> from column types — and [that is not changing](./web-graphql.html). The mapping
> below is kept because it is the one written-down answer to what each `SqlType`
> means in a schema language, and because the two-parse-path trap it documents bites
> anyone writing a custom scalar by hand.

## The related constraint that does exist

`SqlType` is a **closed union of ten members**:

```
serial · integer · bigint · numeric · text · varchar · boolean · timestamp · json · jsonEnum
```

You cannot add an eleventh. That is the same limitation that blocks [database extension types](./db-extensions.html), [vector search](./guide-vector-search.html), [PostGIS](./guide-postgis.html) and `citext` — and it is what a scalar mapping would have to build on, so the two gaps are connected.

The upside is that the mapping is small and total. It is not, however, keyed by column type — see below.

## The mapping, as frozen

The design is frozen in `packages/schema-core/src/sdl/SPEC.md`, and the first thing it settles is what the
mapping is a function of. Not `SqlType`: the emitter reads the column's **wire type**, because a
`Money & Sql<'integer'> & Codec<'Money'> & WireAs<string>` column is an integer in the database and a string on
the wire, and a table keyed by the SQL type emits `Int` for a field the resolver returns as a string. There is
also a verifier — `yarn verify:one-walker` — that exists to stop a second walker over column metadata, and a
private `SqlType` table is exactly that.

Reading the wire type instead, the results land where you would expect:

| Column               | GraphQL                                                       |
| -------------------- | ------------------------------------------------------------- |
| `serial`, `integer`  | `Int`                                                         |
| `bigint`             | `BigInt` (custom — a decimal string; `Int` is 32-bit)         |
| `numeric`            | `Float`, unless the column declares `WireAs<string>`          |
| `text`, `varchar`    | `String`                                                      |
| `boolean`            | `Boolean`                                                     |
| `timestamp`          | `DateTime` (custom — an ISO 8601 string)                      |
| `jsonEnum`           | an `enum`, one value per declared member                      |
| `json`               | the payload's own named type — or a build error, never `JSON` |
| a `WireAs<W>` column | whatever `W` maps to                                          |

Four rows are the ones that bite.

**`bigint` must not be `Int`.** GraphQL's `Int` is a signed 32-bit integer, so anything above 2,147,483,647 is a serialization error at best and a wrong value at worst. Serialise it as a string, which is what the column's wire type already says it is.

**`numeric` is `Float`, and that is a consequence of the declaration rather than a recommendation.** A monetary amount through a double loses precision — `0.1 + 0.2` is the canonical demonstration, and it shows up in production as a total that is a cent off. But a `numeric` column's app type is `number`, so `Entity<T>` has a `number` and your resolver returns one; emitting `String` for it would make the schema disagree with the value, which fails in the client's parser instead of in your arithmetic. The fix is upstream of GraphQL: declare the wire form you want, with `Codec<'Money'> & WireAs<string>`, and every surface — JSON Schema, OpenAPI and SDL — follows. **A degradation has to be requested in the declaration; the emitter never picks one for you.**

**`timestamp`** needs a scalar that serialises to ISO 8601 in UTC. A `Date` through `JSON.stringify` gives you ISO already; the value of a scalar is parsing on the way _in_, where a malformed string should be an error rather than an `Invalid Date` that propagates.

**`jsonEnum` is an `enum`, and `json` is a named type or nothing.** A `'free' | 'pro' | 'enterprise'` column is exactly expressible, so emitting `String` for it would throw away a constraint GraphQL is happy to carry. A `json` column with a declared payload becomes that payload's named object type; a `json` column with no declared payload is a **build error**, because the only thing left to emit is a `JSON` scalar — and that is the next section's problem, not a fallback.

## Writing the scalars

```ts
import { GraphQLScalarType, Kind } from 'graphql';

function parseDateTime(value: unknown): Date {
  if (typeof value !== 'string') throw new TypeError('DateTime must be a string');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('DateTime is not a valid date');
  return date;
}

const DateTime = new GraphQLScalarType({
  name: 'DateTime',
  serialize: value => {
    if (!(value instanceof Date)) throw new TypeError('DateTime must serialize a Date');
    return value.toISOString();
  },
  parseValue: parseDateTime,
  parseLiteral: (ast, variables) => {
    if (ast.kind === Kind.VARIABLE) {
      const value = variables?.[ast.name.value];
      if (value === undefined) throw new TypeError(`DateTime variable $${ast.name.value} was not provided`);
      return parseDateTime(value);
    }
    if (ast.kind !== Kind.STRING) throw new TypeError(`DateTime cannot be a ${ast.kind}`);
    return parseDateTime(ast.value);
  },
});
```

Throw on invalid input rather than returning `null`. A scalar that silently coerces is how `Invalid Date` reaches a database column — and returning `null` for a non-string literal, which is the shape most examples use, is that same bug with a friendlier face: a typo in a query document becomes a null column.

Note the two parse paths, because a scalar that implements one is broken for the other and the break is invisible in tests that only use variables. A **variable** arrives as an already-parsed JSON value and goes to `parseValue`; a **literal** written into the query document arrives as an AST node and goes to `parseLiteral`. The frozen design derives the second from the first — convert the node to a JSON value, then call `parseValue` — so one implementation serves both and they cannot disagree. `$when` inside a literal is why `parseLiteral` receives `variables` at all.

## The `JSON` scalar is a hole in your schema

```ts
const JSONScalar = new GraphQLScalarType({ name: 'JSON', serialize: v => v, parseValue: v => v });
```

Convenient and a genuine risk. It accepts arbitrary depth and size — a nested payload is a parser denial-of-service — and it puts unvalidated data into your application.

It is also the reason the frozen design emits no `JSON` scalar at all, and never falls back to one. A schema with a `JSON` escape hatch always emits successfully, so every construct GraphQL cannot express stops being a build error and becomes a field that no longer describes its data — discovered by a client, months later. A build error names the field.

Validate the contents at the boundary, which is where the AOT validator does more than any scalar could:

```ts
const settings = assert<{ theme: 'light' | 'dark'; notifications: boolean }>(args.settings);
```

`jsonEnum` in a schema constrains the column to a known set, so prefer it over free-form `json` where the shape is known. See [JSON Columns](./json-properties.html).

## Validation lives in the column, not the scalar

A scalar validates a wire format. Your business rules belong on the column, where every write path enforces them regardless of which surface the request came in through:

```ts
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<320> & Pattern<'^\\S+@\\S+$'>;
}
```

An email scalar plus a column rule is the rule written twice. Put it on the column, and REST, a CLI backfill and whatever GraphQL server you run in front all get it.

## What it would have taken

The design is frozen, in `packages/schema-core/src/sdl/SPEC.md`, and neither function is being written. Two of them, neither a table of `SqlType` members:

```ts
sdlOf<Entity<Post>>('Post'); // the type, walking the shared IR
scalar('DateTime', dateTimeCodec); // a named scalar, from the wire half of a codec
```

`scalar` takes the `toWire`/`fromWire` pair — the JSON crossing — and not `encodeValue`/`decodeValue`, which apply `toDb`/`fromDb` and are the _database_ crossing. A scalar built on the database pair would send a driver's representation to a browser. Since `CustomType` declares all four, a column's own custom type can be handed straight to `scalar` with no adapter.

The scalars are constructed with a `GraphQLScalarType` you pass in, so `graphql` stays out of zmdb's dependencies entirely — not even as a peer.

It only becomes useful once [the GraphQL layer exists](./web-graphql-resolvers.html), so it is downstream of that work.

---

See also: [Column Types](./column-types.html) · [JSON Columns](./json-properties.html) · [Database Extensions](./db-extensions.html)
