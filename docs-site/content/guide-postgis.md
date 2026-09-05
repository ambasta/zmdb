PostGIS-backed columns participate in declaration and migration like core
columns. zmdb installs the extension before the table, emits GIST index DDL,
and provides closed typed `ST_Contains` and `ST_DWithin` predicates for declared
`geometry` columns. Writes and projections that need other PostGIS functions
remain explicit, parameterised SQL.

## Declare the column

```ts
import type { Ext, PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

interface GeoJsonPoint {
  readonly type: 'Point';
  readonly coordinates: readonly [number, number];
}

export interface Venue extends Table<'venues'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  location: GeoJsonPoint & Ext<'postgis', 'geometry', ['Point', 4326]>;
}
```

The migration snapshot derives the `postgis` dependency and emits it before the table:

```sql
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE TABLE "venues" (
  "id" SERIAL PRIMARY KEY,
  "location" geometry(Point,4326) NOT NULL,
  "name" TEXT NOT NULL
);
```

The application and wire shape is the declared GeoJSON object. A bare database
projection may still return WKB, so select a GeoJSON projection explicitly when
the result needs the geometry itself. Catalog pull can discover that the column
is PostGIS-backed, but it cannot infer your application-level GeoJSON shape and
therefore omits that property from generated declarations.

## Create the spatial index

```ts
import { createIndexDdl } from '@zmdb/query-compiler/schema-objects';

const indexSql = createIndexDdl(
  {
    name: 'venues_location_gist',
    table: 'venues',
    method: 'gist',
    columns: ['location'],
  },
  'postgres',
);
```

This emits:

```sql
CREATE INDEX "venues_location_gist" ON "venues" USING gist ("location")
```

## Geometry or geography

|                             | `geometry`                              | `geography` |
| --------------------------- | --------------------------------------- | ----------- |
| Model                       | flat plane                              | spheroid    |
| Distance units              | coordinate units (degrees in SRID 4326) | **metres**  |
| Speed                       | faster                                  | slower      |
| Correct over long distances | no                                      | yes         |

For "venues within 5km" use `geography`, where `ST_DWithin` takes metres. With
`geometry(Point, 4326)`, `ST_DWithin(a, b, 5000)` means 5000 coordinate units
and can silently match everything.

## Insert

The typed writer does not lower GeoJSON through `ST_GeomFromGeoJSON`, so use a
parameterised statement:

```ts
const name = 'Bengaluru';
const point: GeoJsonPoint = { type: 'Point', coordinates: [77.5946, 12.9716] };

await driver.execute({
  text: 'INSERT INTO venues (name, location) VALUES ($1, ST_GeomFromGeoJSON($2))',
  parameters: [name, point],
});
```

GeoJSON positions are longitude first. Swapped latitude/longitude remains a
valid point, so the database cannot diagnose it.

## Typed geometry predicates

For a declared `geometry` column, `stDWithin<T>(column, point, distance)`
supplies the closed predicate and binds both the GeoJSON value and distance:

```ts
import { createQueryCompiler, stDWithin } from '@zmdb/query-compiler';

const nearby = createQueryCompiler('postgres')
  .selectFrom('venues')
  .where(stDWithin<Venue>('location', point, 0.05))
  .compile();

const rows = await driver.execute(nearby);
```

The distance above is in the geometry's coordinate units. `stContains<T>` is
the other typed predicate. Both sides are tied to the declared geometry shape,
so a polygon column accepts a declared polygon rather than an arbitrary object:

```ts
import { stContains } from '@zmdb/query-compiler';

interface GeoJsonPolygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly (readonly [number, number])[])[];
}

interface Region extends Table<'regions'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  area: GeoJsonPolygon & Ext<'postgis', 'geometry', ['Polygon', 4326]>;
}

const candidatePolygon: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [77.55, 12.92],
      [77.65, 12.92],
      [77.65, 13.02],
      [77.55, 13.02],
      [77.55, 12.92],
    ],
  ],
};

const contained = createQueryCompiler('postgres')
  .selectFrom('regions')
  .where(stContains<Region>('area', candidatePolygon))
  .compile();
```

The compiler emits only the closed PostGIS function names and binds the GeoJSON
arguments. Every non-PostgreSQL dialect refuses these predicates.

## Metre-based radius search

For metre-based distance, declare the column as geography:

```ts
interface VenueGeography extends Table<'venue_geographies'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  location: GeoJsonPoint & Ext<'postgis', 'geography', ['Point', 4326]>;
}
```

The typed spatial helpers currently target `geometry`. A geography query that
also projects `ST_Distance` therefore remains explicit, parameterised SQL:

```ts
const [longitude, latitude] = point.coordinates;
const radiusMetres = 5_000;
const radiusRows = await driver.execute({
  text: `SELECT id, name,
                ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS metres
         FROM venue_geographies
         WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
         ORDER BY metres
         LIMIT $4`,
  parameters: [longitude, latitude, radiusMetres, 20],
});
```

Use `ST_DWithin` in `WHERE`, not `ST_Distance(...) < r`. Of those two radius
forms, only `ST_DWithin` can use the GIST index.

## Type raw results

```ts
import { assert } from '@zmdb/aot-validator/utilities';

export interface VenueHit {
  id: number;
  name: string;
  metres: number;
}
const venues = radiusRows.map(row => assert<VenueHit>(row));
```

For a geometry value itself, project `ST_AsGeoJSON(location)` or scalar coordinates:

```sql
SELECT id, name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
FROM venues
```

PostGIS support is available only on the `'postgres'` dialect in zmdb.
Cockroach, MySQL, SingleStore, SQLite and SQL Server refuse extension
installation, PostGIS-backed DDL and the spatial predicate nodes instead of
substituting an incompatible type or function.

---

See also: [Vector search](./guide-vector-search.html) · [Database Extensions](./db-extensions.html) · [Raw SQL](./raw-sql.html)
