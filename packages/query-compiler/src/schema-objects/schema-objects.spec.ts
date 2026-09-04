import { describe, expect, it } from 'vitest';

import type { Dialect } from '../index.js';
import { ddlType } from '../migrations/index.js';
import { UnsupportedFeatureError, quoteId } from './index.js';

// Stored-routine DDL tests freeze for #437. The normative contract is
// `./SPEC.md` §8, frozen by #436. Every absent behavior is an `it.fails` that
// reaches the real package module through `routineModule`; the two green controls
// pin the identifier and type renderers the eventual emitter has to reuse.

type RoutineSqlType =
  | 'serial'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'text'
  | 'varchar'
  | 'boolean'
  | 'timestamp'
  | 'json'
  | 'jsonEnum';

interface FrozenRoutineDef {
  readonly kind: 'function' | 'procedure';
  readonly name: string;
  readonly params: readonly {
    readonly name: string;
    readonly type: RoutineSqlType;
    readonly mode?: 'in' | 'out' | 'inout';
  }[];
  readonly returns?: { readonly type: RoutineSqlType | 'void'; readonly setof?: boolean };
  readonly language?: string;
  readonly deterministic?: boolean;
  readonly body: string;
}

interface RoutineModule {
  createRoutineDdl(def: FrozenRoutineDef, dialect: Dialect): string;
  dropRoutineDdl(def: FrozenRoutineDef, dialect: Dialect): string;
  replaceRoutineStatements(
    previous: FrozenRoutineDef | undefined,
    next: FrozenRoutineDef,
    dialect: Dialect,
  ): readonly string[];
  routineFingerprint(def: FrozenRoutineDef): string;
}

const ROUTINE_EXPORTS = [
  'createRoutineDdl',
  'dropRoutineDdl',
  'replaceRoutineStatements',
  'routineFingerprint',
] as const;

function isRoutineModule(loaded: object): loaded is RoutineModule {
  return ROUTINE_EXPORTS.every(name => typeof Reflect.get(loaded, name) === 'function');
}

async function routineModule(): Promise<RoutineModule> {
  const loaded: unknown = await import('./index.js');
  if (typeof loaded !== 'object' || loaded === null) {
    throw new Error('@zmdb/query-compiler/schema-objects did not load as a module record');
  }
  if (!isRoutineModule(loaded)) {
    const missing = ROUTINE_EXPORTS.filter(name => typeof Reflect.get(loaded, name) !== 'function');
    throw new Error(`@zmdb/query-compiler/schema-objects exports no ${missing.join(', ')}`);
  }
  return loaded;
}

const archiveFunction: FrozenRoutineDef = {
  kind: 'function',
  name: 'archive_old_orders',
  params: [{ name: 'cutoff', type: 'timestamp' }],
  returns: { type: 'integer' },
  language: 'plpgsql',
  body: 'DECLARE moved INTEGER;\nBEGIN\n  moved := 1;\n  RETURN moved;\nEND;',
};

