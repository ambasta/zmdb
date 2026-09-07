import { realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { root, evidence } from './registry.mjs';

export async function main(argv) {
  const values = new Map();
  try {
    for (let index = 0; index < argv.length; index++) {
      const key = argv[index];
      if (!['--root', '--evidence-dir', '--setup-only'].includes(key) || values.has(key))
        throw new Error('invalid invocation');
      if (key === '--setup-only') values.set(key, true);
      else {
        const value = argv[++index];
        if (!value || value.startsWith('--')) throw new Error('missing argument');
        values.set(key, value);
      }
    }
    if (
      values.get('--root') !== root ||
      values.get('--evidence-dir') !== evidence ||
      !isAbsolute(evidence) ||
      !relative(root, evidence).startsWith('..') ||
      (await realpath(root)) !== root
    )
      throw new Error('root or evidence directory mismatch');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  const { setup, runAll, close } = await import('./observations.mjs');
  let code = 0,
    failure = null,
    cases = [],
    cleanup;
  try {
    await setup();
    if (!values.has('--setup-only')) {
      cases = await runAll();
      if (cases.some(row => !row.ok)) {
        code = 1;
        failure = { code: 'CASE', message: 'one or more qualification cases failed' };
      }
    }
  } catch (error) {
    code = error.name === 'AssertionError' ? 1 : 70;
    failure = { code: code === 1 ? 'CASE' : 'SETUP', message: String(error.stack ?? error) };
  }
  try {
    cleanup = await close();
  } catch (error) {
    code = 70;
    failure = { code: 'CLEANUP', message: String(error.stack ?? error) };
    cleanup = { children: [evidence], ports: [], processes: [] };
  }
  const report = {
    ok: code === 0,
    phase: failure?.code === 'CLEANUP' ? 'cleanup' : values.has('--setup-only') ? 'setup' : 'qualification',
    cases,
    failure,
    cleanup,
  };
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report) + '\n');
  return code;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await main(process.argv.slice(2));
