// Deterministic seeding — see ./SPEC.md.
import type { CoreSchema, ColumnMeta } from '../index.ts';

/** Deterministic PRNG (mulberry32). Same seed ⇒ same sequence. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedOptions {
  seed?: number;
  count: number;
}

function genValue(col: ColumnMeta, rng: () => number): unknown {
  switch (col.type) {
    case 'serial':
    case 'integer':
    case 'bigint':
      return Math.floor(rng() * 1_000_000);
    case 'numeric':
      return Math.floor(rng() * 100000) / 100;
    case 'boolean':
      return rng() < 0.5;
    case 'timestamp':
      return new Date(Math.floor(rng() * 1_700_000_000_000));
    case 'jsonEnum': {
      const e = col.flags.enum ?? [];
      return e.length ? e[Math.floor(rng() * e.length)] : '';
    }
    case 'text':
    case 'varchar':
    default:
      return 's' + Math.floor(rng() * 1e9).toString(36);
  }
}

export function seedRows(schema: CoreSchema<string>, opts: SeedOptions): Record<string, unknown>[] {
  const rng = makeRng(opts.seed ?? 1);
  const cols = Object.entries(schema.columns).filter(
    ([, col]) => col.flags.autoIncrement !== true && col.flags.hasDefault !== true,
  );
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < opts.count; i++) {
    const row: Record<string, unknown> = {};
    for (const [name, col] of cols) row[name] = genValue(col, rng);
    rows.push(row);
  }
  return rows;
}

// exported for the impl to reuse
export const __genValue = genValue;
