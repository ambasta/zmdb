import { Type } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import Ajv from 'ajv';
// Focused, honest validation benchmark that reuses moltar's exact data model
// and the four case kinds (parseSafe / parseStrict / assertLoose / assertStrict).
// Competitors: zod, @sinclair/typebox, ajv, valibot — all run as real installed
// libraries. zmdb runs both its AOT path (the transformer's actual output) and its
// RUNTIME path (the IR walk), labelled separately. Both are generated from the one
// interface in `model.ts` by `yarn bench:validation:generate` — see that file.
//
// typia is intentionally excluded: it cannot run without its own AOT transform
// build step, so including it untransformed would misrepresent it.
//
// THREE THINGS THIS FILE DOES DELIBERATELY, because the obvious way to write a
// validation benchmark produces numbers that are wrong by 3-5x:
//
// 1. Every result is observed (see `keep`/`keepRef`). An earlier version of this
//    file discarded results with `void`. zmdb's AOT validator is a pure boolean
//    chain over a frozen module constant, so `void aotIs(FROZEN)` is dead code
//    and V8 deletes it outright. Measured: 1074-1199 M ops/s with `void` on a
//    frozen constant, 318-361 M with the result observed, 209-240 M with the
//    result observed and the input varying. That is 3.3-5x of pure fiction, and
//    it is ASYMMETRIC — zod, ajv and valibot allocate and throw, so their calls
//    survive elimination and only ours got the discount. This is also the real
//    explanation for the implausible ~942M ops/s row the Bun run used to print;
//    it was never Bun-specific.
//
// 2. The input rotates through a pool instead of being one frozen object. A
//    single frozen input lets V8 fold property loads and specialise on one
//    object identity, which no real caller gets.
//
// 3. Each timed function runs BATCH iterations internally. tinybench's per-call
//    overhead is ~10ns, which is the SAME ORDER as a fast validator, so
//    unbatched it compresses everything fast toward a common ~100M ops/s
//    ceiling and the suite cannot rank the top of the field at all. Batching
//    amortises that overhead to ~10ns/BATCH and lets the fast validators
//    separate.
import { Bench } from 'tinybench';
import {
  object as vObject,
  strictObject as vStrictObject,
  number as vNumber,
  string as vString,
  boolean as vBoolean,
  parse as vParse,
  is as vIs,
} from 'valibot';
import { object as zObject, number as zNumber, string as zString, boolean as zBoolean } from 'zod';

import { is, equals } from '../../../packages/aot-validator/src/utilities/index.ts';
import { aotIs, aotEquals, aotParseSafe, aotParseStrict } from './aot.generated.ts';
import { MOLTAR } from './model.generated.ts';
import type { Moltar } from './model.ts';

const LONG_STRING =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

// moltar's exact data model, as a pool of distinct-but-identically-shaped
// objects. POOL_MASK lets the hot loops index with `i & MASK` instead of a
// modulo, so the rotation itself costs almost nothing.
const POOL_SIZE = 8;
const POOL_MASK = POOL_SIZE - 1;
// Typed as `Moltar`, so the sample data cannot drift from the declaration every
// validator under test was built from — a benchmark whose input does not satisfy the
// schema measures the reject path and reports it as the accept path.
const POOL: Moltar[] = Array.from({ length: POOL_SIZE }, (_, i) => ({
  number: i,
  negNumber: -i,
  maxNumber: Number.MAX_VALUE,
  string: `string${String(i)}`,
  longString: LONG_STRING,
  boolean: i % 2 === 0,
  deeplyNested: { foo: `bar${String(i)}`, num: i, bool: i % 2 === 0 },
}));

// How many validations happen inside one timed tinybench call. See note 3.
const BATCH = 1_000;
// How many times the whole suite is re-run before we take a median per library.
// `run.sh` documents `REPEATS=9 ./run.sh`, so it has to actually be read from the
// environment; it was a plain constant, and that documented knob did nothing.
const REPEATS = Number(process.env.REPEATS ?? '5');

// --- keeping results alive -------------------------------------------------
// `sink` and `sinkRef` are module-level and printed at the end, so V8 cannot
// prove either the call or the returned object is unobservable. keepRef reads a
// field off the result as well, which defeats escape analysis on parse cases
// that would otherwise let the allocation be scalar-replaced away.
let sink = 0;
let sinkRef: unknown;

