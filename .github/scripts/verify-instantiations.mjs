// REQ-TF-3, measured at a size where a cross-product would show: what the tags cost `tsc`.
//
// The requirement is that a tag "carries zero runtime cost and zero type-level computation —
// an optional `unique symbol` slot, never a conditional or recursive type", and its acceptance
// criterion has two halves. `tags/erasure.spec.ts` has the first (no tag symbol survives to
// the emitted output, as a byte comparison). This is the second: *does not regress against the
// untagged baseline*. So every number here is a comparison against the same schema with every
// tag stripped, generated from the same code path so the two differ in the tags and nothing
// else.
//
// ---------------------------------------------------------------------------
// Instantiations, not a clock
// ---------------------------------------------------------------------------
//
// The criterion says wall-time, and this measures type instantiations. That is a deliberate
// substitution: an instantiation count is bit-identical across runs — four consecutive runs of
// the 512-table project gave 327,477 every time — and a clock on a CI runner is not. A gate
// built on the clock either fails on a noisy neighbour or is set so loose it catches nothing.
//
// The clock is not ignored, though. `Check time` is read from the same report and compared
// tagged-against-untagged as a *ratio*, which is far steadier than either absolute time (the
// two measurements are taken seconds apart on the same machine), and it is checked against a
// deliberately loose ceiling. It is there to catch the case the instantiation count cannot:
// work the checker does that is not an instantiation.
//
// Total generated-project build wall-time is published by REQ-TF-11's
// `verify:build-budget`; its deterministic session/update shape is the gate. This file is
// about the marginal cost of a tag.
//
// ---------------------------------------------------------------------------
// 512 tables, and what the scale caught
// ---------------------------------------------------------------------------
//
// `instantiation-budget.spec.ts` measures a ceiling at 8 tables and a scaling factor from 4 to
// 16, from this same module, and runs in the ordinary test suite where a developer sees it.
// This runs at 128 and 512, which is where the failure that actually matters is visible: one
// table's derivation reaching across the others costs little at 16 tables and makes a large
// schema uncompilable. If you are adjusting a *ceiling*, it is in the spec; if you are
// adjusting the *marginal cost of a tag*, it is here.
//
// The scale also caught the fixture. The first version used the same tag arguments for every
// generated table and reported that declaring 512 tagged tables cost **523** instantiations —
// about one per table, none per column, apparently free. It is not: the checker caches a
// generic instantiation per distinct type argument, so an identical `Length<255>` across four
// thousand columns is instantiated once and the measurement was of the cache. With the
// arguments varying per table, as they do in any real schema, the same declaration costs 6.07
// per table — which is exactly the number of tag arguments that differ from one table to the
// next (`Table<'table_N'>`, `Length`, `Pattern`, `Min`, `Max`, `MinLength`) and none for the
// eight columns' worth of shared ones. That is what the first row enforces, and it is a
// sharper statement of REQ-TF-3 than "cheap": declaring costs O(distinct tag arguments), not
// O(tagged columns).
//
// It has been mutation-tested against the failure it exists for. Rewriting one tag as a
// conditional type — `Length<N> = N extends 0 ? never : {…}` — takes the row from 6.07 to 8.07
// and fails. (Against the old shared-argument fixture the same mutation cost two
// instantiations *in total* and passed, which is how the fixture's problem was found.)
//
// The tags do cost something once the DTOs are derived over them — the key filters are real
// conditional types and they are what the tags are for. That is the third row: the tagged
// derivation's marginal cost against the untagged twin's.
//
// A rising number fails; a falling one is reported with the edit to make, which is the same
// convention as `verify:escape-hatches`.

import {
  COLUMNS_PER_TABLE,
  cleanup,
  measure,
} from '../../packages/schema-core/src/derive/__testing__/instantiations.ts';

/** The at-scale measurement point, and the smaller one linearity is judged against. */
const TABLES = 512;
const SMALL = 128;

