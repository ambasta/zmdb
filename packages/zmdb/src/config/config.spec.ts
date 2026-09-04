import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

// Tests freeze for #491. The public signature is not declared here: it belongs in
// `config/SPEC.md`, whose missing `loadConfig`/`ResolvedConfig` declarations are corrected by
// this draft. A computed import keeps this file collectable until #492 creates the real module.
//
// Current actual at 4c8fbfc552af38cafaa2a6d19d073bb898bac0ee for every
// `it.fails` below:
//   ERR_MODULE_NOT_FOUND: packages/zmdb/src/config/index.ts does not exist.
// Each test then reaches a different frozen assertion once #492 supplies that module.

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

function exported(module: Readonly<Record<string, unknown>>, name: 'defineConfig' | 'loadConfig') {
  const value = module[name];
  if (typeof value !== 'function') throw new TypeError(`config module does not export ${name}()`);
  return value;
}

async function loadConfig(opts?: { readonly cwd?: string; readonly path?: string }): Promise<Record<string, unknown>> {
  const loaded = await exported(await configModule(), 'loadConfig')(opts);
  return Object.fromEntries(Object.entries(Object(loaded)));
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('the zmdb config loader', () => {
  // Current actual: ERR_MODULE_NOT_FOUND for the absent config implementation.
  it.fails('loads a config file and resolves its paths against the config directory', async () => {
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
    expect(loaded.outDir).toBe(join(fixture.root, 'migrations'));
  });

  // Current actual: ERR_MODULE_NOT_FOUND for the absent config implementation.
  it.fails('reports a config that fails to load, including the underlying error', async () => {
    const fixture = project(`throw new Error('fixture config exploded');\n`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(
      new RegExp(`${fixture.config.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*fixture config exploded`, 's'),
    );
  });

  // Current actual: ERR_MODULE_NOT_FOUND for the absent config implementation.
  it.fails('rejects a config whose shape is wrong, naming the field', async () => {
    const fixture = project(`
export default {
  schema: 'src/*.ts',
  dialect: 17,
};
`);
    await expect(loadConfig({ cwd: fixture.root })).rejects.toThrow(/dialect.*(?:string|postgres|mysql|sqlite)/i);
  });

  // Current actual: ERR_MODULE_NOT_FOUND for the absent config implementation.
  it.fails('walks up to find a config file', async () => {
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

  // Current actual: ERR_MODULE_NOT_FOUND for the absent config implementation.
  it.fails('honours --config', async () => {
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
});
