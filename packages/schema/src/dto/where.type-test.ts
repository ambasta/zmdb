import type { PrimaryKey, Serial, Sql, Table } from '../tags/index.js';
import type { WhereDTO, FieldOps } from './index.js';

interface TestUser extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  age: number & Sql<'integer'>;
  isActive: boolean & Sql<'boolean'>;
  role: 'admin' | 'user';
}

// 1. String columns allow range operators, pattern operators, and set inclusion
const _validStringOps: FieldOps<string> = {
  eq: 'a@b.com',
  ne: 'c@d.com',
  gt: 'a',
  gte: 'a',
  lt: 'z',
  lte: 'z',
  like: '%@b.com',
  ilike: '%@b.com',
  in: ['a@b.com'],
  nin: ['c@d.com'],
  isNull: false,
  notNull: true,
};
const _validStringFilter: WhereDTO<TestUser> = {
  email: { gt: 'm@example.com', like: '%@example.com' },
};

// 2. Enum columns allow pattern operators and range operators as well as set inclusion
type Role = 'admin' | 'user';
const _validEnumOps: FieldOps<Role> = {
  eq: 'admin',
  in: ['admin', 'user'],
  like: 'admin%',
  gt: 'admin',
};
const _validEnumFilter: WhereDTO<TestUser> = {
  role: { in: ['admin'], like: 'admin%' },
};

// 3. Boolean columns allow set inclusion
const _validBooleanOps: FieldOps<boolean> = {
  eq: true,
  ne: false,
  in: [true, false],
  nin: [false],
  isNull: false,
  notNull: true,
};
const _validBooleanFilter: WhereDTO<TestUser> = {
  isActive: { in: [true, false] },
};

// 4. Type error assertions via @ts-expect-error

// @ts-expect-error Range comparison gt is disallowed on boolean fields
const _invalidBooleanGt: FieldOps<boolean> = { gt: true };

// @ts-expect-error Range comparison lt is disallowed on boolean fields
const _invalidBooleanLt: FieldOps<boolean> = { lt: false };

// @ts-expect-error Pattern matching like is disallowed on boolean fields
const _invalidBooleanLike: FieldOps<boolean> = { like: 'true' };

// @ts-expect-error Pattern matching like is disallowed on numeric fields
const _invalidNumericLike: FieldOps<number> = { like: '18' };
