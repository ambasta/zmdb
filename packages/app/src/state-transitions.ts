import type { ColumnMeta, DeclaredTable, TaggedSchema, UpdateDTO } from '@zmdb/schema';
import { isRecord } from '@zmdb/schema';
import { ValidationError, type ValidationIssue } from '@zmdb/validator';

export {
  createStateUpdatePayload,
  defineEntityStateMachine,
  defineStateTransitions,
  type AllowedTargetStates,
  type EntityStateMachine,
  type EntityStateMachineOptions,
  type StateTransitions,
  type StateUpdateDTO,
} from '@zmdb/schema';
