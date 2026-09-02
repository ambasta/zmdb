import { describe, it, expect } from 'vitest';

import { ProfileSchema, UserSchema } from './fixtures.ts';
import { manyToOne, oneToMany, oneToOne, manyToMany } from './index.ts';

// The `references validation` half of this file went with `references()`.
//
// That function was a column modifier: it read the target schema *value*'s literal column map to
// compare the two column types, and refused a foreign key whose type did not match. Both it and
// `defineSchema` are gone, and the constraint it enforced is now spelled `References<'users.id'>`
// on the column, where the reflection reads it — checked in
// `aot-validator/src/reflect/reflect.spec.ts`, and followed to the schema value in
// `schema-core/src/ir/ir.spec.ts` and `repository/src/tagged-to-ddl.spec.ts`.
//
// What is genuinely not replaced: `references()` compared the two column types and the tag does
// not, because `References<'users.id'>` is a string and the reflection has one table in front of
// it. `tags/serial-foreign-key.type-test.ts` covers the one case a single declaration can still
// state — a foreign key pointing at a `Serial` column has to be a plain `number`, not a `Serial`
// itself — and cross-table type agreement is a check nothing performs today.
//
// The relation builders below take schema values and are untouched by any of that.

describe('Relation Builders', () => {
  it('manyToOne sets target FK column and owning status', () => {
    const userRel = manyToOne(UserSchema, 'id');
    expect(userRel.target).toBe('users');
    expect(userRel.fk).toBe('id');
    expect(userRel.owning).toBe(true);
  });

  it('oneToMany sets target mappedBy column and owning status', () => {
    const ordersRel = oneToMany(ProfileSchema, 'userId');
    expect(ordersRel.target).toBe('profiles');
    expect(ordersRel.mappedBy).toBe('userId');
    expect(ordersRel.owning).toBe(false);
  });

  it('oneToOne sets target FK column and owning status', () => {
    const profileRel = oneToOne(ProfileSchema, 'userId');
    expect(profileRel.target).toBe('profiles');
    expect(profileRel.fk).toBe('userId');
    expect(profileRel.owning).toBe(true);
  });

  it('manyToMany sets target and through table', () => {
    const tagsRel = manyToMany(UserSchema, 'user_tags');
    expect(tagsRel.target).toBe('users');
    expect(tagsRel.through).toBe('user_tags');
    expect(tagsRel.owning).toBe(true);
  });
});
