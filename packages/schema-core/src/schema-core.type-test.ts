import {
  serial,
  text,
  integer,
  json,
  jsonEnum,
  timestamp,
  primaryKey,
  notNull,
  nullable,
  defaultTo,
  type Entity,
  type CreateDTO,
  type UpdateDTO,
  type Equal,
  type Expect,
} from './index.ts';

type Simplify<T> = { [K in keyof T]: T[K] };

// 1. Column builder type signature tests
const cJson = json();
type _TestJsonType = Expect<Equal<typeof cJson.type, 'json'>>;
type _TestJsonFlags = Expect<Equal<typeof cJson.flags.nullable, false>>;

interface UserConfig {
  theme: 'light' | 'dark';
}
const cTypedJson = json<UserConfig>();
type _TestTypedJsonPayload = Expect<Equal<NonNullable<typeof cTypedJson.__payload>, UserConfig>>;

// 2. Type derivation tests (Entity, CreateDTO, UpdateDTO)
const columns = {
  id: primaryKey(serial()),
  email: notNull(text()),
  role: defaultTo(jsonEnum(['admin', 'user']), 'user'),
  age: integer(),
  createdAt: defaultTo(timestamp(), 'now'),
  payload: json(),
  config: nullable(json<UserConfig>()),
};
type S = { columns: typeof columns };

type _TestEntityId = Expect<Equal<Entity<S>['id'], number>>;
type _TestEntityEmail = Expect<Equal<Entity<S>['email'], string>>;
type _TestEntityRole = Expect<Equal<Entity<S>['role'], 'admin' | 'user'>>;
type _TestEntityAge = Expect<Equal<Entity<S>['age'], number>>;
type _TestEntityCreatedAt = Expect<Equal<Entity<S>['createdAt'], Date>>;
type _TestEntityPayload = Expect<Equal<Entity<S>['payload'], unknown>>;
type _TestEntityConfig = Expect<Equal<Entity<S>['config'], UserConfig | null>>;

type _TestCreateDTO = Simplify<CreateDTO<S>>;
type _TestCreateDTORole = Expect<Equal<_TestCreateDTO['role'], 'admin' | 'user' | undefined>>;
type _TestCreateDTOEmail = Expect<Equal<_TestCreateDTO['email'], string>>;
type _TestCreateDTOPayload = Expect<Equal<_TestCreateDTO['payload'], unknown>>;
type _TestCreateDTOConfig = Expect<Equal<_TestCreateDTO['config'], UserConfig | null>>;

type _TestUpdateDTO = Simplify<UpdateDTO<S>>;
type _TestUpdateDTOEmail = Expect<Equal<_TestUpdateDTO['email'], string | undefined>>;
type _TestUpdateDTOPayload = Expect<Equal<_TestUpdateDTO['payload'], unknown | undefined>>;
type _TestUpdateDTOConfig = Expect<Equal<_TestUpdateDTO['config'], UserConfig | null | undefined>>;

// 3. Natural primary key (text().primaryKey()) is required in CreateDTO (does not set hasDefault)
const naturalPkColumns = {
  id: text().primaryKey(),
};
type NaturalPkSchema = { columns: typeof naturalPkColumns };
type _TestNaturalPkCreateDTO = Expect<Equal<CreateDTO<NaturalPkSchema>['id'], string>>;
