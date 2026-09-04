import type { DialectSqlType, DialectTypeMap } from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

type MissingJsonEnum = Omit<DialectTypeMap, 'jsonEnum'>;

export type _DialectTypeMapNamesEverySqlType = Expect<Equal<keyof DialectTypeMap, DialectSqlType>>;
export type _MissingTypeMappingDoesNotSatisfyTheMap = Expect<
  Equal<MissingJsonEnum extends DialectTypeMap ? true : false, false>
>;
