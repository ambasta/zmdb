// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Compile-only freeze for #627.
//
// The compiler and migrations extraction issues replace their structural
// placeholders with real package entry points while retaining this exact
// subpath and delegation freeze.

import {
  type CompileProjectOptions as CompilerCompileProjectOptions,
  type CompileResult as CompilerCompileResult,
  type compileProject as compilerCompileProject,
  type writeCompileResult as compilerWriteCompileResult,
  type watchCodegen as compilerWatchCodegen,
} from '@zmdb/compiler';
import { type EmitDiagnostic, type EmitOptions, type Emitter } from '@zmdb/compiler/emit';
import { type configs as lintConfigs } from '@zmdb/compiler/lint';
import { type MetroOptions, type withZmdb } from '@zmdb/compiler/metro';
import {
  type ReflectDiagnostic,
  type ReflectLimits,
  type ReflectOptions,
  type ReflectResult,
  type Reflector,
  type irFromType,
  type schemaIrFromType,
} from '@zmdb/compiler/reflect';
import { type schemasFrom, type schemasFromFiles, type schemaIrsFrom } from '@zmdb/compiler/testing';
import {
  type TransformContext,
  type TransformDiagnostic,
  type TransformResult,
  type transformFile,
} from '@zmdb/compiler/transform';
import { type UnpluginLike, type ZmdbAotOptions, type zmdbAot } from '@zmdb/compiler/unplugin';
import {
  type ChangeOp,
  type DiffOptions,
  type SchemaSnapshot,
  type SnapshotableSchema,
  type diff,
  type emitDown,
  type emitUp,
  type snapshot,
} from '@zmdb/migrations';
import { type emitDeclarations } from '@zmdb/migrations/declarations';
import {
  type EmbeddedConnection,
  type EmbeddedMigration,
  type EmbeddedMigrationError,
  type runEmbedded,
} from '@zmdb/migrations/embedded';
import { type createIntrospector, type detectDrift } from '@zmdb/migrations/introspect';
import { type CatalogSchemaSnapshot, type normalizeDriftSnapshot } from '@zmdb/migrations/introspect/runtime';
import {
  type Migration,
  type MigrationConnection,
  type MigrationStatus,
  type down,
  type status,
  type up,
} from '@zmdb/migrations/runner';
import { type Equal, type Expect, type Extends } from '@zmdb/schema';
import { type NamingStrategy } from '@zmdb/schema/naming';
import { type SqlDialect } from '@zmdb/sql';

import type { checkProject } from '../../cli/src/commands/check.js';
import type { embedMigrations } from '../../cli/src/commands/embed.js';
import type { exportSchema } from '../../cli/src/commands/export.js';
import type { generateMigration } from '../../cli/src/commands/generate.js';
import type { migrate, migrationStatus, rollback } from '../../cli/src/commands/migrate.js';
import type { pullDeclarations } from '../../cli/src/commands/pull.js';
import type { applyPush, planPush } from '../../cli/src/commands/push.js';
import type { upgradeSnapshot } from '../../cli/src/commands/upgrade.js';
import type { CliEnvironment, runCli } from './cli/index.js';
import type {
  ResolvedConfig,
  ZmdbConfig,
  ZmdbConfigData,
  defineConfig,
  loadConfig,
  resolveConfig,
} from './config/index.js';
import { sqliteDialect } from './testing/official-dialects.fixture.js';

type ExportSet<Values extends string, Types extends string> = {
  readonly values: Values;
  readonly types: Types;
};

type CompilerExports = {
  readonly '.': ExportSet<
    'compileProject' | 'watchCodegen' | 'writeCompileResult',
    | 'CompileProjectOptions'
    | 'CompileResult'
    | 'CompiledArtifact'
    | 'CompilerDiagnostic'
    | 'WriteCompileResult'
    | 'WriteCompileResultOptions'
  >;
  readonly './reflect': ExportSet<
    'ReflectSession' | 'irFromType' | 'schemaIrFromType',
    'ReflectDiagnostic' | 'ReflectLimits' | 'ReflectOptions' | 'ReflectResult'
  >;
  readonly './emit': ExportSet<'Emitter', 'EmitDiagnostic' | 'EmitOptions'>;
  readonly './transform': ExportSet<'transformFile', 'TransformContext' | 'TransformDiagnostic' | 'TransformResult'>;
  readonly './unplugin': ExportSet<'zmdbAot', 'UnpluginLike' | 'ZmdbAotOptions'>;
  readonly './metro': ExportSet<'withZmdb', 'MetroOptions'>;
  readonly './lint': ExportSet<'configs' | 'default', never>;
  readonly './testing': ExportSet<'schemaIrsFrom' | 'schemasFrom' | 'schemasFromFiles', never>;
  readonly './errors': ExportSet<never, 'CompilerDiagnostic'>;
  readonly './config': ExportSet<
    'defineConfig' | 'loadConfig' | 'resolveConfig',
    'ResolvedConfig' | 'ZmdbConfig' | 'ZmdbConfigData'
  >;
};