function keep(ok: boolean): void {
  if (ok) sink += 1;
}
function keepRef(value: unknown): void {
  sinkRef = value;
  if (value !== null && typeof value === 'object' && 'number' in value) sink += 1;
}

// --- zod -------------------------------------------------------------------
// zod has no allocation-free assert: there is no `is`, and both parse and
// safeParse build the output object. Its assert rows therefore carry parse cost
// by necessity, which the printed footnote states rather than hiding. safeParse
// is used for the assert cases because that is what a zod user writes when they
// want a boolean instead of an exception.
const zodLoose = zObject({
  number: zNumber(),
  negNumber: zNumber(),
  maxNumber: zNumber(),
  string: zString(),
  longString: zString(),
  boolean: zBoolean(),
  deeplyNested: zObject({ foo: zString(), num: zNumber(), bool: zBoolean() }),
});
const zodStrict = zodLoose
  .extend({
    deeplyNested: zObject({ foo: zString(), num: zNumber(), bool: zBoolean() }).strict(),
  })
  .strict();

// --- typebox (compiled — its intended fast path) ---------------------------
const tbFields = {
  number: Type.Number(),
  negNumber: Type.Number(),
  maxNumber: Type.Number(),
  string: Type.String(),
  longString: Type.String(),
  boolean: Type.Boolean(),
};
const tbNested = { foo: Type.String(), num: Type.Number(), bool: Type.Boolean() };
const tbLoose = TypeCompiler.Compile(Type.Object({ ...tbFields, deeplyNested: Type.Object(tbNested) }));
// A genuinely strict compiled checker. The previous version of this file reused
// the loose checker for assertStrict and admitted so in a comment, which made
// the strict column compare zmdb's real excess-key checking against four
// libraries doing no excess-key checking at all.
const tbStrict = TypeCompiler.Compile(
  Type.Object(
    { ...tbFields, deeplyNested: Type.Object(tbNested, { additionalProperties: false }) },
    { additionalProperties: false },
  ),
);

// --- ajv -------------------------------------------------------------------
const ajv = new Ajv();
const ajvNested = {
  type: 'object',
  properties: { foo: { type: 'string' }, num: { type: 'number' }, bool: { type: 'boolean' } },
  required: ['foo', 'num', 'bool'],
} as const;
const ajvProps = {
  number: { type: 'number' },
  negNumber: { type: 'number' },
  maxNumber: { type: 'number' },
  string: { type: 'string' },
  longString: { type: 'string' },
  boolean: { type: 'boolean' },
} as const;
const ajvRequired = ['number', 'negNumber', 'maxNumber', 'string', 'longString', 'boolean', 'deeplyNested'];
const ajvLoose = ajv.compile({
  type: 'object',
  properties: { ...ajvProps, deeplyNested: ajvNested },
  required: ajvRequired,
});
// Same correction as typebox: without additionalProperties:false this was a
// loose check wearing a strict label.
const ajvStrict = ajv.compile({
  type: 'object',
  properties: { ...ajvProps, deeplyNested: { ...ajvNested, additionalProperties: false } },
  required: ajvRequired,
  additionalProperties: false,
});

// --- valibot ---------------------------------------------------------------
const vNested = { foo: vString(), num: vNumber(), bool: vBoolean() };
const vFields = {
  number: vNumber(),
  negNumber: vNumber(),
  maxNumber: vNumber(),
  string: vString(),
  longString: vString(),
  boolean: vBoolean(),
};
const vLoose = vObject({ ...vFields, deeplyNested: vObject(vNested) });
const vStrict = vStrictObject({ ...vFields, deeplyNested: vStrictObject(vNested) });

// --- zmdb ------------------------------------------------------------------
// Both zmdb rows come from `model.ts`, through the generator: `MOLTAR` is the IR the
// runtime walker reads and the `aot*` functions are what the real transformer emitted for
// the same declaration. Neither is written here, which is the difference between measuring
// zmdb and measuring a hand-tuned lookalike of zmdb (REQ-TF-9).

type CaseKind = 'parseSafe' | 'parseStrict' | 'assertLoose' | 'assertStrict';

