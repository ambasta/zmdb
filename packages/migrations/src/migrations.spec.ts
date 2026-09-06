import { schemasFrom, type SchemasFromOptions } from '@zmdb/compiler/testing';
import { UnsupportedFeatureError, createQueryCompiler, type SqlDialect } from '@zmdb/query-compiler';
import {
  createIndexDdl,
  replaceRoutineStatements,
  routineFingerprint,
  type RoutineDef,
} from '@zmdb/query-compiler/schema-objects';
import type { Entity } from '@zmdb/schema-core';
import type { PrimaryKey, References, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect } from 'vitest';

import {
  ddlType,
  diff,
  emitUp,
  emitDown,
  snapshot,
  type ChangeOp,
  type ColumnSnapshot,
  type ExtensionType,
  type SchemaSnapshot,
  type SnapshotableSchema,
  type TableSnapshot,
} from './index.js';
import {
  mssqlDialect,
  officialDialects,
  postgresDialect,
  sqliteDialect,
  type OfficialDialectName,
} from './testing/official-dialects.fixture.js';

// RED PHASE (#40 spec freeze): diff engine + DDL emitter goldens.

const snap = (tables: SchemaSnapshot['tables']): SchemaSnapshot => ({ version: 1, tables, extensions: [] });

const usersV1 = snap([
  {
    name: 'users',
    columns: [
      { name: 'id', type: 'serial', nullable: false, primaryKey: true },
      { name: 'email', type: 'text', nullable: false, primaryKey: false },
    ],
    primaryKey: ['id'],
    foreignKeys: [],
  },
]);

const usersV2 = snap([
  {
    name: 'users',
    columns: [
      { name: 'id', type: 'serial', nullable: false, primaryKey: true },
      { name: 'email', type: 'text', nullable: false, primaryKey: false },
      { name: 'age', type: 'integer', nullable: false, primaryKey: false },
    ],
    primaryKey: ['id'],
    foreignKeys: [],
  },
]);

export interface NamingUser extends Table<'userAccount'> {
  id: number & Sql<'integer'> & PrimaryKey;
  createdAt: Date & Sql<'timestamp'>;
}

export interface NamingPost extends Table<'blogPost'> {
  id: number & Sql<'integer'> & PrimaryKey;
  userId: number & Sql<'integer'> & References<'userAccount.id'>;
}

// Keep project-config wiring out of this package-level test: the reflection
// helper receives one literal build-time strategy, and every SQL consumer below
// must use only the resolved physical names it records.
const namingStrategy = {
  column: (property: string) =>
    property === 'createdAt' ? 'created_at' : property === 'userId' ? 'user_id' : property,
  table: (declared: string) =>
    declared === 'userAccount' ? 'user_accounts' : declared === 'blogPost' ? 'blog_posts' : declared,
  index: (table: string, columns: readonly string[], unique: boolean) =>
    `${table}_${columns.join('_')}_${unique ? 'uniq' : 'idx'}`,
} satisfies NonNullable<SchemasFromOptions['naming']>;

const namingOptions = { naming: namingStrategy } satisfies SchemasFromOptions;

const { NamingUser: namingUserSchema, NamingPost: namingPostSchema } = schemasFrom<{
  NamingUser: NamingUser;
  NamingPost: NamingPost;
}>(import.meta.url, ['NamingUser', 'NamingPost'], namingOptions);

const compileNamingCalls: string[] = [];
const compileNamingStrategy = {
  column(property: string, context: { readonly table: string }) {
    compileNamingCalls.push(`column:${context.table}.${property}`);
    return property === 'createdAt' ? 'created_at' : property;
  },
  table(declared: string) {
    compileNamingCalls.push(`table:${declared}`);
    return declared === 'userAccount' ? 'user_accounts' : declared;
  },
} satisfies NonNullable<SchemasFromOptions['naming']>;
const compileNamingOptions = { naming: compileNamingStrategy } satisfies SchemasFromOptions;
const { NamingUser: compileNamingUserSchema } = schemasFrom<{ NamingUser: NamingUser }>(
  import.meta.url,
  ['NamingUser'],
  compileNamingOptions,
);

describe('diff engine', () => {
  it('identical snapshots → no ops', () => {
    expect(diff(usersV1, usersV1)).toEqual([]);
  });

  it('detects an added column', () => {
    const ops = diff(usersV1, usersV2);
    expect(ops).toContainEqual({
      kind: 'add_column',
      table: 'users',
      column: { name: 'age', type: 'integer', nullable: false, primaryKey: false },
    });
  });
});

