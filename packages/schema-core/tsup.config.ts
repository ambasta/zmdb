import { defineConfig } from 'tsup';

// Bundles each entry point to ESM .js + .d.ts. Internal `./x.ts` imports are
// resolved/bundled; cross-package @zmdb/* imports stay external (resolved to the
// published packages at install time). See PUBLISHING.md.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    dto: 'src/dto/index.ts',
    relations: 'src/relations/index.ts',
    'custom-types': 'src/custom-types/index.ts',
    seeding: 'src/seeding/index.ts',
    llm: 'src/llm/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  external: [/^@zmdb\//],
});