// Each entry runs `n` validations against rotating inputs and observes every
// result. Signature is (n) => void rather than () => void so the batching in
// note 3 lives inside the timed region.
const impls: Record<string, Partial<Record<CaseKind, (n: number) => void>>> = {
  zod: {
    parseSafe: n => {
      for (let i = 0; i < n; i += 1) keepRef(zodLoose.parse(POOL[i & POOL_MASK]));
    },
    parseStrict: n => {
      for (let i = 0; i < n; i += 1) keepRef(zodStrict.parse(POOL[i & POOL_MASK]));
    },
    assertLoose: n => {
      for (let i = 0; i < n; i += 1) keep(zodLoose.safeParse(POOL[i & POOL_MASK]).success);
    },
    assertStrict: n => {
      for (let i = 0; i < n; i += 1) keep(zodStrict.safeParse(POOL[i & POOL_MASK]).success);
    },
  },
  typebox: {
    assertLoose: n => {
      for (let i = 0; i < n; i += 1) keep(tbLoose.Check(POOL[i & POOL_MASK]));
    },
    assertStrict: n => {
      for (let i = 0; i < n; i += 1) keep(tbStrict.Check(POOL[i & POOL_MASK]));
    },
  },
  ajv: {
    assertLoose: n => {
      for (let i = 0; i < n; i += 1) keep(ajvLoose(POOL[i & POOL_MASK]));
    },
    assertStrict: n => {
      for (let i = 0; i < n; i += 1) keep(ajvStrict(POOL[i & POOL_MASK]));
    },
  },
  valibot: {
    parseSafe: n => {
      for (let i = 0; i < n; i += 1) keepRef(vParse(vLoose, POOL[i & POOL_MASK]));
    },
    parseStrict: n => {
      for (let i = 0; i < n; i += 1) keepRef(vParse(vStrict, POOL[i & POOL_MASK]));
    },
    assertLoose: n => {
      for (let i = 0; i < n; i += 1) keep(vIs(vLoose, POOL[i & POOL_MASK]));
    },
    assertStrict: n => {
      for (let i = 0; i < n; i += 1) keep(vIs(vStrict, POOL[i & POOL_MASK]));
    },
  },
  'zmdb (aot)': {
    assertLoose: n => {
      for (let i = 0; i < n; i += 1) keep(aotIs(POOL[i & POOL_MASK]));
    },
    assertStrict: n => {
      for (let i = 0; i < n; i += 1) keep(aotEquals(POOL[i & POOL_MASK]));
    },
    parseSafe: n => {
      for (let i = 0; i < n; i += 1) keepRef(aotParseSafe(POOL[i & POOL_MASK]));
    },
    parseStrict: n => {
      for (let i = 0; i < n; i += 1) keepRef(aotParseStrict(POOL[i & POOL_MASK]));
    },
  },
  'zmdb (runtime)': {
    assertLoose: n => {
      for (let i = 0; i < n; i += 1) keep(is(POOL[i & POOL_MASK], MOLTAR));
    },
    assertStrict: n => {
      for (let i = 0; i < n; i += 1) keep(equals(POOL[i & POOL_MASK], MOLTAR));
    },
    // parse variants: zmdb validates then returns; model with is()+return.
    parseSafe: n => {
      for (let i = 0; i < n; i += 1) {
        const d = POOL[i & POOL_MASK];
        keepRef(is(d, MOLTAR) ? d : null);
      }
    },
    parseStrict: n => {
      for (let i = 0; i < n; i += 1) {
        const d = POOL[i & POOL_MASK];
        keepRef(equals(d, MOLTAR) ? d : null);
      }
    },
  },
};

const cases: CaseKind[] = ['parseSafe', 'parseStrict', 'assertLoose', 'assertStrict'];

// --- equal work, checked before anything is timed --------------------------
// A speed comparison between checkers that do not agree is not a comparison. This
// used to be a claim in RESULTS.md — "all four strict checkers were verified to
// agree" — established once, by hand, and then left behind by every subsequent
// change to what the strict checkers are. It runs now, every time, and refuses to
// print a table if it fails.
//
// NaN is in the set because all six reject it — zmdb guards `!Number.isNaN`,
// typebox `Number.isFinite`, and zod, valibot and ajv all decline it as a
// `number`. That matters for reading the table: the per-field NaN guard zmdb emits
// is not extra work it does and nobody else does.
const strictCheck: Record<string, (v: unknown) => boolean> = {
  zod: v => zodStrict.safeParse(v).success,
  typebox: v => tbStrict.Check(v),
  ajv: v => ajvStrict(v) === true,
  valibot: v => vIs(vStrict, v),
  'zmdb (aot)': v => aotEquals(v),
  'zmdb (runtime)': v => equals(v, MOLTAR),
};
const looseCheck: Record<string, (v: unknown) => boolean> = {
  zod: v => zodLoose.safeParse(v).success,
  typebox: v => tbLoose.Check(v),
  ajv: v => ajvLoose(v) === true,
  valibot: v => vIs(vLoose, v),
  'zmdb (aot)': v => aotIs(v),
  'zmdb (runtime)': v => is(v, MOLTAR),
};

