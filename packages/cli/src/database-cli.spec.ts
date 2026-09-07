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
  it('generates exact migrations and preserves no-op state', async () => {
    await runCase('T09');
  }, 600_000);
  it('applies reports and rolls back a durable SQLite ledger', async () => {
    await runCase('T10');
  }, 600_000);
  it('keeps failed SQLite migrations and destructive prompts truthful', async () => {
    await runCase('T11');
  }, 600_000);
  it('reports every check finding without hiding skipped drift', async () => {
    await runCase('T12');
  }, 600_000);
  it('embeds ordered SQLite migrations and rejects other dialects', async () => {
    await runCase('T13');
  }, 600_000);
  it('exports pulls and checks declarations without overwriting user files', async () => {
    await runCase('T14');
  }, 600_000);
  it('keeps current snapshots unchanged and refuses unsupported formats', async () => {
    await runCase('T15');
  }, 600_000);
});
