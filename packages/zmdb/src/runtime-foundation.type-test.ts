// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The hard-cutover package names do not exist yet. Importing them here would make the
// typecheck fail on module resolution instead of freezing their contracts, so this file
// arranges today's real public signatures into the exact future package/subpath DAG from
// issue #635. Issues #638-#641 replace these source imports with the final package names.

import {
  type BaseRepository,
  type defineRepository,
  type Driver,
  type ExecuteOptions,
  type IncompleteKeyError,
  type RepositoryOptions,
  type StreamOptions,
  type UpdatePatch,
} from '@zmdb/orm';
import { type applyKeysetFilter, type applyOrderBy, type applyPagination, type compileWhere } from '@zmdb/orm/dto';
import { type aliasRow, type attachPopulated, type compilePopulate } from '@zmdb/orm/relations';
import {
  type CoreSchema,
  type CreateDTO,
  type DeclaredTable,
  type Entity,
  type Equal,
  type Expect,
  type isRecord,
  type PrimaryKeyOf,
  type ReadDTO,
  type schemaOf,
  type TaggedSchema,
  type UpdateDTO,
} from '@zmdb/schema';
import {
  type buildListResult,
  type buildSearchResult,
  type decodeCursor,
  type describeAggregate,
  type encodeCursor,
  type getResult,
  type project,
} from '@zmdb/schema/dto';
import {
  type decodeDbValue,
  type decodeWire,
  type encodeWire,
  type jsonSchemaFromIR,
  type objectTypeFromIR,
  type schemaFromIR,
  type SchemaIR,
  type TypeIR,
} from '@zmdb/schema/ir';
import { type componentName, type toJsonSchema, type toOpenApiComponents } from '@zmdb/schema/openapi';
import { type resolveRelation } from '@zmdb/schema/relations';
import {
  type createQueryCompiler,
  type CompiledQuery,
  type QueryCompiler,
  type SelectBuilder,
  type SqlDialect,
} from '@zmdb/sql';
import { type appendComment, type serializeComment, type withComments } from '@zmdb/sql/comments';
import {
  type checkConstraintDdl,
  type createIndexDdl,
  type createViewDdl,
  type dropViewDdl,
} from '@zmdb/sql/schema-objects';
import { type batch, type setOperation } from '@zmdb/sql/set-ops';
import {
  type assert,
  type assertEquals,
  type assertShallow,
  type getCachedRegExp as ownerGetCachedRegExp,
  // @ts-expect-error -- getCachedRegExp is the sole public regex cache entry.
  type getRegExp as legacyOwnerGetRegExp,
  type equals,
  type is,
  type isShallow,
  type random,
  type validate,
  type validateShallow,
  type ValidateResult,
} from '@zmdb/validator';
import { type decode, type parse, type stringify } from '@zmdb/validator/serialization';

import {
  type getCachedRegExp as facadeGetCachedRegExp,
  // @ts-expect-error -- the facade must not retain the removed cache spelling.
  type getRegExp as legacyFacadeGetRegExp,
} from './validator.js';

type FoundationSubpaths = {
  readonly '@zmdb/schema':
    | '.'
    | './custom-types'
    | './derive'
    | './dto'
    | './entity-modeling'
    | './ir'
    | './naming'
    | './openapi'
    | './relations'
    | './tags';
  readonly '@zmdb/sql': '.' | './comments' | './schema-objects' | './set-ops';
  readonly '@zmdb/validator': '.' | './advanced' | './errors' | './protobuf/wire' | './serialization';
  readonly '@zmdb/orm':
    | '.'
    | './dto'
    | './entity-modeling'
    | './outbox'
    | './relations'
    | './replicas'
    | './seeding'
    | './transactions';
};

type FoundationDependencies = {
  readonly '@zmdb/schema': never;
  readonly '@zmdb/sql': never;
  readonly '@zmdb/validator': '@zmdb/schema';
  readonly '@zmdb/orm': '@zmdb/schema' | '@zmdb/sql' | '@zmdb/validator';
};

type OptionalIntegrationDirection = {
  readonly '@zmdb/ai': '@zmdb/schema';
  readonly '@zmdb/postgres': '@zmdb/orm' | '@zmdb/sql';
  readonly '@zmdb/sqlite': '@zmdb/orm' | '@zmdb/sql';
  readonly '@zmdb/mssql': '@zmdb/orm' | '@zmdb/sql';
};

type SchemaRootValues = {
  readonly isRecord: typeof isRecord;
  readonly schemaOf: typeof schemaOf;
};

