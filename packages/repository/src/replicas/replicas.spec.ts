import { describe, it, expect } from 'vitest';

import type { Driver } from '../index.js';
import { withReplicas, isWrite } from './index.js';

function tagDriver(tag: string, log: string[]): Driver {
  return { execute: async q => (log.push(`${tag}:${q.text.slice(0, 6)}`), []) };
}
const q = (text: string) => ({ text, parameters: [] });

describe('read replicas (#128)', () => {
  it('isWrite detects INSERT/UPDATE/DELETE', () => {
    expect(isWrite('INSERT INTO x ...')).toBe(true);
    expect(isWrite('  update x set ...')).toBe(true);
    expect(isWrite('SELECT 1')).toBe(false);
  });

  it('routes writes to primary, reads to replicas (round-robin)', async () => {
    const log: string[] = [];
    const d = withReplicas({
      primary: tagDriver('P', log),
      replicas: [tagDriver('R0', log), tagDriver('R1', log)],
    });
    await d.execute(q('SELECT a'));
    await d.execute(q('SELECT b'));
    await d.execute(q('INSERT INTO x'));
    await d.execute(q('SELECT c'));
    expect(log).toEqual(['R0:SELECT', 'R1:SELECT', 'P:INSERT', 'R0:SELECT']);
  });

  it('falls back to primary when no replicas', async () => {
    const log: string[] = [];
    const d = withReplicas({ primary: tagDriver('P', log), replicas: [] });
    await d.execute(q('SELECT z'));
    expect(log).toEqual(['P:SELECT']);
  });
});
