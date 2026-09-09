import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { MetroConfig } from 'metro';
import { describe, expect, it } from 'vitest';

import { withZmdb } from './metro.js';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const FIXTURE = join(ROOT, 'fixtures', 'consumer-metro');
const require = createRequire(import.meta.url);

function config(): MetroConfig {
  return {
    projectRoot: FIXTURE,
    maxWorkers: 8,
    transformerPath: '/expo/metro-transform-worker.js',
    transformer: {
      babelTransformerPath: require.resolve(join(FIXTURE, 'custom-transformer.js')),
    },
  };
}

describe('withZmdb', () => {
  it('preserves the host config and wraps its existing Babel transformer', () => {
    const original = config();
    const wrapped = withZmdb(original, { workerCount: 2 });

    expect(wrapped).not.toBe(original);
    expect(wrapped.projectRoot).toBe(original.projectRoot);
    expect(wrapped.transformerPath).toBe(original.transformerPath);
    expect(wrapped.maxWorkers).toBe(2);
    expect(wrapped.transformer).toMatchObject({ babelTransformerPath: expect.any(String) });
    expect(wrapped.transformer?.babelTransformerPath).not.toBe(original.transformer?.babelTransformerPath);
  });

  it('uses the host worker count when no override is provided', () => {
    expect(withZmdb(config()).maxWorkers).toBe(8);
  });

  it.each([0, -1, 1.5])('rejects invalid worker count %s', workerCount => {
    expect(() => withZmdb(config(), { workerCount })).toThrow('workerCount must be a positive integer');
  });
});