/**
 * The committed budgets, each with the measurement it was set from.
 *
 * Recorded, not derived. Raising one is a decision that belongs in a commit message; the
 * numbers in the comments are what the tree measured when the budget was written, so the
 * headroom is visible rather than implied.
 *
 * `lowerAt` is the other direction — the value below which the script asks for the budget to
 * come down, so slack does not quietly accumulate until the gate stops meaning anything. It
 * is per row rather than a blanket percentage because the rows are not the same kind of
 * number: 6.07 instantiations per table is *already* one per distinct tag argument and there is
 * nothing left in it to reclaim, while 7% off the derivation cost is a real improvement worth
 * holding on to. A row with no `lowerAt` is one where going lower is not slack.
 */
const BUDGET = {
  declarationPerTable: {
    limit: 7,
    lowerAt: 5,
    what: 'instantiations to declare one tagged table',
    why:
      'REQ-TF-3: a tag is a slot, not a computation. 6.07 is one instantiation per tag ' +
      'argument that differs between tables and nothing for the eight columns. Making any one ' +
      'tag a conditional type costs 8.07, which is what this ceiling is set to catch.',
  },
  derivationPerTable: {
    limit: 640,
    lowerAt: 560,
    what: 'instantiations to derive the DTO suite for one tagged table',
    why:
      'RISK-6: the consumer pays this, once per table per build. Ten shapes are derived per ' +
      'table here (`Entity` through `GetDTO`), so this is roughly 60 instantiations each.',
  },
  tagShareOfDerivation: {
    limit: 1.2,
    lowerAt: 1.05,
    what: 'derivation cost, tagged ÷ untagged',
    why:
      "REQ-TF-3's baseline: the same interfaces with the *column* tags removed. The table-name " +
      'slot stays on both sides, because a type that does not carry it is not a `DeclaredTable` ' +
      'and the derivations refuse it outright (REQ-TF-4) — so this row is the cost of the tags ' +
      'a column carries, which is what REQ-TF-3 is about. The key filters are conditional types ' +
      'and cost real work, so it is above 1 by design; what it must not do is climb.',
  },
  checkTimeRatio: {
    // No `lowerAt`, and a ceiling with a lot of air in it. This is the one row read off a
    // clock, and its ceiling is set to catch a change of *kind* rather than of degree: the
    // degree is the instantiation ratio above, which is reproducible to the digit. Ratcheting
    // a clock downward would flake on whatever machine happened to be fast that day.
    limit: 3,
    what: 'checker wall-time, tagged ÷ untagged',
    why:
      'The one row a clock can answer and an instantiation count cannot: checker work that is ' +
      'not an instantiation. There is some — this sits near 1.8 while the instantiation ratio ' +
      'is 1.11 — so the tags are not free in wall-time at this scale, and the honest form of ' +
      'that is the absolute number: a quarter of a millisecond of check time per tagged ' +
      'table. What this ceiling is for is the change that makes it milliseconds.',
  },
  linearity: {
    limit: 1.1,
    // No `lowerAt`: below 1.0 means the checker is caching across tables, which is welcome
    // and is not headroom anyone can spend.
    what: `per-table derivation cost, ${TABLES} tables ÷ ${SMALL} tables`,
    why:
      'RISK-6 again, and the reason for the scale. A flat per-table cost is linearity. One ' +
      "table's derivation reaching across the others reads as a ratio of 4 here and as " +
      'nothing much at 16 tables.',
  },
};

// ---------------------------------------------------------------------------
// The measurements
// ---------------------------------------------------------------------------

/**
 * Five projects.
 *
 * The floor — the same two imports, no tables — is subtracted from everything. Without that
 * subtraction the comparison is close to meaningless: a program costs about 17,000
 * instantiations before the schema costs anything, so a doubling of the schema's own cost
 * reads as a few percent and every ratio here comes back reassuringly near 1.
 */
let report;
try {
  const floor = measure('floor', { tables: 0, tagged: true, derive: true });
  const declared = measure('declared', { tables: TABLES, tagged: true, derive: false });
  const declaredUntagged = measure('declared-untagged', { tables: TABLES, tagged: false, derive: false });
  const derived = measure('derived', { tables: TABLES, tagged: true, derive: true });
  const derivedUntagged = measure('derived-untagged', { tables: TABLES, tagged: false, derive: true });
  const small = measure('small', { tables: SMALL, tagged: true, derive: true });

  const above = one => one.instantiations - floor.instantiations;
  report = {
    floor,
    declared,
    declaredUntagged,
    derived,
    derivedUntagged,
    small,
    marginal: {
      declared: above(declared),
      declaredUntagged: above(declaredUntagged),
      derived: above(derived),
      derivedUntagged: above(derivedUntagged),
      small: above(small),
    },
  };
} finally {
  cleanup();
}