type MigrationsExports = {
  readonly '.': ExportSet<
    'diff' | 'planMigration' | 'snapshot',
    'ChangeOp' | 'DiffOptions' | 'MigrationPlan' | 'SchemaSnapshot' | 'SnapshotableSchema'
  >;
  readonly './runner': ExportSet<
    'down' | 'downTo' | 'rollbackTo' | 'status' | 'up',
    'Migration' | 'MigrationConnection' | 'MigrationStatus'
  >;
  readonly './embedded': ExportSet<
    'EmbeddedMigrationError' | 'runEmbedded',
    'EmbeddedConnection' | 'EmbeddedMigration'
  >;
  readonly './introspect': ExportSet<
    'createIntrospector' | 'detectDrift' | 'normalizeDriftSnapshot',
    'CatalogSchemaSnapshot'
  >;
  readonly './introspect/runtime': ExportSet<'normalizeDriftSnapshot', 'CatalogSchemaSnapshot'>;
  readonly './declarations': ExportSet<'emitDeclarations', never>;
  readonly './files': ExportSet<
    | 'applyPush'
    | 'checkProject'
    | 'embedMigrations'
    | 'exportSchema'
    | 'generateMigration'
    | 'migrate'
    | 'migrationStatus'
    | 'planPush'
    | 'pullDeclarations'
    | 'rollback'
    | 'upgradeSnapshot',
    never
  >;
  readonly './testing': ExportSet<never, never>;
};

type CliExports = {
  readonly '.': ExportSet<'runCli', 'CliEnvironment'>;
};

interface CompilerDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly file?: string;
}

interface CompileProjectOptions {
  readonly project: string;
  readonly files?: readonly string[];
  readonly naming?: NamingStrategy;
}

interface CompiledArtifact {
  readonly source: string;
  readonly witnessPath: string;
  readonly runtimePath: string;
  readonly declarationPath: string;
  readonly witness: string;
  readonly runtime: string;
  readonly declaration: string;
}

interface CompileResult {
  readonly project: string;
  readonly files: readonly string[];
  readonly artifacts: readonly CompiledArtifact[];
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly dependencies: readonly string[];
}

interface WriteCompileResultOptions {
  readonly check?: boolean;
}

interface WriteCompileResult {
  readonly written: readonly string[];
  readonly deleted: readonly string[];
  readonly stale: readonly string[];
}

type CompileProject = (options: CompileProjectOptions) => Promise<CompileResult>;
type WriteCompileResultFunction = (
  result: CompileResult,
  options?: WriteCompileResultOptions,
) => Promise<WriteCompileResult>;

interface MigrationPlan {
  readonly operations: readonly ChangeOp[];
  readonly up: readonly string[];
  readonly down: readonly string[];
}

type PlanMigration = (
  previous: SchemaSnapshot,
  next: SchemaSnapshot,
  database: {
    readonly dialect: SqlDialect;
    emitUp(operation: ChangeOp): string;
    emitDown(operation: ChangeOp): string;
  },
) => MigrationPlan;

type CompilerValues = {
  readonly compileProject: CompileProject;
  readonly watchCodegen: typeof compilerWatchCodegen;
  readonly writeCompileResult: WriteCompileResultFunction;
};

type MigrationValues = {
  readonly snapshot: typeof snapshot;
  readonly diff: typeof diff;
  readonly planMigration: PlanMigration;
  readonly generateMigration: typeof generateMigration;
  readonly embedMigrations: typeof embedMigrations;
  readonly migrate: typeof migrate;
  readonly rollback: typeof rollback;
  readonly migrationStatus: typeof migrationStatus;
  readonly planPush: typeof planPush;
  readonly applyPush: typeof applyPush;
  readonly checkProject: typeof checkProject;
  readonly upgradeSnapshot: typeof upgradeSnapshot;
  readonly exportSchema: typeof exportSchema;
  readonly pullDeclarations: typeof pullDeclarations;
};

type RuntimeReachability = {
  readonly schema: never;
  readonly sql: never;
  readonly validator: never;
  readonly orm: never;
  readonly web: never;
  readonly zmdbRoot: never;
};

type CommandDelegations = {
  readonly codegen: 'compileProject' | 'writeCompileResult';
  readonly generate: 'generateMigration';
  readonly embed: 'embedMigrations';
  readonly migrate: 'migrate';
  readonly rollback: 'rollback';
  readonly status: 'migrationStatus';
  readonly push: 'applyPush' | 'planPush';
  readonly check: 'checkProject';
  readonly upgrade: 'upgradeSnapshot';
  readonly export: 'exportSchema';
  readonly pull: 'pullDeclarations';
};

export type _CompilerSubpathsAreExact = Expect<
  Equal<
    keyof CompilerExports,
    | '.'
    | './config'
    | './emit'
    | './errors'
    | './lint'
    | './metro'
    | './reflect'
    | './testing'
    | './transform'
    | './unplugin'
  >
>;
export type _MigrationsSubpathsAreExact = Expect<
  Equal<
    keyof MigrationsExports,
    | '.'
    | './declarations'
    | './embedded'
    | './files'
    | './introspect'
    | './introspect/runtime'
    | './runner'
    | './testing'
  >
