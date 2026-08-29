import { describe, it, expectTypeOf } from 'vitest';
import {
  serial,
  text,
  integer,
  jsonEnum,
  timestamp,
  primaryKey,
  notNull,
  defaultTo,
  type Entity,
  type CreateDTO,
  type UpdateDTO,
} from './index.ts';

// #14: compile-time type derivation. Type-level tests (TDD).

// A schema-shaped value (defineSchema itself is #15, still blocked). The
// derivation types read `S['columns']`, so a `{ columns }` shape is sufficient.
const columns = {
  id: primaryKey(serial()),
  email: notNull(text()),
  role: defaultTo(jsonEnum(['admin', 'user']), 'user'),
  age: integer(),
  createdAt: defaultTo(timestamp(), 'now'),
};
type S = { columns: typeof columns };

describe('type derivation', () => {
  it('Entity maps every column to its TS type', () => {
    expectTypeOf<Entity<S>['id']>().toEqualTypeOf<number>();
    expectTypeOf<Entity<S>['email']>().toEqualTypeOf<string>();
    expectTypeOf<Entity<S>['role']>().toEqualTypeOf<'admin' | 'user'>();
    expectTypeOf<Entity<S>['age']>().toEqualTypeOf<number>();
    expectTypeOf<Entity<S>['createdAt']>().toEqualTypeOf<Date>();
  });

  it('CreateDTO omits autoIncrement and makes hasDefault optional', () => {
    // id (autoIncrement) is omitted.
    expectTypeOf<CreateDTO<S>>().not.toHaveProperty('id');
    // role and createdAt (hasDefault) are optional.
    expectTypeOf<CreateDTO<S>['role']>().toEqualTypeOf<'admin' | 'user' | undefined>();
    // email (required) stays required.
    expectTypeOf<CreateDTO<S>['email']>().toEqualTypeOf<string>();
  });

  it('UpdateDTO is fully partial', () => {
    expectTypeOf<UpdateDTO<S>['email']>().toEqualTypeOf<string | undefined>();
  });
});
