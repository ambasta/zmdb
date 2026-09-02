import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    advanced: 'src/advanced/index.ts',
    serialization: 'src/serialization/index.ts',
    utilities: 'src/utilities/index.ts',
    plugin: 'src/plugin/index.ts',
    reflect: 'src/reflect/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  // `typescript` is build-time only and enormous; bundling the client into `reflect`
  // would ship a copy of it and break the `unstable/*` subpath resolution besides.
  external: [/^@zmdb\//, /^typescript(\/|$)/],
});
