import { afterAll, beforeAll, describe, it } from 'vitest';

const location = new URL('../../../../fixtures/consumer-cli/observations.mjs', import.meta.url).href;
const loaded: unknown = await import(location);
if (typeof loaded !== 'object' || loaded === null) throw new TypeError('CLI fixture module is absent');
const setup: unknown = Reflect.get(loaded, 'setup');
const close: unknown = Reflect.get(loaded, 'close');
const runCase: unknown = Reflect.get(loaded, 'runCase');
if (typeof setup !== 'function' || typeof close !== 'function' || typeof runCase !== 'function') {
  throw new TypeError('CLI fixture entry functions are absent');
}

beforeAll(async () => {
  await setup();
}, 600_000);
afterAll(async () => {
  await close();
}, 120_000);

describe('installed CLI qualification', () => {
  it('generates executes and checks the same compiler artifacts', async () => {
    await runCase('T06');
  }, 600_000);
  it('retains one codegen session through changes and termination', async () => {
    await runCase('T07');
  }, 600_000);
  it('preserves borrowed watch sessions and reports callback failure', async () => {
    await runCase('T08');
  }, 600_000);
});
