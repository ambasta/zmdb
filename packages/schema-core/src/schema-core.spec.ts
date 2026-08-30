import { describe, it, expect } from 'vitest';

import {
  serial,
  integer,
  varchar,
  text,
  json,
  jsonEnum,
  boolean,
  timestamp,
  notNull,
  primaryKey,
  defaultTo,
  validate,
  defineSchema,
  SchemaError,
  unique,
  references as references_,
} from './index.ts';

// RED PHASE (#11 spec freeze): these tests encode the frozen spec and MUST
// fail until #12–#15 implement it.

describe('column builders', () => {
  it('serial() carries autoIncrement + hasDefault + not-null defaults', () => {
    const c = serial();
    expect(c.type).toBe('serial');
    expect(c.flags.autoIncrement).toBe(true);
    expect(c.flags.hasDefault).toBe(true);
    expect(c.flags.nullable).toBe(false);
  });

  it('integer/text/boolean/timestamp/json default to not-null', () => {
    for (const c of [integer(), text(), boolean(), timestamp(), json()]) {
      expect(c.flags.nullable).toBe(false);
    }
  });

  it('json() returns exact literal metadata signature', () => {
    const c = json();
    expect(c.type).toBe('json');
    expect(c.flags.nullable).toBe(false);
  });

  it('varchar(n) captures length', () => {
    expect(varchar(255).flags.length).toBe(255);
  });

  it('jsonEnum captures its values', () => {
    const c = jsonEnum(['a', 'b', 'c']);
    expect(c.type).toBe('jsonEnum');
    expect(c.flags.enum).toEqual(['a', 'b', 'c']);
  });

  it('builder output is frozen (immutable)', () => {
    const c = integer();
    expect(Object.isFrozen(c)).toBe(true);
  });
});

describe('modifiers', () => {
  it('are pure — do not mutate the input column', () => {
    const base = integer();
    const modified = notNull(base);
    expect(modified).not.toBe(base);
    expect(base.flags.nullable).toBe(false);
  });

  it('chaining is order-independent for flag setters', () => {
    const a = unique_pk(integer());
    const b = pk_unique(integer());
    expect(a.flags.primaryKey).toBe(b.flags.primaryKey);
    expect(a.flags.unique).toBe(b.flags.unique);
  });

  it('defaultTo sets hasDefault flag and value', () => {
    const c = defaultTo(text(), 'hello');
    expect(c.default).toBe('hello');
    expect(c.flags.hasDefault).toBe(true);
  });

  it('validate appends a rule', () => {
    const c = validate(text(), { kind: 'minLength', value: 3 });
    expect(c.validation).toEqual([{ kind: 'minLength', value: 3 }]);
  });

  it('method-style equals function-style', () => {
    const fluent = text().notNull().validate({ kind: 'minLength', value: 3 });
    const functional = validate(notNull(text()), { kind: 'minLength', value: 3 });
    expect(fluent).toEqual(functional);
  });

  it('fluent chaining primaryKey sets primaryKey and hasDefault flags', () => {
    const col = text().primaryKey();
    expect(col.type).toBe('text');
    expect(col.flags.primaryKey).toBe(true);
    expect(col.flags.hasDefault).toBe(true);
  });

  it('fluent chaining notNull narrows nullable flag from true to false', () => {
    const nullableCol = text().nullable();
    expect(nullableCol.flags.nullable).toBe(true);
    const notNullCol = nullableCol.notNull();
    expect(notNullCol.flags.nullable).toBe(false);
  });

  it('fluent chaining defaultTo sets default value and hasDefault flag', () => {
    const col = text().defaultTo('default-val');
    expect(col.default).toBe('default-val');
    expect(col.flags.hasDefault).toBe(true);
  });
});

describe('defineSchema', () => {
  it('derives primaryKey from column flags', () => {
    const s = defineSchema('users', {
      id: primaryKey(serial()),
      email: text(),
    });
    expect(s.table).toBe('users');
    expect(s.primaryKey).toEqual(['id']);
  });

  it('throws SchemaError when there is no primary key', () => {
    expect(() => defineSchema('bad', { name: text() })).toThrow(SchemaError);
  });

  it('throws SchemaError synchronously when a serial column lacks primary key designation and no other primary key exists', () => {
    expect(() => defineSchema('users', { id: serial(), email: text() })).toThrow(SchemaError);
    expect(() => defineSchema('users', { id: serial(), email: text() })).toThrow(
      'serial column "id" in schema "users" must be designated as a primary key',
    );
  });

  it('allows non-primary serial column when another primary key is declared', () => {
    const s = defineSchema('users', { email: text().primaryKey(), revision: serial() });
    expect(s.primaryKey).toEqual(['email']);
    expect(s.columns.revision.type).toBe('serial');
  });

  it('accepts composite primary key configurations involving serial columns', () => {
    const s = defineSchema('order_items', {
      orderId: serial().primaryKey(),
      itemId: integer().primaryKey(),
      quantity: integer(),
    });
    expect(s.primaryKey).toEqual(['orderId', 'itemId']);
  });

  it('derives references metadata', () => {
    const s = defineSchema('orders', {
      id: primaryKey(serial()),
      userId: references_(integer(), 'users.id'),
    });
    expect(s.references).toContainEqual({ column: 'userId', target: 'users.id' });
  });

  it('returns a deeply frozen schema', () => {
    const s = defineSchema('users', { id: primaryKey(serial()) });
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.columns)).toBe(true);
  });
});

// local helpers using the public API (kept explicit to avoid import churn)
function unique_pk(c: ReturnType<typeof integer>) {
  return unique(primaryKey(c));
}
function pk_unique(c: ReturnType<typeof integer>) {
  return primaryKey(unique(c));
}
