import { describe, it, expect } from 'vitest';

import {
  defineSchema,
  text,
  serial,
  defineStateTransitions,
  defineEntityStateMachine,
  createStateUpdatePayload,
  type StateUpdateDTO,
} from './index.ts';

const ArticleSchema = defineSchema('articles', {
  id: serial().primaryKey(),
  title: text(),
  content: text(),
  status: text(),
});

describe('Entity State Transitions & Update Payload Helpers', () => {
  const transitions = defineStateTransitions({
    draft: ['review', 'published'],
    review: ['published', 'draft'],
    published: ['archived'],
    archived: [],
  } as const);

  it('validates allowed target state values at compile time', () => {
    type DraftUpdatePayload = StateUpdateDTO<typeof ArticleSchema, 'status', 'draft', typeof transitions>;

    const validPayload: DraftUpdatePayload = {
      status: 'review',
      title: 'New Title',
    };

    expect(validPayload.status).toBe('review');
  });

  it('restricts allowable entity patch attributes based on declared source state', () => {
    // For 'review' state, only allow updating 'status' and 'content'
    type ReviewStateUpdate = StateUpdateDTO<
      typeof ArticleSchema,
      'status',
      'review',
      typeof transitions,
      'status' | 'content'
    >;

    const validReviewUpdate: ReviewStateUpdate = {
      status: 'published',
      content: 'Approved content',
    };

    expect(validReviewUpdate.status).toBe('published');
  });

  it('creates state transition payload via standalone helper function', () => {
    const payload = createStateUpdatePayload<typeof ArticleSchema, 'status', 'draft', typeof transitions>(
      'status',
      transitions,
      'draft',
      'published',
      {
        title: 'Published Article Title',
      },
    );

    expect(payload).toEqual({
      status: 'published',
      title: 'Published Article Title',
    });

    // Runtime rejection of invalid transition
    expect(() =>
      createStateUpdatePayload<typeof ArticleSchema, 'status', 'draft', typeof transitions>(
        'status',
        transitions,
        'draft',
        // boundary: cast invalid target state to never to test runtime invalid transition rejection.
        'archived' as never,
        {},
      ),
    ).toThrow('Invalid state transition from "draft" to "archived" for field "status"');
  });

  it('defines an EntityStateMachine and creates typed update payloads', () => {
    const stateMachine = defineEntityStateMachine({
      schema: ArticleSchema,
      stateField: 'status',
      transitions: {
        draft: ['review', 'published'],
        review: ['published', 'draft'],
        published: ['archived'],
        archived: [],
      } as const,
      allowedFields: {
        draft: ['title', 'content', 'status'],
        review: ['status'],
      } as const,
    });

    expect(stateMachine.canTransition('draft', 'review')).toBe(true);
    expect(stateMachine.canTransition('draft', 'archived')).toBe(false);

    const draftToReview = stateMachine.createUpdatePayload('draft', 'review', {
      title: 'Draft in review',
    });

    expect(draftToReview).toEqual({
      status: 'review',
      title: 'Draft in review',
    });

    // Attempting invalid transition at runtime throws
    expect(() =>
      // @ts-expect-error - 'archived' is invalid from 'draft'
      stateMachine.createUpdatePayload('draft', 'archived'),
    ).toThrow('Invalid state transition from "draft" to "archived" for field "status"');
  });
});
