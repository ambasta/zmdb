> **ToDo / partial feature gap.** Declared PostGIS-backed columns, ordered
> extension installation and `USING gist` index DDL are supported. Catalog pull
> cannot infer a PostGIS column's application shape and omits that property from
> emitted declarations. Typed spatial projections and predicates are also not yet
> available, so writes and radius queries still use raw SQL.

## Declare the column

```ts
import type { Ext, PrimaryKey, Sql, Table } from 'zmdb/tags';

interface GeoJsonPoint {
  readonly type: 'Point';
  readonly coordinates: readonly [number, number];
}

export interface Venue extends Table<'venues'> {
  id: number & Sql<'integer'> & PrimaryKey;
  name: string & Sql<'text'>;
  location: GeoJsonPoint & Ext<'postgis', 'geography', ['Point', 4326]>;
}
```

The migration snapshot derives the `postgis` dependency and emits it before the table:

```sql
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE TABLE "venues" (
  "id" INTEGER PRIMARY KEY,
  "location" geography(Point,4326) NOT NULL,
  "name" TEXT NOT NULL
);
```

The application and wire shape is the declared GeoJSON object. A bare database projection may still return WKB, so select a GeoJSON projection explicitly until the typed spatial projection surface lands.

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

|                             | `geometry`                     | `geography` |
| --------------------------- | ------------------------------ | ----------- |
| Model                       | flat plane                     | spheroid    |
| Distance units              | degrees (meaningless for 4326) | **metres**  |
| Speed                       | faster                         | slower      |
| Correct over long distances | no                             | yes         |

For "venues within 5km" use `geography`, where `ST_DWithin` takes metres. With `geometry(Point, 4326)`, `ST_DWithin(a, b, 5000)` means 5000 degrees and can silently match everything.

## Insert

The typed writer does not yet lower GeoJSON through `ST_GeomFromGeoJSON`, so use a parameterised statement:

```ts
await driver.execute({
  text: 'INSERT INTO venues (name, location) VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)',
  parameters: [name, lon, lat],
});
```

`ST_MakePoint(x, y)` is longitude first. Swapped latitude/longitude remains a valid point, so the database cannot diagnose it.

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

Use `ST_DWithin` in `WHERE`, not `ST_Distance(...) < r`. Only `ST_DWithin` can use the GIST index.

## Type raw results

```ts
interface VenueHit {
  id: number;
  name: string;
  metres: number;
}
const venues = rows.map(r => assert<VenueHit>(r));
```

For a geometry value itself, project `ST_AsGeoJSON(location)` or scalar coordinates:

```sql
SELECT id, name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
FROM venues
```

PostGIS is available on RDS, Cloud SQL, Azure, Supabase, Neon and Crunchy. It is not available on PGlite, so spatial execution tests need real PostgreSQL.

---

See also: [Vector search](./guide-vector-search.html) · [Database Extensions](./db-extensions.html) · [Raw SQL](./raw-sql.html)
