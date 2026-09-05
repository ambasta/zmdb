import { is, schemaOf } from 'zmdb';

import type { User } from './model.js';

export function accepts(value: unknown): boolean {
  return is<User>(value);
}

export const users = schemaOf<User>();

globalThis.__ZMDB_METRO_RESULT__ = {
  acceptsGood: accepts({ id: 1, email: 'a@example.com' }),
  acceptsBad: accepts({ id: '1', email: 'a@example.com' }),
  table: users.table,
};
