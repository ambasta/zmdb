import { transform as esbuildTransform } from 'esbuild';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Lower standard decorators used by application fixtures before Node executes them.
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

// These suites install tarballs, build consumer projects or use external services.
// Keep ordinary in-process and local HTTP/SQLite behavior in the default suite.
const integrationTests = [
  'packages/*/src/**/__integration__/**/*.spec.ts',
  'packages/*/src/**/*{.integration,.e2e,.live}.spec.ts',
  'packages/*/src/**/{integration,live,packed,packed-*}.spec.ts',
  'packages/jobs-postgres/src/index.spec.ts',
];

export default defineConfig({
  plugins: [stage3Decorators()],
  test: {
    setupFiles: ['./scripts/ts-specifier-hook.mjs'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'packages/*/src/**/*.spec.ts',
            'benchmarks/src/**/*.spec.ts',
            'docs-site/**/*.spec.ts',
            '.github/**/*.spec.ts',
          ],
          exclude: integrationTests,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: integrationTests,
          // Packed suites share emitted workspace output.
          fileParallelism: false,
        },
      },
    ],
    passWithNoTests: false,
  },
});
