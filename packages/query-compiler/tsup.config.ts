import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    dialect: 'src/dialect.ts',
    fts: 'src/fts/index.ts',
    joins: 'src/joins/index.ts',
    aggregations: 'src/aggregations/index.ts',
    migrations: 'src/migrations/index.ts',
    'migrations/runner': 'src/migrations/runner.ts',
    'set-ops': 'src/set-ops/index.ts',
    'schema-objects': 'src/schema-objects/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  external: [/^@zmdb\//],
});
