import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    transactions: 'src/transactions/index.ts',
    replicas: 'src/replicas/index.ts',
    integrations: 'src/integrations/index.ts',
    'entity-modeling': 'src/entity-modeling/index.ts',
    'drivers-sqlite': 'src/drivers/sqlite.ts',
    'drivers-pg': 'src/drivers/pg.ts',
  },
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'node22',
  external: [/^@zmdb\//],
});
