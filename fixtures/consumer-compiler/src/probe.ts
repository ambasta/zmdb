import { compileProject, writeCompileResult } from '@zmdb/compiler';
import { defineConfig } from '@zmdb/compiler/config';
import { Emitter } from '@zmdb/compiler/emit';
import type { CompilerDiagnostic } from '@zmdb/compiler/errors';
import lint, { configs } from '@zmdb/compiler/lint';
import { withZmdb } from '@zmdb/compiler/metro';
import { ReflectSession } from '@zmdb/compiler/reflect';
import { schemasFromFiles } from '@zmdb/compiler/testing';
import { transformFile } from '@zmdb/compiler/transform';
import { zmdbAot } from '@zmdb/compiler/unplugin';

export async function compileFixture(project: string): Promise<readonly string[]> {
  const result = await compileProject({ project });
  const written = await writeCompileResult(result, { check: true });
  return written.stale;
}

export const compilerSubpaths = {
  configs,
  defineConfig,
  Emitter,
  lint,
  ReflectSession,
  schemasFromFiles,
  transformFile,
  withZmdb,
  zmdbAot,
};

export type CompilerFixtureDiagnostic = CompilerDiagnostic;
