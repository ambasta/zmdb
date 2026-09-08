import type { snapshot } from '@zmdb/migrations';
import type { emitDeclarations } from '@zmdb/migrations/declarations';
import type { EmbeddedConnection, EmbeddedMigration, runEmbedded } from '@zmdb/migrations/embedded';
import type { readMigrations } from '@zmdb/migrations/files';
import type { createIntrospector } from '@zmdb/migrations/introspect';
import type { normalizeDriftSnapshot } from '@zmdb/migrations/introspect/runtime';
import type { up } from '@zmdb/migrations/runner';
import type { memoryMigrationConnection } from '@zmdb/migrations/testing';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
export type EmbeddedContract = Expect<
  Equal<
    typeof runEmbedded,
    (connection: EmbeddedConnection, migrations: readonly EmbeddedMigration[]) => Promise<readonly number[]>
  >
>;
export type ConnectionMethods = Expect<Equal<keyof EmbeddedConnection, 'exec' | 'run' | 'rows'>>;
export type PublicSubpaths = [
  typeof snapshot,
  typeof emitDeclarations,
  typeof readMigrations,
  typeof createIntrospector,
  typeof normalizeDriftSnapshot,
  typeof up,
  typeof memoryMigrationConnection,
];

// @ts-expect-error an embedded version is numeric
export const invalidVersion: EmbeddedMigration = { version: '1', name: 'fixture', up: '', checksum: '' };
