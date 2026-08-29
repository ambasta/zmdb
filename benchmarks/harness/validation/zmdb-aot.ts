// AOT-inlined validators for the moltar data model, written EXACTLY as zmdb's
// transformer WOULD emit for is<T>/equals<T> — monomorphic, allocation-free,
// straight-line, early-exit. The transformer is not yet wired as a build plugin
// (see epic), so these are hand-inlined to measure the AOT path honestly and
// separately from the runtime (TypeDescriptor-walking) path.
//
// Shape T = { number, negNumber, maxNumber, string, longString, boolean,
//             deeplyNested: { foo, num, bool } }

// assertLoose / is<T>: type-correct, allow excess keys.
export function aotIs(d: any): boolean {
  return (
    typeof d === 'object' && d !== null &&
    typeof d.number === 'number' &&
    typeof d.negNumber === 'number' &&
    typeof d.maxNumber === 'number' &&
    typeof d.string === 'string' &&
    typeof d.longString === 'string' &&
    typeof d.boolean === 'boolean' &&
    typeof d.deeplyNested === 'object' && d.deeplyNested !== null &&
    typeof d.deeplyNested.foo === 'string' &&
    typeof d.deeplyNested.num === 'number' &&
    typeof d.deeplyNested.bool === 'boolean'
  );
}

const TOP = ['number', 'negNumber', 'maxNumber', 'string', 'longString', 'boolean', 'deeplyNested'];
const NESTED = ['foo', 'num', 'bool'];

// assertStrict / equals<T>: is<T> + no excess keys (nested strict).
export function aotEquals(d: any): boolean {
  if (!aotIs(d)) return false;
  // strict: exactly the expected keys, top-level and nested.
  const kt = Object.keys(d);
  if (kt.length !== 7) return false;
  for (let i = 0; i < kt.length; i++) if (!TOP.includes(kt[i]!)) return false;
  const kn = Object.keys(d.deeplyNested);
  if (kn.length !== 3) return false;
  for (let i = 0; i < kn.length; i++) if (!NESTED.includes(kn[i]!)) return false;
  return true;
}

// parseSafe: validate (loose) then return the value stripped to known keys.
export function aotParseSafe(d: any): any {
  if (!aotIs(d)) throw new Error('wrong type.');
  return {
    number: d.number, negNumber: d.negNumber, maxNumber: d.maxNumber,
    string: d.string, longString: d.longString, boolean: d.boolean,
    deeplyNested: { foo: d.deeplyNested.foo, num: d.deeplyNested.num, bool: d.deeplyNested.bool },
  };
}

// parseStrict: strict-validate then return.
export function aotParseStrict(d: any): any {
  if (!aotEquals(d)) throw new Error('wrong type.');
  return d;
}
