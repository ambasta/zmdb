import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { codegen } from '@zmdb/aot-validator/codegen';
import { afterEach, describe, expect, it } from 'vitest';

import { inspectConfigContract } from '../../../../.github/scripts/verify-config-contract.mjs';
import { loadConfig as cliLoadConfig } from '../cli/config.js';
import { runCli } from '../cli/index.js';
import { scaffold } from '../cli/scaffold.js';
import { zmdbAot } from '../unplugin.js';
import { defineConfig as contractDefineConfig } from './contract.js';
import { defineConfig as canonicalDefineConfig, loadConfig as canonicalLoadConfig } from './index.js';

// Historical loader coverage remains here; the five load-bearing titles named
// by #621 stay exact because they are part of the public config contract.

const ROOT = process.env.ZMDB_REPOSITORY_ROOT ?? process.cwd();
const CONFIG_ENTRY = join(ROOT, 'packages', 'zmdb', 'src', 'config', 'index.ts');
const CODEGEN_ENTRY = join(ROOT, 'packages', 'aot-validator', 'src', 'cli', 'bin.ts');
const HOOK = join(ROOT, 'scripts', 'ts-specifier-hook.mjs');
const directories: string[] = [];

interface Project {
  readonly root: string;
  readonly config: string;
  readonly schema: string;
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function project(configSource: string): Project {
  const root = temporaryDirectory('zmdb-config-');
  const schema = join(root, 'src', 'schema.ts');
  const tsconfig = join(root, 'tsconfig.json');
  const config = join(root, 'zmdb.config.ts');
  write(join(root, 'package.json'), '{"private":true,"type":"module"}\n');
  write(schema, 'export interface Fixture { readonly id: number; }\n');
  write(
    tsconfig,
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          strict: true,
          target: 'ESNext',
          types: [],
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  write(config, configSource);
  return { root, config, schema };
}

async function configModule(): Promise<Record<string, unknown>> {
  const loaded: unknown = await import(pathToFileURL(CONFIG_ENTRY).href);
  return Object.fromEntries(Object.entries(Object(loaded)));
}

function exported(module: Readonly<Record<string, unknown>>, name: 'defineConfig' | 'loadConfig' | 'resolveConfig') {
  const value = module[name];
  if (typeof value !== 'function') throw new TypeError(`config module does not export ${name}()`);
  return value;
}

interface TestLoadConfigOptions {
  readonly cwd?: string;
  readonly path?: string;
  readonly optional?: boolean;
}

async function loadConfig(
  opts: TestLoadConfigOptions & { readonly optional: true },
): Promise<Record<string, unknown> | undefined>;
async function loadConfig(
  opts?: TestLoadConfigOptions & { readonly optional?: false },
): Promise<Record<string, unknown>>;
async function loadConfig(opts?: TestLoadConfigOptions): Promise<Record<string, unknown> | undefined> {
  const loaded = await exported(await configModule(), 'loadConfig')(opts);
  if (loaded === undefined) return undefined;
  return Object.fromEntries(Object.entries(Object(loaded)));
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('the zmdb config loader', () => {
  it('loads a config file and resolves its paths against the config directory', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  project: './tsconfig.json',
  out: './migrations',
};
`);
    const elsewhere = temporaryDirectory('zmdb-config-cwd-');
    const loaded = await loadConfig({ cwd: elsewhere, path: relative(elsewhere, fixture.config) });

    expect(loaded.configPath).toBe(fixture.config);
    expect(loaded.schemaFiles).toEqual([fixture.schema]);
    expect(loaded.project).toBe(join(fixture.root, 'tsconfig.json'));
    expect(loaded.out).toBe(join(fixture.root, 'migrations'));
    expect(loaded.outDir).toBe(join(fixture.root, 'migrations'));
  });

  it('resolves explicit HTTP contract and artifact paths through the configured project', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  project: './tsconfig.json',
  http: {
    contracts: './src/schema.ts#HTTP_CONTRACT',
    openApi: { out: './generated/openapi.json' },
    client: { out: './generated/http-client.generated.ts' },
  },
};
`);
    const loaded = await loadConfig({ cwd: fixture.root });

    expect(loaded.http).toEqual({
      contracts: [{ file: fixture.schema, exportName: 'HTTP_CONTRACT' }],
      openApiOut: join(fixture.root, 'generated', 'openapi.json'),
      clientOut: join(fixture.root, 'generated', 'http-client.generated.ts'),
    });
  });

  it('rejects invalid HTTP contract and artifact configuration', async () => {
    const empty = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  http: {
    contracts: [],
    openApi: { out: './openapi.json' },
    client: { out: './client.ts' },
  },
};
`);
    await expect(loadConfig({ cwd: empty.root })).rejects.toThrow(/at least one path#export/);

    const missingExport = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  http: {
    contracts: './src/schema.ts',
    openApi: { out: './openapi.json' },
    client: { out: './client.ts' },
  },
};
`);
    await expect(loadConfig({ cwd: missingExport.root })).rejects.toThrow(/must be <path>#<export>/);

    const duplicate = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  http: {
    contracts: ['./src/schema.ts#HTTP_CONTRACT', './src/schema.ts#HTTP_CONTRACT'],
    openApi: { out: './openapi.json' },
    client: { out: './client.ts' },
  },
};
`);
    await expect(loadConfig({ cwd: duplicate.root })).rejects.toThrow(/appears more than once/);

    const external = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  http: {
    contracts: './outside.ts#HTTP_CONTRACT',
    openApi: { out: './openapi.json' },
    client: { out: './client.ts' },
  },
};
`);
    const outside = join(external.root, 'outside.ts');
    write(outside, 'export const HTTP_CONTRACT = {};\n');
    await expect(loadConfig({ cwd: external.root })).rejects.toThrow(/not included by/);

