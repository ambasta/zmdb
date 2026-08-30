import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    advanced: 'src/advanced/index.ts',
    serialization: 'src/serialization/index.ts',
    utilities: 'src/utilities/index.ts',
    plugin: 'src/plugin/index.ts',
  },
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'node22',
  external: [/^@zmdb\//],
});
