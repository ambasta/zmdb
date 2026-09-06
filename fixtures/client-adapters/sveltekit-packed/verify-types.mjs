import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
  encoding: 'utf8',
});

if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  for (const path of [
    '.svelte-kit/types/src/routes/client/$types.d.ts',
    '.svelte-kit/types/src/routes/client/proxy+page.ts',
  ]) {
    if (!existsSync(path)) continue;
    process.stderr.write(`\n--- ${path} ---\n`);
    process.stderr.write(readFileSync(path, 'utf8'));
  }
  process.exit(result.status ?? 1);
}
