import type { CompiledQuery } from '@zmdb/query-compiler';

// Read-replica routing — see ./SPEC.md.
import type { Driver } from '../index.js';

export interface ReplicaOptions {
  primary: Driver;
  replicas: readonly Driver[];
  pick?: (replicas: readonly Driver[], nextIndex: number) => Driver;
}

export function isWrite(sql: string): boolean {
  let i = 0;
  const len = sql.length;
  while (i < len) {
    const code = sql.charCodeAt(i);
    if (code > 32 && code !== 0x00a0 && code !== 0xfeff) {
      break;
    }
    i++;
  }
  if (len - i < 6) return false;

  const c0 = sql.charCodeAt(i) | 32;
  if (c0 === 105) {
    // 'i' -> INSERT
    return (
      (sql.charCodeAt(i + 1) | 32) === 110 &&
      (sql.charCodeAt(i + 2) | 32) === 115 &&
      (sql.charCodeAt(i + 3) | 32) === 101 &&
      (sql.charCodeAt(i + 4) | 32) === 114 &&
      (sql.charCodeAt(i + 5) | 32) === 116
    );
  }
  if (c0 === 117) {
    // 'u' -> UPDATE
    return (
      (sql.charCodeAt(i + 1) | 32) === 112 &&
      (sql.charCodeAt(i + 2) | 32) === 100 &&
      (sql.charCodeAt(i + 3) | 32) === 97 &&
      (sql.charCodeAt(i + 4) | 32) === 116 &&
      (sql.charCodeAt(i + 5) | 32) === 101
    );
  }
  if (c0 === 100) {
    // 'd' -> DELETE
    return (
      (sql.charCodeAt(i + 1) | 32) === 101 &&
      (sql.charCodeAt(i + 2) | 32) === 108 &&
      (sql.charCodeAt(i + 3) | 32) === 101 &&
      (sql.charCodeAt(i + 4) | 32) === 116 &&
      (sql.charCodeAt(i + 5) | 32) === 101
    );
  }

  return false;
}

/** Wrap primary+replicas into a single Driver that routes reads to replicas. */
export function withReplicas(opts: ReplicaOptions): Driver {
  const { primary, replicas } = opts;
  let rr = 0;
  const pick = (query: CompiledQuery): Driver => {
    if (isWrite(query.text) || replicas.length === 0) return primary;
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
