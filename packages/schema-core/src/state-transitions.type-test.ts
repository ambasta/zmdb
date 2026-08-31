import {
  defineSchema,
  text,
  serial,
  defineStateTransitions,
  defineEntityStateMachine,
  createStateUpdatePayload,
  type StateUpdateDTO,
  type UpdateDTO,
  type Equal,
  type Expect,
  type Extends,
} from './index.ts';

const ArticleSchema = defineSchema('articles', {
  id: serial().primaryKey(),
  title: text(),
  content: text(),
  status: text(),
});

type ArticleUpdate = UpdateDTO<typeof ArticleSchema>;

const transitions = defineStateTransitions({
  draft: ['review', 'published'],
  review: ['published', 'draft'],
  published: ['archived'],
  archived: [],
} as const);

// Test 1: DraftUpdatePayload['status'] is 'review' | 'published' | undefined
type DraftUpdatePayload = StateUpdateDTO<typeof ArticleSchema, 'status', 'draft', typeof transitions>;
type _TestDraftStatus = Expect<Equal<DraftUpdatePayload['status'], 'review' | 'published' | undefined>>;

// Test 2: DraftUpdatePayload assignable to ArticleUpdate
declare const validPayload: DraftUpdatePayload;
type _TestDraftPayloadAssignable = Expect<Extends<typeof validPayload, ArticleUpdate>>;

// Test 3: ReviewStateUpdate keys
type ReviewStateUpdate = StateUpdateDTO<
  typeof ArticleSchema,
  'status',
  'review',
  typeof transitions,
  'status' | 'content'
>;
type _TestReviewKeys = Expect<Equal<keyof ReviewStateUpdate, 'content' | 'status'>>;

// Test 4: Invalid target state transition causes compile error with @ts-expect-error
// @ts-expect-error - 'archived' is not a valid target state from 'draft'
createStateUpdatePayload('status', transitions, 'draft', 'archived', {});

// Test 5: EntityStateMachine invalid transition causes compile error
const stateMachine = defineEntityStateMachine({
  schema: ArticleSchema,
  stateField: 'status',
  transitions,
  allowedFields: {
    draft: ['title', 'content', 'status'],
    review: ['status'],
  } as const,
});

// @ts-expect-error - 'archived' is invalid from 'draft'
stateMachine.createUpdatePayload('draft', 'archived');
