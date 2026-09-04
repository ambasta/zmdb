import type { ReflectDiagnostic } from '@zmdb/aot-validator/reflect';
import { schemaIrsFrom } from '@zmdb/aot-validator/testing';
import type { HasDefault, PrimaryKey, References, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import type { ColumnIR, SchemaIR } from '../ir/index.js';

// Referential-action declaration and refusal tests freeze (#455), against
// `./SPEC.md` §1.1.
//
// The public tags do not exist yet, but the reflector is the real behavioral
// boundary that must eventually read them. Local weak tags use the exact symbol
// basenames the vocabulary table will recognize. They are real `const` values in
// this test module, not `declare const` stubs; their public shape is independently
// pinned by `referential-actions.type-test.ts`.

type ReferentialAction = 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action';

const zmdbOnDelete: unique symbol = Symbol('zmdb OnDelete test tag');
const zmdbOnUpdate: unique symbol = Symbol('zmdb OnUpdate test tag');
const zmdbForeignKey: unique symbol = Symbol('zmdb ForeignKey test tag');

type OnDelete<Action extends ReferentialAction> = { readonly [zmdbOnDelete]?: Action };
type OnUpdate<Action extends ReferentialAction> = { readonly [zmdbOnUpdate]?: Action };
type ForeignKey<Local extends string, TargetTable extends string, Target extends string> = {
  readonly [zmdbForeignKey]?: {
    readonly columns: Local;
    readonly targetTable: TargetTable;
    readonly targetColumns: Target;
  };
};

export interface ActionColumns extends Table<'action_columns'> {
  id: number & Sql<'integer'> & PrimaryKey;
  authorId: number & Sql<'integer'> & References<'users.id'> & OnDelete<'cascade'> & OnUpdate<'restrict'>;
  editorId: (number & Sql<'integer'> & References<'users.id'> & OnDelete<'set null'>) | null;
  ownerId: number & Sql<'integer'> & References<'users.id'> & HasDefault & OnDelete<'set default'>;
  reviewerId: number & Sql<'integer'> & References<'users.id'>;
}

export interface InvalidSetNull extends Table<'invalid_set_null'> {
  id: number & Sql<'integer'> & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'> & OnDelete<'set null'>;
}

export interface InvalidSetDefault extends Table<'invalid_set_default'> {
  id: number & Sql<'integer'> & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'> & OnUpdate<'set default'>;
}

export interface CompositeMembership
  extends Table<'composite_memberships'>, ForeignKey<'tenantId,userId', 'users', 'tenantId,id'> {
  id: number & Sql<'integer'> & PrimaryKey;
  tenantId: number & Sql<'integer'>;
  userId: number & Sql<'integer'>;
}

export interface InvalidCompositeLength
  extends Table<'invalid_composite_length'>, ForeignKey<'tenantId,userId', 'users', 'id'> {
  id: number & Sql<'integer'> & PrimaryKey;
  tenantId: number & Sql<'integer'>;
  userId: number & Sql<'integer'>;
}

interface Reflection {
  readonly ir: SchemaIR;
  readonly diagnostics: readonly ReflectDiagnostic[];
}

function reflect(name: string): Reflection {
  const diagnostics: ReflectDiagnostic[] = [];
  const irs = schemaIrsFrom(import.meta.url, [name], {
    onDiagnostics: found => diagnostics.push(...found),
  });
  const ir = irs[name];
  if (ir === undefined) throw new Error(`reflection returned no IR for ${name}`);
  return { ir, diagnostics };
}

const actionColumns = reflect('ActionColumns');
const invalidSetNull = reflect('InvalidSetNull');
const invalidSetDefault = reflect('InvalidSetDefault');
const compositeMembership = reflect('CompositeMembership');
const invalidCompositeLength = reflect('InvalidCompositeLength');

type FrozenColumnIR = ColumnIR & {
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
};

interface FrozenForeignKeyIR {
  readonly columns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
}

type FrozenSchemaIR = SchemaIR & {
  readonly foreignKeys: readonly FrozenForeignKeyIR[];
};

const renderedReasons = (table: string, reflection: Reflection): readonly string[] =>
  reflection.diagnostics.map(
    diagnostic => `${table}${diagnostic.path ? `.${diagnostic.path}` : ''}: ${diagnostic.reason}`,
  );

const column = (schema: SchemaIR, name: string): FrozenColumnIR | undefined =>
  schema.columns.find(candidate => candidate.name === name) as FrozenColumnIR | undefined;

describe('referential-action tags (frozen: relations/SPEC.md 1.1)', () => {
  // actual today: all four values are undefined. The local weak tags erase from
  // the data type, but TAG_NAMES has no onDelete/onUpdate entries to read them.
  it.fails('records ON DELETE and ON UPDATE independently on each referenced column', () => {
    const { ir } = actionColumns;
    expect({
      author: [column(ir, 'authorId')?.onDelete, column(ir, 'authorId')?.onUpdate],
      editor: [column(ir, 'editorId')?.onDelete, column(ir, 'editorId')?.onUpdate],
      owner: [column(ir, 'ownerId')?.onDelete, column(ir, 'ownerId')?.onUpdate],
      reviewer: [column(ir, 'reviewerId')?.onDelete, column(ir, 'reviewerId')?.onUpdate],
    }).toEqual({
      author: ['cascade', 'restrict'],
      editor: ['set null', undefined],
      owner: ['set default', undefined],
      reviewer: [undefined, undefined],
    });
  });

  // Green control: these are the two valid counterparts of the refusals below.
  // The implementation must not reject the nullable/defaulted forms while making
  // the invalid forms red.
  it('accepts SET NULL on a nullable column and SET DEFAULT on a defaulted column', () => {
    expect(actionColumns.diagnostics).toEqual([]);
    expect(column(actionColumns.ir, 'editorId')?.nullable).toBe(true);
    expect(column(actionColumns.ir, 'ownerId')?.hasDefault).toBe(true);
  });

  // actual today: [].
  it.fails('refuses SET NULL on a NOT NULL column at build time', () => {
    const reasons = renderedReasons('invalid_set_null', invalidSetNull).join('\n');
    expect(reasons).toContain("invalid_set_null.userId: OnDelete<'set null'>");
    expect(reasons).toContain('NOT NULL');
    expect(reasons).toContain("make the column nullable, or use 'cascade' or 'restrict'");
  });

  // actual today: [].
  it.fails('refuses SET DEFAULT on a column with no default at build time', () => {
    const reasons = renderedReasons('invalid_set_default', invalidSetDefault).join('\n');
    expect(reasons).toContain("invalid_set_default.userId: OnUpdate<'set default'>");
    expect(reasons).toMatch(/HasDefault|no default/i);
  });
});

describe('explicit composite foreign keys (frozen: relations/SPEC.md 1.1)', () => {
  // actual today: `foreignKeys` is undefined. Because the table-level tag is not
  // in TAG_NAMES yet, today's reflector silently turns its symbol slot into a
  // third column named `__@zmdbForeignKey@20` and reports no diagnostic. The
  // expected value is what makes recognition, not merely silence, pass.
  it.fails('reflects an explicit composite foreign key without grouping separate References columns', () => {
    const ir = compositeMembership.ir as FrozenSchemaIR;
    expect(
      ir.foreignKeys.map(foreignKey => ({
        columns: foreignKey.columns,
        targetTable: foreignKey.targetTable,
        targetColumns: foreignKey.targetColumns,
      })),
    ).toEqual([
      {
        columns: ['tenantId', 'userId'],
        targetTable: 'users',
        targetColumns: ['tenantId', 'id'],
      },
    ]);
  });

  // actual today: no diagnostic; the table tag is the same phantom third column.
  it.fails('refuses a composite foreign key whose column lists have different lengths', () => {
    const reasons = renderedReasons('invalid_composite_length', invalidCompositeLength).join('\n');
    expect(reasons).toContain('2 local columns');
    expect(reasons).toContain('1 target column');
    expect(reasons).toContain('positionally paired');
  });
});
