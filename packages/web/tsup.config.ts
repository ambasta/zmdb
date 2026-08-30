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
    middleware: 'src/middleware/index.ts',
    app: 'src/app/index.ts',
    'dto-pipes': 'src/dto-pipes/index.ts',
    openapi: 'src/openapi/index.ts',
    gateways: 'src/gateways/index.ts',
    testing: 'src/testing/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  external: [/^@zmdb\//],
});
