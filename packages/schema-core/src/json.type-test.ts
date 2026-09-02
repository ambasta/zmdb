import {
  json,
  serial,
  primaryKey,
  nullable,
  defaultTo,
  type Entity,
  type CreateDTO,
  type UpdateDTO,
  type ColumnMeta,
  type Equal,
  type Expect,
} from './index.ts';

interface UserMetadata {
  preferences: { theme: 'light' | 'dark' };
  tags: string[];
}

const jsonCols = {
  id: primaryKey(serial()),
  meta: json<UserMetadata>(),
  nullableMeta: nullable(json<UserMetadata>()),
  defaultMeta: defaultTo(json<UserMetadata>(), { preferences: { theme: 'light' }, tags: [] }),
  untypedMeta: json(),
};
type JsonSchema = { columns: typeof jsonCols };

// 1. ColumnMeta interface does NOT contain __payload
type MetaHasPayload = '__payload' extends keyof ColumnMeta ? true : false;
type _testMetaHasPayload = Expect<Equal<MetaHasPayload, false>>;

// 2. Entity derivation
type _testEntityMeta = Expect<Equal<Entity<JsonSchema>['meta'], UserMetadata>>;
type _testEntityNullableMeta = Expect<Equal<Entity<JsonSchema>['nullableMeta'], UserMetadata | null>>;
type _testEntityDefaultMeta = Expect<Equal<Entity<JsonSchema>['defaultMeta'], UserMetadata>>;
type _testEntityUntypedMeta = Expect<Equal<Entity<JsonSchema>['untypedMeta'], unknown>>;

// 3. CreateDTO derivation
type _testCreateMeta = Expect<Equal<CreateDTO<JsonSchema>['meta'], UserMetadata>>;
// Optional, like a defaulted column: omitting a nullable key inserts `NULL`, which is what
// passing `null` does. Hence the `| undefined` the value-side derivation adds to an optional
// property.
type _testCreateNullableMeta = Expect<Equal<CreateDTO<JsonSchema>['nullableMeta'], UserMetadata | null | undefined>>;
type _testCreateDefaultMeta = Expect<Equal<CreateDTO<JsonSchema>['defaultMeta'], UserMetadata | undefined>>;
type _testCreateUntypedMeta = Expect<Equal<CreateDTO<JsonSchema>['untypedMeta'], unknown>>;

// 4. UpdateDTO derivation
type _testUpdateMeta = Expect<Equal<UpdateDTO<JsonSchema>['meta'], UserMetadata | undefined>>;
type _testUpdateNullableMeta = Expect<Equal<UpdateDTO<JsonSchema>['nullableMeta'], UserMetadata | null | undefined>>;
type _testUpdateDefaultMeta = Expect<Equal<UpdateDTO<JsonSchema>['defaultMeta'], UserMetadata | undefined>>;
type _testUpdateUntypedMeta = Expect<Equal<UpdateDTO<JsonSchema>['untypedMeta'], unknown>>;
