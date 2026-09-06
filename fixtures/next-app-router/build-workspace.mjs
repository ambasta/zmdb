import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const next = require.resolve('next/dist/bin/next');
const preservedFiles = ['next-env.d.ts', 'tsconfig.json'].map(name => {
  const file = new URL(name, import.meta.url);
  return { file, source: readFileSync(file) };
});
const result = spawnSync(process.execPath, [next, 'build', '--webpack'], {
  cwd: new URL('.', import.meta.url),
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ZMDB_NEXT_WORKSPACE_SOURCE: '1' },
  stdio: 'inherit',
});
for (const preserved of preservedFiles) writeFileSync(preserved.file, preserved.source);

if (result.error !== undefined) throw result.error;
process.exit(result.status ?? 1);
