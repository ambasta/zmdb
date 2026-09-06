import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ROOT, publishManifest, publishTrain, readManifest } from '../../../.github/scripts/lib/publish-manifest.mjs';
import {
  PACKED_BUILD_TEST_TIMEOUT_MS,
  runPackedProject,
  type PackedProjectResult,
} from '../../../fixtures/client-adapters/src/packed-project.js';

const RELEASE = await publishTrain(ROOT);
const RELEASE_VERSION = RELEASE.version;
const PACKAGE_NAMES = ['@zmdb/query-compiler', '@zmdb/schema-core', '@zmdb/ai', '@zmdb/ai-vercel'] as const;

function build(packageName: (typeof PACKAGE_NAMES)[number]): void {
  const result = spawnSync('yarn', ['workspace', packageName, 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${packageName} build failed with ${String(result.status)}\n${result.stdout}\n${result.stderr}`);
  }
}

const consumerSource = `
import type { ToolSchema } from '@zmdb/ai';
import { jsonSchema, streamText, tool } from 'ai';
import { aiSdkTool } from '@zmdb/ai-vercel';

interface EchoInput {
  readonly value: string;
}

const column = (name: string) => ({
  name,
  physicalName: name,
  sql: 'text' as const,
  nullable: false,
  primaryKey: false,
  serial: false,
  unique: false,
  hasDefault: false,
  sensitive: false,
  constraints: {},
  rules: [],
});

const schema = {
  table: 'echoes',
  columns: { value: { type: 'text', flags: { nullable: false } } },
  primaryKey: [],
  references: [],
  ir: {
    table: 'echoes',
    physicalTable: 'echoes',
    columns: [column('value')],
    primaryKey: [],
    relations: [],
    foreignKeys: [],
  },
} satisfies ToolSchema;

const echo = tool(
  aiSdkTool('echo', schema, {
    jsonSchema,
    description: 'Echo one value',
    validate(value): EchoInput {
      const text = Reflect.get(Object(value), 'value');
      if (typeof text !== 'string') throw new Error('value must be a string');
      return { value: text };
    },
    execute: input => input.value,
  }),
);

function streamingContract(model: Parameters<typeof streamText>[0]['model']): void {
  const result = streamText({ model, messages: [], tools: { echo } });
  void result;
}

void echo;
void streamingContract;
`;

const runtimeSource = `
import { createRequire } from 'node:module';
import { jsonSchema, tool } from 'ai';
import { aiSdkTool } from '@zmdb/ai-vercel';

const require = createRequire(import.meta.url);
const { version } = require('ai/package.json');
const column = name => ({
  name,
  physicalName: name,
  sql: 'text',
  nullable: false,
  primaryKey: false,
  serial: false,
  unique: false,
  hasDefault: false,
  sensitive: false,
  constraints: {},
  rules: [],
});
const schema = {
  table: 'echoes',
  columns: { value: { type: 'text', flags: { nullable: false } } },
  primaryKey: [],
  references: [],
  ir: {
    table: 'echoes',
    physicalTable: 'echoes',
    columns: [column('value')],
    primaryKey: [],
    relations: [],
    foreignKeys: [],
  },
};
const fields = aiSdkTool('echo', schema, {
  jsonSchema,
  description: 'Echo one value',
  validate(value) {
    const text = Reflect.get(Object(value), 'value');
    if (typeof text !== 'string') {
      const error = new Error('invalid echo input');
      error.issues = [{ path: '$input.value', message: 'value must be a string', expected: 'string' }];
      throw error;
    }
    return { value: text };
  },
  execute(input) {
    return input.value;
  },
});
const sdkTool = tool(fields);
const invalid = await fields.execute({ value: 93 });
process.stdout.write(JSON.stringify({
  version,
  keys: Object.keys(sdkTool).toSorted(),
  result: await fields.execute({ value: 'packed-7.0.93' }),
  invalid,
}));
`;

describe('@zmdb/ai-vercel packed AI SDK floor (#748)', () => {
  let result: PackedProjectResult | undefined;

  afterEach(() => {
    result?.cleanup();
    result = undefined;
  });

  it(
    'installs, typechecks and runs from tarballs against exact ai 7.0.93',
    () => {
      result = runPackedProject({
        name: '@zmdb-fixture/ai-vercel-floor',
        buildLockRoot: ROOT,
        preparePackages() {
          for (const packageName of PACKAGE_NAMES) build(packageName);
        },
        packages: [
          {
            directory: join(ROOT, 'packages', 'query-compiler'),
            manifest: publishManifest(readManifest('query-compiler', RELEASE), RELEASE_VERSION),
          },
          {
            directory: join(ROOT, 'packages', 'schema-core'),
            manifest: publishManifest(readManifest('schema-core', RELEASE), RELEASE_VERSION),
          },
          {
            directory: join(ROOT, 'packages', 'ai'),
            manifest: publishManifest(readManifest('ai', RELEASE), RELEASE_VERSION),
          },
          {
            directory: join(ROOT, 'packages', 'ai-vercel'),
            manifest: publishManifest(readManifest('ai-vercel', RELEASE), RELEASE_VERSION),
          },
        ],
        dependencies: {
          ai: '7.0.93',
          zod: '4.5.4',
        },
        devDependencies: {
          '@types/node': '26.4.1',
          typescript: '7.0.2',
        },
        files: {
          'src/consumer.ts': consumerSource,
          'runtime.mjs': runtimeSource,
          'tsconfig.json': `${JSON.stringify(
            {
              compilerOptions: {
                exactOptionalPropertyTypes: true,
                lib: ['ESNext', 'DOM'],
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                noEmit: true,
                noUncheckedIndexedAccess: true,
                skipLibCheck: true,
                strict: true,
                target: 'ESNext',
                types: ['node'],
                verbatimModuleSyntax: true,
              },
              include: ['src/**/*.ts'],
            },
            null,
            2,
          )}\n`,
        },
        commands: [
          {
            label: 'packed AI SDK floor typecheck',
            command: process.execPath,
            arguments: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
          },
          {
            label: 'packed AI SDK floor runtime',
            command: process.execPath,
            arguments: ['runtime.mjs'],
          },
        ],
      });

      expect([...result.tarballs.keys()].toSorted()).toEqual([...PACKAGE_NAMES].toSorted());
      expect(result.commands.map(command => [command.label, command.status])).toEqual([
        ['packed AI SDK floor typecheck', 0],
        ['packed AI SDK floor runtime', 0],
      ]);
      expect(JSON.parse(result.commands[1]?.stdout ?? '')).toEqual({
        version: '7.0.93',
        keys: ['description', 'execute', 'inputSchema'],
        result: 'packed-7.0.93',
        invalid: expect.stringContaining('$input.value'),
      });
      expect(
        readFileSync(join(result.application, 'node_modules', '@zmdb', 'ai-vercel', 'package.json'), 'utf8'),
      ).toContain('"ai": "^7.0.93"');
    },
    PACKED_BUILD_TEST_TIMEOUT_MS,
  );
});
