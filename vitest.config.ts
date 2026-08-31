import path from 'node:path';

import { transform as esbuildTransform } from 'esbuild';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// --- Stage-3 decorator transform for vitest -------------------------------
// The bumped toolchain (Vitest 4 / Vite 8 / Rolldown + oxc 0.147) does NOT lower
// TC39 **standard** (Stage 3) decorators — oxc passes the syntax through, and no
// JS engine (Node 26 / V8) yet executes standard decorators, so importing a
// decorated module throws "SyntaxError: Invalid or unexpected token". Native TS7
// (tsgo) exposes no JS transform API (`transpileModule` is undefined), so we
// realize the Stage-3 proposal at test time with esbuild (which lowers standard
// decorators to helper calls).
//
// This is TEST-EXECUTION ONLY, and it is a transform the published packages must
// never need: their own source is decorator-free (`verify:exports` imports every
// subpath under plain `node`, which a decorator would break), and `tsc` emits
// `dist` at `target: ESNext`, so it would not lower one either. What decorators
// there are belong to specs and to application code. The plugin only rewrites
// `.ts` files that actually contain one, so everything else keeps oxc's fast path.
const DECORATED = /(^|\n)\s*@[A-Za-z_$]/;

function stage3Decorators(): Plugin {
  return {
    name: 'zmdb:stage3-decorators',
    enforce: 'pre',
    async transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (!file.endsWith('.ts') || file.includes('/node_modules/')) return null;
      if (!DECORATED.test(code)) return null;
      // esbuild realizes standard decorators (experimentalDecorators off) into
      // helper calls; target es2022 keeps output otherwise-modern.
      const result = await esbuildTransform(code, {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
        sourcefile: file,
        sourcemap: true,
        tsconfigRaw: { compilerOptions: { experimentalDecorators: false, useDefineForClassFields: true } },
      });
      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig({
  plugins: [stage3Decorators()],
  resolve: {
    alias: {
      '@zmdb/schema-core/dto': path.resolve(__dirname, 'packages/schema-core/src/dto/index.ts'),
      '@zmdb/schema-core/relations': path.resolve(__dirname, 'packages/schema-core/src/relations/index.ts'),
      '@zmdb/schema-core/custom-types': path.resolve(__dirname, 'packages/schema-core/src/custom-types/index.ts'),
      '@zmdb/schema-core/seeding': path.resolve(__dirname, 'packages/schema-core/src/seeding/index.ts'),
      '@zmdb/schema-core/llm': path.resolve(__dirname, 'packages/schema-core/src/llm/index.ts'),
      '@zmdb/schema-core': path.resolve(__dirname, 'packages/schema-core/src/index.ts'),

      '@zmdb/aot-validator/advanced': path.resolve(__dirname, 'packages/aot-validator/src/advanced/index.ts'),
      '@zmdb/aot-validator/serialization': path.resolve(__dirname, 'packages/aot-validator/src/serialization/index.ts'),
      '@zmdb/aot-validator/utilities': path.resolve(__dirname, 'packages/aot-validator/src/utilities/index.ts'),
      '@zmdb/aot-validator/plugin': path.resolve(__dirname, 'packages/aot-validator/src/plugin/index.ts'),
      '@zmdb/aot-validator/unplugin': path.resolve(__dirname, 'packages/aot-validator/src/plugin/index.ts'),
      '@zmdb/aot-validator': path.resolve(__dirname, 'packages/aot-validator/src/index.ts'),

      '@zmdb/query-compiler/fts': path.resolve(__dirname, 'packages/query-compiler/src/fts/index.ts'),
      '@zmdb/query-compiler/joins': path.resolve(__dirname, 'packages/query-compiler/src/joins/index.ts'),
      '@zmdb/query-compiler/aggregations': path.resolve(__dirname, 'packages/query-compiler/src/aggregations/index.ts'),
      '@zmdb/query-compiler/migrations': path.resolve(__dirname, 'packages/query-compiler/src/migrations/index.ts'),
      '@zmdb/query-compiler/set-ops': path.resolve(__dirname, 'packages/query-compiler/src/set-ops/index.ts'),
      '@zmdb/query-compiler/schema-objects': path.resolve(
        __dirname,
        'packages/query-compiler/src/schema-objects/index.ts',
      ),
      '@zmdb/query-compiler': path.resolve(__dirname, 'packages/query-compiler/src/index.ts'),

      '@zmdb/repository/transactions': path.resolve(__dirname, 'packages/repository/src/transactions/index.ts'),
      '@zmdb/repository/replicas': path.resolve(__dirname, 'packages/repository/src/replicas/index.ts'),
      '@zmdb/repository/integrations': path.resolve(__dirname, 'packages/repository/src/integrations/index.ts'),
      '@zmdb/repository/entity-modeling': path.resolve(__dirname, 'packages/repository/src/entity-modeling/index.ts'),
      '@zmdb/repository/drivers/sqlite': path.resolve(__dirname, 'packages/repository/src/drivers/sqlite.ts'),
      '@zmdb/repository/drivers/pg': path.resolve(__dirname, 'packages/repository/src/drivers/pg.ts'),
      '@zmdb/repository': path.resolve(__dirname, 'packages/repository/src/index.ts'),

      'zmdb/dto': path.resolve(__dirname, 'packages/zmdb/src/dto.ts'),
      'zmdb/relations': path.resolve(__dirname, 'packages/zmdb/src/relations.ts'),
      'zmdb/drivers/sqlite': path.resolve(__dirname, 'packages/zmdb/src/drivers-sqlite.ts'),
      'zmdb/drivers/pg': path.resolve(__dirname, 'packages/zmdb/src/drivers-pg.ts'),
      zmdb: path.resolve(__dirname, 'packages/zmdb/src/index.ts'),
    },
  },
  test: {
    // All package tests live alongside sources under packages/*/src, benchmarks, docs-site, .github, and tests.
    include: [
      'packages/*/src/**/*.spec.ts',
      'benchmarks/src/**/*.spec.ts',
      'docs-site/**/*.spec.ts',
      '.github/**/*.spec.ts',
      'tests/**/*.spec.ts',
    ],
    // Type-level tests are run with `tsc`, not vitest.
    passWithNoTests: false,
  },
});
