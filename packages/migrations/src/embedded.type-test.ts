import { runEmbedded, type EmbeddedConnection, type EmbeddedMigration } from './embedded.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

interface FrozenEmbeddedMigration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly checksum: string;
}

interface FrozenEmbeddedConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, params: readonly (string | number | null)[]): Promise<void>;
  rows(sql: string, params: readonly (string | number | null)[]): Promise<readonly Record<string, unknown>[]>;
}

type FrozenRunEmbedded = (
  connection: FrozenEmbeddedConnection,
  migrations: readonly FrozenEmbeddedMigration[],
) => Promise<readonly number[]>;

export type _RunEmbeddedBoundary = Expect<Equal<typeof runEmbedded, FrozenRunEmbedded>>;
export type _MigrationBoundary = Expect<Equal<EmbeddedMigration, FrozenEmbeddedMigration>>;
export type _ConnectionBoundary = Expect<Equal<EmbeddedConnection, FrozenEmbeddedConnection>>;

const connection: EmbeddedConnection = {
  async exec(_sql): Promise<void> {},
  async run(_sql, _params): Promise<void> {},
  async rows(_sql, _params): Promise<readonly Record<string, unknown>[]> {
    return [];
  },
};
const migrations = [
  {
    version: 20260905090000,
    name: 'create_users',
    up: 'CREATE TABLE users (id INTEGER PRIMARY KEY)',
    checksum: 'sha256:create-users',
  },
] as const satisfies readonly EmbeddedMigration[];

export const applied = runEmbedded(connection, migrations);
export type _AppliedVersionsAreReadonly = Expect<Equal<Awaited<typeof applied>, readonly number[]>>;
