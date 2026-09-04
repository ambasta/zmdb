// #81: packaging. The plugin has to be usable by a bundler, and the package has to be
// importable by an application without dragging a compiler into its bundle.
//
// The second half is the part worth a test. `typescript@7` is a Go binary behind a JS
// client that spawns a child process, so a runtime module that reaches it does not merely
// bloat a bundle — it fails to build one. The split is enforced repo-wide by
// `.github/scripts/verify-exports.mjs`; what is checked here is that this package's own
// manifest actually declares the entry points that split relies on.

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
  it('exports the runtime entry points an application imports', () => {
    for (const subpath of ['.', './utilities', './errors', './emit', './serialization', './advanced']) {
      expect(Object.keys(manifest.exports)).toContain(subpath);
    }
  });

  it('exports the build-time entry points a bundler imports', () => {
    for (const subpath of ['./lint', './plugin', './reflect', './transformer', './unplugin']) {
      expect(Object.keys(manifest.exports)).toContain(subpath);
    }
  });

  it('publishes `./errors`, because the emitted code imports it by name', () => {
    // The compiled validator emits `import { AssertError } from "@zmdb/aot-validator/errors"`.
    // If that subpath is not published, every AOT build produces code that cannot resolve.
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

  it('treats typescript as an optional peer, not a dependency', () => {
    // Installing `@zmdb/aot-validator` to call `is(value, ir)` at runtime should not pull
    // down a compiler; a build that uses the plugin already has one.
    expect(manifest.peerDependencies?.typescript).toBeDefined();
    expect(manifest.peerDependenciesMeta?.typescript?.optional).toBe(true);
  });
});
