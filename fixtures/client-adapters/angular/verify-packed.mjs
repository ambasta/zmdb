import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT, publishManifest, readManifest } from '../../../.github/scripts/lib/publish-manifest.mjs';
import { runPackedProject } from '../src/packed-project.js';

function run(command, arguments_, cwd = ROOT) {
  const result = spawnSync(command, arguments_, { cwd, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(' ')} failed with ${String(result.status)}`);
  }
}

for (const workspace of ['@zmdb/client', '@zmdb/angular']) {
  run('yarn', ['workspace', workspace, 'build']);
}

const fixture = path => readFileSync(join(ROOT, 'fixtures/client-adapters/angular', path), 'utf8');
const conformance = path => readFileSync(join(ROOT, 'fixtures/client-adapters/src', path), 'utf8');
const result = runPackedProject({
  name: '@zmdb-fixture/angular-packed',
  packages: [
    {
      directory: join(ROOT, 'packages/client'),
      manifest: publishManifest(readManifest('client')),
    },
    {
      directory: join(ROOT, 'packages/angular'),
      manifest: publishManifest(readManifest('angular')),
    },
  ],
  dependencies: {
    '@angular/core': '22.1.5',
    rxjs: '7.8.2',
  },
  devDependencies: {
    '@types/node': '26.4.1',
    esbuild: '0.28.2',
    typescript: '7.0.2',
  },
  files: {
    'browser.ts': fixture('browser.ts'),
    'conformance-runner.ts': fixture('conformance-runner.ts'),
    'conformance/angular-binding.ts': conformance('angular-binding.ts'),
    'conformance/conformance-cases.ts': conformance('conformance-cases.ts'),
    'conformance/conformance.ts': conformance('conformance.ts'),
    'conformance/controllable-transport.ts': conformance('controllable-transport.ts'),
    'conformance/generated/api.generated.ts': conformance('generated/api.generated.ts'),
    'conformance/lifecycles.ts': fixture('lifecycles.ts'),
    'conformance/package-matrix.ts': conformance('package-matrix.ts'),
    'conformance/ssr.ts': conformance('ssr.ts'),
    'ssr.mjs': fixture('ssr.mjs'),
    'tsconfig.json': fixture('tsconfig.json'),
  },
  commands: [
    {
      label: 'packed Angular typecheck',
      command: process.execPath,
      arguments: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
    },
    {
      label: 'packed Angular browser bundle',
      command: process.execPath,
      arguments: [
        'node_modules/esbuild/bin/esbuild',
        'browser.ts',
        '--bundle',
        '--format=esm',
        '--platform=browser',
        '--outfile=browser.js',
      ],
    },
    {
      label: 'packed Angular browser runtime',
      command: process.execPath,
      arguments: ['browser.js'],
    },
    {
      label: 'packed Angular common conformance',
      command: process.execPath,
      arguments: ['dist/conformance-runner.js'],
    },
    {
      label: 'packed Angular SSR runtime',
      command: process.execPath,
      arguments: ['ssr.mjs'],
    },
  ],
});

try {
  const browser = readFileSync(join(result.application, 'browser.js'), 'utf8');
  if (browser.includes('@angular/common/http') || browser.includes('HttpClient')) {
    throw new Error('packed Angular browser bundle unexpectedly contains HttpClient');
  }
  const ssr = result.commands.find(command => command.label === 'packed Angular SSR runtime');
  const browserRuntime = result.commands.find(command => command.label === 'packed Angular browser runtime');
  const conformanceRuntime = result.commands.find(command => command.label === 'packed Angular common conformance');
  if (browserRuntime?.stdout.trim() !== 'browser Angular lifecycle passed') {
    throw new Error(`unexpected packed browser output: ${browserRuntime?.stdout ?? '<missing>'}`);
  }
  if (conformanceRuntime?.stdout !== '11 packed Angular conformance cases passed') {
    throw new Error(`unexpected packed conformance output: ${conformanceRuntime?.stdout ?? '<missing>'}`);
  }
  if (ssr?.stdout !== 'request-local Angular SSR clients passed') {
    throw new Error(`unexpected packed SSR output: ${ssr?.stdout ?? '<missing>'}`);
  }
  console.log(
    `Angular packed consumers passed: ${String(result.tarballs.size)} tarballs, 11 common cases, browser lifecycle, request-local SSR.`,
  );
} finally {
  result.cleanup();
}
