// Compile-only public-surface freeze for migrations/SPEC.md §5.
//
// The static import asks the real package export map for the future leaf module.
// Its current error is expected; initialized local values below preserve the
// frozen types without declaring a boundary that does not exist.

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// @ts-expect-error frozen (#520): the real package subpath and function do not exist yet.
import type { runEmbedded } from '@zmdb/query-compiler/migrations/embedded';

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

export type _RunEmbeddedBoundary = typeof runEmbedded;

function unimplemented(what: string): never {
  throw new Error(`${what} is a compile-only frozen surface`);
}

const frozenRunEmbedded: FrozenRunEmbedded = async (_connection, _migrations) => unimplemented('runEmbedded');
const connection: FrozenEmbeddedConnection = {
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
] as const satisfies readonly FrozenEmbeddedMigration[];

export const applied = frozenRunEmbedded(connection, migrations);
export type _FrozenMigrationShape = Expect<(typeof migrations)[number] extends FrozenEmbeddedMigration ? true : false>;
export type _AppliedVersionsAreReadonly = Expect<Equal<Awaited<typeof applied>, readonly number[]>>;
