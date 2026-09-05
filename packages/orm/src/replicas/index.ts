import { analyzeQuery, type CompiledQuery } from '@zmdb/sql';

// Read-replica routing — see ./SPEC.md.
import { type Driver, type TransactionalDriver } from '../index.js';

export interface ReplicaOptions<Primary extends Driver = Driver> {
  primary: Primary;
  replicas: readonly Driver[];
  pick?: (replicas: readonly Driver[], nextIndex: number) => Driver;
}

function isTransactional(driver: Driver): driver is TransactionalDriver {
  return 'transaction' in driver && typeof driver.transaction === 'function';
}

export function isWrite(queryOrSql: string | CompiledQuery): boolean {
  if (typeof queryOrSql === 'object' && queryOrSql !== null) {
    if (queryOrSql.effects !== undefined) {
      return queryOrSql.effects.operation !== 'SELECT' || queryOrSql.effects.requiresPrimary;
    }
    if (queryOrSql.isWrite !== undefined) {
      return queryOrSql.isWrite;
    }
    return analyzeQuery(queryOrSql.text).isWrite;
  }
  return analyzeQuery(String(queryOrSql)).isWrite;
}

/** Wrap primary+replicas into a single Driver that routes reads to replicas. */
export function withReplicas<Name extends string>(
  opts: ReplicaOptions<TransactionalDriver<Name>>,
): TransactionalDriver<Name>;
export function withReplicas<Name extends string>(opts: ReplicaOptions<Driver<Name>>): Driver<Name>;
export function withReplicas(opts: ReplicaOptions): Driver | TransactionalDriver {
  const { primary, replicas } = opts;
  let rr = 0;
  const pick = (query: CompiledQuery): Driver => {
    if ((query.effects && query.effects.requiresPrimary) || isWrite(query) || replicas.length === 0) return primary;
    const driver = opts.pick ? opts.pick(replicas, rr) : replicas[rr % replicas.length];
    rr = (rr + 1) % replicas.length;
    // `replicas` is non-empty here (checked above), so the modulo index always
    // hits — but a custom `pick` is caller code, so fall back to the primary
    // rather than crashing on a bad index.
    return driver ?? primary;
  };

  const canStream =
    typeof primary.stream === 'function' && replicas.every(driver => typeof driver.stream === 'function');
  return {
    get dialect() {
      return primary.dialect;
    },
    ...(primary.queryTelemetry === true || replicas.some(driver => driver.queryTelemetry === true)
      ? { queryTelemetry: true as const }
      : {}),
    execute(query, executeOpts) {
      return pick(query).execute(query, executeOpts);
    },
    ...(canStream
      ? {
          stream(query: CompiledQuery, executeOpts?: Parameters<NonNullable<Driver['stream']>>[1]) {
            const driver = pick(query);
            const stream = driver.stream;
            if (typeof stream !== 'function') {
              throw new Error('replica routing selected a driver without stream support');
            }
            return stream.call(driver, query, executeOpts);
          },
        }
      : {}),
    ...(isTransactional(primary)
      ? { transaction: <Result>(run: (driver: Driver) => Promise<Result>) => primary.transaction(run) }
      : {}),
  };
}
