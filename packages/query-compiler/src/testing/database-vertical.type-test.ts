import {
  createQueryCompiler,
  defineSqlDialect,
  type Introspector,
  type MigrationDialect,
  type MigrationDriver,
  type SqlDialect,
} from '../index.js';
import type {
  DATABASE_CAPABILITY_MATRIX,
  DatabaseCapabilityKey,
  DatabaseCapabilityMatrix,
  OfficialDatabase,
  SqlTypeKey,
  VerticalContractKey,
} from './capability-matrix.js';
import {
  makeSyntheticDialect,
  type FrozenDatabaseCapabilities,
  type FrozenDriver,
  type FrozenSqlDialect,
} from './database-vertical.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type Matrix = typeof DATABASE_CAPABILITY_MATRIX;
type SQLiteCapabilities = Matrix['sqlite']['capabilities'];
type SQLiteTypes = Matrix['sqlite']['sqlTypes'];
type SQLiteVerticals = Matrix['sqlite']['verticals'];
type MissingCancellation = Omit<SQLiteCapabilities, 'cancellation'>;

export type _EveryOfficialDatabaseHasOneRow = Expect<Equal<keyof Matrix, OfficialDatabase>>;
export type _EveryCapabilityHasEvidence = Expect<Equal<keyof SQLiteCapabilities, DatabaseCapabilityKey>>;
export type _EverySqlTypeHasEvidence = Expect<Equal<keyof SQLiteTypes, SqlTypeKey>>;
export type _EveryVerticalHasEvidence = Expect<Equal<keyof SQLiteVerticals, VerticalContractKey>>;
export type _MissingCapabilityCannotSatisfyMatrix = Expect<
  Equal<MissingCancellation extends DatabaseCapabilityMatrix['sqlite']['capabilities'] ? true : false, false>
>;
export type _DialectNameFlowsIntoDriver = Expect<
  Equal<FrozenDriver<'third-party'>['dialect'], FrozenSqlDialect<'third-party'>>
>;
export type _ReturningCapabilitiesAreTotal = Expect<
  Equal<keyof FrozenDatabaseCapabilities['returning'], 'insert' | 'upsert' | 'update' | 'delete'>
>;
export type _FrozenDialectSatisfiesProductionProtocol = Expect<
  FrozenSqlDialect<'third-party'> extends SqlDialect<'third-party'> ? true : false
>;
export type _ProductionMigrationCarriesName = Expect<Equal<MigrationDialect<'third-party'>['name'], 'third-party'>>;
export type _ProductionIntrospectorCarriesName = Expect<Equal<Introspector<'third-party'>['name'], 'third-party'>>;
export type _ProductionMigrationDriverCarriesDialect = Expect<
  Equal<MigrationDriver<'third-party'>['dialect'], SqlDialect<'third-party'>>
>;

const externalDialect = defineSqlDialect(makeSyntheticDialect());
const externalCompiler = createQueryCompiler(externalDialect);
externalCompiler.selectFrom('widgets').where('id', '=', 7).compile();
