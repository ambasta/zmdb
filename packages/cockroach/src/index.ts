import { postgres, postgresFamilyDriver, type PgConnection, type PgOptions, type PgQueryable } from '@zmdb/postgres';
import { extendSqlDialect, UnsupportedFeatureError, type SqlDialect } from '@zmdb/query-compiler';
import type { DatabaseVertical, TransactionalDriver } from '@zmdb/repository';

import { cockroachIntrospector } from './introspect.js';
import { COCKROACH_TYPE_OVERRIDES, cockroachMigrations } from './migrations.js';

export type { PgConnection, PgOptions, PgQueryable };
export { cockroachIntrospector, cockroachMigrations };

interface PgPoolLike extends PgQueryable {
  readonly totalCount: number;
  readonly idleCount: number;
  connect(): Promise<PgConnection>;
}

type PgQueryConfig = {
  readonly name?: string;
  readonly queryMode?: 'extended';
  readonly text: string;
  readonly values?: readonly unknown[];
};

function isPoolLike(client: PgQueryable): client is PgPoolLike {
  return (
    typeof client.connect === 'function' &&
    typeof Reflect.get(client, 'totalCount') === 'number' &&
    typeof Reflect.get(client, 'idleCount') === 'number'
  );
}

function normalizeBackendPid(
  input: string | PgQueryConfig,
  result: { rows: Record<string, unknown>[] },
): { rows: Record<string, unknown>[] } {
  const text = typeof input === 'string' ? input : input.text;
  if (text.trim().toLowerCase() !== 'select pg_backend_pid() as pid') return result;
  return {
    rows: result.rows.map(row => {
      const pid = Reflect.get(row, 'pid');
      if (typeof pid !== 'string' || !/^\d+$/.test(pid)) return row;
      const numeric = Number(pid);
      return Number.isSafeInteger(numeric) && numeric > 0 ? { ...row, pid: numeric } : row;
    }),
  };
}

class CockroachClient implements PgConnection {
  private readonly target: PgConnection;

  constructor(target: PgConnection) {
    this.target = target;
  }

  query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  query(config: PgQueryConfig): Promise<{ rows: Record<string, unknown>[] }>;
  async query(
    input: string | PgQueryConfig,
    params?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    const result = typeof input === 'string' ? await this.target.query(input, params) : await this.target.query(input);
    return normalizeBackendPid(input, result);
  }

  release(): void {
    const release = this.target.release;
    if (release !== undefined) release.call(this.target);
  }
}

class CockroachQueryable implements PgQueryable {
  private readonly target: PgQueryable;

  constructor(target: PgQueryable) {
    this.target = target;
  }

  query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  query(config: PgQueryConfig): Promise<{ rows: Record<string, unknown>[] }>;
  async query(
    input: string | PgQueryConfig,
    params?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    const result = typeof input === 'string' ? await this.target.query(input, params) : await this.target.query(input);
    return normalizeBackendPid(input, result);
  }
}

class CockroachPool extends CockroachQueryable implements PgPoolLike {
  private readonly pool: PgPoolLike;

  constructor(pool: PgPoolLike) {
    super(pool);
    this.pool = pool;
  }

  get totalCount(): number {
    return this.pool.totalCount;
  }

  get idleCount(): number {
    return this.pool.idleCount;
  }

  async connect(): Promise<PgConnection> {
    return new CockroachClient(await this.pool.connect());
  }
}

function cockroachQueryable(client: PgQueryable): PgQueryable {
  return isPoolLike(client) ? new CockroachPool(client) : new CockroachQueryable(client);
}

export const cockroach: SqlDialect<'cockroach'> = extendSqlDialect(postgres, {
  name: 'cockroach',
  traits: {
    types: COCKROACH_TYPE_OVERRIDES,
    fts: 'none',
    retryableCodes: ['40001'],
    vectorDistance: false,
    spatialPredicates: false,
  },
  capabilities: {
    transactionalDdl: false,
    rowLevelSecurity: false,
    cancellation: false,
  },
  migrations: cockroachMigrations,
  introspector: cockroachIntrospector,
});

export function cockroachDriver(client: PgQueryable, options?: PgOptions): TransactionalDriver<'cockroach'> {
  if (options?.cancelVia !== undefined) {
    throw new UnsupportedFeatureError(
      'server-side cancellation',
      'cockroach',
      'cockroach does not provide PostgreSQL pg_cancel_backend(); omit PgOptions.cancelVia',
    );
  }
  return postgresFamilyDriver(cockroach, cockroachQueryable(client), options);
}

export const cockroachVertical: DatabaseVertical<'cockroach', PgQueryable, PgOptions> = Object.freeze({
  dialect: cockroach,
  driver: cockroachDriver,
});
