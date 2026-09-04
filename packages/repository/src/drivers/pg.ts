// pg (node-postgres) driver adapter — see ../drivers/SPEC.md.
import type { Driver } from '../index.js';

// Minimal structural type so we don't hard-depend on `pg`'s types at build time.
export interface PgQueryable {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  query(config: {
    name?: string;
    text: string;
    values?: readonly unknown[];
  }): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface PgOptions {
  prepared?: boolean;
  maxCacheSize?: number;
}

/** Wrap a pg Pool/Client as a zmdb Driver. `prepared: true` opts into server-side
 * prepared statements (stable statement name per SQL). Kept opt-in to preserve
 * the zero-state default (see the benchmarks tail trade-off). */
export function pgDriver(client: PgQueryable, opts?: PgOptions): Driver {
  const prepared = opts?.prepared ?? false;
  const maxCacheSize = opts?.maxCacheSize ?? 1000;
  const names = new Map<string, string>();
  let seq = 0;
  const nameFor = (text: string): string => {
    let n = maxCacheSize > 0 ? names.get(text) : undefined;
    if (!n) {
      n = 'z' + (seq++).toString(36);
      if (maxCacheSize > 0) {
        if (names.size >= maxCacheSize) {
          const oldestKey = names.keys().next().value;
          if (oldestKey !== undefined) {
            const oldestName = names.get(oldestKey);
            names.delete(oldestKey);
            if (oldestName) {
              client.query(`DEALLOCATE ${oldestName}`).catch(() => {});
            }
          }
        }
        names.set(text, n);
      }
    } else if (maxCacheSize > 0) {
      names.delete(text);
      names.set(text, n);
    }
    return n;
  };
  return {
    dialect: 'postgres',
    async execute(q) {
      const params = q.parameters;
      const res = prepared
        ? await client.query({ name: nameFor(q.text), text: q.text, values: params })
        : await client.query(q.text, params);
      return res.rows;
    },
  };
}
