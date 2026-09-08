import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveSources } from './runtime.mjs';

const evidence = resolve(process.argv[2]);
const requirePeer = await resolveSources(evidence);
const generated = join(evidence, 'generated');
const [{ Compile }, zmdb, typia, { stringify: zmdbStringify }] = await Promise.all([
  import(pathToFileURL(requirePeer.resolve('typebox/compile')).href),
  import(pathToFileURL(join(generated, 'zmdb.mjs')).href),
  import(pathToFileURL(join(generated, 'typia/typia-source.js')).href),
  import('@zmdb/validator/serialization'),
]);
const Ajv = requirePeer('ajv');
const fastJsonStringify = requirePeer('fast-json-stringify');
const schema = JSON.parse(readFileSync(join(generated, 'schema.json'), 'utf8'));
const strictSchema = structuredClone(schema);
strictSchema.additionalProperties = false;
strictSchema.properties.deeplyNested.additionalProperties = false;
const compiled = { loose: Compile(schema), strict: Compile(strictSchema) };
assert.equal(compiled.loose.IsAccelerated(), true);
assert.equal(compiled.strict.IsAccelerated(), true);
const ajv = new Ajv({
  strict: true,
  allErrors: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
const validators = {
  'zmdb-aot': { loose: zmdb.loose, strict: zmdb.strict },
  'typia-aot': { loose: typia.loose, strict: typia.strict },
  'typebox-compiled': {
    loose: compiled.loose.Check.bind(compiled.loose),
    strict: compiled.strict.Check.bind(compiled.strict),
  },
  'ajv-compiled': { loose: ajv.compile(schema), strict: ajv.compile(strictSchema) },
};
const serializers = {
  'zmdb-runtime-stringify': zmdbStringify,
  'typia-aot-stringify': typia.stringify,
  'fast-json-stringify': fastJsonStringify(schema),
  'native-json-stringify': JSON.stringify,
};
const ablations = process.argv.includes('--ablations');
if (ablations) {
  validators['zmdb-no-nan-prototype'] = await import(pathToFileURL(join(evidence, 'ablations/no-nan.mjs')).href);
  serializers['zmdb-no-replacer-prototype'] = (
    await import(pathToFileURL(join(evidence, 'ablations/no-replacer.mjs')).href)
  ).stringify;
}
writeFileSync(join(generated, 'typebox-code.txt'), compiled.loose.Code());
writeFileSync(join(generated, 'ajv-code.txt'), validators['ajv-compiled'].loose.toString());

const poolSize = 32;
function row(seed, escaped = false) {
  return {
    number: seed + 0.25,
    negNumber: -seed - 0.5,
    maxNumber: 999999 - seed,
    string: escaped ? `row-${seed}\\"\n\t` : `row-${seed}`,
    longString: `${escaped ? `λ雪\\"\n` : 'plain-text-'}${'x'.repeat(32 + seed)}`,
    boolean: seed % 2 === 0,
    deeplyNested: { foo: `child-${seed}`, num: seed * 3.25, bool: seed % 3 === 0 },
  };
}
const valid = Array.from({ length: poolSize }, (_, i) => row(i));
const escaped = Array.from({ length: poolSize }, (_, i) => row(i, true));
const invalid = valid.map(value => ({ ...value, deeplyNested: { ...value.deeplyNested, bool: 'invalid' } }));
const excess = valid.map(value => ({ ...value, deeplyNested: { ...value.deeplyNested, extra: true } }));
const semanticChecks = [];
const probe = valid[0];
for (const [name, functions] of Object.entries(validators)) {
  for (const [mode, validate] of Object.entries(functions)) {
    const inputs = [
      ['valid', probe, true],
      ['late-invalid', invalid[0], false],
      ['root-excess', { ...probe, extra: true }, mode === 'loose'],
      ['nested-excess', excess[0], mode === 'loose'],
      ['NaN', { ...probe, number: NaN }, false],
      ['Infinity', { ...probe, number: Infinity }, false],
      ['negative-Infinity', { ...probe, number: -Infinity }, false],
      ['below-min', { ...probe, number: -1000001 }, false],
      ['above-max', { ...probe, number: 1000001 }, false],
      ['min', { ...probe, number: -1000000 }, true],
      ['max', { ...probe, number: 1000000 }, true],
      ['numeric-string', { ...probe, number: '3' }, false],
      ['missing-key', { ...probe, string: undefined }, false],
      ['null', null, false],
      ['array', [], false],
    ];
    for (const [label, value, expected] of inputs) {
      const before = structuredClone(value);
      assert.equal(validate(value), expected, `${name}/${mode}/${label}`);
      assert.deepEqual(value, before, `${name}/${mode} mutated input`);
    }
    semanticChecks.push({ name, mode, probes: inputs.length, passed: true });
  }
}
for (const [name, serialize] of Object.entries(serializers)) {
  for (const value of [...valid, ...escaped]) assert.equal(serialize(value), JSON.stringify(value), name);
  semanticChecks.push({ name, cases: poolSize * 2, byteEqual: true });
}

const cases = [];
for (const [peer, functions] of Object.entries(validators)) {
  for (const [kind, values, mode] of [
    ['loose-valid', valid, 'loose'],
    ['loose-late-invalid', invalid, 'loose'],
    ['strict-valid', valid, 'strict'],
    ['strict-excess-invalid', excess, 'strict'],
  ])
    cases.push({ id: `${kind}/${peer}`, values, fn: functions[mode], type: 'boolean' });
}
for (const [peer, fn] of Object.entries(serializers)) {
  cases.push({ id: `serialize-plain/${peer}`, values: valid, fn, type: 'string' });
  cases.push({ id: `serialize-escaped/${peer}`, values: escaped, fn, type: 'string' });
}
let sink = 0;
const retained = Array(32);
for (const entry of cases) {
  let cursor = 0;
  entry.run = count => {
    let checksum = 0;
    for (let i = 0; i < count; i++) {
      const index = cursor++ & (poolSize - 1);
      const output = entry.fn(entry.values[index]);
      if (entry.type === 'boolean') checksum += output ? 1 : 2;
      else {
        retained[index] = output;
        checksum += output.length + output.charCodeAt((index * 17) % output.length);
      }
    }
    sink = (sink + checksum) >>> 0;
    return checksum;
  };
  entry.expected = entry.run(poolSize);
  assert.equal(entry.run(poolSize), entry.expected);
}
const selectedPattern = process.argv.find(value => value.startsWith('--case='))?.slice(7);
const selected = cases.filter(entry => selectedPattern === undefined || entry.id.includes(selectedPattern));
assert.ok(selected.length > 0);
const measuring = process.argv.includes('--measure');
const targetMs = Number(process.argv.find(value => value.startsWith('--sample-ms='))?.slice(12) ?? 120);
const rounds = Number(process.argv.find(value => value.startsWith('--rounds='))?.slice(9) ?? 5);
assert.ok(Number.isFinite(targetMs) && targetMs > 0);
assert.ok(Number.isInteger(rounds) && rounds > 0);
const batch = 8192;
const samples = [];
function timed(entry, milliseconds) {
  const started = performance.now();
  let iterations = 0;
  let elapsed = 0;
  do {
    assert.equal(entry.run(batch), entry.expected * (batch / poolSize));
    iterations += batch;
    elapsed = performance.now() - started;
  } while (elapsed < milliseconds);
  return { iterations, elapsedMs: elapsed, nsPerOp: (elapsed * 1e6) / iterations };
}
if (measuring) {
  for (const entry of selected) timed(entry, 150);
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 === 0 ? selected : selected.toReversed();
    for (const entry of order) samples.push({ round, id: entry.id, ...timed(entry, targetMs) });
  }
}
const summary = selected.map(entry => {
  const values = samples
    .filter(sample => sample.id === entry.id)
    .map(sample => sample.nsPerOp)
    .toSorted((a, b) => a - b);
  return {
    id: entry.id,
    medianNsPerOp: values[Math.floor(values.length / 2)],
    minNsPerOp: values[0],
    maxNsPerOp: values.at(-1),
  };
});
const output = {
  mode: measuring ? 'measurement' : 'untimed-semantic-smoke',
  command: [process.execPath, ...process.argv.slice(1)],
  prepared: JSON.parse(readFileSync(join(evidence, 'prepared.json'), 'utf8')),
  semantics: {
    shape: 'seven required root fields, three required nested fields; all four numbers bounded inclusively ±1000000',
    booleans:
      'non-mutating boolean checks, no coercion/defaults/copy; loose permits extras, strict rejects root and nested extras; own plain enumerable JSON objects only',
    errorCost: 'Ajv boolean calls also maintain their normal first-error field; no detailed-error or throwing rankings',
    serialization:
      'valid exact-shape finite plain JSON only; byte-equal property order and escapes; no validation/copy/getters/toJSON/excess-key or invalid-input equivalence claim',
    formats: 'no string format constraint',
    sink: 'rotating 32 input objects; every result contributes to checked checksum; serialized strings escape into retained ring',
  },
  ablations: ablations ? JSON.parse(readFileSync(join(evidence, 'ablations/provenance.json'), 'utf8')) : undefined,
  semanticChecks,
  samples,
  summary,
  sink,
  retainedBytes: retained.reduce((sum, value) => sum + (value?.length ?? 0), 0),
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
