import { schemaOf } from '@zmdb/schema';
import { is, validate } from '@zmdb/validator';

import type { User } from './user.js';

export const users = schemaOf<User>();
export function isUser(value: unknown): boolean {
  return is<User>(value);
}
export function validateUser(value: unknown) {
  return validate<User>(value);
}
