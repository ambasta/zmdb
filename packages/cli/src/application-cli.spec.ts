import { afterAll, beforeAll, describe, it } from 'vitest';

const location = new URL('../../../fixtures/consumer-cli/observations.mjs', import.meta.url).href;
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
  it('describes real modules without constructing providers', async () => {
    await runCase('T18');
  }, 600_000);
  it('preserves module finding severity and argument refusals', async () => {
    await runCase('T19');
  }, 600_000);
  it('boots and disposes a real PTY REPL with private history', async () => {
    await runCase('T20');
  }, 600_000);
  it('refuses unsafe REPL inputs and retains cleanup errors', async () => {
    await runCase('T21');
  }, 600_000);
});
