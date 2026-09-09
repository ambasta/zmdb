import { join } from 'node:path';
import vm from 'node:vm';

import { loadConfig, runBuild } from 'metro';
import { expect, it } from 'vitest';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const FIXTURE = join(ROOT, 'fixtures', 'consumer-metro');

it('builds a working validator and schema through Metro and the existing transformer', async () => {
  const config = await loadConfig({ config: join(FIXTURE, 'metro.config.js'), cwd: FIXTURE });
  const bundle = await runBuild(config, {
    entry: 'src/index.ts',
    dev: false,
    minify: false,
    platform: 'ios',
  });

  const context: Record<string, unknown> = { console };
  vm.createContext(context);
  vm.runInContext(bundle.code, context);

  expect(context.__ZMDB_METRO_RESULT__).toEqual({
    acceptsGood: true,
    acceptsBad: false,
    table: 'users',
  });
  expect(context.__ZMDB_CUSTOM_TRANSFORMER__).toBe(true);
}, 180_000);
