Inheritance lets you model entity hierarchies in a single database table using a discriminator column. zmdb provides `SingleTableInheritance` utilities to map rows to their correct subtypes at runtime.

## Single Table Inheritance

Store all subtypes in one table with a discriminator column. Each subtype has a subset of columns that apply to it.

```ts
import { rowToSubtype, discriminatorFor } from '@zmdb/repository/entity-modeling';
import { assert } from '@zmdb/aot-validator/utilities';
import { schemaOf } from 'zmdb';
import type { PrimaryKey, Serial, Sql, Table } from 'zmdb/tags';

// The table: every subtype's columns, with the type-specific ones nullable
export interface EventRow extends Table<'events'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  // Discriminator column — a union, so the switch below is exhaustive
  type: 'concert' | 'game';
  // Common fields
  created_at: Date & Sql<'timestamp'>;
  // Type-specific fields (nullable in the table, populated per-type)
  title: (string & Sql<'text'>) | null; // For "concert"
  venue: (string & Sql<'text'>) | null; // For "concert"
  artist: (string & Sql<'text'>) | null; // For "concert"
  opponent: (string & Sql<'text'>) | null; // For "game"
  home_score: (number & Sql<'integer'>) | null; // For "game"
  away_score: (number & Sql<'integer'>) | null; // For "game"
}

// Define inheritance map
const sti = {
  discriminator: 'type',
  map: {
    concert: ['title', 'venue', 'artist'],
    game: ['opponent', 'home_score', 'away_score'],
  },
} as const;

// Map row to correct subtype
type Concert = { type: 'concert'; title: string; venue: string; artist: string };
type Game = { type: 'game'; opponent: string; home_score: number; away_score: number };
type Event = Concert | Game;

// In your repository
const eventSchema = schemaOf<EventRow>();

class EventRepository extends BaseRepository<Event> {
  findById(id: number) {
    return super.findById(id).then(row => {
      if (!row) return null;
      const subtype = rowToSubtype(sti, row);
      // discriminated union, checked rather than asserted
      return assert<Event>({ type: subtype.type, ...subtype.data });
    });
  }
}
```

Generated DDL:

```sql
CREATE TABLE "events" (
  "id" SERIAL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "title" TEXT,
  "venue" TEXT,
  "artist" TEXT,
  "opponent" TEXT,
  "home_score" INTEGER,
  "away_score" INTEGER
)
```

## Discriminator Values

Use `discriminatorFor` to generate the correct discriminator value for a subtype.

```ts
import { discriminatorFor } from '@zmdb/repository/entity-modeling';

const disc = discriminatorFor(sti, 'concert');
// disc => 'concert'

// Usage in create
async function createConcert(data: Omit<Concert, 'type'>) {
  return this.create({
    type: disc,
    ...data,
  });
}
```

## Querying Subtypes

Query the base table and filter by discriminator to get specific subtypes.

```ts
import { createQueryCompiler } from '@zmdb/query-compiler';

const compiler = createQueryCompiler('postgres');

// Get all concerts
const concerts = compiler
  .selectFrom('events')
  .select(['id', 'title', 'venue', 'artist'])
  .where('type', '=', 'concert')
  .compile();

// concerts.text => SELECT ... WHERE "type" = $1
// concerts.parameters => ['concert']
```

The declaration gets you two things here that the row shape alone does not: `type` narrows to
`'concert' | 'game'`, so the `switch` below is exhaustive and a third subtype breaks the
compile; and the per-subtype columns are honestly `| null`, which is what the table says. The
part it cannot express is the invariant — that a `concert` row has a `title` and a `game` row
does not — because that is a `CHECK` constraint, not a type.

> [!NOTE]
> Inheritance in zmdb is a runtime pattern, not a database constraint. You must ensure data integrity (e.g., that the type-specific columns match the discriminator) in your application code, or with a `CHECK` in a [custom migration](./migrations-custom.html).

## Polymorphic Relations

Use the discriminator to route to the correct handler for polymorphic associations.

```ts
async function handleEventAttachment(eventRow: Record<string, unknown>) {
  const { type, data } = rowToSubtype(sti, eventRow);

  switch (type) {
    case 'concert':
      return sendConcertNotification(data as Concert);
    case 'game':
      return updateScoreboard(data as Game);
  }
}
```

> [!TIP]
> Keep discriminator columns indexed for efficient filtering. Add a partial index if your DB supports it (e.g., `WHERE type IS NOT NULL`).

---

See also: [Repository](./repository.html) · [Embeddables](./embeddables.html) · [Schema Declaration](./schema-declaration.html)
