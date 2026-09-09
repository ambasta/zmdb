import { FORMAT_OPTIONS, type TemplateFactory } from './types.js';

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
            'node scripts/build.mjs fmt-check && tsc --noEmit && oxlint . && node scripts/build.mjs test && vitest run --config vitest.config.ts',
          fmt: 'node scripts/build.mjs fmt',
          'fmt:check': 'node scripts/build.mjs fmt-check',
          lint: 'oxlint .',
          start: 'node dist/main.mjs',
          test: 'node scripts/build.mjs test && vitest run --config vitest.config.ts',
          typecheck: 'tsc --noEmit',
        },
        dependencies: {
          '@zmdb/core': packageVersion,
          '@zmdb/sqlite': packageVersion,
        },
        devDependencies: {
          '@types/node': '26.4.1',
          esbuild: '0.28.2',
          oxfmt: '0.66.0',
          oxlint: '1.81.0',
          typescript: '7.0.2',
          vitest: '5.0.0',
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
      source: `import { glob, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { format } from 'oxfmt';
import { zmdbAot } from '@zmdb/core/compiler';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const formatOptions = ${JSON.stringify(FORMAT_OPTIONS)};

async function formatProject(check) {
  const paths = glob(['**/*.ts', '**/*.mjs', '**/*.json'], {
    cwd: root,
    exclude: ['**/node_modules/**', '**/dist/**', '**/generated-tests/**', '**/.cache/**', '**/package-lock.json', '**/npm-shrinkwrap.json'],
  });
  for await (const path of paths) {
    const absolute = join(root, path);
    const source = await readFile(absolute, 'utf8');
    const result = await format(path, source, formatOptions);
    if (result.errors.length > 0) throw new Error(JSON.stringify(result.errors));
    if (result.code === source) continue;
    if (check) {
      process.stderr.write(path + '\\n');
      process.exitCode = 1;
    } else {
      await writeFile(absolute, result.code);
    }
  }
}

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
  target: 'es2022',
};

const mode = process.argv[2];
if (mode === 'fmt' || mode === 'fmt-check') {
  await formatProject(mode === 'fmt-check');
} else if (mode === 'app') {
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
  throw new Error('usage: node scripts/build.mjs <app|test|fmt|fmt-check>');
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

import { defineConfig } from '@zmdb/core';
import { sqlite, sqliteDriver } from '@zmdb/core/sqlite';

const databasePath = fileURLToPath(new URL('./database.sqlite', import.meta.url));

export default defineConfig({
  schema: ['src/**/*.ts'],
  dialect: sqlite,
  project: './tsconfig.json',
  out: './migrations',
  driver: () => sqliteDriver(new DatabaseSync(databasePath)),
});
`,
    },
    {
      path: 'src/app.module.ts',
      source: `import { Module } from '@zmdb/core';

import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController] })
export class AppModule {}
`,
    },
    {
      path: 'src/main.ts',
      source: `import { createServer } from 'node:http';

import { compileModule, createRouter, toNodeHandler } from '@zmdb/core/web';

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
      source: `import { Controller, Get } from '@zmdb/core';

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
      source: `import { createTestApp } from '@zmdb/core/testing';
import { bodyText } from '@zmdb/core/web';
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
