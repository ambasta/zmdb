import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    transactions: 'src/transactions/index.ts',
    replicas: 'src/replicas/index.ts',
    integrations: 'src/integrations/index.ts',
    'entity-modeling': 'src/entity-modeling/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  external: [/^@zmdb\//],
});
