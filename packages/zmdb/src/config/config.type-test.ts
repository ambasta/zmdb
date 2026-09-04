import { defineConfig, loadConfig, resolveConfig, type ResolvedConfig, type ZmdbConfig } from './index.js';

const config = defineConfig({
  schema: ['src/**/*.schema.ts'],
  dialect: 'postgres',
  project: './tsconfig.json',
  out: './migrations',
  naming: 'snake_case_plural',
  driver: async () => ({ execute: async () => [] }),
  namingStrategy: {
    table: name => name.toLowerCase(),
    column: (name, context) => `${context.table}_${name}`,
    index: (table, columns, unique) => `${table}_${columns.join('_')}_${unique ? 'uniq' : 'idx'}`,
  },
});

const accepted: ZmdbConfig = config;
void accepted;

const loaded: Promise<ResolvedConfig> = loadConfig({ cwd: '/tmp/project', path: './zmdb.config.ts' });
void loaded;

const resolved: Promise<ResolvedConfig> = resolveConfig(config, '/tmp/project/zmdb.config.ts');
void resolved;

defineConfig({
  schema: 'src/**/*.ts',
  // @ts-expect-error — the loader accepts only the three implemented SQL dialects.
  dialect: 'oracle',
});

defineConfig({
  schema: 'src/**/*.ts',
  dialect: 'sqlite',
  namingStrategy: {
    // @ts-expect-error — naming hooks return physical names, not numbers.
    table: () => 17,
  },
});
