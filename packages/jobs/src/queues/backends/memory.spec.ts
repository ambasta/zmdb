import { readFileSync } from 'node:fs';

import { createMemoryJobStore } from '@zmdb/jobs/memory';
import { describe, expect, it } from 'vitest';

describe('@zmdb/jobs memory backend (#588, #650)', () => {
  it('ships an in-memory backend with the queue schema and claim index', () => {
    using store = createMemoryJobStore();

    const objects = store.database
      .prepare(
        `SELECT name, type FROM sqlite_master
         WHERE name IN ('zmdb_job', 'zmdb_job_done', 'zmdb_job_pending')
         ORDER BY name`,
      )
      .all();

    expect(store.dialect).toBe('sqlite');
    expect(objects).toEqual([
      { name: 'zmdb_job', type: 'table' },
      { name: 'zmdb_job_done', type: 'table' },
      { name: 'zmdb_job_pending', type: 'index' },
    ]);
  });

  it('keeps the core package free of external backends and runtime peers', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as Record<
      string,
      unknown
    >;

    expect(manifest).toMatchObject({
      exports: {
        '.': './src/index.ts',
        './memory': './src/queues/backends/memory.ts',
        './schedule': './src/schedule/index.ts',
      },
    });
    expect(manifest['peerDependencies']).toBeUndefined();
    expect(manifest['optionalDependencies']).toBeUndefined();
    expect(manifest['dependencies']).not.toMatchObject({ pg: expect.anything() });
  });
});
