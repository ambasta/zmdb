import { assert, is, validate } from '@zmdb/aot-validator';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { BaseRepository, type Driver } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/sqlite';
import { defineRepository, schemaOf } from 'zmdb';
import type { CreateDTO, Entity, UpdateDTO, Populated } from 'zmdb/derive';
import type {
  HasDefault,
  Length,
  Max,
  MaxLength,
  Min,
  Pattern,
  PrimaryKey,
  References,
  Serial,
  Sql,
  Table,
  Unique,
} from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Pattern<'^[^@]+@[^@]+\.[^@]+$'>;
  name?: string & Sql<'text'>;
  role: ('admin' | 'user' | 'guest') & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
}

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'numeric'> & Min<0>;
}

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  authorId: number & Sql<'integer'> & References<'users.id'>;
}

const db = {} as any;
const driver: Driver = { dialect: 'sqlite', execute: async () => [] };
const users = defineRepository(schemaOf<User>(), sqliteDriver(db), { dialect: 'sqlite' });
const orders = defineRepository(schemaOf<Order>(), sqliteDriver(db), { dialect: 'sqlite' });
const posts = defineRepository(schemaOf<Post>(), sqliteDriver(db), { dialect: 'sqlite' });
const qb = createQueryCompiler('sqlite');
const compiler = qb;
const builder = qb.selectFrom('users');

// #region snippet-1
{
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
}
// #endregion snippet-1

// #region snippet-2
{
  const disc = discriminatorFor(sti, 'concert');
  // disc => 'concert'

  // Usage in create
  async function createConcert(data: Omit<Concert, 'type'>) {
    return this.create({
      type: disc,
      ...data,
    });
  }
}
// #endregion snippet-2

// #region snippet-3
{
  const compiler = createQueryCompiler('postgres');

  // Get all concerts
  const concerts = compiler
    .selectFrom('events')
    .select(['id', 'title', 'venue', 'artist'])
    .where('type', '=', 'concert')
    .compile();

  // concerts.text => SELECT ... WHERE "type" = $1
  // concerts.parameters => ['concert']
}
// #endregion snippet-3

// #region snippet-4
{
  async function handleEventAttachment(eventRow: Record<string, unknown>) {
    const { type, data } = rowToSubtype(sti, eventRow);

    switch (type) {
      case 'concert':
        return sendConcertNotification(data as Concert);
      case 'game':
        return updateScoreboard(data as Game);
    }
  }
}
// #endregion snippet-4