type SchemaIrValues = {
  readonly decodeDbValue: typeof decodeDbValue;
  readonly decodeWire: typeof decodeWire;
  readonly encodeWire: typeof encodeWire;
  readonly jsonSchemaFromIR: typeof jsonSchemaFromIR;
  readonly objectTypeFromIR: typeof objectTypeFromIR;
  readonly schemaFromIR: typeof schemaFromIR;
};

type SchemaOpenApiValues = {
  readonly componentName: typeof componentName;
  readonly toJsonSchema: typeof toJsonSchema;
  readonly toOpenApiComponents: typeof toOpenApiComponents;
};

type SchemaRelationValues = {
  readonly resolveRelation: typeof resolveRelation;
};

type SqlRootValues = {
  readonly createQueryCompiler: typeof createQueryCompiler;
};

type SqlCommentValues = {
  readonly appendComment: typeof appendComment;
  readonly serializeComment: typeof serializeComment;
  readonly withComments: typeof withComments;
};

type SqlSchemaObjectValues = {
  readonly checkConstraintDdl: typeof checkConstraintDdl;
  readonly createIndexDdl: typeof createIndexDdl;
  readonly createViewDdl: typeof createViewDdl;
  readonly dropViewDdl: typeof dropViewDdl;
};
type SqlSetOperationValues = {
  readonly batch: typeof batch;
  readonly setOperation: typeof setOperation;
};

type ValidatorRootValues = {
  readonly assert: typeof assert;
  readonly assertEquals: typeof assertEquals;
  readonly assertShallow: typeof assertShallow;
  readonly equals: typeof equals;
  readonly is: typeof is;
  readonly isShallow: typeof isShallow;
  readonly random: typeof random;
  readonly validate: typeof validate;
  readonly validateShallow: typeof validateShallow;
};

type ValidatorSerializationValues = {
  readonly decode: typeof decode;
  readonly parse: typeof parse;
  readonly stringify: typeof stringify;
};

type OrmRootValues = {
  readonly BaseRepository: typeof BaseRepository;
  readonly IncompleteKeyError: typeof IncompleteKeyError;
  readonly defineRepository: typeof defineRepository;
};

type OrmDtoValues = {
  readonly applyKeysetFilter: typeof applyKeysetFilter;
  readonly applyOrderBy: typeof applyOrderBy;
  readonly applyPagination: typeof applyPagination;
  readonly compileWhere: typeof compileWhere;
};

type SchemaDtoValues = {
  readonly buildListResult: typeof buildListResult;
  readonly buildSearchResult: typeof buildSearchResult;
  readonly decodeCursor: typeof decodeCursor;
  readonly describeAggregate: typeof describeAggregate;
  readonly encodeCursor: typeof encodeCursor;
  readonly getResult: typeof getResult;
  readonly project: typeof project;
};

type OrmRelationValues = {
  readonly aliasRow: typeof aliasRow;
  readonly attachPopulated: typeof attachPopulated;
  readonly compilePopulate: typeof compilePopulate;
};

export type _FoundationPackageNamesAreExact = Expect<
  Equal<keyof FoundationSubpaths, '@zmdb/orm' | '@zmdb/schema' | '@zmdb/sql' | '@zmdb/validator'>
>;
export type _SchemaSubpathsAreExact = Expect<
  Equal<
    FoundationSubpaths['@zmdb/schema'],
    | '.'
    | './custom-types'
    | './derive'
    | './dto'
    | './entity-modeling'
    | './ir'
    | './naming'
    | './openapi'
    | './relations'
    | './tags'
  >
>;
export type _SqlSubpathsAreExact = Expect<
  Equal<FoundationSubpaths['@zmdb/sql'], '.' | './comments' | './schema-objects' | './set-ops'>
>;
export type _ValidatorSubpathsAreExact = Expect<
  Equal<FoundationSubpaths['@zmdb/validator'], '.' | './advanced' | './errors' | './protobuf/wire' | './serialization'>
>;
export type _OrmSubpathsAreExact = Expect<
  Equal<
    FoundationSubpaths['@zmdb/orm'],
    '.' | './dto' | './entity-modeling' | './outbox' | './relations' | './replicas' | './seeding' | './transactions'
  >
>;
export type _SchemaAndSqlAreIndependentRoots = Expect<
  Equal<FoundationDependencies['@zmdb/schema'] | FoundationDependencies['@zmdb/sql'], never>
>;
export type _ValidatorDependsOnlyOnSchema = Expect<Equal<FoundationDependencies['@zmdb/validator'], '@zmdb/schema'>>;
export type _OrmIsTheOnlyFoundationCompositionLayer = Expect<
  Equal<FoundationDependencies['@zmdb/orm'], '@zmdb/schema' | '@zmdb/sql' | '@zmdb/validator'>
