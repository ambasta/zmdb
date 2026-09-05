import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ReflectSession } from '@zmdb/aot-validator/reflect';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, type ResolvedConfig } from '../../config/index.js';
import { runCli } from '../index.js';
import { generateHttpArtifacts, watchHttpArtifacts, type HttpArtifactGeneration } from './client.js';

const ROOT = process.env.ZMDB_REPOSITORY_ROOT ?? process.cwd();
const FIXTURE = fileURLToPath(new URL('../__fixtures__/http-client', import.meta.url));
const directories: string[] = [];

async function project(contracts?: readonly string[]): Promise<ResolvedConfig> {
  const root = mkdtempSync(join(tmpdir(), 'zmdb-http-client-'));
  directories.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');
  if (contracts !== undefined) {
    writeFileSync(
      join(root, 'zmdb.config.ts'),
      `export default {
  schema: './src/schema.ts',
  dialect: 'sqlite',
  project: './tsconfig.json',
  http: {
    contracts: ${JSON.stringify(contracts)},
    openApi: { out: './generated/openapi.json' },
    client: { out: './generated/http-client.generated.ts' },
  },
};\n`,
    );
  }
  return loadConfig({ cwd: root });
}

function operationIds(document: unknown): readonly string[] {
  if (typeof document !== 'object' || document === null) throw new TypeError('OpenAPI document must be an object');
  const paths: unknown = Reflect.get(document, 'paths');
  if (typeof paths !== 'object' || paths === null) throw new TypeError('OpenAPI paths must be an object');
  return Object.values(paths)
    .flatMap(item => (typeof item === 'object' && item !== null ? Object.values(item) : []))
    .map(operation => {
      if (typeof operation !== 'object' || operation === null)
        throw new TypeError('OpenAPI operation must be an object');
      const operationId: unknown = Reflect.get(operation, 'operationId');
      if (typeof operationId !== 'string') throw new TypeError('OpenAPI operationId must be a string');
      return operationId;
    })
    .toSorted();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  expect(predicate()).toBe(true);
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__zmdbHttpContractFixtureLoads');
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('zmdb client generate', { timeout: 30_000 }, () => {
  it('generate writes the expected client', async () => {
    const config = await project();
    const generation = await generateHttpArtifacts(config);
    const http = config.http;
    if (http === undefined) throw new Error('fixture has no HTTP generation config');

    expect(generation.result).toMatchObject({
      out: { openApi: http.openApiOut, client: http.clientOut },
      operations: ['get_accounts_accountId'],
      changed: true,
      contractFormat: 1,
      generatorVersion: '1.0.0',
    });
    expect(readFileSync(http.clientOut, 'utf8')).toContain(
      'export function createApiClient(options: ClientOptions): ApiClient',
    );
    expect(readFileSync(http.clientOut, 'utf8')).toContain('get_accounts_accountId');
    expect(readFileSync(http.openApiOut, 'utf8').endsWith('\n')).toBe(true);

    const before = {
      client: statSync(http.clientOut, { bigint: true }).mtimeNs,
      openApi: statSync(http.openApiOut, { bigint: true }).mtimeNs,
    };
    const current = await generateHttpArtifacts(config);
    expect(current.result.changed).toBe(false);
    expect(statSync(http.clientOut, { bigint: true }).mtimeNs).toBe(before.client);
    expect(statSync(http.openApiOut, { bigint: true }).mtimeNs).toBe(before.openApi);
  });

  it('check fails after a contract change', async () => {
    const config = await project();
    await generateHttpArtifacts(config);
    const http = config.http;
    if (http === undefined) throw new Error('fixture has no HTTP generation config');
    const before = {
      client: readFileSync(http.clientOut, 'utf8'),
      openApi: readFileSync(http.openApiOut, 'utf8'),
    };
    const models = join(dirname(config.configPath), 'src', 'models.ts');
    writeFileSync(
      models,
      readFileSync(models, 'utf8').replace('readonly displayName: string;', 'readonly displayName: number;'),
    );

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runCli(['client', 'generate', '--check'], {
      cwd: dirname(config.configPath),
      stdout: text => stdout.push(text),
      stderr: text => stderr.push(text),
    });

    expect(exitCode).toBe(1);
    expect(stdout.join('')).toContain(`stale ${http.clientOut}`);
    expect(stderr).toEqual([]);
    expect(readFileSync(http.clientOut, 'utf8')).toBe(before.client);
    expect(readFileSync(http.openApiOut, 'utf8')).toBe(before.openApi);
  });

  it('one contract load emits OpenAPI and client', async () => {
    const config = await project(['./src/contract.ts#HTTP_CONTRACT', './src/contract.ts#HEALTH_CONTRACT']);
    Reflect.deleteProperty(globalThis, '__zmdbHttpContractFixtureLoads');
    const generation = await generateHttpArtifacts(config);

    expect(Reflect.get(globalThis, '__zmdbHttpContractFixtureLoads')).toBe(1);
    expect(generation.result.operations).toEqual(['get_accounts_accountId', 'get_accounts_health']);
    expect(generation.stale).toEqual([config.http?.openApiOut, config.http?.clientOut]);
    expect(existsSync(config.http?.openApiOut ?? '')).toBe(true);
    expect(existsSync(config.http?.clientOut ?? '')).toBe(true);
  });

  it('operation ids match OpenAPI exactly', async () => {
    const config = await project(['./src/contract.ts#HTTP_CONTRACT', './src/contract.ts#HEALTH_CONTRACT']);
    const generation = await generateHttpArtifacts(config);
    const openApiPath = config.http?.openApiOut;
    if (openApiPath === undefined) throw new Error('fixture has no OpenAPI output');

    expect(operationIds(JSON.parse(readFileSync(openApiPath, 'utf8')))).toEqual(generation.result.operations);
  });

  it('generated output contains no workspace path', async () => {
    const config = await project();
    await generateHttpArtifacts(config);
    const http = config.http;
    if (http === undefined) throw new Error('fixture has no HTTP generation config');
    const output = `${readFileSync(http.openApiOut, 'utf8')}\n${readFileSync(http.clientOut, 'utf8')}`;

    expect(output).not.toContain(ROOT);
    expect(output).not.toContain(dirname(config.configPath));
  });

  it('watch invalidates only the actual contract dependency set', async () => {
    const config = await project();
    const stop = Promise.withResolvers<void>();
    const generations: HttpArtifactGeneration[] = [];
    using session = ReflectSession.open({ project: config.project });
    const watching = watchHttpArtifacts(config, {
      session,
      until: stop.promise,
      debounceMs: 10,
      log: generation => generations.push(generation),
    });
    await waitFor(() => generations.length === 1);

    const root = dirname(config.configPath);
    writeFileSync(join(root, 'src', 'unrelated.ts'), "export const unrelated = 'changed';\n");
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(generations).toHaveLength(1);

    const models = join(root, 'src', 'models.ts');
    writeFileSync(
      models,
      readFileSync(models, 'utf8').replace('readonly displayName: string;', 'readonly displayName: number;'),
    );
    await waitFor(() => generations.length === 2);
    stop.resolve();
    await watching;

    expect(session.updates).toEqual(['open', 'refresh']);
    expect(generations[1]?.dependencies).toContain(models);
    expect(generations[1]?.result.changed).toBe(true);
  });
});
