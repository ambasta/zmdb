import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const location = new URL('../../../fixtures/consumer-cli/observations.mjs', import.meta.url).href;
const loaded: unknown = await import(location);
if (typeof loaded !== 'object' || loaded === null) throw new TypeError('CLI fixture module is absent');
const setup: unknown = Reflect.get(loaded, 'setup');
const close: unknown = Reflect.get(loaded, 'close');
const runAll: unknown = Reflect.get(loaded, 'runAll');
if (typeof setup !== 'function' || typeof close !== 'function' || typeof runAll !== 'function') {
  throw new TypeError('CLI fixture entry functions are absent');
}

beforeAll(async () => {
  await setup();
}, 600_000);
afterAll(async () => {
  await close();
}, 120_000);

describe('installed CLI workflow', () => {
  it('runs each packed CLI observation once', async () => {
    const results: readonly { readonly id: string; readonly ok: boolean; readonly exitCode: number }[] = await runAll();
    expect(results.filter(result => !result.ok)).toEqual([]);
  }, 600_000);
});
