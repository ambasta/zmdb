import type { Driver } from '../index.js';

/** A driver that can pin every query in a callback to one database transaction. */
export interface TransactionalDriver extends Driver {
  transaction<Result>(run: (driver: Driver) => Promise<Result>): Promise<Result>;
}
