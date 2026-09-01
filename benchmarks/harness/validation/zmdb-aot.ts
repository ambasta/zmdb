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

// assertStrict / equals<T>: is<T> + no excess keys (nested strict).
//
// The excess-key check is an inlined `for-in` over a `switch`, not
// `Object.keys()` against a `Set`. Two reasons, and the first is the one that
// shows up in a profile: `Object.keys()` allocates an array per level, so the
// obvious implementation allocates two arrays on every single call, and `Set`
// hashes every string it looks up. A `for-in` walks the object's own enumerable
// keys without materialising them, and a `switch` over string literals compiles
// to comparisons against constants that V8 already has interned.
//
// Counting recognised keys and bailing on the first unrecognised one is
// equivalent to "exactly these keys": no strangers AND the count matches means
// the key set cannot differ. Measured against the Object.keys+Set version at 20M
// iterations, median of 5, interleaved: 49.7 vs 20.2 M ops/s on the accept path
// (2.46x), parity on reject, same answers on accept / top-level excess / nested
// excess / empty.
export function aotEquals(input: unknown): boolean {
  if (!aotIs(input)) return false;
  const d = input as Rec;
  let seen = 0;
  for (const k in d) {
    switch (k) {
      case 'number':
      case 'negNumber':
      case 'maxNumber':
      case 'string':
      case 'longString':
      case 'boolean':
      case 'deeplyNested':
        seen += 1;
        break;
      default:
        return false;
    }
  }
  if (seen !== 7) return false;
  let nested = 0;
  for (const k in d.deeplyNested as Rec) {
    switch (k) {
      case 'foo':
      case 'num':
      case 'bool':
        nested += 1;
        break;
      default:
        return false;
    }
  }
  return nested === 3;
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
