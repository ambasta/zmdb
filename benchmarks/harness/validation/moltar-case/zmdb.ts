import { addCase } from '../benchmarks';
import { is, equals, validate, type TypeDescriptor } from './zmdb/utilities';

// zmdb runtime validator. NOTE: zmdb's AOT transformer is not wired as a build
// plugin, so this benchmarks the RUNTIME path (descriptor-driven), not the
// inlined AOT output. Labelled honestly in RESULTS.md.
//
// Descriptor mirrors the suite's fixed data model.
const desc: TypeDescriptor = {
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
      fields: {
        foo: { kind: 'string' },
        num: { kind: 'number' },
        bool: { kind: 'boolean' },
      },
    },
  },
};

addCase('zmdb', 'parseSafe', data => {
  const r = validate(data, desc);
  if (!r.success) throw new Error('wrong type.');
  return r.data;
});

addCase('zmdb', 'parseStrict', data => {
  if (!equals(data, desc)) throw new Error('wrong type.');
  return data;
});

addCase('zmdb', 'assertLoose', data => {
  if (!is(data, desc)) throw new Error('wrong type.');
  return true;
});

addCase('zmdb', 'assertStrict', data => {
  if (!equals(data, desc)) throw new Error('wrong type.');
  return true;
});
