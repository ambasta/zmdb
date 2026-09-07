import {
  runCli,
  embedMigrations,
  exportSchema,
  generateMigration,
  pullDeclarations,
  generateHttpArtifacts,
  watchHttpArtifacts,
  type CliEnvironment,
  type CliResult,
  type CheckResult,
  type EmbedOptions,
  type EmbedResult,
  type ExportResult,
  type GenerateHttpArtifactsOptions,
  type GenerateOptions,
  type GenerateResult,
  type HttpArtifactGeneration,
  type MigrateResult,
  type PullOptions,
  type PullResult,
  type PushResult,
  type RollbackResult,
  type StatusResult,
  type UpgradeResult,
  type WatchHttpArtifactsOptions,
  type ClientGenerateResult,
} from '@zmdb/cli';
import { watchCodegen, type WatchOptions, type CodegenOptions, type CodegenResult } from '@zmdb/compiler';
import type { ReflectSession } from '@zmdb/compiler/reflect';
import { runCli as facadeRunCli } from 'zmdb/cli';
const environment: CliEnvironment = {
  cwd: '.',
  stdout(text) {
    process.stdout.write(text);
  },
  stderr(text) {
    process.stderr.write(text);
  },
};
const argv: readonly string[] = ['--help'];
const result: Promise<number> = runCli(argv, environment);
const stable: typeof runCli = facadeRunCli;
function watch(session: ReflectSession) {
  const options: WatchOptions = {
    project: './tsconfig.json',
    session,
    until: Promise.resolve(),
    log(line) {
      process.stdout.write(line);
    },
  };
  const finite: CodegenOptions = options;
  const pending: Promise<CodegenResult> = watchCodegen(options);
  return [finite, pending];
}
function rollback(value: RollbackResult) {
  const versions: readonly { readonly version: number; readonly name: string }[] = value.versions;
  return [versions, value.reverted];
}
type PublicTypes = [
  CliResult<unknown>,
  CheckResult,
  EmbedOptions,
  EmbedResult,
  ExportResult,
  GenerateHttpArtifactsOptions,
  GenerateOptions,
  GenerateResult,
  HttpArtifactGeneration,
  MigrateResult,
  PullOptions,
  PullResult,
  PushResult,
  StatusResult,
  UpgradeResult,
  WatchHttpArtifactsOptions,
  ClientGenerateResult,
];
export type Contract = PublicTypes;
void [
  result,
  stable,
  watch,
  rollback,
  embedMigrations,
  exportSchema,
  generateMigration,
  pullDeclarations,
  generateHttpArtifacts,
  watchHttpArtifacts,
];
