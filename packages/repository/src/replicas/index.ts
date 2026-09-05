import type { CompiledQuery } from '@zmdb/query-compiler';
import { analyzeQuery } from '@zmdb/query-compiler';

// Read-replica routing — see ./SPEC.md.
import type { Driver } from '../index.js';

export interface ReplicaOptions {
  primary: Driver;
  replicas: readonly Driver[];
  pick?: (replicas: readonly Driver[], nextIndex: number) => Driver;
}

export function isWrite(queryOrSql: string | CompiledQuery): boolean {
  if (typeof queryOrSql === 'object' && queryOrSql !== null) {
    if (queryOrSql.isWrite !== undefined) {
      return queryOrSql.isWrite;
    }
    return analyzeQuery(queryOrSql.text).isWrite;
  }
  return analyzeQuery(String(queryOrSql)).isWrite;
}

/** Wrap primary+replicas into a single Driver that routes reads to replicas. */
export function withReplicas(opts: ReplicaOptions): Driver {
  const { primary, replicas } = opts;
  let rr = 0;
  const pick = (query: CompiledQuery): Driver => {
    if (isWrite(query) || replicas.length === 0) return primary;
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
  };
}
