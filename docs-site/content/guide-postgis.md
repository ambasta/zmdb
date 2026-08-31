> **ToDo / feature gap.** `SqlType` has no `geometry` or `geography`, so PostGIS
> columns cannot be declared in `defineSchema`, and `IndexDef` cannot emit
> `USING GIST`.

## What works today

PostGIS is an extension and the driver takes raw SQL, so the functionality is available — the schema declaration is not.

**Migration** ([custom migration](./migrations-custom.html)):

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE venues (
  id serial PRIMARY KEY,
  name text NOT NULL,
  location geography(Point, 4326) NOT NULL
);

CREATE INDEX venues_location_gist ON venues USING GIST (location);
```

`geography` versus `geometry` is the first real decision:

|                             | `geometry`                     | `geography` |
| --------------------------- | ------------------------------ | ----------- |
| Model                       | flat plane                     | spheroid    |
| Distance units              | degrees (meaningless for 4326) | **metres**  |
| Speed                       | faster                         | slower      |
| Correct over long distances | no                             | yes         |

For "venues within 5km" use `geography`, where `ST_DWithin` takes metres. With `geometry(Point, 4326)`, `ST_DWithin(a, b, 5000)` means 5000 _degrees_ — a filter that matches everything, silently. This is the most common PostGIS bug and it produces no error.

## Inserting

```ts
await driver.execute({
  text: 'INSERT INTO venues (name, location) VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326))',
  parameters: [name, lon, lat],
});
```

`ST_MakePoint(x, y)` is **longitude first**. Every mapping API hands you `lat, lng`, so this is where coordinates get swapped — and swapped coordinates are valid points, so nothing errors; your London venue is just in the Atlantic.

## Radius search

```ts
const rows = await driver.execute({
  text: `SELECT id, name,
                ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS metres
         FROM venues
         WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         ORDER BY metres
         LIMIT $4`,
  parameters: [lon, lat, radiusMetres, 20],
});
```

Use `ST_DWithin` in the `WHERE`, not `ST_Distance(...) < r`. Only `ST_DWithin` uses the GIST index; the comparison form computes a distance for every row in the table. Same class of mistake as ordering by a computed alias in [vector search](./guide-vector-search.html).

## Typing the results

```ts
interface Venue {
  id: number;
  name: string;
  metres: number;
}
const venues = rows.map(r => assert<Venue>(r));
```

Geometry columns come back as WKB hex by default, which is rarely what you want. Select `ST_AsGeoJSON(location)` and parse, or `ST_X`/`ST_Y` for points:

```sql
SELECT id, name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon FROM venues
```

## Declaring the table anyway

You can declare the non-spatial columns and leave `location` out:

```ts
export const venues = defineSchema('venues', {
  id: serial().primaryKey(),
  name: text().notNull(),
});
```

Repository reads with an explicit `select` work fine. But `create` cannot populate a `NOT NULL` geography column, so inserts must go through raw SQL — or make the column nullable and set it in a second statement, which is worse. In practice: raw SQL for writes, the repository for everything else.

## Managed Postgres

PostGIS availability varies. Available on RDS, Cloud SQL, Azure, [Supabase](./connect-supabase.html), [Neon](./connect-neon.html) and Crunchy. Not available on [PGlite](./connect-pglite.html), so tests touching spatial queries need a real Postgres in a container — see [Local Postgres](./guide-local-postgres.html).

## What it would take

The same two changes as [vector search](./guide-vector-search.html): an extensible `SqlType` with a defined type mapping and serialisation story, and index expressions plus a `USING <method>` option in `IndexDef`. PostGIS additionally wants type _modifiers_ (`geography(Point, 4326)`), which vector needs too (`vector(1536)`) — so a design that handles a parameterised custom type covers both.

Until then, PostGIS in zmdb means a hand-written migration and raw SQL for the spatial predicates, which is a smaller compromise than it sounds: PostGIS queries are usually hand-written anyway.

---

See also: [Vector search](./guide-vector-search.html) · [Database Extensions](./db-extensions.html) · [Raw SQL](./raw-sql.html)
