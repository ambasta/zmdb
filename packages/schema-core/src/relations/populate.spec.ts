import { describe, it, expect } from 'vitest';

import { RELATION_KINDS, type ColumnIR, type SchemaIR } from '../ir/index.js';
import { PostSchema, UserSchema } from './fixtures.js';
import { compilePopulate, resolveRelation, inferFkName } from './index.js';

// Resolution and SQL for populate. Both read the relation off the declaration — the fixtures
// declare `posts`, `profile`, `author` and `tags` as tags on the interface.

describe('resolveRelation', () => {
  it('resolves the owning side from the foreign key and what it references', () => {
    expect(resolveRelation(PostSchema.ir, 'author')).toEqual({
      name: 'author',
      targetTable: 'users',
      parentKey: ['userId'],
      targetKey: ['id'],
      toMany: false,
    });
  });

  it('resolves the inverse side from the primary key', () => {
    expect(resolveRelation(UserSchema.ir, 'posts')).toEqual({
      name: 'posts',
      targetTable: 'posts',
      parentKey: ['id'],
      targetKey: ['userId'],
      toMany: true,
    });
  });

  it('puts a one-to-one on whichever table has the column', () => {
    expect(resolveRelation(UserSchema.ir, 'profile')).toEqual({
      name: 'profile',
      targetTable: 'profiles',
      parentKey: ['id'],
      targetKey: ['userId'],
      toMany: false,
    });
  });

  it('resolves many-to-many through join table with inferred foreign keys', () => {
    expect(resolveRelation(UserSchema.ir, 'tags')).toEqual({
      name: 'tags',
      isManyToMany: true,
      targetTable: 'tags',
      parentKey: ['id'],
      targetKey: ['id'],
      toMany: true,
      through: 'user_tags',
      baseFk: 'userId',
      targetFk: 'tagId',
    });
  });

  it('names the relations the type does declare when given one it does not', () => {
    expect(() => resolveRelation(UserSchema.ir, 'ordres')).toThrow(/unknown relation "ordres" on users/);
    expect(() => resolveRelation(UserSchema.ir, 'ordres')).toThrow(/posts, profile, tags/);
  });
});

describe('inferFkName', () => {
  it('converts table names to singular camelCase foreign key defaults', () => {
    expect(inferFkName('posts')).toBe('postId');
    expect(inferFkName('tags')).toBe('tagId');
    expect(inferFkName('users')).toBe('userId');
    expect(inferFkName('user_addresses')).toBe('userAddressId');
    expect(inferFkName('categories')).toBe('categoryId');
    expect(inferFkName('public.users')).toBe('userId');
  });
});

describe('the relation vocabulary', () => {
  /** One column, with the six booleans and two collections every column has. */
  const col = (name: string, references?: string): ColumnIR => ({
    name,
    physicalName: name,
    sql: 'integer',
    nullable: false,
    primaryKey: name === 'id',
    serial: false,
    unique: false,
    hasDefault: false,
    sensitive: false,
    constraints: {},
    rules: [],
    ...(references === undefined ? {} : { references }),
  });

  it('has four cardinalities, and resolveRelation gives each of them its own answer', () => {
    expect([...RELATION_KINDS]).toEqual(['manyToOne', 'oneToMany', 'oneToOne', 'manyToMany']);

    const ir: SchemaIR = {
      table: 'users',
      physicalTable: 'users',
      columns: [col('id'), col('accountId', 'accounts.id')],
      primaryKey: ['id'],
      relations: [
        { name: 'account', relation: 'manyToOne', target: 'accounts', via: 'accountId' },
        { name: 'posts', relation: 'oneToMany', target: 'posts', via: 'userId' },
        { name: 'profile', relation: 'oneToOne', target: 'profiles', via: 'userId' },
        { name: 'groups', relation: 'manyToMany', target: 'groups', via: 'group_members' },
      ],
      foreignKeys: [],
    };

    expect(resolveRelation(ir, 'account')).toEqual({
      name: 'account',
      targetTable: 'accounts',
      parentKey: ['accountId'],
      targetKey: ['id'],
      toMany: false,
    });
    expect(resolveRelation(ir, 'posts')).toEqual({
      name: 'posts',
      targetTable: 'posts',
      parentKey: ['id'],
      targetKey: ['userId'],
      toMany: true,
    });
    expect(resolveRelation(ir, 'profile')).toEqual({
      name: 'profile',
      targetTable: 'profiles',
      parentKey: ['id'],
      targetKey: ['userId'],
      toMany: false,
    });
    expect(resolveRelation(ir, 'groups')).toEqual({
      name: 'groups',
      isManyToMany: true,
      targetTable: 'groups',
      parentKey: ['id'],
      targetKey: ['id'],
      toMany: true,
      through: 'group_members',
      baseFk: 'userId',
      targetFk: 'groupId',
    });
  });
});

