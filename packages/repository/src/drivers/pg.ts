// pg (node-postgres) driver adapter — see ../drivers/SPEC.md.
import type { Driver } from '../index.ts';

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
}

/** Wrap a pg Pool/Client as a zmdb Driver. `prepared:true` opts into server-side
 * prepared statements (stable statement name per SQL). */
export function pgDriver(client: PgQueryable, opts?: PgOptions): Driver {
  const names = new Map<string, string>();
  let seq = 0;
  const nameFor = (text: string): string => {
    let n = names.get(text);
    if (!n) {
      n = 'z' + (seq++).toString(36);
      names.set(text, n);
    }
    return n;
  };
  return {
    async execute(q) {
      const params = q.parameters as unknown[];
      const res = opts?.prepared
        ? await client.query({ name: nameFor(q.text), text: q.text, values: params })
        : await client.query(q.text, params);
      return res.rows;
    },
  };
}
