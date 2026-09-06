import { transform as esbuildTransform } from 'esbuild';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

if (typeof (Uint8Array.prototype as any).toHex !== 'function') {
  (Uint8Array.prototype as any).toHex = function () {
    return Array.from(this as Uint8Array, b => b.toString(16).padStart(2, '0')).join('');
  };
}
if (typeof (Uint8Array.prototype as any).toBase64 !== 'function') {
  (Uint8Array.prototype as any).toBase64 = function (options?: { alphabet?: string; omitPadding?: boolean }) {
    let buf = Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString('base64');
    if (options?.alphabet === 'base64url') {
      buf = buf.replace(/\+/g, '-').replace(/\//g, '_');
    }
    if (options?.omitPadding) {
      buf = buf.replace(/=/g, '');
    }
    return buf;
  };
}
if (typeof (Uint8Array as any).fromBase64 !== 'function') {
  (Uint8Array as any).fromBase64 = function (string: string, options?: { alphabet?: string }) {
    let base64 = string;
    if (options?.alphabet === 'base64url') {
      base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
    }
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const buf = Buffer.from(base64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  };
}

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

// These suites install tarballs, build consumer projects or use external services.
// Keep ordinary in-process and local HTTP/SQLite behavior in the default suite.
const integrationTests = [
  'packages/*/src/**/__integration__/**/*.spec.ts',
  'packages/*/src/**/*{.integration,.e2e,.live}.spec.ts',
  'packages/jobs-postgres/src/index.spec.ts',
  'packages/jobs/src/{selection-contract,provider-wire}.spec.ts',
  'packages/client/src/package-boundary.spec.ts',
  'packages/web/src/separation/{server-packages,server-integrations}.spec.ts',
  'packages/zmdb/src/{consumer-*-publication,runtime-foundation,server-documentation,tooling-package-boundaries}.spec.ts',
  'packages/zmdb/src/client-integrations/adapter-contract.spec.ts',
  '.github/scripts/{verify-database-boundaries,verify-tooling-cutover}.spec.ts',
];

export default defineConfig({
  plugins: [stage3Decorators()],
  test: {
    setupFiles: ['./scripts/vitest-setup.ts'],
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