>;
export type _OptionalPackagesPointInward = Expect<
  Equal<
    OptionalIntegrationDirection,
    {
      readonly '@zmdb/ai': '@zmdb/schema';
      readonly '@zmdb/postgres': '@zmdb/orm' | '@zmdb/sql';
      readonly '@zmdb/sqlite': '@zmdb/orm' | '@zmdb/sql';
      readonly '@zmdb/mssql': '@zmdb/orm' | '@zmdb/sql';
    }
  >
>;

export type _SchemaRootValues = Expect<Equal<keyof SchemaRootValues, 'isRecord' | 'schemaOf'>>;
export type _SchemaIrValues = Expect<
  Equal<
    keyof SchemaIrValues,
    'decodeDbValue' | 'decodeWire' | 'encodeWire' | 'jsonSchemaFromIR' | 'objectTypeFromIR' | 'schemaFromIR'
  >
>;
export type _SchemaOpenApiValues = Expect<
  Equal<keyof SchemaOpenApiValues, 'componentName' | 'toJsonSchema' | 'toOpenApiComponents'>
>;
export type _SchemaRelationValues = Expect<Equal<keyof SchemaRelationValues, 'resolveRelation'>>;
export type _SqlRootValues = Expect<Equal<keyof SqlRootValues, 'createQueryCompiler'>>;
export type _SqlCommentValues = Expect<
  Equal<keyof SqlCommentValues, 'appendComment' | 'serializeComment' | 'withComments'>
>;
export type _SqlSchemaObjectValues = Expect<
  Equal<keyof SqlSchemaObjectValues, 'checkConstraintDdl' | 'createIndexDdl' | 'createViewDdl' | 'dropViewDdl'>
>;
export type _SqlSetOperationValues = Expect<Equal<keyof SqlSetOperationValues, 'batch' | 'setOperation'>>;
export type _ValidatorRootValues = Expect<
  Equal<
    keyof ValidatorRootValues,
    | 'assert'
    | 'assertEquals'
    | 'assertShallow'
    | 'equals'
    | 'is'
    | 'isShallow'
    | 'random'
    | 'validate'
    | 'validateShallow'
  >
>;
export type _ValidatorSerializationValues = Expect<
  Equal<keyof ValidatorSerializationValues, 'decode' | 'parse' | 'stringify'>
>;
export type _OrmRootValues = Expect<
  Equal<keyof OrmRootValues, 'BaseRepository' | 'IncompleteKeyError' | 'defineRepository'>
>;
export type _OrmDtoValues = Expect<
  Equal<keyof OrmDtoValues, 'applyKeysetFilter' | 'applyOrderBy' | 'applyPagination' | 'compileWhere'>
>;
export type _SchemaDtoValues = Expect<
  Equal<
    keyof SchemaDtoValues,
    | 'buildListResult'
    | 'buildSearchResult'
    | 'decodeCursor'
    | 'describeAggregate'
    | 'encodeCursor'
    | 'getResult'
    | 'project'
  >
>;
export type _OrmRelationValues = Expect<
  Equal<keyof OrmRelationValues, 'aliasRow' | 'attachPopulated' | 'compilePopulate'>
>;

// Keep the moved public types in the compile-only contract as well as the value signatures.
export type _SchemaTypeSignatures<T extends DeclaredTable> = [
  CoreSchema<string>,
  TaggedSchema<T>,
  Entity<T>,
  CreateDTO<T>,
  ReadDTO<T>,
  UpdateDTO<T>,
  PrimaryKeyOf<T>,
  SchemaIR,
  TypeIR,
];
export type _SqlTypeSignatures = [CompiledQuery, SqlDialect, QueryCompiler, SelectBuilder<unknown>];
export type _ValidatorTypeSignatures<T> = [ValidateResult<T>];
export type _OrmTypeSignatures<T extends DeclaredTable> = [
  Driver,
  ExecuteOptions,
  RepositoryOptions,
  StreamOptions,
  UpdatePatch<T>,
];

export type _CanonicalRegexCache = Expect<Equal<typeof ownerGetCachedRegExp, (pattern: string) => RegExp>>;
export type _CanonicalRegexCacheFacade = Expect<Equal<typeof facadeGetCachedRegExp, typeof ownerGetCachedRegExp>>;
export type _NoLegacyRegexCache = typeof legacyOwnerGetRegExp;
export type _NoLegacyRegexCacheFacade = typeof legacyFacadeGetRegExp;