    const wrongOutput = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  http: {
    contracts: './src/schema.ts#HTTP_CONTRACT',
    openApi: { out: './openapi.json' },
    client: { out: './client.js' },
  },
};
`);
    await expect(loadConfig({ cwd: wrongOutput.root })).rejects.toThrow(/http\.client\.out must end in \.ts/);
  });

  it('reports a config that fails to load, including the underlying error', async () => {
    const fixture = project(`throw new Error('fixture config exploded');\n`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(
      new RegExp(`${fixture.config.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*fixture config exploded`, 's'),
    );
  });

  it('rejects a config whose shape is wrong, naming the field', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 17,
};
`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(/dialect.*(?:string|postgres|mysql|sqlite)/i);
  });

  it('walks up to find a config file', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
};
`);
    const nested = join(fixture.root, 'src', 'nested', 'deeper');
    mkdirSync(nested, { recursive: true });
    const loaded = await loadConfig({ cwd: nested });
    expect(loaded.configPath).toBe(fixture.config);
  });

  it('honours --config', async () => {
    const discovered = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  out: './discovered',
};
`);
    const explicit = join(discovered.root, 'configs', 'explicit.mjs');
    write(
      explicit,
      `export default {
  schema: '../src/*.ts',
  dialect: 'sqlite',
  project: '../tsconfig.json',
  out: './chosen',
};\n`,
    );

    const loaded = await loadConfig({
      cwd: discovered.root,
      path: relative(discovered.root, explicit),
    });
    expect(loaded.configPath).toBe(explicit);
    expect(loaded.outDir).toBe(join(dirname(explicit), 'chosen'));
  });

  it('defineConfig is the identity function', async () => {
    const value = { schema: 'src/*.ts', dialect: 'sqlite' };
    const defineConfig = exported(await configModule(), 'defineConfig');
    expect(canonicalDefineConfig).toBe(contractDefineConfig);
    expect(defineConfig).toBe(contractDefineConfig);
    expect(defineConfig(value)).toBe(value);
  });

  it('resolves identical schema files, project, output and naming for CLI and compiler consumers', async () => {
    const fixture = join(ROOT, 'fixtures', 'consumer-plugin');
    const model = join(fixture, 'src', 'model.ts');
    const orders = join(fixture, 'src', 'orders.ts');
    const loaded = await cliLoadConfig({ cwd: fixture });

    expect(cliLoadConfig).toBe(canonicalLoadConfig);
    expect(loaded.configPath).toBe(join(fixture, 'zmdb.config.ts'));
    expect(loaded.project).toBe(join(fixture, 'tsconfig.json'));
    expect(loaded.schemaFiles).toEqual([model]);
    expect(loaded.out).toBe(join(fixture, 'migrations'));
    expect(loaded.outDir).toBe(join(fixture, 'migrations'));

    const plugin = await zmdbAot({ cwd: fixture });
    try {
      const transformed = plugin.transform(readFileSync(orders, 'utf8'), orders);
      expect(transformed).not.toBeNull();
      const code = transformed?.code ?? '';
      const tableName = loaded.resolvedNaming.table;
      const columnName = loaded.resolvedNaming.column;
      if (tableName === undefined || columnName === undefined) {
        throw new Error('resolved naming must provide table and column hooks');
      }
      const table = tableName('order');
      const column = columnName('shipTo', { table: 'order' });
      expect(code).toContain(`"table":"${table}"`);
      expect(code).toContain(`"physicalName":"${column}"`);
    } finally {
      plugin.buildEnd?.();
    }
  }, 60_000);

  it('keeps the generated config validator current', () => {
    const result = codegen({
      project: join(ROOT, 'packages', 'zmdb', 'tsconfig.codegen.json'),
      check: true,
    });
    expect(result.problems).toEqual([]);
    expect(result.written).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('uses a named config export when there is no default export', async () => {
    const fixture = project(`
export const config = {
  schema: 'src/*.ts',
  dialect: 'sqlite',
};
`);
    expect((await loadConfig({ cwd: fixture.root })).configPath).toBe(fixture.config);
  });

  it('awaits an asynchronous config export', async () => {
    const fixture = project(`
export default Promise.resolve({
  schema: 'src/*.ts',
  dialect: 'sqlite',
});
`);
    expect((await loadConfig({ cwd: fixture.root })).schemaFiles).toEqual([fixture.schema]);
  });

  it('rejects a module with no config export', async () => {
    const fixture = project(`
const config = {
  schema: 'src/*.ts',
  dialect: 'sqlite',
};
void config;
`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(/exactly one.*no exports/i);
  });

  it('rejects a module with both supported config exports', async () => {
    const fixture = project(`
export const config = {
  schema: 'src/*.ts',
  dialect: 'sqlite',
};
export default config;
`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(/exactly one.*config.*default/i);
  });

  it('prefers TypeScript over mjs and js in one directory', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  out: './typescript',
};
`);
    write(
      join(fixture.root, 'zmdb.config.mjs'),
      `export default { schema: 'src/*.ts', dialect: 'sqlite', out: './mjs' };\n`,
    );
    write(
      join(fixture.root, 'zmdb.config.js'),
      `export default { schema: 'src/*.ts', dialect: 'sqlite', out: './js' };\n`,
    );

    expect((await loadConfig({ cwd: fixture.root })).outDir).toBe(join(fixture.root, 'typescript'));
  });

  it('stops discovery at the nearest package boundary', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
};
`);
    const child = join(fixture.root, 'packages', 'child');
    const nested = join(child, 'src', 'nested');
    write(join(child, 'package.json'), '{"private":true,"type":"module"}\n');
    mkdirSync(nested, { recursive: true });

    await expect(loadConfig({ cwd: nested })).rejects.toThrow(
      new RegExp(`package boundary ${child.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  });

  it('returns undefined for optional discovery, but not for an explicit missing path', async () => {
    const root = temporaryDirectory('zmdb-config-optional-');
    write(join(root, 'package.json'), '{"private":true,"type":"module"}\n');

    await expect(loadConfig({ cwd: root, optional: true })).resolves.toBeUndefined();
    await expect(loadConfig({ cwd: root, path: './missing.ts', optional: true })).rejects.toThrow(/missing\.ts/i);
  });

  it('loads two project configs in one process without cache cross-talk', async () => {
    const first = project(`
export default { schema: 'src/*.ts', dialect: 'sqlite', out: './first' };
`);
    const second = project(`
export default { schema: 'src/*.ts', dialect: 'sqlite', out: './second' };
`);

    const [a, b] = await Promise.all([loadConfig({ cwd: first.root }), loadConfig({ cwd: second.root })]);
    expect(a.configPath).toBe(first.config);
    expect(a.outDir).toBe(join(first.root, 'first'));
    expect(b.configPath).toBe(second.config);
    expect(b.outDir).toBe(join(second.root, 'second'));
  });

  it('reports one field-level validation error shape through every command and adapter', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 17,
};
`);

    let expected = '';
    try {
      await canonicalLoadConfig({ cwd: fixture.root });
    } catch (error) {
      expected = error instanceof Error ? error.message : String(error);
    }
    expect(expected).toMatch(/Invalid config .*dialect.*(?:string|postgres|mysql|sqlite)/i);

    await expect(zmdbAot({ cwd: fixture.root })).rejects.toThrow(expected);

    symlinkSync(join(ROOT, 'node_modules'), join(fixture.root, 'node_modules'), 'dir');
    const codegenResult = spawnSync(
      process.execPath,
      [`--import=${HOOK}`, CODEGEN_ENTRY, '--config', fixture.config, '--check'],
      {
        cwd: fixture.root,
        encoding: 'utf8',
      },
    );
    expect(codegenResult.status, codegenResult.stderr).toBe(2);
    expect(codegenResult.stdout).toBe('');
    expect(codegenResult.stderr).toContain(expected);

    const commands = [
      { label: 'check', argv: ['check'] },
      { label: 'client generate', argv: ['client', 'generate'] },
      { label: 'embed', argv: ['embed'] },
      { label: 'export', argv: ['export'] },
      { label: 'generate', argv: ['generate'] },
      { label: 'migrate', argv: ['migrate'] },
      { label: 'pull', argv: ['pull'] },
      { label: 'push', argv: ['push'] },
      { label: 'rollback', argv: ['rollback'] },
      { label: 'status', argv: ['status'] },
      { label: 'studio', argv: ['studio'] },
      { label: 'upgrade', argv: ['upgrade'] },
    ] as const;
    for (const command of commands) {
      let stdout = '';
      let stderr = '';
      const exitCode = await runCli([...command.argv, '--config', fixture.config], {
        cwd: fixture.root,
        stdinIsTTY: false,
        stdout: text => {
          stdout += text;
        },
        stderr: text => {
          stderr += text;
        },
      });
      expect(exitCode, command.label).toBe(2);
      expect(stdout, command.label).toBe('');
      expect(stderr, command.label).toContain(expected);
    }
  });

  it('keeps runtime application bootstrap independent of ambient project config loading', () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
};
`);
    const marker = join(fixture.root, 'config-loaded.txt');
    write(
      fixture.config,
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'loaded');
throw new Error('runtime application imported project config');
`,
    );
    const webEntry = pathToFileURL(join(ROOT, 'packages', 'zmdb', 'src', 'web.ts')).href;
    const contractEntry = pathToFileURL(join(ROOT, 'packages', 'zmdb', 'src', 'config', 'contract.ts')).href;
    const source = `const [{ createRouter }, { defineConfig }] = await Promise.all([
  import(${JSON.stringify(webEntry)}),
  import(${JSON.stringify(contractEntry)}),
]);
createRouter();
defineConfig({ schema: 'src/*.ts', dialect: 'sqlite' });
process.stdout.write('bootstrapped');
`;
    const result = spawnSync(process.execPath, [`--import=${HOOK}`, '--input-type=module', '--eval', source], {
      cwd: fixture.root,
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('bootstrapped');
    expect(existsSync(marker)).toBe(false);
  });

  it('rejects a second public project-config declaration outside the canonical owner', () => {
    expect(inspectConfigContract(ROOT)).toEqual({
      owner: 'packages/zmdb/src/config/index.ts',
      authoringOwner: 'packages/zmdb/src/config/contract.ts',
      facade: 'packages/zmdb/src/config/index.ts',
      problems: [],
    });

    const planted = join(ROOT, 'packages', 'schema-core', 'src', 'index.ts');
    const source = readFileSync(planted, 'utf8');
    const report = inspectConfigContract(
      ROOT,
      new Map([
        [
          planted,
          `${source}
interface LoadConfigOptions { readonly planted: true }
export interface ResolvedConfig { readonly planted: true }
export function defineConfig(value: unknown): unknown { return value; }
export async function loadConfig(): Promise<never> { throw new Error('planted'); }
`,
        ],
      ]),
    );
    expect(report.problems).toEqual([
      'packages/schema-core/src/index.ts declares exported ResolvedConfig; canonical owner is packages/zmdb/src/config/index.ts',
      'packages/schema-core/src/index.ts declares exported defineConfig; canonical owner is packages/zmdb/src/config/contract.ts',
      'packages/schema-core/src/index.ts declares exported loadConfig; canonical owner is packages/zmdb/src/config/index.ts',
      'packages/schema-core/src/index.ts declares private LoadConfigOptions; canonical owner is packages/zmdb/src/config/index.ts',
    ]);

    expect(
      inspectConfigContract(
        ROOT,
        new Map([
          [
            planted,
            `${source}
export { loadConfig } from '../../zmdb/src/config/index.js';
`,
          ],
        ]),
      ).problems,
    ).toContain(
      'packages/schema-core/src/index.ts publishes loadConfig through @zmdb/schema-core instead of zmdb/config',
    );

    const authoringOwner = join(ROOT, 'packages', 'zmdb', 'src', 'config', 'contract.ts');
    const authoringSource = readFileSync(authoringOwner, 'utf8');
    expect(
      inspectConfigContract(
        ROOT,
        new Map([[authoringOwner, `import { readFileSync } from 'node:fs';\n${authoringSource}`]]),
      ).problems,
    ).toContain(
      'packages/zmdb/src/config/contract.ts imports node:fs at runtime; the authoring contract must be dependency-free',
    );
  });

  it('scaffolds only the canonical project config and build-adapter entry points', async () => {
    const cwd = temporaryDirectory('zmdb-config-scaffold-');
    const result = await scaffold({
      cwd,
      kind: 'project',
      name: 'orders',
      dryRun: true,
    });
    const files = new Map(result.files.map(file => [file.path, file.source]));
    const config = files.get('orders/zmdb.config.ts');
    const build = files.get('orders/scripts/build.mjs');
    const runtime = files.get('orders/src/main.ts');

    expect(config).toContain("from 'zmdb/config'");
    expect(build).toContain("from 'zmdb/unplugin'");
    expect(build).toContain('zmdbAot({ cwd: root })');
    expect(runtime).not.toContain('zmdb/config');
    expect(runtime).not.toContain('loadConfig');
  });

  it('caches one resolved config by its absolute path', async () => {
    const fixture = project(`
export default { schema: 'src/*.ts', dialect: 'sqlite' };
`);
    const marker = join(fixture.root, 'loads.txt');
    write(
      fixture.config,
      `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const marker = ${JSON.stringify(marker)};
const count = existsSync(marker) ? Number(readFileSync(marker, 'utf8')) : 0;
writeFileSync(marker, String(count + 1));
export default { schema: 'src/*.ts', dialect: 'sqlite' };
`,
    );

    const first = await loadConfig({ cwd: fixture.root });
    const second = await loadConfig({ cwd: fixture.root, path: './zmdb.config.ts' });
    expect(second).toStrictEqual(first);
    expect(readFileSync(marker, 'utf8')).toBe('1');
  });

  it('expands, deduplicates and sorts multiple schema globs', async () => {
    const fixture = project(`
export default {
  schema: ['src/*.ts', 'src/schema.ts'],
  dialect: 'sqlite',
};
`);
    const other = join(fixture.root, 'src', 'another.ts');
    write(other, 'export interface Another { readonly id: number; }\n');

    expect((await loadConfig({ cwd: fixture.root })).schemaFiles).toEqual([other, fixture.schema].toSorted());
  });

  it('rejects a schema glob that matches no files', async () => {
    const fixture = project(`
export default {
  schema: 'missing/**/*.ts',
  dialect: 'sqlite',
};
`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(/schema glob.*matched no files/i);
  });

  it('rejects a matched schema file outside the configured TypeScript project', async () => {
    const fixture = project(`
export default {
  schema: 'outside.ts',
  dialect: 'sqlite',
};
`);
    const outside = join(fixture.root, 'outside.ts');
    write(outside, 'export interface Outside { readonly id: number; }\n');

    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(
      new RegExp(`${outside.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*not included`, 's'),
    );
  });

  it('reports the config and project paths when the TypeScript project cannot load', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  project: './missing-tsconfig.json',
};
`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(
      new RegExp(
        `${join(fixture.root, 'missing-tsconfig.json').replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*${fixture.config.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        's',
      ),
    );
  });

  it('preserves a callable driver and naming strategy', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  driver: () => ({ execute: async () => [] }),
  namingStrategy: {
    table: name => name.toUpperCase(),
    column: name => name.toLowerCase(),
    index: (table, columns) => [table, ...columns].join('_'),
  },
};
`);
    const loaded = await loadConfig({ cwd: fixture.root });
    expect(typeof loaded.driver).toBe('function');
    expect(typeof Object(loaded.namingStrategy).table).toBe('function');
    expect(loaded.resolvedNaming).toBe(loaded.namingStrategy);
  });

  it('resolves a built-in naming strategy while loading the config', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  naming: 'snake_case_plural',
};
`);
    const loaded = await loadConfig({ cwd: fixture.root });
    const naming = Object(loaded.resolvedNaming);
    expect(naming.table('userAccount')).toBe('user_accounts');
    expect(naming.column('createdAt', { table: 'userAccount' })).toBe('created_at');
  });

  it('rejects a non-callable driver', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  driver: 17,
};
`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(/driver.*function/i);
  });

  it('rejects a non-callable naming strategy member', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  namingStrategy: { table: 'snake' },
};
`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(/namingStrategy.*functions/i);
  });

  it('validates nested plain-data fields with their full path', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  introspect: { include: [17] },
};
`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(/introspect\.include.*string/i);
  });

  it('refuses migrations.schema outside PostgreSQL', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 'sqlite',
  migrations: { schema: 'app' },
};
`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(/migrations\.schema.*PostgreSQL.*sqlite/i);
  });

  it('resolveConfig applies the same validation and path rules to an imported object', async () => {
    const fixture = project(`
export default { schema: 'src/*.ts', dialect: 'sqlite' };
`);
    const resolveConfig = exported(await configModule(), 'resolveConfig');
    const loaded = await resolveConfig(
      { schema: 'src/*.ts', dialect: 'sqlite', out: './resolved-directly' },
      fixture.config,
    );
    const resolved = Object.fromEntries(Object.entries(Object(loaded)));
    expect(resolved.outDir).toBe(join(fixture.root, 'resolved-directly'));
    expect(resolved.schemaFiles).toEqual([fixture.schema]);
  });

  it('adds the Node .js-to-.ts resolution hint without hiding the import error', async () => {
    const fixture = project(`
import './missing.js';
export default { schema: 'src/*.ts', dialect: 'sqlite' };
`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(/missing\.js.*does not remap.*\.js.*\.ts/s);
  });
});