describe('DDL emitter (postgres)', () => {
  const addAge = {
    kind: 'add_column' as const,
    table: 'users',
    column: { name: 'age', type: 'integer', nullable: false, primaryKey: false },
  };

  it('emits up SQL for add_column', () => {
    expect(emitUp(addAge, postgresDialect)).toBe('ALTER TABLE "users" ADD COLUMN "age" INTEGER NOT NULL');
  });

  it('down reverses up for add_column', () => {
    expect(emitDown(addAge, postgresDialect)).toBe('ALTER TABLE "users" DROP COLUMN "age"');
  });
});

describe('physical names through DDL and snapshots (frozen: migrations/SPEC.md 1.4)', () => {
  function namingTable() {
    const table = snapshot([namingUserSchema]).tables[0];
    expect(table).toBeDefined();
    return table as TableSnapshot;
  }

  function timestampColumn(table: TableSnapshot) {
    const column = table.columns.find(candidate => candidate.type === 'timestamp');
    expect(column).toBeDefined();
    return column as TableSnapshot['columns'][number];
  }

  it('emits DDL with physical names and derives Entity with property names', () => {
    const entity: Entity<NamingUser> = { id: 1, createdAt: new Date(0) };
    expect(Object.keys(entity).toSorted()).toEqual(['createdAt', 'id']);

    const table = namingTable();
    expect(
      emitUp(
        {
          kind: 'create_table',
          table: table.name,
          columns: table.columns,
          primaryKey: table.primaryKey,
          foreignKeys: table.foreignKeys,
        },
        postgresDialect,
      ),
    ).toBe('CREATE TABLE "user_accounts" ("created_at" TIMESTAMPTZ NOT NULL, "id" INTEGER PRIMARY KEY)');
  });

  it('derives an index name from physical names', () => {
    const table = namingTable();
    const column = timestampColumn(table);
    const name = namingStrategy.index?.(table.name, [column.name], false);
    expect(name).toBeDefined();
    expect(createIndexDdl({ name: name as string, table: table.name, columns: [column.name] }, postgresDialect)).toBe(
      'CREATE INDEX "user_accounts_created_at_idx" ON "user_accounts" ("created_at")',
    );
  });

  it('records physical names in the snapshot', () => {
    expect(snapshot([namingUserSchema])).toEqual({
      version: 1,
      extensions: [],
      tables: [
        {
          name: 'user_accounts',
          columns: [
            { name: 'created_at', type: 'timestamp', nullable: false, primaryKey: false },
            { name: 'id', type: 'integer', nullable: false, primaryKey: true },
          ],
          primaryKey: ['id'],
          foreignKeys: [],
        },
      ],
    });
  });

  it('does not rewrite a raw SQL fragment', () => {
    const table = namingTable();
    const column = timestampColumn(table);
    const ddl = createIndexDdl(
      {
        name: 'user_accounts_created_at_partial',
        table: table.name,
        columns: [column.name],
        where: 'createdAt IS NOT NULL',
      },
      postgresDialect,
    );

    expect(ddl).toBe(
      'CREATE INDEX "user_accounts_created_at_partial" ON "user_accounts" ("created_at") WHERE createdAt IS NOT NULL',
    );
    expect(ddl).not.toContain('WHERE created_at IS NOT NULL');
  });

  it('resolves naming before query compilation without runtime strategy calls', () => {
    const baseline = createQueryCompiler(postgresDialect)
      .selectFrom('userAccount')
      .select(['createdAt'])
      .compile().text;
    const resolvedCalls = compileNamingCalls.length;
    const physicalColumn = Object.keys(compileNamingUserSchema.columns).find(name => name !== 'id');
    expect(physicalColumn).toBeDefined();

    const named = createQueryCompiler(postgresDialect)
      .selectFrom(compileNamingUserSchema.table)
      .select([physicalColumn ?? ''])
      .compile().text;

    expect(baseline).toBe('SELECT "createdAt" FROM "userAccount"');
    expect(named).toBe('SELECT "created_at" FROM "user_accounts"');
    expect(named).not.toBe(baseline);
    expect(resolvedCalls).toBe(3);
    expect(compileNamingCalls).toHaveLength(resolvedCalls);
  });

  it('derives foreign-key columns, targets and constraint names from physical names', () => {
    const post = snapshot([namingUserSchema, namingPostSchema]).tables.find(table => table.name === 'blog_posts');

    expect(post?.foreignKeys).toEqual([
      {
        name: 'blog_posts_user_id_fkey',
        columns: ['user_id'],
        targetTable: 'user_accounts',
        targetColumns: ['id'],
        onDelete: 'no action',
        onUpdate: 'no action',
      },
    ]);
  });
});

