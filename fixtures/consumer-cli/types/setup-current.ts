import { compileProject, writeCompileResult, type CompileResult, type WriteCompileResult } from '@zmdb/compiler';
import { ReflectSession } from '@zmdb/compiler/reflect';
import type { RollbackResult } from '@zmdb/migrations/files';

import { AppModule } from '../projects/app/src/app.module.js';
import { HTTP_CONTRACT } from '../projects/http/src/contract.js';
const result: Promise<CompileResult> = compileProject({ project: './tsconfig.json' });
const written: Promise<WriteCompileResult> = result.then(value => writeCompileResult(value));
function versions(value: RollbackResult) {
  const all: readonly { readonly version: number; readonly name: string }[] = value.versions;
  const first: { readonly version: number; readonly name: string } | null = value.reverted;
  return [all, first];
}
void [written, versions, ReflectSession, AppModule, HTTP_CONTRACT];