const { marginal } = report;
const values = {
  declarationPerTable: marginal.declared / TABLES,
  derivationPerTable: marginal.derived / TABLES,
  tagShareOfDerivation: marginal.derived / marginal.derivedUntagged,
  checkTimeRatio: report.derived.checkMs / report.derivedUntagged.checkMs,
  linearity: marginal.derived / TABLES / (marginal.small / SMALL),
};

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const pad = (text, width) => String(text).padStart(width);
const columns = TABLES * COLUMNS_PER_TABLE;

console.log(
  `type-instantiation budget: ${TABLES} tagged tables (${columns.toLocaleString()} columns), ` +
    'against the same schema untagged\n',
);
console.log('  measurement                                                        value    ceiling');
for (const [key, { limit, lowerAt, what }] of Object.entries(BUDGET)) {
  const value = values[key];
  const mark = value > limit ? '✗' : lowerAt !== undefined && value < lowerAt ? '↓' : ' ';
  console.log(`  ${mark} ${what.padEnd(62)} ${pad(value.toFixed(2), 7)} ${pad(limit.toFixed(2), 10)}`);
}

console.log(`\n  floor (imports, no tables): ${report.floor.instantiations.toLocaleString()} instantiations`);
console.log('\n  above the floor                       tagged      untagged   check time (t/u)');
const row = (label, tagged, untagged, taggedMs, untaggedMs) =>
  console.log(
    `  ${label.padEnd(34)} ${pad(tagged.toLocaleString(), 8)} ${pad(untagged.toLocaleString(), 13)}` +
      `   ${pad(`${taggedMs}ms / ${untaggedMs}ms`, 16)}`,
  );
row(
  'declaration only',
  marginal.declared,
  marginal.declaredUntagged,
  report.declared.checkMs,
  report.declaredUntagged.checkMs,
);
row(
  'declaration + derived DTOs',
  marginal.derived,
  marginal.derivedUntagged,
  report.derived.checkMs,
  report.derivedUntagged.checkMs,
);
console.log(
  `  ${`the same at ${SMALL} tables`.padEnd(34)} ${pad(marginal.small.toLocaleString(), 8)}` +
    `${pad('—', 14)}   ${pad(`${report.small.checkMs}ms`, 16)}`,
);

// The ratios above are what a gate can hold; this is the line a person wants. Reported and not
// capped, because it is arithmetic on two rows that are already capped.
const tagCost = (marginal.derived - marginal.derivedUntagged) / TABLES;
const tagMs = (report.derived.checkMs - report.derivedUntagged.checkMs) / TABLES;
console.log(
  `\n  what a tagged table costs over an untagged one: ${tagCost.toFixed(1)} instantiations, ${tagMs.toFixed(2)}ms of check time`,
);

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

const problems = [];
for (const [key, { limit, what, why }] of Object.entries(BUDGET)) {
  if (values[key] > limit) {
    problems.push(`${what}: ${values[key].toFixed(2)}, ceiling ${limit}.\n    ${why}`);
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} budget(s) exceeded:\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error('RISK-6 is that this cost grows in a currency nobody watches: nothing fails when a');
  console.error("consumer's build gets slower, it just gets slower, and by the time anyone measures");
  console.error('it the cause is thirty commits back. Raising a budget here is allowed and is a');
  console.error('decision — say in the commit message what bought the increase.');
  process.exit(1);
}

const slack = Object.entries(BUDGET).filter(([key, { lowerAt }]) => lowerAt !== undefined && values[key] < lowerAt);
if (slack.length > 0) {
  console.log(`\n${slack.length} budget(s) now have a lot of room. Lower BUDGET to keep the gate honest:`);
  for (const [key, { limit, what }] of slack) console.log(`  ${what}: ${limit} → ${values[key].toFixed(2)}`);
}

console.log(
  `\ndeclaring ${columns.toLocaleString()} tagged columns costs ${marginal.declared.toLocaleString()} instantiations, ` +
    `and deriving over them costs ${values.tagShareOfDerivation.toFixed(2)}x the untagged schema.`,
);
