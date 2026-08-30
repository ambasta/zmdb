import type { CompiledQuery } from '@zmdb/query-compiler';

// Read-replica routing — see ./SPEC.md.
import type { Driver } from '../index.ts';

export interface ReplicaOptions {
  primary: Driver;
  replicas: readonly Driver[];
  pick?: (replicas: readonly Driver[], nextIndex: number) => Driver;
}

export function isWrite(sql: string): boolean {
  const s = sql.trimStart().toUpperCase();
  return s.startsWith('INSERT') || s.startsWith('UPDATE') || s.startsWith('DELETE');
}

/** Wrap primary+replicas into a single Driver that routes reads to replicas. */
export function withReplicas(opts: ReplicaOptions): Driver {
  const { primary, replicas } = opts;
  let rr = 0;
  return {
    execute(query: CompiledQuery) {
      if (isWrite(query.text) || replicas.length === 0) return primary.execute(query);
      const driver = opts.pick ? opts.pick(replicas, rr) : replicas[rr % replicas.length]!;
      rr = (rr + 1) % replicas.length;
      return driver.execute(query);
    },
  };
}