describe('stored routine DDL (frozen: schema-objects/SPEC.md 8)', () => {
  it('quotes routine identifiers with the existing dialect rules', () => {
    expect(quoteId('postgres', 'odd"name')).toBe('"odd""name"');
    expect(quoteId('mysql', 'odd`name')).toBe('`odd``name`');
  });

  it('renders routine parameter types through the existing column type map', () => {
    const column = { name: 'cutoff', type: 'timestamp', nullable: false, primaryKey: false };
    expect(ddlType('postgres', column)).toBe('TIMESTAMPTZ');
    expect(ddlType('mysql', column)).toBe('DATETIME(3)');
  });

  // Actual at e4a6b064: the module boundary reports all four routine exports
  // missing. Once present, this assertion freezes the complete statement and
  // the RETURNS -> LANGUAGE -> AS clause order.
  it.fails('emits CREATE OR REPLACE FUNCTION with a dollar-quoted body', async () => {
    const routines = await routineModule();
    expect(routines.createRoutineDdl(archiveFunction, 'postgres')).toBe(
      'CREATE OR REPLACE FUNCTION "archive_old_orders"("cutoff" TIMESTAMPTZ) ' +
        'RETURNS INTEGER LANGUAGE plpgsql AS $zmdb$\n' +
        'DECLARE moved INTEGER;\n' +
        'BEGIN\n' +
        '  moved := 1;\n' +
        '  RETURN moved;\n' +
        'END;\n' +
        '$zmdb$',
    );
  });

  // The nested bare `$$` is ordinary body text. `$zmdb$` also collides, so the
  // smallest safe stable delimiter is `$zmdb1$`.
  it.fails('chooses a safe dollar-quote tag when the body contains $$', async () => {
    const routines = await routineModule();
    const body = "BEGIN\n  PERFORM $$nested$$;\n  PERFORM '$zmdb$';\nEND;";
    expect(routines.createRoutineDdl({ ...archiveFunction, body }, 'postgres')).toBe(
      'CREATE OR REPLACE FUNCTION "archive_old_orders"("cutoff" TIMESTAMPTZ) ' +
        'RETURNS INTEGER LANGUAGE plpgsql AS $zmdb1$\n' +
        `${body}\n` +
        '$zmdb1$',
    );
  });

  it.fails('emits a MySQL function as a drop-then-create pair', async () => {
    const routines = await routineModule();
    const mysqlFunction: FrozenRoutineDef = {
      kind: 'function',
      name: 'archive_old_orders',
      params: [{ name: 'cutoff', type: 'timestamp' }],
      returns: { type: 'integer' },
      body: 'BEGIN\n  RETURN 1;\nEND;',
    };
    expect(routines.replaceRoutineStatements(undefined, mysqlFunction, 'mysql')).toEqual([
      'DROP FUNCTION IF EXISTS `archive_old_orders`',
      'CREATE FUNCTION `archive_old_orders`(`cutoff` DATETIME(3)) RETURNS INT ' +
        'NOT DETERMINISTIC MODIFIES SQL DATA SQL SECURITY INVOKER\n' +
        'BEGIN\n  RETURN 1;\nEND;',
    ]);
  });

  it.fails('emits a MySQL procedure as one driver statement with no DELIMITER', async () => {
    const routines = await routineModule();
    const ddl = routines.createRoutineDdl(
      {
        kind: 'procedure',
        name: 'rebuild_search_index',
        params: [{ name: 'tenant_id', type: 'integer' }],
        body: 'BEGIN\n  DELETE FROM search_index WHERE tenant_id = tenant_id;\n  SELECT 1;\nEND;',
      },
      'mysql',
    );
    expect(ddl).toBe(
      'CREATE PROCEDURE `rebuild_search_index`(`tenant_id` INT) ' +
        'MODIFIES SQL DATA SQL SECURITY INVOKER\n' +
        'BEGIN\n  DELETE FROM search_index WHERE tenant_id = tenant_id;\n  SELECT 1;\nEND;',
    );
    expect(ddl).not.toContain('DELIMITER');
  });

  it.fails('refuses a MySQL routine with a language, naming the routine', async () => {
    const routines = await routineModule();
    const run = () => routines.createRoutineDdl(archiveFunction, 'mysql');
    expect(run).toThrow(UnsupportedFeatureError);
    expect(run).toThrow(/mysql/i);
    expect(run).toThrow(/archive_old_orders/);
    expect(run).toThrow(/language|plpgsql/i);
  });

  it.fails('refuses out and inout parameters, naming the parameter', async () => {
    const routines = await routineModule();
    for (const mode of ['out', 'inout'] as const) {
      const run = () =>
        routines.createRoutineDdl(
          {
            kind: 'procedure',
            name: 'collect_totals',
            params: [{ name: 'total', type: 'integer', mode }],
            body: 'BEGIN\n  total := 1;\nEND;',
          },
          'postgres',
        );
      expect(run, mode).toThrow(UnsupportedFeatureError);
      expect(run, mode).toThrow(/total/);
      expect(run, mode).toThrow(new RegExp(mode, 'i'));
    }
  });

  it.fails('refuses a routine on sqlite, naming the routine', async () => {
    const routines = await routineModule();
    const run = () => routines.createRoutineDdl(archiveFunction, 'sqlite');
    expect(run).toThrow(UnsupportedFeatureError);
    expect(run).toThrow(
      'sqlite does not support stored routines (function "archive_old_orders"); SQLite has no CREATE FUNCTION, ' +
        'so register the function on the connection instead — `node:sqlite` exposes `DatabaseSync#function` — ' +
        'and call it like any other',
    );
  });

  it.fails('drops a changed Postgres signature by its previous argument types', async () => {
    const routines = await routineModule();
    const next: FrozenRoutineDef = {
      ...archiveFunction,
      params: [{ name: 'cutoff', type: 'text' }],
    };
    const statements = routines.replaceRoutineStatements(archiveFunction, next, 'postgres');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe('DROP FUNCTION IF EXISTS "archive_old_orders"(TIMESTAMPTZ)');
    expect(statements[1]).toContain('CREATE OR REPLACE FUNCTION "archive_old_orders"("cutoff" TEXT)');
  });

  it.fails('uses CREATE OR REPLACE when a Postgres signature is unchanged', async () => {
    const routines = await routineModule();
    expect(
      routines.replaceRoutineStatements(
        archiveFunction,
        { ...archiveFunction, body: 'BEGIN RETURN 2; END;' },
        'postgres',
      ),
    ).toEqual([expect.stringMatching(/^CREATE OR REPLACE FUNCTION /)]);
  });
});
