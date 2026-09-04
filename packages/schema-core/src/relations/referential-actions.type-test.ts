// Public declaration surface for referential actions (#455), frozen by
// `./SPEC.md` §1.1.

import type { Equal, Expect } from '../index.js';
import type { ColumnIR } from '../ir/index.js';
import type { ForeignKey, OnDelete, OnUpdate, ReferentialAction } from '../tags/index.js';

type FrozenReferentialAction = 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action';

type NormalizedTag<T> = {
  readonly keyIsSymbol: keyof T extends symbol ? true : false;
  readonly hasStringKey: Extract<keyof T, string> extends never ? false : true;
  readonly hasNumberKey: Extract<keyof T, number> extends never ? false : true;
  readonly optional: {} extends T ? true : false;
  readonly payload: Exclude<T[keyof T], undefined>;
};

interface FrozenActionTag {
  readonly keyIsSymbol: true;
  readonly hasStringKey: false;
  readonly hasNumberKey: false;
  readonly optional: true;
  readonly payload: FrozenReferentialAction;
}

type TagEnvelope<T> = Omit<NormalizedTag<T>, 'payload'>;
type FrozenTagEnvelope = Omit<FrozenActionTag, 'payload'>;

export type _ReferentialAction = Expect<Equal<ReferentialAction, FrozenReferentialAction>>;

// Instantiating with the complete union also pins the generic constraint: leaving
// one action out of either tag is a compile error when the export lands.
export type _OnDeleteShape = Expect<Equal<NormalizedTag<OnDelete<FrozenReferentialAction>>, FrozenActionTag>>;

export type _OnUpdateShape = Expect<Equal<NormalizedTag<OnUpdate<FrozenReferentialAction>>, FrozenActionTag>>;

// The composite declaration is a weak, symbol-keyed tag and accepts the exact
// three string arguments the frozen spelling shows. Its private payload is not
// frozen here: only the reflector consumes it, and the behavioral spec pins the
// resulting IR rather than an implementation detail.
type ImportedForeignKeyEnvelope = TagEnvelope<ForeignKey<'tenantId,userId', 'users', 'tenantId,id'>>;
export type _ForeignKeyIsAWeakTag = Expect<Equal<ImportedForeignKeyEnvelope, FrozenTagEnvelope>>;

// The action remains optional in ColumnIR; absence becomes NO ACTION in the
// migration snapshot, not an invented IR literal.
type DeleteOnColumnIR = ColumnIR['onDelete'];
export type _DeleteOnColumnIR = Expect<Equal<DeleteOnColumnIR, FrozenReferentialAction | undefined>>;

type UpdateOnColumnIR = ColumnIR['onUpdate'];
export type _UpdateOnColumnIR = Expect<Equal<UpdateOnColumnIR, FrozenReferentialAction | undefined>>;

// Green controls prove the normalization notices a forgeable string key and
// reads the payload rather than merely counting properties.
const localDelete: unique symbol = Symbol('local delete action');
type LocalOnDelete<Action extends FrozenReferentialAction> = { readonly [localDelete]?: Action };
type ForgedOnDelete<Action extends FrozenReferentialAction> = { readonly __onDelete?: Action };

export type _TechniqueReadsAction = Expect<
  Equal<NormalizedTag<LocalOnDelete<FrozenReferentialAction>>, FrozenActionTag>
>;
export type _TechniqueRejectsStringKey = Expect<Equal<NormalizedTag<ForgedOnDelete<'cascade'>>['hasStringKey'], true>>;
