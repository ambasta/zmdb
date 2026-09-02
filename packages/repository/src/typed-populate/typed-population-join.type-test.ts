// Type-level tests for typed population and join derivation.
// No runtime code: this file is a *compilation* gate run by `yarn typecheck`.
import type { Entity, Equal, Expect, Mutual } from '@zmdb/schema-core';

import { BaseRepository, type defineRepository } from '../index.ts';
import { OrderSchema, UserSchema, userJoinRelations, type ProfileSchema } from './fixtures.ts';

type User = Entity<typeof UserSchema>;
type Order = Entity<typeof OrderSchema>;
type Profile = Entity<typeof ProfileSchema>;

class UserRepository extends BaseRepository<typeof UserSchema, typeof userJoinRelations> {
  static override readonly schema = UserSchema;
  static readonly relations = userJoinRelations;
}

class PlainUserRepository extends BaseRepository<typeof UserSchema> {
  static override readonly schema = UserSchema;
}

declare const repo: UserRepository;
declare const plainRepo: PlainUserRepository;
declare const txRepo: UserRepository;

// --- Invalid relation keys rejected at compile time ------------------------
// @ts-expect-error - invalid relation key 'invalid' is rejected at compile time
export const _err1 = repo.findById(1, { populate: ['invalid'] });
// @ts-expect-error - invalid relation key 'invalid' is rejected at compile time
export const _err2 = repo.find({ name: 'Ada' }, { populate: ['invalid'] });
// @ts-expect-error - invalid relation key 'invalid' is rejected at compile time
export const _err3 = repo.findOne({ name: 'Ada' }, { populate: ['invalid'] });
// @ts-expect-error - invalid relation key 'invalid' is rejected at compile time
export const _err4 = repo.findAll({ populate: ['invalid'] });
// @ts-expect-error - invalid relation key 'invalid' is rejected at compile time
export const _err5 = repo.list(undefined, { populate: ['invalid'] });
// @ts-expect-error - invalid relation key 'invalid' is rejected at compile time
export const _err6 = repo.findAllWithMany('invalid');
// @ts-expect-error - invalid relation key 'invalid' is rejected at compile time
export const _err7 = txRepo.findById(1, { populate: ['invalid'] });

// --- Populated to-many and to-one relation return types ---------------------
export const _pOrders = repo.findById(1, { populate: ['orders'] });
declare const userWithOrders: NonNullable<Awaited<typeof _pOrders>>;
export type _PopOrders = Expect<Equal<(typeof userWithOrders)['orders'], readonly Order[]>>;

export const _pProfile = repo.findById(1, { populate: ['profile'] });
declare const userWithProfile: NonNullable<Awaited<typeof _pProfile>>;
export type _PopProfile = Expect<Equal<(typeof userWithProfile)['profile'], Profile | null>>;

export const _pBoth = repo.findById(1, { populate: ['orders', 'profile'] });
declare const userWithBoth: NonNullable<Awaited<typeof _pBoth>>;
export type _PopBothOrders = Expect<Equal<(typeof userWithBoth)['orders'], readonly Order[]>>;
export type _PopBothProfile = Expect<Equal<(typeof userWithBoth)['profile'], Profile | null>>;

// --- Batch relation loading return type -----------------------------------
export const _pBatch = repo.findAllWithMany('orders');
declare const usersWithOrders: Awaited<typeof _pBatch>;
export type _BatchOrders = Expect<Equal<(typeof usersWithOrders)[number]['orders'], readonly Order[]>>;

// --- Join derivation return types -----------------------------------------
// `Mutual` on the column assertions: the fixtures are tagged, so a joined `name` is
// `string & Sql<'text'>`. The claim is about which columns the join produced and
// whether the right side went optional, not about tag spelling.
export const _pInner = repo.findJoined({
  target: OrderSchema,
  leftCol: 'users.id',
  rightCol: 'orders.userId',
  kind: 'inner',
});
declare const innerJoined: Awaited<typeof _pInner>;
export type _InnerName = Expect<Mutual<(typeof innerJoined)[number]['name'], string>>;
export type _InnerTotal = Expect<Mutual<(typeof innerJoined)[number]['total'], number>>;

export const _pLeft = repo.findJoined({
  target: OrderSchema,
  leftCol: 'users.id',
  rightCol: 'orders.userId',
  kind: 'left',
});
declare const leftJoined: Awaited<typeof _pLeft>;
export type _LeftName = Expect<Mutual<(typeof leftJoined)[number]['name'], string>>;
export type _LeftTotal = Expect<Mutual<(typeof leftJoined)[number]['total'], number | undefined>>;

// --- defineRepository factory ---------------------------------------------
declare const definedRepo: ReturnType<typeof defineRepository<typeof UserSchema, typeof userJoinRelations>>;
export const _pDefined = definedRepo.findById(1, { populate: ['orders'] });
declare const definedUserWithOrders: NonNullable<Awaited<typeof _pDefined>>;
export type _DefinedPopOrders = Expect<Equal<(typeof definedUserWithOrders)['orders'], readonly Order[]>>;

// --- Subclasses without defined static relations --------------------------
export const _pPlainUser = plainRepo.findById(1);
declare const plainUser: Awaited<typeof _pPlainUser>;
export type _PlainUser = Expect<Equal<typeof plainUser, User | undefined>>;

export const _pPlainAll = plainRepo.findAll();
declare const plainAll: Awaited<typeof _pPlainAll>;
export type _PlainAll = Expect<Equal<typeof plainAll, readonly User[]>>;

// --- Transaction helpers preserve relation declarations -------------------
export const _pTxUserWithOrders = txRepo.findById(1, { populate: ['orders'] });
declare const txUserWithOrders: NonNullable<Awaited<typeof _pTxUserWithOrders>>;
export type _TxPopOrders = Expect<Equal<(typeof txUserWithOrders)['orders'], readonly Order[]>>;
