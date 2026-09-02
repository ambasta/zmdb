import { describe, it, expect } from 'vitest';

import { defineSchema, integer, jsonEnum, sensitive, serial, text, timestamp, type CoreSchema } from '../index.ts';
import {
  toJsonSchema,
  toJsonSchemaWithRelations,
  toListSchema,
  toOpenApiComponents,
  toSearchSchema,
  type Variant,
} from './index.ts';

// #63: JSON Schema / OpenAPI golden fixtures.

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull().validate({ kind: 'pattern', value: '^[^@]+@[^@]+\\.[^@]+$' }),
  role: jsonEnum(['admin', 'user', 'guest']).notNull().defaultTo('user'),
  createdAt: timestamp().notNull().defaultTo('now()'),
});

describe('toJsonSchema (entity)', () => {
  it('matches the frozen golden fixture', () => {
    expect(toJsonSchema(UserSchema, 'entity')).toEqual({
      type: 'object',
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
        email: { type: 'string', pattern: '^[^@]+@[^@]+\\.[^@]+$' },
        id: { type: 'integer' },
        // Sorted, not as declared above: `ColumnIR.enum` canonicalises the order because the
        // tagged front-end reads it back out of the checker, which does not preserve one.
        role: { type: 'string', enum: ['admin', 'guest', 'user'] },
      },
      required: ['createdAt', 'email', 'id', 'role'],
    });
  });

  it('is deterministic (twice → identical)', () => {
    expect(toJsonSchema(UserSchema)).toEqual(toJsonSchema(UserSchema));
  });

  it('preserves raw unescaped pattern strings with slashes and quotes for OpenAPI definitions', () => {
    const RawPatternSchema = {
      table: 'files',
      columns: {
        path: {
          type: 'text',
          flags: { nullable: false },
          validation: [{ kind: 'Pattern', args: ['^/usr/local/"bin"/.*$'] }],
        },
      },
      primaryKey: [],
      references: [],
    } as unknown as CoreSchema<'files'>;

    const schema = toJsonSchema(RawPatternSchema, 'entity');
    expect(schema.properties.path).toEqual({
      type: 'string',
      pattern: '^/usr/local/"bin"/.*$',
    });
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

  it('update omits the primary key even when the database does not generate it', () => {
    // A patch body identifies its row in the URL. `UpdateDTO<T>` has always dropped the
    // key; the variant only agreed by accident, because every key it had ever been given
    // was a `serial()` and those were dropped for a different reason.
    const Membership = defineSchema('memberships', {
      userId: integer().primaryKey(),
      groupId: integer().primaryKey(),
      note: text().nullable(),
    });
    expect(Object.keys(toJsonSchema(Membership, 'update').properties)).toEqual(['note']);
    expect(Object.keys(toJsonSchema(Membership, 'entity').properties)).toEqual(['groupId', 'note', 'userId']);
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
    expect(userSchema).toBeDefined();
    if (!userSchema) throw new Error('userSchema should be defined');
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
