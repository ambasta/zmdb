import { isRecord, type ColumnMeta, type DeclaredTable, type TaggedSchema, type UpdateDTO } from '@zmdb/schema';
import { ValidationError, type ValidationIssue } from '@zmdb/validator';
export { ValidationError };

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
  options?: {
    schema?: TaggedSchema<T> | unknown;
    allowedFields?: Record<string, readonly string[]>;
  },
): StateUpdateDTO<T, StateField, From, Transitions, AllowedFields> {
  const allowed = transitions[from];
  if (!Array.isArray(allowed) || !allowed.includes(to)) {
    throw new Error(`Invalid state transition from "${from}" to "${to}" for field "${stateField}"`);
  }

  const patchObj = (patch ?? {}) as Record<string, unknown>;

  if (options?.allowedFields && options.allowedFields[from]) {
    const allowedKeys = new Set(options.allowedFields[from]);
    for (const key of Object.keys(patchObj)) {
      if (key !== stateField && !allowedKeys.has(key)) {
        throw new Error(`Field "${key}" is not allowed to be updated during transition from "${from}"`);
      }
    }
  }

  const payload = {
    ...patchObj,
    [stateField]: to,
  };

  if (options?.schema && isRecord(options.schema)) {
    const schemaObj = options.schema as Record<string, unknown>;
    if (isRecord(schemaObj.columns)) {
      const columns = schemaObj.columns as Record<string, ColumnMeta>;
      const issues: ValidationIssue[] = [];

      for (const [key, val] of Object.entries(payload)) {
        const col = columns[key];
        if (!col) continue;

        if (!col.flags.nullable && (val === null || val === undefined)) {
          issues.push({
            path: `input.${key}`,
            message: `property "${key}" cannot be null or undefined`,
            expected: 'non-nullable value',
            value: val,
          });
        }

        if (col.validation && val !== undefined && val !== null) {
          for (const rule of col.validation) {
            const k = rule.kind;
            const rVal = rule.value;

            if ((k === 'Minimum' || k === 'minimum') && typeof val === 'number' && typeof rVal === 'number') {
              if (val < rVal) {
                issues.push({
                  path: `input.${key}`,
                  message: rule.message ?? `value must be >= ${rVal}`,
                  expected: `>= ${rVal}`,
                  value: val,
                });
              }
            } else if ((k === 'Maximum' || k === 'maximum') && typeof val === 'number' && typeof rVal === 'number') {
              if (val > rVal) {
                issues.push({
                  path: `input.${key}`,
                  message: rule.message ?? `value must be <= ${rVal}`,
                  expected: `<= ${rVal}`,
                  value: val,
                });
              }
            } else if (
              (k === 'MinLength' || k === 'minLength') &&
              typeof val === 'string' &&
              typeof rVal === 'number'
            ) {
              if (val.length < rVal) {
                issues.push({
                  path: `input.${key}`,
                  message: rule.message ?? `length must be >= ${rVal}`,
                  expected: `minLength ${rVal}`,
                  value: val,
                });
              }
            } else if (
              (k === 'MaxLength' || k === 'maxLength') &&
              typeof val === 'string' &&
              typeof rVal === 'number'
            ) {
              if (val.length > rVal) {
                issues.push({
                  path: `input.${key}`,
                  message: rule.message ?? `length must be <= ${rVal}`,
                  expected: `maxLength ${rVal}`,
                  value: val,
                });
              }
            } else if ((k === 'Pattern' || k === 'pattern') && typeof val === 'string') {
              const re = new RegExp(String(rVal));
              if (!re.test(val)) {
                issues.push({
                  path: `input.${key}`,
                  message: rule.message ?? `value does not match pattern ${rVal}`,
                  expected: `pattern ${rVal}`,
                  value: val,
                });
              }
            } else if ((k === 'Enum' || k === 'enum') && Array.isArray(rVal)) {
              if (!rVal.includes(val)) {
                issues.push({
                  path: `input.${key}`,
                  message: rule.message ?? `value must be one of ${JSON.stringify(rVal)}`,
                  expected: `enum ${JSON.stringify(rVal)}`,
                  value: val,
                });
              }
            }
          }
        }
      }

      if (issues.length > 0) {
        throw new ValidationError(`State update payload violated schema constraints`, issues);
      }
    }
  }

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
  const { schema, stateField, transitions, allowedFields } = options;

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
      >(stateField, transitions, from, to, patch, {
        ...(schema !== undefined ? { schema } : {}),
        ...(allowedFields !== undefined ? { allowedFields: allowedFields as Record<string, readonly string[]> } : {}),
      });
    },
  };
}
