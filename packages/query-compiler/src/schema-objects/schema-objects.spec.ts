import { describe, expect, it } from 'vitest';

import {
  createExtensionDdl,
  createIndexDdl,
  createRoutineDdl,
  dropRoutineDdl,
  quoteId,
  replaceRoutineStatements,
  routineFingerprint,
  type RoutineDef,
  UnsupportedFeatureError,
  ddlType,
} from './index.js';

describe('extension DDL (frozen: schema-objects/SPEC.md 7)', () => {
  it('quotes extension identifiers and version literals in the frozen clause order', () => {
    expect(createExtensionDdl({ name: 'vector' }, 'postgres')).toBe('CREATE EXTENSION IF NOT EXISTS "vector"');
    expect(createExtensionDdl({ name: 'postgis', schema: 'extensions' }, 'postgres')).toBe(
      'CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA "extensions"',
    );
    expect(createExtensionDdl({ name: 'vector', version: "0.7'0" }, 'postgres')).toBe(
      "CREATE EXTENSION IF NOT EXISTS \"vector\" VERSION '0.7''0'",
    );
  });

  it('refuses extension installation on mysql and sqlite', () => {
    for (const dialect of ['mysql', 'sqlite'] as const) {
      expect(() => createExtensionDdl({ name: 'vector' }, dialect)).toThrow(UnsupportedFeatureError);
      expect(() => createExtensionDdl({ name: 'vector' }, dialect)).toThrow(
        new RegExp(`${dialect} does not support database extensions`),
      );
    }
  });
});

// Stored-routine DDL tests landed expected-failing in #437 against the normative
// `./SPEC.md` §8 contract. #438 retires only this declaration/DDL/replacement
// surface; the compiler and repository call tests remain expected-failing for #439.

