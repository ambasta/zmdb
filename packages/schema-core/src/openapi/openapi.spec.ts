import { describe, expect, it } from 'vitest';

import { defineSchema, sensitive, serial, text, type CoreSchema } from '../index.ts';
import {
  toJsonSchema,
  toJsonSchemaWithRelations,
  toListSchema,
  toOpenApiComponents,
  toSearchSchema,
  type Variant,
} from './index.ts';

// RED PHASE (#63 spec freeze): JSON Schema / OpenAPI golden fixtures.

// Hand-built schema literal (defineSchema is itself unimplemented).
const UserSchema = {
  table: 'users',
  columns: {
    id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
    email: {
      type: 'text',
      flags: { nullable: false },
      validation: [{ kind: 'pattern', value: '^[^@]+@[^@]+\\.[^@]+$' }],
    },
    role: { type: 'jsonEnum', flags: { nullable: false, hasDefault: true, enum: ['admin', 'user', 'guest'] } },
    createdAt: { type: 'timestamp', flags: { nullable: false, hasDefault: true } },
  },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'users'>;

describe('toJsonSchema (entity)', () => {
  it('matches the frozen golden fixture', () => {
    expect(toJsonSchema(UserSchema, 'entity')).toEqual({
      type: 'object',
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
        email: { type: 'string', pattern: '^[^@]+@[^@]+\\.[^@]+$' },
        id: { type: 'integer' },
        role: { type: 'string', enum: ['admin', 'user', 'guest'] },
      },
      required: ['createdAt', 'email', 'id', 'role'],
    });
  });

  it('is deterministic (twice → identical)', () => {
    expect(toJsonSchema(UserSchema)).toEqual(toJsonSchema(UserSchema));
  });
});

describe('toJsonSchema variants', () => {
  it('create omits autoIncrement and makes hasDefault optional', () => {
    const s = toJsonSchema(UserSchema, 'create');
    expect(Object.keys(s.properties)).not.toContain('id'); // autoIncrement omitted
    expect(s.required).not.toContain('role'); // hasDefault → optional
    expect(s.required).not.toContain('createdAt');
    expect(s.required).toContain('email');
  });

  it('update makes everything optional', () => {
    expect(toJsonSchema(UserSchema, 'update').required).toEqual([]);
  });
});

describe('toOpenApiComponents', () => {
  it('keys schemas by PascalCase table name', () => {
    const c = toOpenApiComponents([UserSchema]);
    expect(Object.keys(c.schemas)).toContain('User');
  });
});

describe('sensitive field redaction in OpenAPI specs', () => {
  const SchemaWithSecret = defineSchema('users', {
    id: serial().primaryKey(),
    email: text().notNull(),
    passwordHash: sensitive(text().notNull()),
    apiToken: text().notNull().sensitive(),
  });

  const variants: Variant[] = ['entity', 'create', 'update', 'get', 'list', 'search'];

  for (const variant of variants) {
    it(`omits sensitive fields from toJsonSchema for variant "${variant}"`, () => {
      const s = toJsonSchema(SchemaWithSecret, variant);
      expect(s.properties).not.toHaveProperty('passwordHash');
      expect(s.properties).not.toHaveProperty('apiToken');
      expect(s.properties).toHaveProperty('email');
      expect(s.required).not.toContain('passwordHash');
      expect(s.required).not.toContain('apiToken');
    });
  }

  it('omits sensitive fields from toOpenApiComponents', () => {
    const c = toOpenApiComponents([SchemaWithSecret]);
    const userSchema = c.schemas.User;
    expect(userSchema.properties).not.toHaveProperty('passwordHash');
    expect(userSchema.properties).not.toHaveProperty('apiToken');
    expect(userSchema.required).not.toContain('passwordHash');
  });

  it('omits sensitive fields from toJsonSchemaWithRelations', () => {
    const s = toJsonSchemaWithRelations(SchemaWithSecret, {}, 'entity');
    expect(s.properties).not.toHaveProperty('passwordHash');
    expect(s.properties).not.toHaveProperty('apiToken');
  });

  it('omits sensitive fields from toListSchema and toSearchSchema', () => {
    const listS = toListSchema(SchemaWithSecret);
    const itemsProp = (listS.properties.items as { items: { properties: Record<string, unknown> } }).items;
    expect(itemsProp.properties).not.toHaveProperty('passwordHash');
    expect(itemsProp.properties).not.toHaveProperty('apiToken');

    const searchS = toSearchSchema(SchemaWithSecret);
    const searchItemsProp = (searchS.properties.items as { items: { properties: Record<string, unknown> } }).items;
    expect(searchItemsProp.properties).not.toHaveProperty('passwordHash');
    expect(searchItemsProp.properties).not.toHaveProperty('apiToken');
  });
});
