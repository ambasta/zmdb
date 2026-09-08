import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export async function resolveSources(evidence) {
  const requirePeer = createRequire(join(evidence, 'tooling/package.json'));
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('@zmdb/')) {
        const [, name, ...parts] = specifier.split('/');
        const directory = join(root, 'packages', name);
        const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        const entry = manifest.exports[parts.length === 0 ? '.' : `./${parts.join('/')}`];
        assert.equal(typeof entry, 'string');
        return { url: pathToFileURL(join(directory, entry)).href, shortCircuit: true };
      }
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (!specifier.startsWith('.') && !specifier.startsWith('/') && error.code === 'ERR_MODULE_NOT_FOUND') {
          return { url: pathToFileURL(requirePeer.resolve(specifier)).href, shortCircuit: true };
        }
        throw error;
      }
    },
  });
  await import(pathToFileURL(join(root, 'scripts/ts-specifier-hook.mjs')).href);
  return requirePeer;
}
