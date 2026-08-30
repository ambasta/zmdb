// node:sqlite driver adapter — see ../drivers/SPEC.md.
import type { DatabaseSync } from 'node:sqlite';
import type { Driver } from '../index.ts';

/** Wrap a node:sqlite DatabaseSync as a zmdb Driver. Zero external deps. */
export function sqliteDriver(_db: DatabaseSync): Driver {
  throw new Error('not implemented');
}
