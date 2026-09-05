// `ResolvedRelation`, as a type. The runtime pairing is covered by
// `composite-parent-key.spec.ts`; this file pins the public shape.
import type { Equal, Expect } from '../index.js';
import type { ResolvedRelation } from './index.js';

// Both sides widen, and to the same type — §2.1 pairs them positionally, so a shape that let one
// be a list and the other a scalar would make "the lengths must match" unsayable.
//
export type _ParentKeyIsAList = Expect<Equal<ResolvedRelation['parentKey'], readonly string[]>>;

export type _TargetKeyIsAList = Expect<Equal<ResolvedRelation['targetKey'], readonly string[]>>;

// `readonly string[]`, not a tuple and not a set. A tuple would put the arity in the type, which
// is not knowable from a `SchemaIR` the resolver reads at runtime; a set would lose the ordering
// that positional pairing is entirely made of.
//
// The container assertions above pin the widening; this one independently pins the element type.
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
