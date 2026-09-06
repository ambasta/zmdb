import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PACKAGE = join(ROOT, 'packages', 'ai-vercel');
const HOOK = join(ROOT, 'scripts', 'ts-specifier-hook.mjs');
const PEERS = [
  { module: 'ai-lower-bound', version: '7.0.83' },
  { module: 'ai', version: '7.0.93' },
] as const;

let scratch = '';
let packed = '';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function packFilename(output: string): string {
  const report: unknown = JSON.parse(output);
  const row = Array.isArray(report) ? report[0] : isRecord(report) ? Object.values(report)[0] : undefined;
  if (!isRecord(row) || typeof row['filename'] !== 'string') {
    throw new Error(`npm pack returned no filename: ${output}`);
  }
  return row['filename'];
}

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'dir');
}

function runPackedConsumer(peer: (typeof PEERS)[number]): unknown {
  const app = join(scratch, `consumer-${peer.version}`);
  const modules = join(app, 'node_modules');
  mkdirSync(modules, { recursive: true });
  writeFileSync(join(app, 'package.json'), '{"name":"ai-vercel-packed-consumer","private":true,"type":"module"}\n');

  link(packed, join(modules, '@zmdb', 'ai-vercel'));
  const peerDirectory = join(ROOT, 'node_modules', peer.module);
  if (!existsSync(peerDirectory)) throw new Error(`missing installed peer fixture ${peer.module}`);
  link(peerDirectory, join(modules, 'ai'));

  const probe = join(app, 'probe.mjs');
  writeFileSync(
    probe,
    `import { createRequire } from 'node:module';
import { aiSdkTool } from '@zmdb/ai-vercel';
import { jsonSchema, tool } from 'ai';

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
process.stdout.write(JSON.stringify({
  version,
  keys: Object.keys(sdkTool).toSorted(),
  result: await fields.execute({ value: 'packed' }),
}));
`,
  );

  const output = execFileSync(process.execPath, [`--import=${HOOK}`, probe], {
    cwd: app,
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'zmdb-ai-vercel-'));
  const output = execFileSync('npm', ['pack', '--json', '--pack-destination', scratch], {
    cwd: PACKAGE,
    encoding: 'utf8',
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });
  packed = join(scratch, 'packed');
  mkdirSync(packed, { recursive: true });
  execFileSync('tar', ['-xzf', join(scratch, packFilename(output)), '-C', packed, '--strip-components=1']);
  link(join(ROOT, 'packages', 'ai'), join(packed, 'node_modules', '@zmdb', 'ai'));
  link(join(ROOT, 'packages', 'schema-core'), join(packed, 'node_modules', '@zmdb', 'schema-core'));
  link(join(ROOT, 'packages', 'query-compiler'), join(packed, 'node_modules', '@zmdb', 'query-compiler'));
  expect(readFileSync(join(packed, 'package.json'), 'utf8')).toContain('"@zmdb/ai"');
});

afterAll(() => {
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true });
});

describe('packed @zmdb/ai-vercel peer matrix (#708)', () => {
  for (const peer of PEERS) {
    it(`accepts ai ${peer.version} from a packed consumer`, () => {
      expect(runPackedConsumer(peer)).toEqual({
        version: peer.version,
        keys: ['description', 'execute', 'inputSchema'],
        result: 'packed',
      });
    });
  }
});