const archiveFunction: RoutineDef = {
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
    expect(ddlType('postgres', 'timestamp')).toBe('TIMESTAMPTZ');
    expect(ddlType('mysql', 'timestamp')).toBe('DATETIME(3)');
    const serialRoutine: RoutineDef = {
      kind: 'function',
      name: 'identity',
      params: [{ name: 'value', type: 'serial' }],
      returns: { type: 'serial' },
      language: 'sql',
      body: 'SELECT value;',
    };
    expect(createRoutineDdl(serialRoutine, 'postgres')).toContain('"value" INTEGER) RETURNS INTEGER');
    expect(
      createRoutineDdl(
        {
          kind: 'function',
          name: 'identity',
          params: [{ name: 'value', type: 'serial' }],
          returns: { type: 'serial' },
          body: 'RETURN value;',
        },
        'mysql',
      ),
    ).not.toContain('AUTO_INCREMENT');
  });

  it('emits CREATE OR REPLACE FUNCTION with a dollar-quoted body', () => {
    expect(createRoutineDdl(archiveFunction, 'postgres')).toBe(
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
  it('chooses a safe dollar-quote tag when the body contains $$', () => {
    const body = "BEGIN\n  PERFORM $$nested$$;\n  PERFORM '$zmdb$';\nEND;";
    expect(createRoutineDdl({ ...archiveFunction, body }, 'postgres')).toBe(
      'CREATE OR REPLACE FUNCTION "archive_old_orders"("cutoff" TIMESTAMPTZ) ' +
        'RETURNS INTEGER LANGUAGE plpgsql AS $zmdb1$\n' +
        `${body}\n` +
        '$zmdb1$',
    );
  });

  it('emits a MySQL function as a drop-then-create pair', () => {
    const mysqlFunction: RoutineDef = {
      kind: 'function',
      name: 'archive_old_orders',
      params: [{ name: 'cutoff', type: 'timestamp' }],
      returns: { type: 'integer' },
      body: 'BEGIN\n  RETURN 1;\nEND;',
    };
    expect(replaceRoutineStatements(undefined, mysqlFunction, 'mysql')).toEqual([
      'DROP FUNCTION IF EXISTS `archive_old_orders`',
      'CREATE FUNCTION `archive_old_orders`(`cutoff` DATETIME(3)) RETURNS INT ' +
        'NOT DETERMINISTIC MODIFIES SQL DATA SQL SECURITY INVOKER\n' +
        'BEGIN\n  RETURN 1;\nEND;',
    ]);
    expect(createRoutineDdl({ ...mysqlFunction, deterministic: true }, 'mysql')).toContain(
      'RETURNS INT DETERMINISTIC MODIFIES SQL DATA',
    );
  });

  it('inherits Postgres routine DDL on CockroachDB', () => {
    expect(createRoutineDdl(archiveFunction, 'cockroach')).toContain(
      'CREATE OR REPLACE FUNCTION "archive_old_orders"("cutoff" TIMESTAMPTZ) RETURNS INT4 LANGUAGE plpgsql',
    );
    expect(dropRoutineDdl(archiveFunction, 'cockroach')).toBe(
      'DROP FUNCTION IF EXISTS "archive_old_orders"(TIMESTAMPTZ)',
    );
    expect(
      replaceRoutineStatements(archiveFunction, { ...archiveFunction, body: 'BEGIN RETURN 2; END;' }, 'cockroach'),
    ).toEqual([expect.stringMatching(/^CREATE OR REPLACE FUNCTION /)]);
  });

  it('refuses SingleStore routine DDL instead of emitting MySQL grammar', () => {
    const singleStoreRoutine: RoutineDef = {
      kind: archiveFunction.kind,
      name: archiveFunction.name,
      params: archiveFunction.params,
      returns: { type: 'integer' },
      body: archiveFunction.body,
    };
    expect(() => createRoutineDdl(singleStoreRoutine, 'singlestore')).toThrow(
      /singlestore stored routines are not modeled.*hand-written migration/i,
    );
  });

  it('emits a MySQL procedure as one driver statement with no DELIMITER', () => {
    const ddl = createRoutineDdl(
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

  it('emits Postgres procedures and set-returning functions', () => {
    expect(
      createRoutineDdl(
        {
          kind: 'procedure',
          name: 'rebuild_search_index',
          params: [],
          body: 'BEGIN\n  DELETE FROM search_index;\nEND;',
        },
        'postgres',
      ),
    ).toBe(
      'CREATE OR REPLACE PROCEDURE "rebuild_search_index"() LANGUAGE plpgsql AS $zmdb$\n' +
        'BEGIN\n  DELETE FROM search_index;\nEND;\n' +
        '$zmdb$',
    );
    expect(
      createRoutineDdl(
        {
          kind: 'function',
          name: 'active_user_ids',
          params: [{ name: 'org_id', type: 'bigint' }],
          returns: { type: 'bigint', setof: true },
          language: 'sql',
          body: 'SELECT id FROM users WHERE org_id = org_id;',
        },
        'postgres',
      ),
    ).toContain('RETURNS SETOF BIGINT LANGUAGE sql');
  });

  it('refuses a MySQL routine with a language, naming the routine', () => {
    const run = () => createRoutineDdl(archiveFunction, 'mysql');
    expect(run).toThrow(UnsupportedFeatureError);
    expect(run).toThrow(/mysql/i);
    expect(run).toThrow(/archive_old_orders/);
    expect(run).toThrow(/language|plpgsql/i);
  });

  it('refuses out and inout parameters, naming the parameter', () => {
    for (const mode of ['out', 'inout'] as const) {
      const run = () =>
        createRoutineDdl(
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

  it('refuses a routine on sqlite, naming the routine', () => {
    const run = () => createRoutineDdl(archiveFunction, 'sqlite');
    expect(run).toThrow(UnsupportedFeatureError);
    expect(run).toThrow(
      'sqlite does not support stored routines (function "archive_old_orders"); SQLite has no CREATE FUNCTION, ' +
        'so register the function on the connection instead — `node:sqlite` exposes `DatabaseSync#function` — ' +
        'and call it like any other',
    );
  });

  it('drops a changed Postgres signature by its previous argument types', () => {
    const next: RoutineDef = {
      ...archiveFunction,
      params: [{ name: 'cutoff', type: 'text' }],
    };
    const statements = replaceRoutineStatements(archiveFunction, next, 'postgres');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe('DROP FUNCTION IF EXISTS "archive_old_orders"(TIMESTAMPTZ)');
    expect(statements[1]).toContain('CREATE OR REPLACE FUNCTION "archive_old_orders"("cutoff" TEXT)');
  });

  it('uses CREATE OR REPLACE when a Postgres signature is unchanged', () => {
    expect(
      replaceRoutineStatements(archiveFunction, { ...archiveFunction, body: 'BEGIN RETURN 2; END;' }, 'postgres'),
    ).toEqual([expect.stringMatching(/^CREATE OR REPLACE FUNCTION /)]);
  });

  it('drops routines with each dialect required signature', () => {
    expect(dropRoutineDdl(archiveFunction, 'postgres')).toBe(
      'DROP FUNCTION IF EXISTS "archive_old_orders"(TIMESTAMPTZ)',
    );
    expect(
      dropRoutineDdl(
        {
          kind: 'procedure',
          name: 'rebuild_search_index',
          params: [{ name: 'tenant_id', type: 'integer' }],
          body: '',
        },
        'postgres',
      ),
    ).toBe('DROP PROCEDURE IF EXISTS "rebuild_search_index"(INTEGER)');
    expect(dropRoutineDdl(archiveFunction, 'mysql')).toBe('DROP FUNCTION IF EXISTS `archive_old_orders`');
  });

  it('fingerprints every declared field and normalizes only trailing whitespace', () => {
    const withTrailingWhitespace = { ...archiveFunction, body: `${archiveFunction.body}   \n\n` };
    expect(routineFingerprint(withTrailingWhitespace)).toBe(routineFingerprint(archiveFunction));
    expect(routineFingerprint({ ...archiveFunction, deterministic: true })).not.toBe(
      routineFingerprint(archiveFunction),
    );
  });
});

describe('vector index DDL (frozen: schema-objects/SPEC.md 1.2)', () => {
  it('emits an ivfflat index with its lists option', () => {
    expect(
      createIndexDdl(
        {
          name: 'items_embedding_l2',
          table: 'items',
          method: 'ivfflat',
          columns: [{ column: 'embedding', opclass: 'vector_l2_ops' }],
          with: { lists: 100 },
        },
        'postgres',
      ),
    ).toBe('CREATE INDEX "items_embedding_l2" ON "items" USING ivfflat ("embedding" vector_l2_ops) WITH (lists = 100)');
  });

  it('emits an hnsw index with m and ef_construction', () => {
    expect(
      createIndexDdl(
        {
          name: 'items_embedding_cos',
          table: 'items',
          method: 'hnsw',
          columns: [{ column: 'embedding', opclass: 'vector_cosine_ops' }],
          with: { m: 16, ef_construction: 64 },
        },
        'postgres',
      ),
    ).toBe(
      'CREATE INDEX "items_embedding_cos" ON "items" USING hnsw ' +
        '("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64)',
    );
  });

  it('validates options against the selected method', () => {
    expect(() =>
      createIndexDdl(
        {
          name: 'items_embedding_l2',
          table: 'items',
          method: 'ivfflat',
          columns: [{ column: 'embedding', opclass: 'vector_l2_ops' }],
          with: { m: 16 },
        },
        'postgres',
      ),
    ).toThrow('ivfflat does not take the option `m` ("items_embedding_l2"); ivfflat options are (lists)');
    expect(() =>
      createIndexDdl(
        {
          name: 'items_embedding_l2',
          table: 'items',
          method: 'ivfflat',
          columns: [{ column: 'embedding', opclass: 'vector_l2_ops' }],
          with: { lists: 1.5 },
        },
        'postgres',
      ),
    ).toThrow('ivfflat option `lists` must be a non-negative integer');
  });

  it('refuses postgres-only methods on mysql and sqlite', () => {
    for (const dialect of ['mysql', 'sqlite'] as const) {
      expect(() =>
        createIndexDdl(
          {
            name: 'items_embedding_l2',
            table: 'items',
            method: 'ivfflat',
            columns: [{ column: 'embedding', opclass: 'vector_l2_ops' }],
          },
          dialect,
        ),
      ).toThrow(UnsupportedFeatureError);
    }
  });

  it('inherits MySQL index methods and expression-index refusal on SingleStore', () => {
    expect(
      createIndexDdl(
        {
          name: 'users_email',
          table: 'users',
          method: 'btree',
          columns: ['email'],
        },
        'singlestore',
      ),
    ).toBe('CREATE INDEX `users_email` USING BTREE ON `users` (`email`)');
    expect(() =>
      createIndexDdl(
        {
          name: 'users_email_ci',
          table: 'users',
          columns: [{ expr: 'lower(email)' }],
        },
        'singlestore',
      ),
    ).toThrow(/singlestore does not support an expression index/);
  });

  it('refuses a unique vector index before emitting invalid PostgreSQL DDL', () => {
    expect(() =>
      createIndexDdl(
        {
          name: 'items_embedding_unique',
          table: 'items',
          method: 'hnsw',
          unique: true,
          columns: [{ column: 'embedding', opclass: 'vector_cosine_ops' }],
        },
        'postgres',
      ),
    ).toThrow('postgres does not support a unique hnsw index ("items_embedding_unique" on "items")');
  });

  it('refuses an operator class that is not a SQL identifier', () => {
    expect(() =>
      createIndexDdl(
        {
          name: 'items_embedding_l2',
          table: 'items',
          method: 'ivfflat',
          columns: [{ column: 'embedding', opclass: 'vector_l2_ops) WHERE true; --' }],
        },
        'postgres',
      ),
    ).toThrow('index operator class "vector_l2_ops) WHERE true; --" is not a SQL identifier');
  });
});
