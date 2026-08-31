> **ToDo / feature gap.** There is no GraphQL layer, so there are no scalars to
> define — no `GraphQLScalarType` registration, no `@Scalar` decorator, no scalar
> mapping from column types.

## The related constraint that does exist

`SqlType` is a **closed union of ten members**:

```
serial · integer · bigint · numeric · text · varchar · boolean · timestamp · json · jsonEnum
```

You cannot add an eleventh. That is the same limitation that blocks [database extension types](./db-extensions.html), [vector search](./guide-vector-search.html), [PostGIS](./guide-postgis.html) and `citext` — and it is what a scalar mapping would have to build on, so the two gaps are connected.

The upside is that a scalar table would be small and total: ten column types, one GraphQL scalar each.

## What a mapping would look like

| Column type         | GraphQL                                       |
| ------------------- | --------------------------------------------- |
| `serial`, `integer` | `Int`                                         |
| `bigint`            | `BigInt` (custom — exceeds `Int`)             |
| `numeric`           | `String` or a `Decimal` scalar, never `Float` |
| `text`, `varchar`   | `String`                                      |
| `boolean`           | `Boolean`                                     |
| `timestamp`         | `DateTime` (custom)                           |
| `json`, `jsonEnum`  | `JSON` (custom), or a typed object            |

Three rows there are the ones that bite.

**`bigint` must not be `Int`.** GraphQL's `Int` is a signed 32-bit integer, so anything above 2,147,483,647 is a serialization error at best and a wrong value at worst. Serialise it as a string.

**`numeric` must not be `Float`.** A monetary amount through a double loses precision — `0.1 + 0.2` is the canonical demonstration, and it shows up in production as a total that is a cent off. Carry it as a string and parse it with a decimal library on the client. zmdb's drivers already return `numeric` as a string for exactly this reason.

**`timestamp`** needs a scalar that serialises to ISO 8601 in UTC. A `Date` through `JSON.stringify` gives you ISO already; the value of a scalar is parsing on the way _in_, where a malformed string should be an error rather than an `Invalid Date` that propagates.

## Writing the scalars

```ts
import { GraphQLScalarType, Kind } from 'graphql';

const DateTime = new GraphQLScalarType({
  name: 'DateTime',
  serialize: value => {
    if (!(value instanceof Date)) throw new TypeError('DateTime must serialize a Date');
    return value.toISOString();
  },
  parseValue: value => {
    if (typeof value !== 'string') throw new TypeError('DateTime must be a string');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError('DateTime is not a valid date');
    return date;
  },
  parseLiteral: ast => (ast.kind === Kind.STRING ? new Date(ast.value) : null),
});
```

Throw on invalid input rather than returning `null`. A scalar that silently coerces is how `Invalid Date` reaches a database column.

## The `JSON` scalar is a hole in your schema

```ts
const JSONScalar = new GraphQLScalarType({ name: 'JSON', serialize: v => v, parseValue: v => v });
```

Convenient and a genuine risk. It accepts arbitrary depth and size — a nested payload is a parser denial-of-service — and it puts unvalidated data into your application.

Validate the contents at the boundary, which is where the AOT validator does more than any scalar could:

```ts
const settings = assert<{ theme: 'light' | 'dark'; notifications: boolean }>(args.settings);
```

`jsonEnum` in a schema constrains the column to a known set, so prefer it over free-form `json` where the shape is known. See [JSON Columns](./json-properties.html).

## Validation lives in the column, not the scalar

A scalar validates a wire format. Your business rules belong on the column, where every write path enforces them regardless of which surface the request came in through:

```ts
const users = defineSchema('users', {
  id: serial(),
  email: varchar(320).notNull().validate({ kind: 'email', message: 'invalid email' }),
});
```

An email scalar plus a column rule is the rule written twice. Put it on the column, and REST, GraphQL and a CLI backfill all get it.

## What it would take

A `toGraphQLType(schema)` function alongside `toJsonSchema`, mapping the ten `SqlType` members to type nodes, plus the custom scalars above. Small and well-defined — the ten-member closed union that constrains other features makes _this_ one easy.

It only becomes useful once [the GraphQL layer exists](./web-graphql-resolvers.html), so it is downstream of that work.

---

See also: [Column Types](./column-types.html) · [JSON Columns](./json-properties.html) · [Database Extensions](./db-extensions.html)
