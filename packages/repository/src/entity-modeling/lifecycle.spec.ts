import { describe, it, expect, vi } from 'vitest';

import { EventBus } from './index.ts';

describe('lifecycle events & subscribers (#143)', () => {
  it('emits to matching subscribers in order', async () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.subscribe({
      on: 'beforeCreate',
      run: () => {
        order.push('a');
      },
    });
    bus.subscribe({
      on: 'beforeCreate',
      run: async () => {
        order.push('b');
      },
    });
    bus.subscribe({
      on: 'afterCreate',
      run: () => {
        order.push('other');
      },
    });
    await bus.emit('beforeCreate', {});
    expect(order).toEqual(['a', 'b']);
  });

  it('unsubscribe removes exactly that subscriber', async () => {
    const bus = new EventBus();
    const run = vi.fn();
    const off = bus.subscribe({ on: 'afterUpdate', run });
    off();
    await bus.emit('afterUpdate', {});
    expect(run).not.toHaveBeenCalled();
  });

  it('unknown event ⇒ no-op', async () => {
    const bus = new EventBus();
    await expect(bus.emit('beforeDelete', {})).resolves.toBeUndefined();
  });
});
