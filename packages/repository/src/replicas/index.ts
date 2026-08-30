// Read-replica routing — see ./SPEC.md.
import type { Driver } from '../index.ts';
import type { CompiledQuery } from '@zmdb/query-compiler';

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
export function withReplicas(_opts: ReplicaOptions): Driver {
  throw new Error('not implemented');
}
