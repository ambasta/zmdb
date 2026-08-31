import fs from 'fs';
import path from 'path';

import ts from 'typescript';

const tsconfigPath = path.resolve('tsconfig.base.json');
const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));

const compilerOptions = ts.parseJsonConfigFileContent(tsconfig, ts.sys, path.dirname(tsconfigPath)).options;

// Add path mappings for workspace packages
compilerOptions.baseUrl = path.resolve('.');
compilerOptions.paths = {
  '@zmdb/schema-core': ['packages/schema-core/src/index.ts'],
  '@zmdb/schema-core/*': ['packages/schema-core/src/*'],
  '@zmdb/aot-validator': ['packages/aot-validator/src/index.ts'],
  '@zmdb/aot-validator/*': ['packages/aot-validator/src/*'],
  '@zmdb/query-compiler': ['packages/query-compiler/src/index.ts'],
  '@zmdb/query-compiler/*': ['packages/query-compiler/src/*'],
  '@zmdb/repository': ['packages/repository/src/index.ts'],
  '@zmdb/repository/*': ['packages/repository/src/*'],
  zmdb: ['packages/zmdb/src/index.ts'],
  'zmdb/*': ['packages/zmdb/src/*'],
};
compilerOptions.noEmit = true;

function checkSnippet(snippetCode) {
  const header = `
import { defineSchema, serial, text, integer, numeric, jsonEnum, timestamp, Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';
import { is, assert, validate, tags } from '@zmdb/aot-validator';
import { defineRepository, BaseRepository } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import { DatabaseSync } from 'node:sqlite';

declare const db: DatabaseSync;
declare const driver: ReturnType<typeof sqliteDriver>;
declare const UserSchema: any;
declare const users: any;
declare const input: any;
declare const payload: any;
declare const req: any;
declare const since: Date;
declare const connection: any;
`;

  const fullCode = header + '\n' + snippetCode;
  const fileName = path.resolve('tests/virtual_snippet.ts');

  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile;

  host.getSourceFile = (fName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fName === fileName) {
      return ts.createSourceFile(fName, fullCode, languageVersion);
    }
    return originalGetSourceFile(fName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  const program = ts.createProgram([fileName], compilerOptions, host);
  const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];

  const headerLines = header.split('\n').length;

  return diagnostics.map(d => {
    const file = d.file;
    let line = 0;
    if (file) {
      const pos = file.getLineAndCharacterOfPosition(d.start || 0);
      line = pos.line + 1 - headerLines;
    }
    return {
      line: Math.max(1, line),
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    };
  });
}

console.log('Testing valid snippet typecheck...');
const validDiags = checkSnippet(`
const schema = defineSchema('test', { id: serial().primaryKey() });
type TestEntity = Entity<typeof schema>;
`);
console.log('Valid snippet errors count:', validDiags.length);

console.log('Testing invalid snippet typecheck...');
const invalidDiags = checkSnippet(`
const x: number = "hello";
`);
console.log('Invalid snippet errors:', invalidDiags);
