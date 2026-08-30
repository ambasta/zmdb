// AOT-inlined validators for the moltar data model, written EXACTLY as zmdb's
// transformer WOULD emit for is<T>/equals<T> — monomorphic, allocation-free,
// straight-line, early-exit. The transformer is not yet wired as a build plugin
// (see epic), so these are hand-inlined to measure the AOT path honestly and
// separately from the runtime (TypeDescriptor-walking) path.
//
// Shape T = { number, negNumber, maxNumber, string, longString, boolean,
//             deeplyNested: { foo, num, bool } }

type Rec = Record<string, unknown>;

// assertLoose / is<T>: type-correct, allow excess keys.
export function aotIs(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const d = input as Rec;
  if (typeof d.deeplyNested !== 'object' || d.deeplyNested === null) return false;
  const n = d.deeplyNested as Rec;
  return (
    typeof d.number === 'number' &&
    typeof d.negNumber === 'number' &&
    typeof d.maxNumber === 'number' &&
    typeof d.string === 'string' &&
    typeof d.longString === 'string' &&
    typeof d.boolean === 'boolean' &&
    typeof n.foo === 'string' &&
    typeof n.num === 'number' &&
    typeof n.bool === 'boolean'
  );
}

const TOP = new Set(['number', 'negNumber', 'maxNumber', 'string', 'longString', 'boolean', 'deeplyNested']);
const NESTED = new Set(['foo', 'num', 'bool']);

// assertStrict / equals<T>: is<T> + no excess keys (nested strict).
export function aotEquals(input: unknown): boolean {
  if (!aotIs(input)) return false;
  const d = input as Rec;
  // strict: exactly the expected keys, top-level and nested.
  const kt = Object.keys(d);
  if (kt.length !== 7) return false;
  for (let i = 0; i < kt.length; i++) if (!TOP.has(kt[i]!)) return false;
  const kn = Object.keys(d.deeplyNested as Rec);
  if (kn.length !== 3) return false;
  for (let i = 0; i < kn.length; i++) if (!NESTED.has(kn[i]!)) return false;
  return true;
}

// parseSafe: validate (loose) then return the value stripped to known keys.
export function aotParseSafe(input: unknown): Rec {
  if (!aotIs(input)) throw new Error('wrong type.');
  const d = input as Rec;
  const n = d.deeplyNested as Rec;
  return {
    number: d.number,
    negNumber: d.negNumber,
    maxNumber: d.maxNumber,
    string: d.string,
    longString: d.longString,
    boolean: d.boolean,
    deeplyNested: { foo: n.foo, num: n.num, bool: n.bool },
  };
}

// parseStrict: strict-validate then return.
export function aotParseStrict(input: unknown): unknown {
  if (!aotEquals(input)) throw new Error('wrong type.');
  return input;
}
