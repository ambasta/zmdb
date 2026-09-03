// `ResolvedRelation`, as a type. Tests freeze for the epic "Composite primary keys and expression
// indexes" (#407 / spec freeze #408); the frozen text is `./SPEC.md` §2.1.
//
// The type-level half of `composite-parent-key.spec.ts`. `node scripts/typecheck.mjs` compiles
// this file, so a frozen claim written plainly is a build failure rather than a red test;
// `@ts-expect-error` over the claim is the `it.fails` of the type level, and it reports TS2578 the
// day the claim comes true. See `@zmdb/query-compiler`'s
// `src/migrations/composite-keys.type-test.ts` for the placement rule and for the one thing this
// idiom cannot express.
import type { Equal, Expect } from '../index.js';
import type { ResolvedRelation } from './index.js';

// Both sides widen, and to the same type — §2.1 pairs them positionally, so a shape that let one
// be a list and the other a scalar would make "the lengths must match" unsayable.
//
// @ts-expect-error frozen (SPEC.md 2.1): `parentKey` is the whole key, so it is a list.
export type _ParentKeyIsAList = Expect<Equal<ResolvedRelation['parentKey'], readonly string[]>>;

// @ts-expect-error frozen (SPEC.md 2.1): `targetKey` is positionally paired with it, so it matches.
export type _TargetKeyIsAList = Expect<Equal<ResolvedRelation['targetKey'], readonly string[]>>;

// `readonly string[]`, not a tuple and not a set. A tuple would put the arity in the type, which
// is not knowable from a `SchemaIR` the resolver reads at runtime; a set would lose the ordering
// that positional pairing is entirely made of.
//
// Written with no directive on purpose, and it is not an oversight: `string[number]` is `string`,
// because a `string` is itself indexable by a number. So this assertion holds both before and
// after the widening and pins the *element* type without saying anything about the container -
// which is exactly the assertion `_ParentKeyIsAList` above needs a partner for. Compiled to find
// this out; a directive here is TS2578 today.
export type _KeyElementsAreNames = Expect<Equal<ResolvedRelation['parentKey'][number], string>>;

// The other three fields do not move, and the shape gains nothing. Asserted green, and the
// `keyof` is the load-bearing half: §2.1's interface has exactly these five members, so a slice
// that widens the keys by adding, say, a `parentKeyArity` alongside the old scalar - which would
// let every existing reader keep compiling while quietly reading half a key - fails here.
export type _NameUnchanged = Expect<Equal<ResolvedRelation['name'], string>>;
export type _TargetTableUnchanged = Expect<Equal<ResolvedRelation['targetTable'], string>>;
export type _ToManyUnchanged = Expect<Equal<ResolvedRelation['toMany'], boolean>>;
export type _NoNewMembers = Expect<
  Equal<keyof ResolvedRelation, 'name' | 'targetTable' | 'parentKey' | 'targetKey' | 'toMany'>
>;
