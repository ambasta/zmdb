import type { DeclaredTable, TaggedSchema, UpdateDTO } from '@zmdb/schema';

export type StateTransitions<StateValues extends string | number | symbol = string> = {
  readonly [From in StateValues]?: readonly StateValues[];
};

export function defineStateTransitions<
  StateValues extends string,
  const T extends { readonly [From in StateValues]?: readonly StateValues[] },
>(transitions: T): T {
  return transitions;
}

export type AllowedTargetStates<Transitions, From extends string> = Transitions extends {
  readonly [k in From]?: readonly (infer To extends string)[];
}
  ? To
  : never;

export type StateUpdateDTO<
  T extends DeclaredTable,
  StateField extends string,
  FromState extends string,
  Transitions,
  AllowedFields extends keyof UpdateDTO<T> = keyof UpdateDTO<T>,
> = Pick<UpdateDTO<T>, Exclude<AllowedFields, StateField>> & {
  [P in StateField]?: AllowedTargetStates<Transitions, FromState>;
};

/** What a transition out of `From` is allowed to patch: the declared restriction if there is one, otherwise every updatable field. */
type PatchableFields<
  T extends DeclaredTable,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<T>)[] },
  From extends keyof Transitions & string,
> = FieldRestrictions[From] extends readonly (keyof UpdateDTO<T>)[]
  ? FieldRestrictions[From][number]
  : keyof UpdateDTO<T>;

/**
 * The `patch` argument of a transition out of `From`. When the only patchable
 * field is the state field itself there is nothing left to pass, so the argument
 * narrows to `Record<string, never>` and any property is a type error.
 */
type TransitionPatch<
  T extends DeclaredTable,
  StateField extends string,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<T>)[] },
  From extends keyof Transitions & string,
> = [Exclude<PatchableFields<T, Transitions, FieldRestrictions, From>, StateField>] extends [never]
  ? Record<string, never>
  : Omit<Pick<UpdateDTO<T>, PatchableFields<T, Transitions, FieldRestrictions, From>>, StateField>;

export interface EntityStateMachineOptions<
  T extends DeclaredTable,
  StateField extends string,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<T>)[] } = {},
> {
  /**
   * The generated schema value, for inference only — nothing reads it.
   *
   * It is the whole reason this machine knows what a patch may contain: `T` is the
   * declared type, recovered from the value's phantom, and `UpdateDTO<T>` is what the
   * transitions are checked against. Passing a schema for a different table is the one
   * mistake this cannot catch, and it is the same mistake as pointing a repository at
   * the wrong table.
   */
  schema?: TaggedSchema<T>;
  stateField: StateField;
  transitions: Transitions;
  allowedFields?: FieldRestrictions | undefined;
}

export interface EntityStateMachine<
  T extends DeclaredTable,
  StateField extends string,
  Transitions extends Record<string, readonly string[]>,
  FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<T>)[] } = {},
> {
  readonly stateField: StateField;
  readonly transitions: Transitions;
  readonly allowedFields?: FieldRestrictions | undefined;
  canTransition<From extends keyof Transitions & string>(from: From, to: string): boolean;
  createUpdatePayload<From extends keyof Transitions & string, To extends Transitions[From][number]>(
    from: From,
    to: To,
    patch?: TransitionPatch<T, StateField, Transitions, FieldRestrictions, From>,
  ): StateUpdateDTO<T, StateField, From, Transitions, PatchableFields<T, Transitions, FieldRestrictions, From>>;
}

export function createStateUpdatePayload<
  T extends DeclaredTable,
  StateField extends string,
  From extends keyof Transitions & string,
  const Transitions extends Record<string, readonly string[]>,
  AllowedFields extends keyof UpdateDTO<T> = keyof UpdateDTO<T>,
>(
  stateField: StateField,
  transitions: Transitions,
  from: From,
  to: Transitions[From][number],
  patch?: Omit<Pick<UpdateDTO<T>, AllowedFields>, StateField> | Record<string, never>,
): StateUpdateDTO<T, StateField, From, Transitions, AllowedFields> {
  const allowed = transitions[from];
  if (!Array.isArray(allowed) || !allowed.includes(to)) {
    throw new Error(`Invalid state transition from "${from}" to "${to}" for field "${stateField}"`);
  }
  const payload = {
    ...patch,
    [stateField]: to,
  };
  // boundary: return value is certified as StateUpdateDTO after runtime transition validation.
  return payload as StateUpdateDTO<T, StateField, From, Transitions, AllowedFields>;
}

export function defineEntityStateMachine<
  T extends DeclaredTable,
  StateField extends string,
  const Transitions extends Record<string, readonly string[]>,
  const FieldRestrictions extends { readonly [From in keyof Transitions]?: readonly (keyof UpdateDTO<T>)[] } = {},
>(
  options: EntityStateMachineOptions<T, StateField, Transitions, FieldRestrictions>,
): EntityStateMachine<T, StateField, Transitions, FieldRestrictions> {
  const { stateField, transitions, allowedFields } = options;

  return {
    stateField,
    transitions,
    allowedFields,
    canTransition(from: keyof Transitions & string, to: string): boolean {
      const allowed = transitions[from];
      return Array.isArray(allowed) && allowed.includes(to);
    },
    createUpdatePayload<From extends keyof Transitions & string, To extends Transitions[From][number]>(
      from: From,
      to: To,
      patch?: TransitionPatch<T, StateField, Transitions, FieldRestrictions, From>,
    ) {
      return createStateUpdatePayload<
        T,
        StateField,
        From,
        Transitions,
        PatchableFields<T, Transitions, FieldRestrictions, From>
      >(stateField, transitions, from, to, patch);
    },
  };
}
