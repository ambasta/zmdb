// Type-level tests for relation result typing (#32, #190, #193): PopulatedEntity
// and JoinRow. Compiled by `yarn typecheck`; see `../type-derivation.type-test.ts`
// for why these are not `expectTypeOf` calls inside a `.spec.ts`.
import type { Equal, Expect } from '../index.ts';
import type { attachPopulated, JoinRow, PopulatedEntity, RelationDef, RelationMeta } from './index.ts';

interface User {
  id: number;
  name: string;
}
interface Order {
  id: number;
  total: number;
}

// A relation map: users have many orders.
type UserRelations = {
  orders: { meta: RelationMeta; entity: Order; cardinality: 'one-to-many' };
  manager: { meta: RelationMeta; entity: User; cardinality: 'many-to-one' };
};

// --- PopulatedEntity -------------------------------------------------------
type Populated = PopulatedEntity<User, UserRelations, 'orders'>;
export type _Pop1 = Expect<Equal<Populated['orders'], Order[]>>;
// Base keys survive.
export type _Pop2 = Expect<Equal<Populated['id'], number>>;
// to-one is a single entity, not an array.
export type _Pop3 = Expect<Equal<PopulatedEntity<User, UserRelations, 'manager'>['manager'], User>>;
// Nothing is attached for relations that were not populated — the whole point of
// "no lazy getters": an unpopulated relation is absent from the type, so reading
// it is a compile error rather than `undefined` at runtime.
export type _Pop4 = Expect<Equal<keyof PopulatedEntity<User, UserRelations, never>, keyof User>>;

// A `RelationDef`-constrained map (interface with an index signature) works too.
interface IndexedRelations {
  orders: RelationDef & { cardinality: 'one-to-many'; entity: Order };
  [k: string]: RelationDef;
}
export type _Pop5 = Expect<Equal<PopulatedEntity<User, IndexedRelations, 'orders'>['orders'], Order[]>>;

// --- attachPopulated -------------------------------------------------------
// The runtime counterpart of `PopulatedEntity`: attaching under a literal key
// must widen the parent with exactly that key (not a `string` index signature).
// (A `type` alias, not the `User` interface above: `attachPopulated` constrains
// its parent to `Record<string, unknown>`, which only object *type* aliases
// satisfy — interfaces have no implicit index signature.)
type UserRow = { id: number; name: string };
export type _Attach1 = Expect<
  Equal<ReturnType<typeof attachPopulated<UserRow, 'orders', Order[]>>, UserRow & { orders: Order[] }>
>;

// --- JoinRow ---------------------------------------------------------------
// LEFT joins may not match, so joined columns are optional; INNER always match.
interface Emp {
  id: number;
  recipient_id: number;
}
interface Recipient {
  r_id: number;
  r_name: string;
}
export type _Join1 = Expect<Equal<JoinRow<Emp, Recipient, 'left'>['r_name'], string | undefined>>;
export type _Join2 = Expect<Equal<JoinRow<Emp, Recipient, 'inner'>['r_name'], string>>;
// `left` is the default.
export type _Join3 = Expect<Equal<JoinRow<Emp, Recipient>, JoinRow<Emp, Recipient, 'left'>>>;