// Referential actions tests freeze (#455), against `./SPEC.md` §1.6 and
// `@zmdb/schema-core`'s `relations/SPEC.md` §1.1.
//
// The implementation has no foreign-key snapshot or op yet. As in
// `composite-keys.spec.ts`, only the frozen widening is declared locally and each
// value is handed to the real exported function at one boundary. No function is
// declared or stubbed: today's switch falls through and returns `undefined`, which
// is the measured failure these assertions carry.

type ReferentialAction = 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action';

interface FrozenForeignKeySnapshot {
  readonly name: string;
  readonly columns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly onDelete: ReferentialAction;
  readonly onUpdate: ReferentialAction;
}

type FrozenTableSnapshot = Omit<TableSnapshot, 'foreignKeys'> & {
  readonly foreignKeys: readonly FrozenForeignKeySnapshot[];
};

type FrozenCreateTable = Extract<ChangeOp, { kind: 'create_table' }> & {
  // SPEC correction required by SQLite's own golden: an inline constraint cannot
  // be emitted from the currently frozen create_table payload without this field.
  readonly foreignKeys: readonly FrozenForeignKeySnapshot[];
};

interface AddForeignKey {
  readonly kind: 'add_foreign_key';
  readonly table: string;
  readonly fk: FrozenForeignKeySnapshot;
}

interface DropForeignKey {
  readonly kind: 'drop_foreign_key';
  readonly table: string;
  readonly name: string;
}

type FrozenChangeOp = ChangeOp | FrozenCreateTable | AddForeignKey | DropForeignKey;

function up(op: FrozenChangeOp, dialect: OfficialDialectName): string {
  return emitUp(op as ChangeOp, officialDialects[dialect]);
}

type SqlOutcome =
  | { readonly kind: 'sql'; readonly statements: readonly string[] | undefined }
  | { readonly kind: 'error'; readonly name: string; readonly message: string };

