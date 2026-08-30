import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  defineSchema,
  serial,
  text,
  integer,
  references,
  type Entity,
} from '../index.ts';
import {
  manyToOne,
  oneToMany,
  oneToOne,
  manyToMany,
  type PopulatedEntity,
  type RelationMeta,
} from './index.ts';

// Target Schemas for testing
const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
});

const ProfileSchema = defineSchema('profiles', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  bio: text(),
});

type User = Entity<typeof UserSchema>;

describe('Typed Foreign Keys & Schema Generic Constraints', () => {
  describe('references validation', () => {
    it('allows valid foreign key reference matching target column and type', () => {
      const OrderSchema = defineSchema('orders', {
        id: serial().primaryKey(),
        // userId: integer FK matching UserSchema.id (serial/integer -> number)
        userId: references(integer(), UserSchema, 'id'),
      });

      expect(OrderSchema.references).toContainEqual({
        column: 'userId',
        target: 'users.id',
      });
    });

    it('allows foreign key reference with generic target type', () => {
      const OrderSchema = defineSchema('orders', {
        id: serial().primaryKey(),
        userId: references<typeof UserSchema, 'id'>(integer(), 'users.id'),
      });

      expect(OrderSchema.references).toContainEqual({
        column: 'userId',
        target: 'users.id',
      });
    });

    it('fails compile-time check when referencing non-existent target column', () => {
      // @ts-expect-error - 'invalid_col' does not exist on UserSchema
      references(integer(), UserSchema, 'invalid_col');

      // @ts-expect-error - 'non_existent' does not exist on UserSchema
      references<typeof UserSchema, 'non_existent'>(integer(), 'users.non_existent');
    });

    it('fails compile-time check when local column data type differs from target column data type', () => {
      // @ts-expect-error - local text() (string) vs target UserSchema.id (serial/number)
      references(text(), UserSchema, 'id');

      // @ts-expect-error - local text() (string) vs target UserSchema.id (serial/number)
      references<typeof UserSchema, 'id'>(text(), 'users.id');
    });
  });

  describe('Relation Builders', () => {
    it('manyToOne validates target FK column and preserves target entity type', () => {
      const userRel = manyToOne(UserSchema, 'id');
      expect(userRel.target).toBe('users');
      expect(userRel.fk).toBe('id');
      expect(userRel.owning).toBe(true);

      // Fails on invalid column name
      // @ts-expect-error - 'bad_col' is not a column of UserSchema
      manyToOne(UserSchema, 'bad_col');

      // Fails on invalid column name via generic type parameter
      // @ts-expect-error - 'bad_col' is not a column of UserSchema
      manyToOne<typeof UserSchema>('users', 'bad_col');
    });

    it('oneToMany validates target mappedBy column and preserves target entity type', () => {
      const ordersRel = oneToMany(ProfileSchema, 'userId');
      expect(ordersRel.target).toBe('profiles');
      expect(ordersRel.mappedBy).toBe('userId');
      expect(ordersRel.owning).toBe(false);

      // Fails on invalid mappedBy column
      // @ts-expect-error - 'missing_fk' is not a column of ProfileSchema
      oneToMany(ProfileSchema, 'missing_fk');
    });

    it('oneToOne validates target FK column', () => {
      const profileRel = oneToOne(ProfileSchema, 'userId');
      expect(profileRel.target).toBe('profiles');
      expect(profileRel.fk).toBe('userId');
      expect(profileRel.owning).toBe(true);

      // @ts-expect-error - 'unknown_col' is not a column of ProfileSchema
      oneToOne(ProfileSchema, 'unknown_col');
    });

    it('manyToMany sets target and through table', () => {
      const tagsRel = manyToMany(UserSchema, 'user_tags');
      expect(tagsRel.target).toBe('users');
      expect(tagsRel.through).toBe('user_tags');
      expect(tagsRel.owning).toBe(true);
    });
  });

  describe('Downstream Type Inference', () => {
    it('infers target entity types for populated queries without manual type casting', () => {
      const userRel = manyToOne(UserSchema, 'id');
      const profileRel = oneToMany(ProfileSchema, 'userId');

      type OrderBase = { id: number; total: number };
      type Relations = {
        user: typeof userRel;
        profiles: typeof profileRel;
      };

      type PopulatedOrder = PopulatedEntity<OrderBase, Relations, 'user' | 'profiles'>;

      expectTypeOf<PopulatedOrder['user']>().toEqualTypeOf<User>();
      expectTypeOf<PopulatedOrder['profiles']>().toEqualTypeOf<Entity<typeof ProfileSchema>[]>();
    });
  });
});