>;
export type _CliHasOneLibraryEntry = Expect<Equal<keyof CliExports, '.'>>;
export type _CompilerRootIsExact = Expect<
  Equal<keyof CompilerValues, 'compileProject' | 'watchCodegen' | 'writeCompileResult'>
>;
export type _MigrationOperationsAreExact = Expect<
  Equal<
    keyof MigrationValues,
    | 'applyPush'
    | 'checkProject'
    | 'diff'
    | 'embedMigrations'
    | 'exportSchema'
    | 'generateMigration'
    | 'migrate'
    | 'migrationStatus'
    | 'planMigration'
    | 'planPush'
    | 'pullDeclarations'
    | 'rollback'
    | 'snapshot'
    | 'upgradeSnapshot'
  >
>;
export type _CliSignatureMovesWithoutChanging = Expect<
  Equal<typeof runCli, (argv: readonly string[], environment?: CliEnvironment) => Promise<number>>
>;
export type _RuntimeRootsReachNoToolingPackage = Expect<Equal<RuntimeReachability[keyof RuntimeReachability], never>>;
export type _EveryDatabaseCommandHasOneLibraryOperation = Expect<
  Equal<
    keyof CommandDelegations,
    | 'check'
    | 'codegen'
    | 'embed'
    | 'export'
    | 'generate'
    | 'migrate'
    | 'pull'
    | 'push'
    | 'rollback'
    | 'status'
    | 'upgrade'
  >
>;
export type _EmbeddedConnectionHasNoFilesystemContract = Expect<
  Equal<Extract<keyof EmbeddedConnection, 'open' | 'readFile' | 'writeFile'>, never>
>;
export type _CompilerFilesAreProjectMembers = Expect<
  Equal<CompileProjectOptions['files'], readonly string[] | undefined>
>;
export type _CompilerResultIsData = Expect<Equal<CompileResult['artifacts'][number], CompiledArtifact>>;
export type _MigrationSnapshotRemainsStructural = Expect<
  Equal<
    Extends<SnapshotableSchema, { readonly table: string; readonly columns: Readonly<Record<string, unknown>> }>,
    true
  >
>;

// Keep every current implementation signature named so the extraction cannot
// silently narrow a moved entry while the structural package map still compiles.
export type _CompilerImplementationSignatures = [
  typeof compilerCompileProject,
  typeof compilerWriteCompileResult,
  CompilerCompileProjectOptions,
  CompilerCompileResult,
  Emitter,
  EmitDiagnostic,
  EmitOptions,
  Reflector,
  ReflectDiagnostic,
  ReflectLimits,
  ReflectOptions,
  ReflectResult<unknown>,
  typeof irFromType,
  typeof schemaIrFromType,
  TransformContext,
  TransformDiagnostic,
  TransformResult,
  typeof transformFile,
  UnpluginLike,
  ZmdbAotOptions,
  typeof zmdbAot,
  MetroOptions,
  typeof withZmdb,
  typeof lintConfigs,
  typeof schemasFrom,
  typeof schemasFromFiles,
  typeof schemaIrsFrom,
  typeof defineConfig,
  typeof loadConfig,
  typeof resolveConfig,
  ZmdbConfigData,
  ZmdbConfig,
  ResolvedConfig,
];

export type _MigrationsImplementationSignatures = [
  typeof snapshot,
  typeof diff,
  typeof emitUp,
  typeof emitDown,
  DiffOptions,
  SchemaSnapshot,
  ChangeOp,
  typeof up,
  typeof down,
  typeof status,
  Migration,
  MigrationConnection,
  MigrationStatus,
  typeof runEmbedded,
  EmbeddedMigration,
  EmbeddedMigrationError,
  typeof createIntrospector,
  typeof detectDrift,
  typeof normalizeDriftSnapshot,
  typeof emitDeclarations,
  CatalogSchemaSnapshot,
];

function unimplemented(what: string): never {
  throw new Error(`${what} has no production implementation`);
}

const compileProject: CompileProject = _options => unimplemented('@zmdb/compiler compileProject');
const writeCompileResult: WriteCompileResultFunction = (_result, _options) =>
  unimplemented('@zmdb/compiler writeCompileResult');
const planMigration: PlanMigration = (_previous, _next, _database) => unimplemented('@zmdb/migrations planMigration');

void compileProject({ project: './tsconfig.json', files: ['./src/model.ts'] });
void writeCompileResult({
  project: './tsconfig.json',
  files: [],
  artifacts: [],
  diagnostics: [],
  dependencies: [],
});
void planMigration(
  { version: 1, tables: [], extensions: [] },
  { version: 1, tables: [], extensions: [] },
  {
    dialect: sqliteDialect,
    emitUp: _operation => '',
    emitDown: _operation => '',
  },
);

// @ts-expect-error the project is the required compiler boundary
void compileProject({});
// @ts-expect-error argv is an immutable sequence of strings, not one string
void runCli('--help');
// @ts-expect-error the embedded runner receives SQL protocols, never filesystem handles
const invalidEmbeddedConnection: EmbeddedConnection = { open() {} };
void invalidEmbeddedConnection;
