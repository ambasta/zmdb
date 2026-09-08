import { schemaOf } from '@zmdb/schema';
import { is } from '@zmdb/validator';

import type { PublicationUser } from './model.js';

export function accepts(value: unknown): boolean {
  return is<PublicationUser>(value);
}

export const users = schemaOf<PublicationUser>();

Object.assign(globalThis, {
  __ZMDB_TOOLING_PUBLICATION__: {
    acceptsGood: accepts({ id: 7, email: 'packed@example.com' }),
    acceptsBad: accepts({ id: '7', email: 'packed@example.com' }),
    table: users.table,
  },
});
