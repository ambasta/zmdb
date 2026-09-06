// #81/#628: the build adapters and their TypeScript front end ship as one package.
// This test freezes the exact subpaths and the peer boundary each host integration uses.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { zmdbAot } from './index.js';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

describe('the plugin object', () => {
  it('is unplugin-shaped', () => {
    const plugin = zmdbAot();
    expect(plugin.name).toBe('zmdb-aot');
    expect(typeof plugin.transform).toBe('function');
    expect(typeof plugin.watchChange).toBe('function');
    expect(typeof plugin.buildEnd).toBe('function');
  });

  it('runs before anything else can edit the module', () => {
    // Load-bearing. The transform rewrites at offsets from the AST the compiler parsed, so
    // a plugin that got there first would leave every offset pointing at the wrong byte —
    // and the failure mode is a silent fallback to the slow path, not an error.
    expect(zmdbAot().enforce).toBe('pre');
  });

  it('needs no options at all', () => {
    expect(() => zmdbAot()).not.toThrow();
  });
});

describe('the manifest', () => {
  it('exports exactly the compiler package contract', () => {
    expect(Object.keys(manifest.exports).toSorted()).toEqual([
      '.',
      './config',
      './config/contract',
      './emit',
      './errors',
      './lint',
      './metro',
      './reflect',
      './testing',
      './transform',
      './unplugin',
    ]);
  });

  it('publishes the compiler diagnostic types separately from runtime errors', () => {
    expect(manifest.exports['./errors']).toBe('./src/errors.ts');
  });

  it('declares every export as a source path the build mirrors', () => {
    // `dist` mirrors `src` one file at a time, so the publish manifest is this map with
    // `src`/`.ts` swapped for `dist`/`.js` (`.github/scripts/repoint-dist.mjs`). A target
    // that is not a `./src/….ts` path has no dist counterpart, and the first person to
    // find out is a consumer whose import does not resolve.
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      expect(target, `${subpath} is not a source path the build mirrors`).toMatch(/^\.\/src\/.+\.ts$/);
    }
  });

  it('requires TypeScript and keeps host-specific lint and Metro peers optional', () => {
    expect(manifest.peerDependencies?.typescript).toBeDefined();
    expect(manifest.peerDependenciesMeta?.typescript?.optional).not.toBe(true);
    for (const peer of ['metro', 'metro-babel-transformer', 'oxlint']) {
      expect(manifest.peerDependencies?.[peer]).toBeDefined();
      expect(manifest.peerDependenciesMeta?.[peer]?.optional).toBe(true);
    }
  });
});
