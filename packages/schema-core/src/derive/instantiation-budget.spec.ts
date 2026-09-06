// What the type-first design costs the compiler, measured rather than asserted.
//
// The whole plan moves work from runtime to the type system: `CreateDTO<User>` is a mapped
// type over a filtered key set, `WhereDTO` another, `Populated` another again, and each is
// instantiated once per table per use site. That is a real budget and it is spent in a
// currency nobody watches — nothing fails when a build gets slower, it just gets slower, and
// by the time anyone measures it the cause is thirty commits back. That is RISK-6.
//
// So two numbers, both from `tsc --extendedDiagnostics` on a project `__testing__/
// instantiations.ts` generates:
//
//   1. A **ceiling**. A fixed schema costs at most N instantiations. Blunt, and it catches
//      the ordinary regression: a helper that stops being lazy, an `extends` that forces a
//      union to distribute.
//   2. A **scaling factor**, which is the one that matters. The same derivation is measured
//      at two table counts, and quadrupling the tables may not much more than quadruple the
//      cost. A ceiling goes stale the moment the fixture grows; superlinearity does not.
//      An accidental cross-product between tables — the failure mode that makes a large
//      schema uncompilable rather than merely slow — shows up here and only here.
//
//      It is the *marginal* cost that is compared, with an empty-project baseline subtracted
//      out. Without that subtraction the test is close to useless: the fixed floor of a
//      program (lib files, the `derive` module's own types) is around 17,000 instantiations
//      and four tables add under 3,000, so the raw ratio for 4x the tables is about 1.4 and
//      even genuinely quadratic per-table growth stays well under any plausible threshold.
//      Subtracting the floor makes linear read as 4.0 and quadratic as 16.
//
// This file is the small, fast half, and it runs in the ordinary test suite where a developer
// sees the number without asking for it. The other half is `yarn verify:instantiations`, which
// runs the same measurement at 128 and 512 tables and compares a tagged schema against the
// same schema with every tag stripped — REQ-TF-3's baseline, and a scale where a cross-product
// is unmissable. Both call the same module, so the two cannot disagree about what they are
// measuring: if a number here moves, the same edit moves the number there.

import { afterAll, describe, expect, it } from 'vitest';

import { cleanup, measure } from './__testing__/instantiations.js';

/**
 * The measured ceiling for `TABLES` tables, with headroom.
 *
 * Recorded, not derived: the point of a committed number is that changing it is a visible
 * edit with a reason in the commit message. Raise it when the derivation genuinely grows;
 * lower it when something gets cheaper, so the slack does not quietly accumulate.
 */
const CEILING = 36_000;
const TABLES = 8;

/**
 * Quadrupling the tables may cost at most this much more, per table above the baseline.
 *
 * Linear is 4.0 exactly, since the floor is subtracted. 5 leaves room for the mapped types
 * that the checker caches across tables (which pushes it slightly *below* 4) and for ordinary
 * measurement noise, while still failing on anything quadratic — that reads as 16.
 */
const MAX_SCALING = 5;
const SMALL = 4;
const LARGE = SMALL * 4;

/** The variant both tests use: tagged, with the whole DTO suite derived over it. */
const tagged = (tables: number) => ({ tables, tagged: true, derive: true }) as const;

afterAll(() => {
  cleanup();
});

describe('type-instantiation budget (RISK-6)', () => {
  it(`stays under ${CEILING.toLocaleString()} instantiations for ${TABLES} tagged tables`, () => {
    const { instantiations } = measure('fixed', tagged(TABLES));
    // Logged unconditionally: the number is the deliverable, and a passing test that prints
    // nothing gives no way to see the slack shrinking over several commits.
    console.log(
      `derive: ${instantiations.toLocaleString()} instantiations for ${TABLES} tables (ceiling ${CEILING.toLocaleString()})`,
    );
    expect(instantiations).toBeLessThanOrEqual(CEILING);
  }, 60_000);

  it('scales linearly in the number of tables', () => {
    // The floor: the same imports, no tables. Everything a program costs before the schema
    // does, which is most of it.
    const baseline = measure('baseline', tagged(0)).instantiations;
    const small = measure('small', tagged(SMALL)).instantiations - baseline;
    const large = measure('large', tagged(LARGE)).instantiations - baseline;
    expect(small, 'the tables must cost something measurable above the baseline').toBeGreaterThan(0);

    const ratio = large / small;
    console.log(
      `derive: baseline ${baseline.toLocaleString()}; ` +
        `${SMALL} tables +${small.toLocaleString()}, ${LARGE} tables +${large.toLocaleString()} ` +
        `= ${ratio.toFixed(2)}x for 4x the tables (max ${MAX_SCALING})`,
    );
    // The failure this catches: one table's derivation reaching across the others. It makes a
    // 50-table schema uncompilable while an 8-table fixture sits comfortably under any
    // ceiling, so the ceiling above cannot see it.
    expect(ratio).toBeLessThanOrEqual(MAX_SCALING);
  }, 120_000);
});