function capture(run: () => unknown): SqlOutcome {
  try {
    const value = run();
    return {
      kind: 'sql',
      // The public emitter returns one string. MySQL's required supporting index
      // makes that string contain two statements; the separator is not part of the
      // frozen contract, so compare the two complete statements rather than inventing
      // whether the join is `; ` or `;\n`.
      statements:
        typeof value === 'string'
          ? value
              .split(';')
              .map(statement => statement.trim())
              .filter(Boolean)
          : undefined,
    };
  } catch (error) {
    return {
      kind: 'error',
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const postsUserId: FrozenForeignKeySnapshot = {
  name: 'posts_user_id_fkey',
  columns: ['user_id'],
  targetTable: 'users',
  targetColumns: ['id'],
  onDelete: 'cascade',
  onUpdate: 'no action',
};

const addPostsUserId: AddForeignKey = {
  kind: 'add_foreign_key',
  table: 'posts',
  fk: postsUserId,
};

function createPosts(fk: FrozenForeignKeySnapshot, nullable = false): FrozenCreateTable {
  return {
    kind: 'create_table',
    table: 'posts',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true },
      { name: 'user_id', type: 'integer', nullable, primaryKey: false },
    ],
    primaryKey: ['id'],
    foreignKeys: [fk],
  };
}

function addStatement(dialect: Exclude<OfficialDialectName, 'sqlite'>, fk: FrozenForeignKeySnapshot): string {
  const q = dialect === 'mysql' ? '`' : '"';
  const names = (values: readonly string[]): string => values.map(value => `${q}${value}${q}`).join(', ');
  return (
    `ALTER TABLE ${q}posts${q} ADD CONSTRAINT ${q}${fk.name}${q} ` +
    `FOREIGN KEY (${names(fk.columns)}) REFERENCES ${q}${fk.targetTable}${q} (${names(fk.targetColumns)}) ` +
    `ON DELETE ${fk.onDelete.toUpperCase()} ON UPDATE ${fk.onUpdate.toUpperCase()}`
  );
}

function mysqlIndexStatement(fk: FrozenForeignKeySnapshot): string {
  return `CREATE INDEX \`${fk.name}_idx\` ON \`posts\` (` + fk.columns.map(column => `\`${column}\``).join(', ') + ')';
}

function sqliteCreateStatement(fk: FrozenForeignKeySnapshot, nullable = false): string {
  const local = fk.columns.map(column => `"${column}"`).join(', ');
  const target = fk.targetColumns.map(column => `"${column}"`).join(', ');
  return (
    'CREATE TABLE "posts" ("id" INT PRIMARY KEY NOT NULL, ' +
    `"user_id" INTEGER${nullable ? '' : ' NOT NULL'}, ` +
    `FOREIGN KEY (${local}) REFERENCES "${fk.targetTable}" (${target}) ` +
    `ON DELETE ${fk.onDelete.toUpperCase()} ON UPDATE ${fk.onUpdate.toUpperCase()})`
  );
}

describe('foreign-key DDL and actions (frozen: migrations/SPEC.md 1.6)', () => {
  // actual today:
  //   postgres undefined
  //   mysql    undefined
  //   sqlite   CREATE TABLE "posts" ("id" INT PRIMARY KEY NOT NULL, "user_id" INTEGER NOT NULL)
  // The SQLite value is a real CREATE TABLE with the extra `foreignKeys` field ignored.
  it('emits ON DELETE CASCADE on the foreign key', () => {
    expect({
      postgres: capture(() => up(addPostsUserId, 'postgres')),
      mysql: capture(() => up(addPostsUserId, 'mysql')),
      sqlite: capture(() => up(createPosts(postsUserId), 'sqlite')),
    }).toEqual({
      postgres: { kind: 'sql', statements: [addStatement('postgres', postsUserId)] },
      mysql: {
        kind: 'sql',
        statements: [mysqlIndexStatement(postsUserId), addStatement('mysql', postsUserId)],
      },
      sqlite: { kind: 'sql', statements: [sqliteCreateStatement(postsUserId)] },
    });
  });

  // Both action positions are set to the row's value. This covers all five spellings
  // for ON DELETE and ON UPDATE without pretending the two are one option.
  //
  // actual today: every add_foreign_key is `undefined`; every SQLite CREATE TABLE
  // omits the FOREIGN KEY; MySQL's SET DEFAULT path returns `undefined` rather than
  // refusing it.
  it('emits every supported referential action', () => {
    const actions: readonly ReferentialAction[] = ['cascade', 'restrict', 'set null', 'set default', 'no action'];
    const actual = Object.fromEntries(
      actions.map(action => {
        const fk: FrozenForeignKeySnapshot = {
          ...postsUserId,
          onDelete: action,
          onUpdate: action,
        };
        const nullable = action === 'set null';
        return [
          action,
          {
            postgres: capture(() => up({ kind: 'add_foreign_key', table: 'posts', fk }, 'postgres')),
            mysql: capture(() => up({ kind: 'add_foreign_key', table: 'posts', fk }, 'mysql')),
            sqlite: capture(() => up(createPosts(fk, nullable), 'sqlite')),
          },
        ];
      }),
    );
    const expected = Object.fromEntries(
      actions.map(action => {
        const fk: FrozenForeignKeySnapshot = {
          ...postsUserId,
          onDelete: action,
          onUpdate: action,
        };
        const nullable = action === 'set null';
        return [
          action,
          {
            postgres: { kind: 'sql', statements: [addStatement('postgres', fk)] },
            mysql:
              action === 'set default'
                ? {
                    kind: 'error',
                    name: 'UnsupportedFeatureError',
                    message: expect.stringMatching(/set default.*posts_user_id_fkey.*mysql/i),
                  }
                : {
                    kind: 'sql',
                    statements: [mysqlIndexStatement(fk), addStatement('mysql', fk)],
                  },
            sqlite: { kind: 'sql', statements: [sqliteCreateStatement(fk, nullable)] },
          },
        ];
      }),
    );
    expect(actual).toEqual(expected);
  });

  // The refusal gets its own named test as well as its row above: the issue DoD says
  // every refusal is named, and this message must identify all three facts an author
  // needs to change.
  //
  // actual today: { kind: 'sql', statements: undefined }
  it('refuses SET DEFAULT on mysql, naming the action, constraint and dialect', () => {
    const fk: FrozenForeignKeySnapshot = {
      ...postsUserId,
      onDelete: 'set default',
    };
    const outcome = capture(() => up({ kind: 'add_foreign_key', table: 'posts', fk }, 'mysql'));
    expect(outcome).toMatchObject({ kind: 'error', name: 'UnsupportedFeatureError' });
    expect(outcome).toMatchObject({
      message: expect.stringMatching(/set default.*posts_user_id_fkey.*mysql/i),
    });
  });

  // actual today: the add op returns undefined, so neither statement exists.
  it('creates the supporting index MySQL requires', () => {
    expect(capture(() => up(addPostsUserId, 'mysql'))).toEqual({
      kind: 'sql',
      statements: [mysqlIndexStatement(postsUserId), addStatement('mysql', postsUserId)],
    });
    expect(capture(() => up(addPostsUserId, 'postgres'))).toEqual({
      kind: 'sql',
      statements: [addStatement('postgres', postsUserId)],
    });
  });

  // actual today: the two ALTER ops return undefined, and SQLite's CREATE TABLE
  // contains only the columns.
  it('emits a composite foreign key referencing a composite key', () => {
    const fk: FrozenForeignKeySnapshot = {
      name: 'memberships_tenant_id_user_id_fkey',
      columns: ['tenant_id', 'user_id'],
      targetTable: 'users',
      targetColumns: ['tenant_id', 'id'],
      onDelete: 'cascade',
      onUpdate: 'restrict',
    };
    const createMemberships: FrozenCreateTable = {
      kind: 'create_table',
      table: 'memberships',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'tenant_id', type: 'integer', nullable: false, primaryKey: false },
        { name: 'user_id', type: 'integer', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [fk],
    };
    const postgres =
      'ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_user_id_fkey" ' +
      'FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users" ("tenant_id", "id") ' +
      'ON DELETE CASCADE ON UPDATE RESTRICT';
    const mysqlIndex =
      'CREATE INDEX `memberships_tenant_id_user_id_fkey_idx` ON `memberships` (`tenant_id`, `user_id`)';
    const mysql =
      'ALTER TABLE `memberships` ADD CONSTRAINT `memberships_tenant_id_user_id_fkey` ' +
      'FOREIGN KEY (`tenant_id`, `user_id`) REFERENCES `users` (`tenant_id`, `id`) ' +
      'ON DELETE CASCADE ON UPDATE RESTRICT';
    const sqlite =
      'CREATE TABLE "memberships" ("id" INT PRIMARY KEY NOT NULL, "tenant_id" INTEGER NOT NULL, ' +
      '"user_id" INTEGER NOT NULL, ' +
      'FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users" ("tenant_id", "id") ' +
      'ON DELETE CASCADE ON UPDATE RESTRICT)';

    expect({
      postgres: capture(() => up({ kind: 'add_foreign_key', table: 'memberships', fk }, 'postgres')),
      mysql: capture(() => up({ kind: 'add_foreign_key', table: 'memberships', fk }, 'mysql')),
      sqlite: capture(() => up(createMemberships, 'sqlite')),
    }).toEqual({
      postgres: { kind: 'sql', statements: [postgres] },
      mysql: { kind: 'sql', statements: [mysqlIndex, mysql] },
      sqlite: { kind: 'sql', statements: [sqlite] },
    });
  });
});

interface FrozenIrColumn {
  readonly name: string;
  readonly references?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

type FrozenSnapshotColumn = SnapshotableSchema['columns'][string] & {
  readonly references?: { readonly target: string };
};

interface FrozenSnapshotInput extends Omit<SnapshotableSchema, 'columns'> {
  readonly columns: Readonly<Record<string, FrozenSnapshotColumn>>;
  readonly ir: {
    readonly table: string;
    readonly columns: readonly FrozenIrColumn[];
  };
}

function snapshotInput(
  table: string,
  column: string,
  target: string,
  actions: { readonly onDelete?: ReferentialAction; readonly onUpdate?: ReferentialAction } = {},
): FrozenSnapshotInput {
  return {
    table,
    primaryKey: ['id'],
    columns: {
      id: { type: 'integer', flags: { nullable: false, primaryKey: true } },
      [column]: {
        type: 'integer',
        flags: { nullable: false },
        references: { target },
      },
    },
    ir: {
      table,
      columns: [{ name: 'id' }, { name: column, references: target, ...actions }],
    },
  };
}

function foreignKeysOf(input: FrozenSnapshotInput): readonly FrozenForeignKeySnapshot[] | undefined {
  const result = snapshot([input as SnapshotableSchema]);
  const table = result.tables[0] as FrozenTableSnapshot | undefined;
  return table?.foreignKeys;
}

describe('foreign keys on the snapshot (frozen: migrations/SPEC.md 1.6)', () => {
  // actual today: both snapshots omit `foreignKeys`, so both reads are undefined.
  it('names a generated constraint deterministically', () => {
    const input = snapshotInput('posts', 'user_id', 'users.id', { onDelete: 'cascade' });
    const first = foreignKeysOf(input);
    const second = foreignKeysOf(input);
    expect(first).toEqual(second);
    expect(first).toEqual([postsUserId]);
  });

  // The absence of both tags is not the absence of semantics: the snapshot states
  // NO ACTION explicitly so the emitted DDL does too.
  //
  // actual today: undefined.
  it('defaults omitted referential-action tags to NO ACTION', () => {
    expect(foreignKeysOf(snapshotInput('posts', 'user_id', 'users.id'))).toEqual([
      {
        ...postsUserId,
        onDelete: 'no action',
        onUpdate: 'no action',
      },
    ]);
  });

  // Each References tag is one single-column foreign key, even when two columns
  // point at the same table. Grouping these would assert created_by and
  // updated_by identify the same user, a rule the declaration never stated.
  //
  // actual today: undefined.
  it('keeps two References to one table as two foreign keys', () => {
    const input: FrozenSnapshotInput = {
      table: 'audit_entries',
      primaryKey: ['id'],
      columns: {
        id: { type: 'integer', flags: { nullable: false, primaryKey: true } },
        created_by: {
          type: 'integer',
          flags: { nullable: false },
          references: { target: 'users.id' },
        },
        updated_by: {
          type: 'integer',
          flags: { nullable: false },
          references: { target: 'users.id' },
        },
      },
      ir: {
        table: 'audit_entries',
        columns: [
          { name: 'id' },
          { name: 'created_by', references: 'users.id' },
          { name: 'updated_by', references: 'users.id' },
        ],
      },
    };
    expect(foreignKeysOf(input)).toEqual([
      {
        name: 'audit_entries_created_by_fkey',
        columns: ['created_by'],
        targetTable: 'users',
        targetColumns: ['id'],
        onDelete: 'no action',
        onUpdate: 'no action',
      },
      {
        name: 'audit_entries_updated_by_fkey',
        columns: ['updated_by'],
        targetTable: 'users',
        targetColumns: ['id'],
        onDelete: 'no action',
        onUpdate: 'no action',
      },
    ]);
  });

  // actual today: accepted; snapshot() returns a table with no foreignKeys field.
  it('refuses a generated constraint name longer than 63 characters', () => {
    const table = 'orders_with_a_deliberately_long_table_name';
    const column = 'customer_identifier_column';
    const generated = `${table}_${column}_fkey`;
    expect(generated.length).toBeGreaterThan(63);
    expect(() => foreignKeysOf(snapshotInput(table, column, 'customers.id'))).toThrow(
      new RegExp(`${String(generated.length)}.*63`),
    );
  });
});

function asSnapshot(tables: readonly FrozenTableSnapshot[]): SchemaSnapshot {
  return { version: 1, tables: tables as readonly TableSnapshot[], extensions: [] };
}

const postsColumns: TableSnapshot['columns'] = [
  { name: 'id', type: 'integer', nullable: false, primaryKey: true },
  { name: 'user_id', type: 'integer', nullable: false, primaryKey: false },
];

const noActionPosts: FrozenTableSnapshot = {
  name: 'posts',
  columns: postsColumns,
  primaryKey: ['id'],
  foreignKeys: [{ ...postsUserId, onDelete: 'no action' }],
};

const cascadePosts: FrozenTableSnapshot = {
  name: 'posts',
  columns: postsColumns,
  primaryKey: ['id'],
  foreignKeys: [postsUserId],
};

const postsWithoutForeignKeys: FrozenTableSnapshot = {
  name: 'posts',
  columns: postsColumns,
  primaryKey: ['id'],
  foreignKeys: [],
};

type FrozenDiff = (
  prev: SchemaSnapshot,
  next: SchemaSnapshot,
  opts?: { readonly dialect?: SqlDialect },
) => readonly FrozenChangeOp[];

// SPEC correction: SQLite's refusal needs the whole before/after pair. The frozen
// drop/add ops never carry both actions to one `emitUp` call, while `diff` has both
// snapshots and can name NO ACTION → CASCADE exactly.
const diffForDialect: FrozenDiff = diff;

describe('foreign-key diff and refusals (frozen: migrations/SPEC.md 1.6)', () => {
  // actual today: [] — diff compares table/column names and column types only.
  it('diffs a changed action into a drop and an add', () => {
    expect(diff(asSnapshot([noActionPosts]), asSnapshot([cascadePosts]))).toEqual([
      { kind: 'drop_foreign_key', table: 'posts', name: 'posts_user_id_fkey' },
      { kind: 'add_foreign_key', table: 'posts', fk: postsUserId },
    ]);
  });

  // This is green today because all foreign keys are ignored. It remains load-bearing:
  // §1.6 compares every structural field except the name, so a hand-named constraint
  // with identical structure is not churned on every diff.
  it('ignores a foreign-key name-only change when its structure is identical', () => {
    const renamed: FrozenTableSnapshot = {
      ...cascadePosts,
      foreignKeys: [{ ...postsUserId, name: 'posts_author_fkey' }],
    };
    expect(diff(asSnapshot([cascadePosts]), asSnapshot([renamed]))).toEqual([]);
  });

  it('orders a newly created target table before its child', () => {
    const users: FrozenTableSnapshot = {
      name: 'users',
      columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
      primaryKey: ['id'],
      foreignKeys: [],
    };
    const empty: SchemaSnapshot = { version: 1, tables: [], extensions: [] };

    expect(
      diffForDialect(empty, asSnapshot([cascadePosts, users]), { dialect: sqliteDialect }).map(operation => [
        operation.kind,
        'table' in operation ? operation.table : undefined,
      ]),
    ).toEqual([
      ['create_table', 'users'],
      ['create_table', 'posts'],
    ]);
    expect(
      diffForDialect(empty, asSnapshot([cascadePosts, users]), { dialect: postgresDialect }).map(operation => [
        operation.kind,
        'table' in operation ? operation.table : undefined,
      ]),
    ).toEqual([
      ['create_table', 'users'],
      ['create_table', 'posts'],
      ['add_foreign_key', 'posts'],
    ]);
  });

  // actual today: no throw. The optional third argument is ignored; add and
  // drop produce no FK op, and change produces [].
  it('refuses to alter a constraint on sqlite, naming the table', () => {
    const transitions = [
      ['add', postsWithoutForeignKeys, cascadePosts],
      ['drop', cascadePosts, postsWithoutForeignKeys],
      ['change', noActionPosts, cascadePosts],
    ] as const;
    for (const [label, before, after] of transitions) {
      const run = (): readonly FrozenChangeOp[] =>
        diffForDialect(asSnapshot([before]), asSnapshot([after]), { dialect: sqliteDialect });
      expect(run, label).toThrow(UnsupportedFeatureError);
      expect(run, label).toThrow(/foreign key "posts_user_id_fkey".*"posts"/s);
      expect(run, label).toThrow(/SQLite has no ALTER TABLE form for a constraint/);
    }
  });

  // The second refusal that needs plan-wide context. No single create_table op can
  // know that another table points back to it, so this uses the same dialect-aware
  // diff boundary as the action-change refusal.
  //
  // actual today: two create_table ops, no refusal.
  it('refuses mutually-referencing tables on sqlite, naming both tables', () => {
    const users: FrozenTableSnapshot = {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'primary_org_id', type: 'integer', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [
        {
          name: 'users_primary_org_id_fkey',
          columns: ['primary_org_id'],
          targetTable: 'organizations',
          targetColumns: ['id'],
          onDelete: 'restrict',
          onUpdate: 'no action',
        },
      ],
    };
    const organizations: FrozenTableSnapshot = {
      name: 'organizations',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'owner_id', type: 'integer', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [
        {
          name: 'organizations_owner_id_fkey',
          columns: ['owner_id'],
          targetTable: 'users',
          targetColumns: ['id'],
          onDelete: 'restrict',
          onUpdate: 'no action',
        },
      ],
    };
    const run = (): readonly FrozenChangeOp[] =>
      diffForDialect({ version: 1, tables: [], extensions: [] }, asSnapshot([organizations, users]), {
        dialect: sqliteDialect,
      });
    expect(run).toThrow(UnsupportedFeatureError);
    expect(run).toThrow(/sqlite/i);
    expect(run).toThrow(/organizations/);
    expect(run).toThrow(/users/);
  });
});

// #437 deliberately froze only these accepted public primitives. It did not
// invent routine fields on SchemaSnapshot or ChangeOp, so this migration-boundary
// suite measures the exact fingerprint-to-replacement decision and no wider plan.

const routineV1: RoutineDef = {
  kind: 'function',
  name: 'invoice_total',
  params: [{ name: 'invoice_id', type: 'bigint' }],
  returns: { type: 'numeric' },
  language: 'sql',
  body: 'SELECT total FROM invoices WHERE id = invoice_id;',
};

function replacementFor(previous: RoutineDef, next: RoutineDef): readonly string[] {
  return routineFingerprint(previous) === routineFingerprint(next)
    ? []
    : replaceRoutineStatements(previous, next, postgresDialect);
}

describe('routine body diff (frozen: schema-objects/SPEC.md 8.6)', () => {
  it('re-emits a routine when its body changes', () => {
    const statements = replacementFor(routineV1, {
      ...routineV1,
      body: 'SELECT total + tax FROM invoices WHERE id = invoice_id;',
    });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('total + tax');
  });

  it('does not re-emit when only trailing whitespace differs', () => {
    const withTrailingWhitespace: RoutineDef = {
      ...routineV1,
      body: 'SELECT total FROM invoices WHERE id = invoice_id;   \n\n',
    };
    expect(replacementFor(routineV1, withTrailingWhitespace)).toEqual([]);
  });

  it('re-emits when indentation or comments change', () => {
    const reindented: RoutineDef = {
      ...routineV1,
      body: '  SELECT total FROM invoices WHERE id = invoice_id; -- deliberate',
    };
    expect(replacementFor(routineV1, reindented)).not.toEqual([]);
  });

  it('treats a parameter rename as a routine change', () => {
    const renamed: RoutineDef = {
      ...routineV1,
      params: [{ name: 'id', type: 'bigint' }],
    };
    expect(routineFingerprint(renamed)).not.toBe(routineFingerprint(routineV1));
  });
});

// Extension-backed column tests freeze (#424), against `./SPEC.md` §1.5,
// `../schema-objects/SPEC.md` §7 and `@zmdb/schema-core/ir`'s SPEC §4.3.
const vector1536: ExtensionType = {
  extension: 'vector',
  name: 'vector',
  args: [1536],
};

const geometryPoint4326: ExtensionType = {
  extension: 'postgis',
  name: 'geometry',
  args: ['Point', 4326],
};

const itemColumns: readonly ColumnSnapshot[] = [
  { name: 'id', type: 'integer', nullable: false, primaryKey: true },
  { name: 'embedding', type: vector1536, nullable: false, primaryKey: false },
];

const noExtensions: SchemaSnapshot = {
  version: 1,
  extensions: [],
  tables: [],
};

const vectorItems: SchemaSnapshot = {
  version: 1,
  extensions: [{ name: 'vector' }],
  tables: [{ name: 'items', columns: itemColumns, primaryKey: ['id'], foreignKeys: [] }],
};

const vector3072: ExtensionType = {
  extension: 'vector',
  name: 'vector',
  args: [3072],
};

const vectorItems3072: SchemaSnapshot = {
  version: 1,
  extensions: [{ name: 'vector' }],
  tables: [
    {
      name: 'items',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'embedding', type: vector3072, nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    },
  ],
};

function extensionDiff(previous: SchemaSnapshot, next: SchemaSnapshot): readonly ChangeOp[] {
  return diff(previous, next);
}

function extensionUp(op: ChangeOp, dialect: OfficialDialectName): string {
  return emitUp(op, officialDialects[dialect]);
}

describe('database extensions and extension-backed types (frozen: migrations/SPEC.md 1.5)', () => {
  it('emits CREATE EXTENSION IF NOT EXISTS before any table that uses it', () => {
    expect(extensionDiff(noExtensions, vectorItems).map(op => extensionUp(op, 'postgres'))).toEqual([
      'CREATE EXTENSION IF NOT EXISTS "vector"',
      'CREATE TABLE "items" ("id" INTEGER PRIMARY KEY, "embedding" vector(1536) NOT NULL)',
    ]);
  });

  it('renders a parameterised extension type', () => {
    expect(
      ddlType(postgresDialect, {
        name: 'embedding',
        type: vector1536,
        nullable: false,
        primaryKey: false,
      }),
    ).toBe('vector(1536)');
    expect(
      ddlType(postgresDialect, {
        name: 'location',
        type: geometryPoint4326,
        nullable: false,
        primaryKey: false,
      }),
    ).toBe('geometry(Point,4326)');
  });

  it('refuses an extension type on mysql, naming the dialect and the type', () => {
    const run = () =>
      extensionUp(
        { kind: 'create_table', table: 'items', columns: itemColumns, primaryKey: ['id'], foreignKeys: [] },
        'mysql',
      );
    expect(run).toThrow(UnsupportedFeatureError);
    expect(run).toThrow(/mysql/i);
    expect(run).toThrow(/vector\(1536\)/i);
  });

  it('refuses an extension type on sqlite, naming the dialect and the type', () => {
    const run = () =>
      extensionUp(
        { kind: 'create_table', table: 'items', columns: itemColumns, primaryKey: ['id'], foreignKeys: [] },
        'sqlite',
      );
    expect(run).toThrow(UnsupportedFeatureError);
    expect(run).toThrow(/sqlite/i);
    expect(run).toThrow(/vector\(1536\)/i);
  });

  it('refuses an extension type on mssql, naming the dialect and the type', () => {
    const run = () =>
      mssqlDialect.migrations.emitUp({
        kind: 'create_table',
        table: 'items',
        columns: itemColumns,
        primaryKey: ['id'],
        foreignKeys: [],
      });
    expect(run).toThrow(UnsupportedFeatureError);
    expect(run).toThrow(/mssql/i);
    expect(run).toThrow(/vector\(1536\)/i);
  });

  it('does not drop an extension on diff', () => {
    expect(extensionDiff(noExtensions, vectorItems)).toEqual([
      { kind: 'create_extension', name: 'vector' },
      { kind: 'create_table', table: 'items', columns: itemColumns, primaryKey: ['id'], foreignKeys: [] },
    ]);
    expect(extensionDiff(vectorItems, noExtensions)).toEqual([{ kind: 'drop_table', table: 'items' }]);
  });

  it('compares extension type arguments structurally and emits a dimension change as an alter', () => {
    const changes = extensionDiff(vectorItems, vectorItems3072);
    expect(changes).toEqual([
      {
        kind: 'alter_column_type',
        table: 'items',
        column: 'embedding',
        from: vector1536,
        to: vector3072,
        fromNullable: false,
        toNullable: false,
      },
    ]);
    expect(changes.map(op => extensionUp(op, 'postgres'))).toEqual([
      'ALTER TABLE "items" ALTER COLUMN "embedding" TYPE vector(3072)',
    ]);
  });
});
