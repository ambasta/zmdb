import type {
  CompiledArtifact,
  CompileProjectOptions,
  CompileResult,
  compileProject,
  ConfiguredZmdbAotOptions,
  WriteCompileResult,
  WriteCompileResultOptions,
  writeCompileResult,
  zmdbAot as configuredPlugin,
} from '@zmdb/compiler';
import type { loadConfig } from '@zmdb/compiler/config';
import type { defineConfig } from '@zmdb/compiler/config/contract';
import type { Emitter } from '@zmdb/compiler/emit';
import type { CompilerDiagnostic } from '@zmdb/compiler/errors';
import type { configs } from '@zmdb/compiler/lint';
import { withZmdb } from '@zmdb/compiler/metro';
import type { ReflectSession } from '@zmdb/compiler/reflect';
import type { schemasFromFiles } from '@zmdb/compiler/testing';
import type { transformFile } from '@zmdb/compiler/transform';
import type { UnpluginLike, zmdbAot as directPlugin } from '@zmdb/compiler/unplugin';
import type { MetroConfig } from 'metro';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

interface Artifact {
  readonly source: string;
  readonly witnessPath: string;
  readonly runtimePath: string;
  readonly declarationPath: string;
  readonly witness: string;
  readonly runtime: string;
  readonly declaration: string;
}

interface Publication {
  readonly written: readonly string[];
  readonly deleted: readonly string[];
  readonly stale: readonly string[];
}

export type CompilerMethods = [
  Expect<Equal<typeof compileProject, (options: CompileProjectOptions) => Promise<CompileResult>>>,
  Expect<
    Equal<
      typeof writeCompileResult,
      (result: CompileResult, options?: WriteCompileResultOptions) => Promise<WriteCompileResult>
    >
  >,
  Expect<Equal<CompiledArtifact, Artifact>>,
  Expect<Equal<WriteCompileResult, Publication>>,
  Expect<Equal<ReturnType<typeof configuredPlugin>, Promise<UnpluginLike>>>,
  Expect<Equal<ReturnType<typeof directPlugin>, UnpluginLike>>,
  Expect<Equal<ConfiguredZmdbAotOptions['config'], string | undefined>>,
  Expect<
    Equal<
      typeof withZmdb,
      <Config extends MetroConfig>(value: Config, options?: { readonly workerCount?: number }) => Config
    >
  >,
];

export type PublicSubpaths = [
  typeof loadConfig,
  typeof defineConfig,
  typeof Emitter,
  CompilerDiagnostic,
  typeof configs,
  typeof ReflectSession,
  typeof schemasFromFiles,
  typeof transformFile,
];

const project = { projectRoot: '/publication' } satisfies MetroConfig;
export const preserved = withZmdb(project, { workerCount: 1 });
export type ExactConfiguration = Expect<Equal<typeof preserved, typeof project>>;

// @ts-expect-error the selected worker count is numeric
withZmdb(project, { workerCount: '1' });
// @ts-expect-error project compilation requires a path string
export const invalidProject: CompileProjectOptions = { project: 1 };
