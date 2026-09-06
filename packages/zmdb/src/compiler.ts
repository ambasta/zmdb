// Logic-free product facade for project compilation and compiler integrations.

export { zmdbAot } from './unplugin.js';
export type { ConfiguredZmdbAotOptions } from './unplugin.js';

export { compileProject, writeCompileResult } from '@zmdb/compiler';
export type {
  CompiledArtifact,
  CompileProjectOptions,
  CompileResult,
  CompilerDiagnostic,
  WriteCompileResult,
  WriteCompileResultOptions,
} from '@zmdb/compiler';

export { transformTypeChecks } from '@zmdb/compiler/unplugin';
export type { UnpluginLike, WatchChange, ZmdbAotOptions } from '@zmdb/compiler/unplugin';

export { getCacheKey, transform, withZmdb } from '@zmdb/compiler/metro';
export type { MetroOptions } from '@zmdb/compiler/metro';

export {
  Emitter,
  discriminantOf,
  escapePattern,
  expectedForConstraint,
  expectedForDiscriminant,
  expectedOf,
  hasExcessCheck,
  messageFor,
} from '@zmdb/compiler/emit';
export type {
  ConstraintKeyword,
  Discriminant,
  DiscriminantArm,
  EmitDiagnostic,
  EmitOptions,
  EmitTarget,
} from '@zmdb/compiler/emit';

export { configs, default as lintPlugin } from '@zmdb/compiler/lint';
export type { LintRule } from '@zmdb/compiler/lint';

export {
  DEFAULT_LIMITS,
  ReflectSession,
  Reflector,
  apiInstanceCount,
  irFromType,
  projectSourceFileNames,
  schemaIrFromType,
  withSession,
} from '@zmdb/compiler/reflect';
export type {
  GrpcMethodIR,
  GrpcServiceIR,
  NamingStrategy,
  ReflectDiagnostic,
  ReflectLimits,
  ReflectOptions,
  ReflectResult,
  SessionOptions,
  SessionUpdate,
  SourceFileHandle,
} from '@zmdb/compiler/reflect';

export {
  CALLEES,
  Rewriter,
  splitArgs,
  splitTopLevelComma,
  transformCode,
  transformFile,
} from '@zmdb/compiler/transform';
export type { TransformContext, TransformDiagnostic, TransformResult } from '@zmdb/compiler/transform';
