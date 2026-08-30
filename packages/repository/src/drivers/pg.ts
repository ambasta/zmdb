// pg (node-postgres) driver adapter — see ../drivers/SPEC.md.
import type { Driver } from '../index.ts';

// Minimal structural type so we don't hard-depend on `pg`'s types at build time.
export interface PgQueryable {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  query(config: { name?: string; text: string; values?: readonly unknown[] }): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface PgOptions {
  prepared?: boolean;
}

/** Wrap a pg Pool/Client as a zmdb Driver. `prepared:true` opts into server-side
 * prepared statements (stable statement name per SQL). */
export function pgDriver(_client: PgQueryable, _opts?: PgOptions): Driver {
  throw new Error('not implemented');
}
