Inheritance lets you model entity hierarchies in a single database table using a discriminator column. zmdb provides `SingleTableInheritance` utilities to map rows to their correct subtypes at runtime.

## Single Table Inheritance

Store all subtypes in one table with a discriminator column. Each subtype has a subset of columns that apply to it.

```ts
import { defineSchema, serial, text, integer, jsonEnum } from '@zmdb/schema-core';
import { rowToSubtype, discriminatorFor } from '@zmdb/repository/entity-modeling';
import { assert } from '@zmdb/aot-validator/utilities';

// Base event type
const EventSchema = defineSchema('events', {
  id: serial().primaryKey(),
  // Discriminator column
  type: text().notNull(),
  // Common fields
  created_at: timestamp().notNull(),
  // Type-specific fields (nullable in DB, populated per-type)
  title: text(), // For "concert"
  venue: text(), // For "concert"
  artist: text(), // For "concert"
  opponent: text(), // For "game"
  home_score: integer(), // For "game"
  away_score: integer(), // For "game"
});

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
class EventRepository extends BaseRepository<typeof EventSchema> {
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
  "created_at" TIMESTAMP NOT NULL,
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

> [!NOTE]
> Inheritance in zmdb is a runtime pattern, not a database constraint. You must ensure data integrity (e.g., correct discriminator values) in your application code.

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

See also: [Repository](./repository.html) · [Embeddables](./embeddables.html) · [Schema Core](./schema-declaration.html)