describe('compilePopulate', () => {
  it('compiles a to-one as an INNER JOIN on the resolved pair of columns', () => {
    const q = compilePopulate(PostSchema.ir, 'author', 'postgres');
    expect(q.kind).toBe('join');
    expect(q.sql).toBe('SELECT * FROM "posts" INNER JOIN "users" ON "posts"."userId" = "users"."id"');
  });

  it('joins an inverse one-to-one from the primary key', () => {
    const q = compilePopulate(UserSchema.ir, 'profile', 'postgres');
    expect(q.sql).toBe('SELECT * FROM "users" INNER JOIN "profiles" ON "users"."id" = "profiles"."userId"');
  });

  it('compiles a to-many as a batched IN() select', () => {
    const q = compilePopulate(UserSchema.ir, 'posts', 'postgres', [1, 2, 3]);
    expect(q.kind).toBe('batched');
    expect(q.sql).toBe('SELECT * FROM "posts" WHERE "userId" IN ($1, $2, $3)');
    expect(q.parameters).toEqual([1, 2, 3]);
  });

  it('matches nothing for no parent keys, rather than every row', () => {
    const q = compilePopulate(UserSchema.ir, 'posts', 'postgres', []);
    expect(q.sql).toBe('SELECT * FROM "posts" WHERE 1 = 0');
    expect(q.parameters).toEqual([]);
  });

  it('drops duplicate and nullish parent keys', () => {
    const q = compilePopulate(UserSchema.ir, 'posts', 'sqlite', [1, 1, null, 2, undefined]);
    expect(q.sql).toBe('SELECT * FROM "posts" WHERE "userId" IN (?, ?)');
    expect(q.parameters).toEqual([1, 2]);
  });

  it('applies the target filter when populating a to-one relation', () => {
    const q = compilePopulate(PostSchema.ir, 'author', 'postgres', [], [{ col: 'users.tenantId', op: '=', value: 42 }]);

    expect(q.kind).toBe('join');
    expect(q.sql).toBe(
      'SELECT * FROM "posts" LEFT JOIN "users" ON "posts"."userId" = "users"."id" AND "users"."tenantId" = $1',
    );
    expect(q.parameters).toEqual([42]);
  });

  it('applies the target filter to the batched query of a to-many populate', () => {
    const q = compilePopulate(
      UserSchema.ir,
      'posts',
      'postgres',
      [1, 2],
      [{ col: 'posts.deletedAt', op: 'is null', value: undefined }],
    );

    expect(q.kind).toBe('batched');
    expect(q.sql).toBe('SELECT * FROM "posts" WHERE "userId" IN ($1, $2) AND "posts"."deletedAt" IS NULL');
    expect(q.parameters).toEqual([1, 2]);
  });

  it('keeps an OR target filter grouped inside the join condition', () => {
    const q = compilePopulate(
      PostSchema.ir,
      'author',
      'postgres',
      [],
      [
        { col: 'users.active', op: '=', value: true },
        { col: 'users.role', op: '=', value: 'admin', connector: 'OR' },
      ],
    );

    expect(q.kind).toBe('join');
    expect(q.sql).toBe(
      'SELECT * FROM "posts" LEFT JOIN "users" ON "posts"."userId" = "users"."id" ' +
        'AND ("users"."active" = $1 OR "users"."role" = $2)',
    );
    expect(q.parameters).toEqual([true, 'admin']);
  });

  it('compiles a many-to-many relation as a two-pass lookup (pivot and target queries)', () => {
    const q = compilePopulate(UserSchema.ir, 'tags', 'postgres', [10, 20]);
    expect(q.kind).toBe('batched');
    expect(q.sql).toBe('SELECT * FROM "user_tags" WHERE "userId" IN ($1, $2)');
    expect(q.parameters).toEqual([10, 20]);

    expect(q.pivotQuery).toBeDefined();
    expect(q.pivotQuery?.sql).toBe('SELECT * FROM "user_tags" WHERE "userId" IN ($1, $2)');

    expect(q.targetQuery).toBeDefined();
    const tq = q.targetQuery!([100, 200]);
    expect(tq.kind).toBe('batched');
    expect(tq.sql).toBe('SELECT * FROM "tags" WHERE "id" IN ($1, $2)');
    expect(tq.parameters).toEqual([100, 200]);
  });

  it('handles empty parent or target ID sets with WHERE 1 = 0 for many-to-many', () => {
    const qEmptyParent = compilePopulate(UserSchema.ir, 'tags', 'postgres', []);
    expect(qEmptyParent.sql).toBe('SELECT * FROM "user_tags" WHERE 1 = 0');
    expect(qEmptyParent.parameters).toEqual([]);

    const tqEmptyTarget = qEmptyParent.targetQuery!([]);
    expect(tqEmptyTarget.sql).toBe('SELECT * FROM "tags" WHERE 1 = 0');
    expect(tqEmptyTarget.parameters).toEqual([]);
  });

  it('resolves relation tables, keys and filters to physical names from the schema set', () => {
    const namedColumn = (
      name: string,
      physicalName: string,
      sql: ColumnIR['sql'],
      options: Partial<Pick<ColumnIR, 'primaryKey' | 'references' | 'nullable'>> = {},
    ): ColumnIR => ({
      name,
      physicalName,
      sql,
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: false,
      hasDefault: false,
      sensitive: false,
      constraints: {},
      rules: [],
      ...options,
    });
    const users: SchemaIR = {
      table: 'userAccount',
      physicalTable: 'user_accounts',
      columns: [namedColumn('id', 'account_id', 'integer', { primaryKey: true })],
      primaryKey: ['id'],
      relations: [{ name: 'posts', relation: 'oneToMany', target: 'blogPost', via: 'userId' }],
      foreignKeys: [],
    };
    const posts: SchemaIR = {
      table: 'blogPost',
      physicalTable: 'blog_posts',
      columns: [
        namedColumn('id', 'id', 'integer', { primaryKey: true }),
        namedColumn('userId', 'user_id', 'integer', { references: 'userAccount.id' }),
        namedColumn('deletedAt', 'deleted_at', 'timestamp', { nullable: true }),
      ],
      primaryKey: ['id'],
      relations: [],
      foreignKeys: [],
    };

    const q = compilePopulate(
      users,
      'posts',
      'postgres',
      [1, 2],
      [{ col: 'blogPost.deletedAt', op: 'is null', value: undefined }],
      [users, posts],
    );

    expect(q.sql).toBe('SELECT * FROM "blog_posts" WHERE "user_id" IN ($1, $2) AND "blog_posts"."deleted_at" IS NULL');
    expect(q.parameters).toEqual([1, 2]);
  });

  it('uses every physical column in composite relation joins and tuple batches', () => {
    const namedColumn = (
      name: string,
      physicalName: string,
      options: Partial<Pick<ColumnIR, 'primaryKey' | 'references'>> = {},
    ): ColumnIR => ({
      name,
      physicalName,
      sql: 'integer',
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: false,
      hasDefault: false,
      sensitive: false,
      constraints: {},
      rules: [],
      ...options,
    });
    const accounts: SchemaIR = {
      table: 'account',
      physicalTable: 'account_rows',
      columns: [
        namedColumn('tenantId', 'tenant_key', { primaryKey: true }),
        namedColumn('id', 'account_key', { primaryKey: true }),
      ],
      primaryKey: ['tenantId', 'id'],
      relations: [{ name: 'memberships', relation: 'oneToMany', target: 'membership', via: 'tenantId,accountId' }],
      foreignKeys: [],
    };
    const memberships: SchemaIR = {
      table: 'membership',
      physicalTable: 'member_rows',
      columns: [
        namedColumn('tenantId', 'tenant_fk', { references: 'account.tenantId' }),
        namedColumn('accountId', 'account_fk', { references: 'account.id' }),
      ],
      primaryKey: [],
      relations: [{ name: 'account', relation: 'manyToOne', target: 'account', via: 'tenantId,accountId' }],
      foreignKeys: [],
    };

    const joined = compilePopulate(memberships, 'account', 'postgres', [], [], [memberships, accounts]);
    const batched = compilePopulate(accounts, 'memberships', 'postgres', [['t1', 7]], [], [accounts, memberships]);

    expect(joined.sql).toBe(
      'SELECT * FROM "member_rows" INNER JOIN "account_rows" ' +
        'ON "member_rows"."tenant_fk" = "account_rows"."tenant_key" ' +
        'AND "member_rows"."account_fk" = "account_rows"."account_key"',
    );
    expect(batched.sql).toBe('SELECT * FROM "member_rows" WHERE ("tenant_fk", "account_fk") IN (($1, $2))');
    expect(batched.parameters).toEqual(['t1', 7]);
  });
});
