// Compile-only freeze for #627.
//
// The three target packages do not exist yet. Importing them here would turn a
// useful contract into three TS2307 placeholders, so the future surfaces are
// transcribed from #626 and wired to the current implementation types. #628-
// #630 replace these aliases with imports from the real package entry points.

import type { CodegenOptions, CodegenResult, codegen, watchCodegen } from '@zmdb/aot-validator/codegen';
import type { EmitDiagnostic, EmitOptions, Emitter } from '@zmdb/aot-validator/emit';
import type { configs as lintConfigs } from '@zmdb/aot-validator/lint';
import type { MetroOptions, withZmdb } from '@zmdb/aot-validator/metro';
import type {
  ReflectDiagnostic,
  ReflectLimits,
  ReflectOptions,
  ReflectResult,
  Reflector,
  irFromType,
  schemaIrFromType,
} from '@zmdb/aot-validator/reflect';
import type { schemasFrom, schemasFromFiles, schemaIrsFrom } from '@zmdb/aot-validator/testing';
import type {
  TransformContext,
  TransformDiagnostic,
  TransformResult,
  transformFile,
} from '@zmdb/aot-validator/transformer';
import type { UnpluginLike, ZmdbAotOptions, zmdbAot } from '@zmdb/aot-validator/unplugin';
import type { Dialect } from '@zmdb/query-compiler';
import type {
  CatalogSchemaSnapshot,
  createIntrospector,
  detectDrift,
  emitDeclarations,
} from '@zmdb/query-compiler/introspect';
import type {
  ChangeOp,
  DiffOptions,
  SchemaSnapshot,
  SnapshotableSchema,
  diff,
  emitDown,
  emitUp,
  snapshot,
} from '@zmdb/query-compiler/migrations';
import type {
  EmbeddedConnection,
  EmbeddedMigration,
  EmbeddedMigrationError,
  runEmbedded,
} from '@zmdb/query-compiler/migrations/embedded';
import type {
  Migration,
  MigrationConnection,
  MigrationStatus,
  down,
  status,
  up,
} from '@zmdb/query-compiler/migrations/runner';
import type { Equal, Expect, Extends } from '@zmdb/schema-core';
import type { NamingStrategy } from '@zmdb/schema-core/naming';

import type {
  TARGET_PRODUCT_TOOLING_EXPORTS,
  TARGET_TOOLING_MANIFESTS,
} from '../../../.github/scripts/verify-tooling-boundaries.mjs';
import type { checkProject } from './cli/commands/check.js';
import type { embedMigrations } from './cli/commands/embed.js';
import type { exportSchema } from './cli/commands/export.js';
import type { generateMigration } from './cli/commands/generate.js';
import type { migrate, migrationStatus, rollback } from './cli/commands/migrate.js';
import type { pullDeclarations } from './cli/commands/pull.js';
import type { applyPush, planPush } from './cli/commands/push.js';
import type { upgradeSnapshot } from './cli/commands/upgrade.js';
import type { CliEnvironment, runCli } from './cli/index.js';
import type {
  ResolvedConfig,
  ZmdbConfig,
  ZmdbConfigData,
  defineConfig,
  loadConfig,
  resolveConfig,
} from './config/index.js';

type ExportSet<Values extends string, Types extends string> = {
  readonly values: Values;
  readonly types: Types;
};

type CompilerExports = {
  readonly '.': ExportSet<
    'compileProject' | 'writeCompileResult',
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
    | 'applyPush'
    | 'checkProject'
    | 'diff'
    | 'embedMigrations'
    | 'exportSchema'
    | 'generateMigration'
    | 'planMigration'
    | 'planPush'
    | 'pullDeclarations'
    | 'snapshot'
    | 'upgradeSnapshot',
    'ChangeOp' | 'DiffOptions' | 'MigrationPlan' | 'SchemaSnapshot' | 'SnapshotableSchema'
  >;
  readonly './runner': ExportSet<
    'down' | 'migrate' | 'migrationStatus' | 'rollback' | 'status' | 'up',
    'Migration' | 'MigrationConnection' | 'MigrationStatus'
  >;
  readonly './embedded': ExportSet<
    'EmbeddedMigrationError' | 'runEmbedded',
    'EmbeddedConnection' | 'EmbeddedMigration'
  >;
  readonly './introspect': ExportSet<'createIntrospector' | 'detectDrift', 'CatalogSchemaSnapshot'>;
  readonly './declarations': ExportSet<'emitDeclarations', never>;
  readonly './files': ExportSet<never, never>;
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
    readonly dialect: Dialect;
    emitUp(operation: ChangeOp): string;
    emitDown(operation: ChangeOp): string;
  },
) => MigrationPlan;

type CompilerValues = {
  readonly compileProject: CompileProject;
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

type TargetManifestContracts = typeof TARGET_TOOLING_MANIFESTS;
type TargetDependencies = {
  readonly [Package in keyof TargetManifestContracts]: TargetManifestContracts[Package]['dependencies'][number];
};
type TargetPeers = {
  readonly [Package in keyof TargetManifestContracts]: TargetManifestContracts[Package]['peerDependencies'][number];
};
type TargetOptionalPeers = {
  readonly [Package in keyof TargetManifestContracts]: TargetManifestContracts[Package]['optionalPeers'][number];
};
type ProductToolingExports =
  (typeof TARGET_PRODUCT_TOOLING_EXPORTS)[keyof typeof TARGET_PRODUCT_TOOLING_EXPORTS][number];

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
    '.' | './declarations' | './embedded' | './files' | './introspect' | './runner' | './testing'
  >
>;
export type _CliHasOneLibraryEntry = Expect<Equal<keyof CliExports, '.'>>;
export type _CompilerRootIsExact = Expect<Equal<keyof CompilerValues, 'compileProject' | 'writeCompileResult'>>;
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
export type _ToolingDependencyGraphIsExact = Expect<
  Equal<
    TargetDependencies,
    {
      readonly '@zmdb/compiler': '@zmdb/aot-validator' | '@zmdb/query-compiler' | '@zmdb/schema-core';
      readonly '@zmdb/migrations': '@zmdb/query-compiler' | 'oxfmt';
      readonly '@zmdb/cli': '@zmdb/compiler' | '@zmdb/migrations' | 'oxfmt';
    }
  >
>;
export type _OnlyCompilerAndCliHaveToolingPeers = Expect<
  Equal<
    TargetPeers,
    {
      readonly '@zmdb/compiler': 'metro' | 'metro-babel-transformer' | 'oxlint' | 'typescript';
      readonly '@zmdb/migrations': never;
      readonly '@zmdb/cli': '@zmdb/web' | 'esbuild';
    }
  >
>;
export type _OptionalPeersAreExact = Expect<
  Equal<
    TargetOptionalPeers,
    {
      readonly '@zmdb/compiler': 'metro' | 'metro-babel-transformer' | 'oxlint';
      readonly '@zmdb/migrations': never;
      readonly '@zmdb/cli': '@zmdb/web' | 'esbuild';
    }
  >
>;
export type _ProductToolingFacadesAreExact = Expect<
  Equal<ProductToolingExports, './cli' | './compiler' | './config' | './migrations'>
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
  typeof codegen,
  typeof watchCodegen,
  CodegenOptions,
  CodegenResult,
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
    dialect: 'sqlite',
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
