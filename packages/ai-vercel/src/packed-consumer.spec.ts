import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { publishManifest, publishTrain } from '../../../.github/scripts/lib/publish-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PACKAGES = join(ROOT, 'packages');
const AI_VERSION = '7.0.93';
const PACKAGE_DIRECTORIES = ['query-compiler', 'schema-core', 'ai', 'ai-vercel'] as const;

let scratch = '';
let consumer = '';

const readJson = (path: string): Readonly<Record<string, unknown>> =>
  JSON.parse(readFileSync(path, 'utf8')) as Readonly<Record<string, unknown>>;

function run(command: string, arguments_: readonly string[], cwd: string): string {
  return execFileSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });
}

function pack(directory: (typeof PACKAGE_DIRECTORIES)[number], releaseVersion: string): string {
  const source = join(PACKAGES, directory);
  const stage = join(scratch, 'stage', directory);
  cpSync(source, stage, {
    recursive: true,
    dereference: true,
    filter: path => !path.split(sep).includes('node_modules'),
  });
  const manifest = readJson(join(source, 'package.json'));
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(publishManifest(manifest, releaseVersion), null, 2)}\n`);
  const output = run('npm', ['pack', '--json', '--pack-destination', join(scratch, 'tarballs')], stage);
  const report: unknown = JSON.parse(output);
  const row = Array.isArray(report) ? report[0] : undefined;
  if (typeof row !== 'object' || row === null || !('filename' in row) || typeof row.filename !== 'string') {
    throw new Error(`npm pack returned no filename for ${directory}: ${output}`);
  }
  return join(scratch, 'tarballs', row.filename);
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'zmdb-ai-vercel-supported-floor-'));
  consumer = join(scratch, 'consumer');
  mkdirSync(join(scratch, 'tarballs'), { recursive: true });
  mkdirSync(consumer, { recursive: true });

  const releaseVersion = publishTrain(ROOT).version;
  const tarballs = new Map<string, string>();
  for (const directory of PACKAGE_DIRECTORIES) {
    const manifest = readJson(join(PACKAGES, directory, 'package.json'));
    const name = manifest['name'];
    if (typeof name !== 'string') throw new Error(`${directory} has no package name`);
    run('yarn', ['workspace', name, 'build'], ROOT);
    tarballs.set(name, pack(directory, releaseVersion));
  }

  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify(
      {
        name: 'ai-vercel-supported-floor-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@zmdb/ai-vercel': `file:${tarballs.get('@zmdb/ai-vercel')}`,
          '@zmdb/ai': `file:${tarballs.get('@zmdb/ai')}`,
          '@zmdb/query-compiler': `file:${tarballs.get('@zmdb/query-compiler')}`,
          '@zmdb/schema-core': `file:${tarballs.get('@zmdb/schema-core')}`,
          ai: AI_VERSION,
        },
      },
      null,
      2,
    )}\n`,
  );
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);

  writeFileSync(
    join(consumer, 'contract.ts'),
    `import { jsonSchema, streamText, tool, type LanguageModel } from 'ai';
import { aiSdkTool } from '@zmdb/ai-vercel';
import type { ToolSchema } from '@zmdb/ai';

declare const schema: ToolSchema;
declare const model: LanguageModel;
const echo = tool(aiSdkTool('echo', schema, {
  jsonSchema,
  description: 'Echo one value',
  validate(input): { readonly value: string } {
    return { value: String(Reflect.get(Object(input), 'value')) };
  },
  execute: async input => input.value,
}));
const stream = streamText({ model, prompt: 'echo', tools: { echo } }).fullStream;
void stream;
`,
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          target: 'ESNext',
        },
        include: ['contract.ts'],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(consumer, 'runtime.mjs'),
    `import { readFileSync } from 'node:fs';
import { aiSdkTool } from '@zmdb/ai-vercel';
import { jsonSchema, simulateReadableStream, streamText, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

const manifest = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const column = name => ({
  name, physicalName: name, sql: 'text', nullable: false, primaryKey: false,
  serial: false, unique: false, hasDefault: false, sensitive: false, constraints: {}, rules: [],
});
const schema = {
  table: 'echoes', columns: { value: { type: 'text', flags: { nullable: false } } },
  primaryKey: [], references: [],
  ir: { table: 'echoes', physicalTable: 'echoes', columns: [column('value')], primaryKey: [], relations: [], foreignKeys: [] },
};
const fields = aiSdkTool('echo', schema, {
  jsonSchema,
  description: 'Echo one value',
  validate(input) {
    const value = Reflect.get(Object(input), 'value');
    if (typeof value !== 'string') throw Object.assign(new Error('invalid input'), {
      issues: [{ path: '$input.value', message: 'value must be a string', expected: 'string' }],
    });
    return { value };
  },
  execute: async input => input.value,
});
const sdkTool = tool(fields);
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const model = new MockLanguageModelV3({
  doStream: {
    stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'echo', input: '{"value":"packed"}' },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
    ] }),
  },
});
const result = streamText({ model, prompt: 'echo', tools: { echo: sdkTool } });
let toolCalls = 0;
let toolResult;
for await (const event of result.fullStream) {
  if (event.type === 'tool-call') toolCalls += 1;
  if (event.type === 'tool-result') toolResult = event.output;
}
process.stdout.write(JSON.stringify({
  version: manifest('./node_modules/ai/package.json').version,
  peer: manifest('./node_modules/@zmdb/ai-vercel/package.json').peerDependencies.ai,
  toolCalls,
  toolResult,
}));
`,
  );
}, 120_000);

afterAll(() => {
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true });
});

describe('packed @zmdb/ai-vercel supported-floor consumer (#748)', () => {
  it('installs exact ai 7.0.93 and exercises real tool and streaming surfaces', () => {
    run(
      process.execPath,
      [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'tsconfig.json'],
      consumer,
    );
    const output = run(process.execPath, ['runtime.mjs'], consumer);
    expect(JSON.parse(output)).toEqual({
      version: AI_VERSION,
      peer: '^7.0.93',
      toolCalls: 1,
      toolResult: 'packed',
    });
  });
});
