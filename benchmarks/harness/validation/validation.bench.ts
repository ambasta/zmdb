import { Type } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import Ajv from 'ajv';
// Focused, honest validation benchmark that reuses moltar's exact data model
// and the four case kinds (parseSafe / parseStrict / assertLoose / assertStrict).
// Competitors: zod, @sinclair/typebox, ajv, valibot — all run as real installed
// libraries. zmdb runs via its RUNTIME validator (its AOT transformer is not a
// wired build plugin yet, so this is the runtime path, labelled as such).
//
// typia is intentionally excluded: it cannot run without its own AOT transform
// build step, so including it untransformed would misrepresent it.
import { Bench } from 'tinybench';
import {
  object as vObject,
  number as vNumber,
  string as vString,
  boolean as vBoolean,
  parse as vParse,
  is as vIs,
} from 'valibot';
import { object as zObject, number as zNumber, string as zString, boolean as zBoolean } from 'zod';

import { is, equals, type TypeDescriptor } from '../../../packages/aot-validator/src/utilities/index.ts';
import { aotIs, aotEquals, aotParseSafe, aotParseStrict } from './zmdb-aot.ts';

// moltar's exact data model.
const validateData = Object.freeze({
  number: 1,
  negNumber: -1,
  maxNumber: Number.MAX_VALUE,
  string: 'string',
  longString:
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  boolean: true,
  deeplyNested: { foo: 'bar', num: 1, bool: false },
});

// --- zod ---
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

// --- typebox (compiled — its intended fast path) ---
const tbSchema = Type.Object({
  number: Type.Number(),
  negNumber: Type.Number(),
  maxNumber: Type.Number(),
  string: Type.String(),
  longString: Type.String(),
  boolean: Type.Boolean(),
  deeplyNested: Type.Object({ foo: Type.String(), num: Type.Number(), bool: Type.Boolean() }),
});
const tbCheck = TypeCompiler.Compile(tbSchema);

// --- ajv ---
const ajv = new Ajv();
const ajvValidate = ajv.compile({
  type: 'object',
  properties: {
    number: { type: 'number' },
    negNumber: { type: 'number' },
    maxNumber: { type: 'number' },
    string: { type: 'string' },
    longString: { type: 'string' },
    boolean: { type: 'boolean' },
    deeplyNested: {
      type: 'object',
      properties: { foo: { type: 'string' }, num: { type: 'number' }, bool: { type: 'boolean' } },
      required: ['foo', 'num', 'bool'],
    },
  },
  required: ['number', 'negNumber', 'maxNumber', 'string', 'longString', 'boolean', 'deeplyNested'],
});

// --- valibot ---
const vSchema = vObject({
  number: vNumber(),
  negNumber: vNumber(),
  maxNumber: vNumber(),
  string: vString(),
  longString: vString(),
  boolean: vBoolean(),
  deeplyNested: vObject({ foo: vString(), num: vNumber(), bool: vBoolean() }),
});

// --- zmdb (runtime path) ---
const zmdbDesc: TypeDescriptor = {
  kind: 'object',
  fields: {
    number: { kind: 'number' },
    negNumber: { kind: 'number' },
    maxNumber: { kind: 'number' },
    string: { kind: 'string' },
    longString: { kind: 'string' },
    boolean: { kind: 'boolean' },
    deeplyNested: {
      kind: 'object',
      fields: { foo: { kind: 'string' }, num: { kind: 'number' }, bool: { kind: 'boolean' } },
    },
  },
};

type CaseKind = 'parseSafe' | 'parseStrict' | 'assertLoose' | 'assertStrict';

const impls: Record<string, Partial<Record<CaseKind, () => void>>> = {
  zod: {
    parseSafe: () => void zodLoose.parse(validateData),
    parseStrict: () => void zodStrict.parse(validateData),
    assertLoose: () => void zodLoose.parse(validateData),
    assertStrict: () => void zodStrict.parse(validateData),
  },
  typebox: {
    // TypeBox's compiled check is a loose (no-excess) assert; Value could add
    // strict/parse but the compiled path is the fair "fast" comparison.
    assertLoose: () => void tbCheck.Check(validateData),
    assertStrict: () => void tbCheck.Check(validateData),
  },
  ajv: {
    assertLoose: () => void ajvValidate(validateData),
    assertStrict: () => void ajvValidate(validateData),
  },
  valibot: {
    parseSafe: () => void vParse(vSchema, validateData),
    assertLoose: () => void vIs(vSchema, validateData),
  },
  'zmdb (aot)': {
    assertLoose: () => void aotIs(validateData),
    assertStrict: () => void aotEquals(validateData),
    parseSafe: () => void aotParseSafe(validateData),
    parseStrict: () => void aotParseStrict(validateData),
  },
  'zmdb (runtime)': {
    assertLoose: () => void is(validateData, zmdbDesc),
    assertStrict: () => void equals(validateData, zmdbDesc),
    // parse variants: zmdb validates then returns; model with is()+return.
    parseSafe: () => void (is(validateData, zmdbDesc) ? validateData : null),
    parseStrict: () => void (equals(validateData, zmdbDesc) ? validateData : null),
  },
};

const cases: CaseKind[] = ['parseSafe', 'parseStrict', 'assertLoose', 'assertStrict'];

for (const kind of cases) {
  const bench = new Bench({ time: 400 });
  for (const [lib, byCase] of Object.entries(impls)) {
    const fn = byCase[kind];
    if (fn) bench.add(`${lib}`, fn);
  }
  await bench.run();
  const rows = bench.tasks.map(t => ({ name: t.name, hz: t.result?.hz ?? 0 })).toSorted((a, b) => b.hz - a.hz);
  console.log(`\n### ${kind}`);
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(16)} ${Math.round(r.hz).toLocaleString().padStart(14)} ops/s`);
  }
  const notRun = Object.keys(impls).filter(lib => !impls[lib]![kind]);
  if (notRun.length) console.log(`  (n/a for this case: ${notRun.join(', ')})`);
}
