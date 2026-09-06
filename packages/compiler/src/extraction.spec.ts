import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringify } from '@zmdb/aot-validator/serialization';
import { describe, expect, it } from 'vitest';

import { FixtureProject } from './emit/__testing__/project.js';
import { compileProject } from './index.js';
import { apiInstanceCount } from './reflect/session.js';

const ROOT = new URL('../../../', import.meta.url).pathname;
const DECLARATIONS = `  interface User extends ZmdbTags.Table<"users"> {
    id: number & ZmdbTags.Sql<"integer"> & ZmdbTags.PrimaryKey;
    email: string & ZmdbTags.Sql<"text">;
  }
  function toJsonSchema<T>(): unknown;
  function schemaOf<T>(): unknown;`;

describe('@zmdb/compiler extraction', () => {
  it('reflects one tagged declaration into the identical frozen TypeIR from @zmdb/compiler', () => {
    using project = FixtureProject.open({ declarations: DECLARATIONS });

    expect(project.ir('User')).toEqual({
      kind: 'object',
      name: 'User',
      properties: [
        {
          name: 'id',
          type: { kind: 'scalar', scalar: 'integer' },
          optional: false,
          readonly: false,
        },
        {
          name: 'email',
          type: { kind: 'scalar', scalar: 'string' },
          optional: false,
          readonly: false,
        },
      ],
    });
  });

  it('emits byte-equivalent validator, serializer, JSON Schema and schema-value output after the move', () => {
    using project = FixtureProject.open({ declarations: DECLARATIONS });

    expect(project.transform('const check = (input) => is<User>(input);')).toMatchObject({
      diagnostics: [],
      code:
        'function _zmdbCheckUser0(_v) { return typeof _v === "object" && _v !== null && !Array.isArray(_v) && ' +
        '(Number.isInteger(_v.id)) && (typeof _v.email === "string"); }\n' +
        'const check = (input) => (_zmdbCheckUser0(input));',
    });
    // Serialization remains a runtime-validator responsibility. The extraction contract is
    // byte preservation across the move, not a new compiler-side serializer emitter.
    expect(stringify({ id: 1, email: 'a@b' })).toBe('{"id":1,"email":"a@b"}');
    expect(project.transform('const check = () => toJsonSchema<User>();')).toMatchObject({
      diagnostics: [],
      code:
        'const _zmdbJsonSchema0 = _zmdbFreeze({"type":"object","properties":{"email":{"type":"string"},' +
        '"id":{"type":"integer"}},"required":["email","id"]});\n' +
        'function _zmdbFreeze(_v) { if (_v !== null && typeof _v === "object") { for (const _k of ' +
        'Object.keys(_v)) _zmdbFreeze(_v[_k]); Object.freeze(_v); } return _v; }\n' +
        'const check = () => _zmdbJsonSchema0;',
    });
    expect(project.transform('const check = () => schemaOf<User>();')).toMatchObject({
      diagnostics: [],
      code:
        'const _zmdbSchema0 = _zmdbFreeze({"table":"users","columns":{"id":{"type":"integer","flags":' +
        '{"nullable":false,"primaryKey":true}},"email":{"type":"text","flags":{"nullable":false}}},' +
        '"primaryKey":["id"],"references":[],"ir":{"table":"users","physicalTable":"users","columns":' +
        '[{"name":"id","physicalName":"id","sql":"integer","nullable":false,"primaryKey":true,' +
        '"serial":false,"unique":false,"hasDefault":false,"sensitive":false,"constraints":{},"rules":[]},' +
        '{"name":"email","physicalName":"email","sql":"text","nullable":false,"primaryKey":false,' +
        '"serial":false,"unique":false,"hasDefault":false,"sensitive":false,"constraints":{},"rules":[]}],' +
        '"primaryKey":["id"],"relations":[],"foreignKeys":[]}});\n' +
        'function _zmdbFreeze(_v) { if (_v !== null && typeof _v === "object") { for (const _k of ' +
        'Object.keys(_v)) _zmdbFreeze(_v[_k]); Object.freeze(_v); } return _v; }\n' +
        'const check = () => _zmdbSchema0;',
    });
  });

  it('reports the same file, span, path and refusal through compiler diagnostics', () => {
    using project = FixtureProject.open();
    const source = 'const check = (input) => is<{ bag: Record<string, string> }>(input);';
    const result = project.transform(source);
    const diagnostic = result.diagnostics[0];

    expect(diagnostic).toEqual({
      fileName: project.module,
      position: source.indexOf('is<'),
      callee: 'is',
      path: 'bag',
      reason: 'an index signature is not readable through the checker API, so `Record<string, T>` cannot be modelled',
      source: 'Record<string, string>',
    });
    expect(source.slice(diagnostic?.position, (diagnostic?.position ?? 0) + 2)).toBe('is');
  });

  it('opens one compiler session for project selection and generation', async () => {
    using project = FixtureProject.open();
    const before = apiInstanceCount();

    const result = await compileProject({ project: project.tsconfig, files: [project.module] });

    expect(result.diagnostics).toEqual([]);
    expect(result.files).toEqual([project.module]);
    expect(apiInstanceCount() - before).toBe(1);
  });

  it('compiles generated witnesses when the consumer lists project roots explicitly', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zmdb-compiler-explicit-roots-'));
    try {
      mkdirSync(join(directory, 'src'), { recursive: true });
      symlinkSync(join(ROOT, 'node_modules'), join(directory, 'node_modules'), 'dir');
      writeFileSync(join(directory, 'package.json'), '{"private":true,"type":"module"}\n');
      writeFileSync(
        join(directory, 'tsconfig.json'),
        `${JSON.stringify(
          {
            compilerOptions: {
              target: 'ESNext',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              strict: true,
              allowImportingTsExtensions: false,
              noEmit: true,
              types: ['node'],
            },
            include: ['src/model.ts'],
          },
          undefined,
          2,
        )}\n`,
      );
      const model = join(directory, 'src', 'model.ts');
      writeFileSync(
        model,
        `import { is } from '@zmdb/aot-validator/utilities';

export interface User {
  readonly id: number;
}

export const acceptsUser = (value: unknown): value is User => is<User>(value);
`,
      );

      const result = await compileProject({ project: join(directory, 'tsconfig.json'), files: [model] });

      expect(result.diagnostics).toEqual([]);
      expect(result.files).toEqual([model]);
      expect(result.artifacts).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps one-walker, instantiation and build-budget measurements within updated evidence-backed budgets', () => {
    const run = (args: readonly string[]): string =>
      execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });

    expect(run(['.github/scripts/verify-one-walker.mjs'])).toContain('one walk from a column to a value');
    expect(run(['.github/scripts/verify-instantiations.mjs'])).toContain('deriving over them costs');
    expect(
      run(['--import', join(ROOT, 'scripts/ts-specifier-hook.mjs'), '.github/scripts/verify-build-budget.mjs']),
    ).toContain('one compiler session');
  }, 60_000);
});
