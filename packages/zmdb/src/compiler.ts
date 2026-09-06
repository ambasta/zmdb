// AOT code generation, bundler adapters, reflection, linting, and emit tooling.

export { zmdbAot } from './unplugin.js';
export type { ConfiguredZmdbAotOptions } from './unplugin.js';

export { transformCode, transformFile, transformTypeChecks } from '@zmdb/aot-validator/unplugin';
export type {
  TransformContext,
  TransformDiagnostic,
  TransformResult,
  UnpluginLike,
  ZmdbAotOptions,
} from '@zmdb/aot-validator/unplugin';

export { getCacheKey, transform, withZmdb } from '@zmdb/aot-validator/metro';
export type { MetroOptions } from '@zmdb/aot-validator/metro';

export { codegen, watchCodegen } from '@zmdb/aot-validator/codegen';
export type { CodegenOptions, CodegenResult, WatchOptions } from '@zmdb/aot-validator/codegen';

export {
  Emitter,
  discriminantOf,
  escapePattern,
  expectedForConstraint,
  expectedForDiscriminant,
  expectedOf,
  hasExcessCheck,
  messageFor,
} from '@zmdb/aot-validator/emit';
export type {
  ConstraintKeyword,
  Discriminant,
  DiscriminantArm,
  EmitDiagnostic,
  EmitOptions,
  EmitTarget,
} from '@zmdb/aot-validator/emit';

export { configs, default as lintPlugin } from '@zmdb/aot-validator/lint';
export type { LintRule } from '@zmdb/aot-validator/lint';

export {
  DEFAULT_LIMITS,
  ReflectSession,
  Reflector,
  apiInstanceCount,
  irFromType,
  projectSourceFileNames,
  schemaIrFromType,
  withSession,
} from '@zmdb/aot-validator/reflect';
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
} from '@zmdb/aot-validator/reflect';

export { CALLEES, Rewriter } from '@zmdb/aot-validator/transformer';
export type { WatchChange } from '@zmdb/aot-validator/plugin';
