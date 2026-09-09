// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Logic-free product facade for project compilation and compiler integrations.

export { compileProject, watchCodegen, writeCompileResult, zmdbAot } from '@zmdb/compiler';
export type {
  ConfiguredZmdbAotOptions,
  CodegenOptions,
  CodegenResult,
  CompiledArtifact,
  CompileProjectOptions,
  CompileResult,
  CompilerDiagnostic,
  WatchOptions,
  WriteCompileResult,
  WriteCompileResultOptions,
} from '@zmdb/compiler';

export { transformTypeChecks } from '@zmdb/compiler/unplugin';
export type { UnpluginLike, WatchChange, ZmdbAotOptions } from '@zmdb/compiler/unplugin';

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

export { CALLEES, Rewriter, transformCode, transformFile } from '@zmdb/compiler/transform';
export type { TransformContext, TransformDiagnostic, TransformResult } from '@zmdb/compiler/transform';
