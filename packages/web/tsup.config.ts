import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    routing: 'src/routing/index.ts',
    context: 'src/context/index.ts',
    di: 'src/di/index.ts',
    state: 'src/state/index.ts',
    pipeline: 'src/pipeline/index.ts',
    data: 'src/data/index.ts',
    modules: 'src/modules/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  external: [/^@zmdb\//],
});
