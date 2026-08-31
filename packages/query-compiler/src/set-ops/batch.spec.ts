import { describe, it, expect, vi } from 'vitest';

import { createQueryCompiler } from '../index.ts';
import { batch } from './index.ts';

const qc = createQueryCompiler('postgres');
const a = qc.selectFrom('users').compile();
const b = qc.insertInto('users').values({ email: 'x@y.com' }).compile();

describe('batch API (#123)', () => {
  it('exposes the statements in order', () => {
    expect(batch([a, b]).statements).toEqual([a, b]);
  });

  it('execute calls the runner exactly once with all statements', async () => {
    const runner = vi.fn(async (stmts: readonly unknown[]) => stmts.map((_, i) => ({ i })));
    const out = await batch([a, b]).execute(runner);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0]).toEqual([a, b]);
    expect(out).toEqual([{ i: 0 }, { i: 1 }]);
  });

  it('empty batch ⇒ runner not called, empty result', async () => {
    const runner = vi.fn(async () => []);
    const out = await batch([]).execute(runner);
    expect(runner).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });
});