const good = POOL[0] as Moltar;
const probes: { name: string; value: unknown; strict: boolean; loose: boolean }[] = [
  { name: 'accept', value: good, strict: true, loose: true },
  { name: 'top-level excess key', value: { ...good, extra: 1 }, strict: false, loose: true },
  {
    name: 'nested excess key',
    value: { ...good, deeplyNested: { ...good.deeplyNested, extra: 1 } },
    strict: false,
    loose: true,
  },
  { name: 'wrong type', value: { ...good, number: 'not a number' }, strict: false, loose: false },
  { name: 'empty object', value: {}, strict: false, loose: false },
  { name: 'NaN as number', value: { ...good, number: Number.NaN }, strict: false, loose: false },
];

const disagreements: string[] = [];
for (const probe of probes) {
  for (const [lib, check] of Object.entries(strictCheck)) {
    const got = check(probe.value);
    if (got !== probe.strict) disagreements.push(`${lib} strict on "${probe.name}": got ${String(got)}`);
  }
  for (const [lib, check] of Object.entries(looseCheck)) {
    const got = check(probe.value);
    if (got !== probe.loose) disagreements.push(`${lib} loose on "${probe.name}": got ${String(got)}`);
  }
}
if (disagreements.length > 0) {
  console.error('the checkers under test do not agree, so their speeds are not comparable:');
  for (const line of disagreements) console.error(`  ${line}`);
  process.exit(1);
}
console.log(
  `equal work: ${String(probes.length)} probes, all ${String(Object.keys(strictCheck).length)} libraries agree`,
);

const median = (xs: number[]): number => {
  const sorted = xs.toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
};

// Warm every implementation before any of it is timed, so no library pays for
// another library's JIT tiering.
for (const byCase of Object.values(impls)) {
  for (const fn of Object.values(byCase)) fn(BATCH * 20);
}

for (const kind of cases) {
  // ops/s per library across REPEATS full passes. The whole suite is re-run
  // rather than each library in turn, so thermal or scheduler drift lands on
  // every library roughly equally instead of penalising whoever ran last.
  const samples = new Map<string, number[]>();
  for (let rep = 0; rep < REPEATS; rep += 1) {
    const bench = new Bench({ time: 400 });
    for (const [lib, byCase] of Object.entries(impls)) {
      const fn = byCase[kind];
      if (fn) bench.add(lib, () => fn(BATCH));
    }
    await bench.run();
    for (const task of bench.tasks) {
      // tinybench timed BATCH validations per call, so hz is batches/s.
      const opsPerSecond = (task.result?.hz ?? 0) * BATCH;
      const bucket = samples.get(task.name);
      if (bucket) bucket.push(opsPerSecond);
      else samples.set(task.name, [opsPerSecond]);
    }
  }

  const rows = [...samples.entries()]
    .map(([name, xs]) => ({ name, hz: median(xs), spread: Math.max(...xs) / Math.min(...xs) }))
    .toSorted((a, b) => b.hz - a.hz);
  console.log(`\n### ${kind}  (median of ${String(REPEATS)}, ${BATCH.toLocaleString()} per timed call)`);
  for (const r of rows) {
    const hz = Math.round(r.hz).toLocaleString().padStart(14);
    console.log(`  ${r.name.padEnd(16)} ${hz} ops/s   (spread ${r.spread.toFixed(2)}x)`);
  }
  const notRun = Object.keys(impls).filter(lib => !impls[lib]?.[kind]);
  if (notRun.length) console.log(`  (n/a for this case: ${notRun.join(', ')})`);
}

console.log('\nnote: zod has no allocation-free assert (no `is`), so its assertLoose/assertStrict');
console.log('      rows necessarily include the cost of building the parsed output.');
console.log(`\nresults observed: sink=${String(sink)}, sinkRef kept=${String(sinkRef !== undefined)}`);
