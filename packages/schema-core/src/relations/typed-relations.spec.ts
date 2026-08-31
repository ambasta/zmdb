import { describe, it, expect } from 'vitest';

import { defineSchema, serial, text, integer, references } from '../index.ts';
import { manyToOne, oneToMany, oneToOne, manyToMany } from './index.ts';

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

describe('Typed Foreign Keys & Schema Generic Constraints', () => {
  describe('references validation', () => {
    it('allows valid foreign key reference matching target column and type', () => {
      const OrderSchema = defineSchema('orders', {
        id: serial().primaryKey(),
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
  });

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
});
