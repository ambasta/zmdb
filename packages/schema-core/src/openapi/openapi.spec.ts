import { describe, it, expect } from 'vitest';
import { toJsonSchema, toOpenApiComponents } from './index.ts';
import type { CoreSchema } from '../index.ts';

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
    role: { type: 'jsonEnum', flags: { nullable: false, enum: ['admin', 'user', 'guest'] } },
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
