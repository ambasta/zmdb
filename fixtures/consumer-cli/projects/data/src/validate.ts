import { is, validate } from '@zmdb/aot-validator/utilities';
import { schemaOf } from '@zmdb/schema-core';

import type { User } from './user.js';

export const users = schemaOf<User>();
export function isUser(value: unknown): boolean {
  return is<User>(value);
}
export function validateUser(value: unknown) {
  return validate<User>(value);
}
