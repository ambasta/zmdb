import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { codegen } from '@zmdb/aot-validator/codegen';
import { afterEach, describe, expect, it } from 'vitest';

// The five load-bearing titles frozen in #491 stay exact. #492 promotes them
// from expected failures and adds the boundary cases the loader now owns.

const ROOT = process.env.ZMDB_REPOSITORY_ROOT ?? process.cwd();
const CONFIG_ENTRY = join(ROOT, 'packages', 'zmdb', 'src', 'config', 'index.ts');
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
    expect(defineConfig(value)).toBe(value);
  });

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

  it('loads two different configs in one process without cross-talk', async () => {
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
