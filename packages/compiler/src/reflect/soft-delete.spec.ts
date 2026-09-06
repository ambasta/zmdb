import type { PrimaryKey, Serial, SoftDelete, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { schemasFrom } from '../testing/index.js';
import type { ReflectDiagnostic } from './index.js';

export interface SoftDeleteUser extends Table<'soft_delete_users'>, SoftDelete<'deletedAt'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  deletedAt: (Date & Sql<'timestamp'>) | null;
}

export interface MissingSoftDeleteColumn extends Table<'missing_soft_delete'>, SoftDelete<'deletedAt'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
}

export interface RequiredSoftDeleteColumn extends Table<'required_soft_delete'>, SoftDelete<'deletedAt'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  deletedAt: Date & Sql<'timestamp'>;
}

export interface BooleanSoftDeleteColumn extends Table<'boolean_soft_delete'>, SoftDelete<'deleted'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  deleted: (boolean & Sql<'boolean'>) | null;
}

const diagnostics: ReflectDiagnostic[] = [];
const { SoftDeleteUser: valid } = schemasFrom(
  import.meta.url,
  ['SoftDeleteUser', 'MissingSoftDeleteColumn', 'RequiredSoftDeleteColumn', 'BooleanSoftDeleteColumn'],
  { onDiagnostics: found => diagnostics.push(...found) },
);

function reasons(table: string): readonly string[] {
  return diagnostics.filter(diagnostic => diagnostic.path === table).map(diagnostic => diagnostic.reason);
}

describe('SoftDelete reflection', () => {
  it('records the declared nullable timestamp column in SchemaIR', () => {
    expect(valid.ir.softDelete).toEqual({ column: 'deletedAt' });
    expect(reasons('soft_delete_users')).toEqual([]);
  });

  it('refuses a missing column before a repository can compile its filter', () => {
    expect(reasons('missing_soft_delete').join('\n')).toContain(
      "SoftDelete<'deletedAt'> names a column that does not exist",
    );
  });

  it('refuses a non-nullable soft-delete column', () => {
    expect(reasons('required_soft_delete').join('\n')).toContain(
      'a soft-delete column must be nullable because IS NULL is what "live" means',
    );
  });

  it('refuses a non-timestamp soft-delete column', () => {
    expect(reasons('boolean_soft_delete').join('\n')).toContain("a soft-delete column must use Sql<'timestamp'>");
  });
});
