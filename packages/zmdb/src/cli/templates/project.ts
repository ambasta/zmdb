import type { TemplateFactory } from './types.js';

export const projectTemplate: TemplateFactory = ({ name, packageVersion }) => ({
  files: [
    {
      path: 'package.json',
      source: `${JSON.stringify({
        name: name.fileStem,
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: {
          build: 'node scripts/build.mjs app',
          check:
            'oxfmt --check . && tsc --noEmit && oxlint . && node scripts/build.mjs test && vitest run --config vitest.config.ts',
          fmt: 'oxfmt .',
          'fmt:check': 'oxfmt --check .',
          lint: 'oxlint .',
          start: 'node dist/main.mjs',
          test: 'node scripts/build.mjs test && vitest run --config vitest.config.ts',
          typecheck: 'tsc --noEmit',
        },
        dependencies: {
          zmdb: `^${packageVersion}`,
        },
        devDependencies: {
          '@types/node': '^26.4.1',
          esbuild: '^0.28.2',
          oxfmt: '^0.66.0',
          oxlint: '^1.81.0',
          typescript: '^7.0.2',
          vitest: '^5.0.0',
        },
        engines: {
          node: '>=26',
        },
      })}\n`,
    },
    {
      path: 'tsconfig.json',
      source: `${JSON.stringify({
        compilerOptions: {
          allowImportingTsExtensions: false,
          exactOptionalPropertyTypes: true,
          isolatedModules: true,
          lib: ['ESNext', 'DOM', 'DOM.Iterable'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          noImplicitOverride: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          strict: true,
          target: 'ESNext',
          types: ['node'],
          verbatimModuleSyntax: true,
        },
        include: ['src/**/*.ts', 'vitest.config.ts', 'zmdb.config.ts'],
      })}\n`,
    },
    {
      path: 'scripts/build.mjs',
      source: `import { glob, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { zmdbAot } from 'zmdb/compiler';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function aotPlugin() {
  const plugin = await zmdbAot({ cwd: root });
  return {
    name: plugin.name,
    setup(esbuild) {
      esbuild.onLoad({ filter: /\\.[cm]?tsx?$/ }, async ({ path }) => {
        const code = await readFile(path, 'utf8');
        const result = plugin.transform(code, path);
        return { contents: result?.code ?? code, loader: path.endsWith('x') ? 'tsx' : 'ts' };
      });
      esbuild.onEnd(() => plugin.buildEnd?.());
    },
  };
}

const common = {
  bundle: true,
  format: 'esm',
  packages: 'external',
  platform: 'node',
  target: 'node26',
};

const mode = process.argv[2];
if (mode === 'app') {
  await build({
    ...common,
    entryPoints: [join(root, 'src', 'main.ts')],
    outfile: join(root, 'dist', 'main.mjs'),
    plugins: [await aotPlugin()],
  });
} else if (mode === 'test') {
  const entryPoints = [];
  for await (const path of glob('src/**/*.spec.ts', { cwd: root })) {
    entryPoints.push(join(root, path));
  }
  const outdir = join(root, 'generated-tests');
  await rm(outdir, { recursive: true, force: true });
  await build({
    ...common,
    entryPoints,
    outbase: join(root, 'src'),
    outdir,
    outExtension: { '.js': '.mjs' },
    plugins: [await aotPlugin()],
  });
} else {
  throw new Error('usage: node scripts/build.mjs <app|test>');
}
`,
    },
    {
      path: 'vitest.config.ts',
      source: `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['generated-tests/**/*.spec.mjs'],
  },
});
`,
    },
    {
      path: 'zmdb.config.ts',
      source: `import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'zmdb';
import { sqliteDriver } from 'zmdb/drivers/sqlite';

const databasePath = fileURLToPath(new URL('./database.sqlite', import.meta.url));

export default defineConfig({
  schema: ['src/**/*.ts'],
  dialect: 'sqlite',
  project: './tsconfig.json',
  out: './migrations',
  driver: () => sqliteDriver(new DatabaseSync(databasePath)),
});
`,
    },
    {
      path: 'src/app.module.ts',
      source: `import { Module } from 'zmdb';

import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController] })
export class AppModule {}
`,
    },
    {
      path: 'src/main.ts',
      source: `import { createServer } from 'node:http';

import { compileModule, createRouter, toNodeHandler } from 'zmdb/web';

import { AppModule } from './app.module.js';

const port = Number(process.env.PORT ?? '3000');
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new RangeError(\`PORT must be an integer from 0 through 65535, received \${String(process.env.PORT)}\`);
}

const compiled = compileModule(AppModule);
const router = createRouter();
for (const controller of compiled.controllers) {
  router.register(controller);
}

const handle = toNodeHandler(router);
const server = createServer((request, response) => {
  const method = request.method;
  if (method === undefined) {
    response.writeHead(400).end('request method is required');
    return;
  }
  handle(
    {
      method,
      headers: request.headers,
      ...(request.url === undefined ? {} : { url: request.url }),
      on(event, listener) {
        request.on(event, listener);
      },
      setEncoding() {
        request.setEncoding('utf8');
      },
    },
    response,
  );
});
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const selectedPort = typeof address === 'object' && address !== null ? address.port : port;
  console.log(\`listening on http://127.0.0.1:\${String(selectedPort)}\`);
});
`,
    },
    {
      path: 'src/health.controller.ts',
      source: `import { Controller, Get } from 'zmdb';

@Controller('/health')
export class HealthController {
  @Get()
  check(): { readonly ok: true } {
    return { ok: true };
  }
}
`,
    },
    {
      path: 'src/health.controller.spec.ts',
      source: `import { createTestApp } from 'zmdb/testing';
import { bodyText } from 'zmdb/web';
import { describe, expect, it } from 'vitest';

import config from '../zmdb.config.js';
import { AppModule } from './app.module.js';

describe('generated project', () => {
  it('serves health and opens its sqlite database', async () => {
    await using app = createTestApp(AppModule);
    const response = await app.request({ method: 'GET', path: '/health', headers: {} });
    expect(response.status).toBe(200);
    expect(JSON.parse(await bodyText(response))).toEqual({ ok: true });

    const rows = await config.driver().execute({ text: 'SELECT 1 AS ok', parameters: [] });
    expect(Reflect.get(rows[0] ?? {}, 'ok')).toBe(1);
  });
});
`,
    },
    {
      path: '.gitignore',
      source: `node_modules
dist
generated-tests
coverage
database.sqlite
`,
    },
  ],
});
