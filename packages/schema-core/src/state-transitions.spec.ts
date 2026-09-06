import { schemasFrom } from '@zmdb/compiler/testing';
import { describe, it, expect } from 'vitest';

import {
  defineStateTransitions,
  defineEntityStateMachine,
  createStateUpdatePayload,
  ValidationError,
  type StateUpdateDTO,
} from './index.js';
import type { PrimaryKey, Serial, Sql, Table } from './tags/index.js';

export interface Article extends Table<'articles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  content: string & Sql<'text'>;
  status: string & Sql<'text'>;
}

const { Article: ArticleSchema } = schemasFrom<{ Article: Article }>(import.meta.url, ['Article']);
const titleCol = ArticleSchema.columns.title;
if (titleCol) {
  Object.assign(titleCol, {
    validation: [{ kind: 'minLength', value: 5 }],
  });
}

describe('Entity State Transitions & Update Payload Helpers', () => {
  const transitions = defineStateTransitions({
    draft: ['review', 'published'],
    review: ['published', 'draft'],
    published: ['archived'],
    archived: [],
  } as const);

  it('validates allowed target state values at compile time', () => {
    type DraftUpdatePayload = StateUpdateDTO<Article, 'status', 'draft', typeof transitions>;

    const validPayload: DraftUpdatePayload = {
      status: 'review',
      title: 'New Title',
    };

    expect(validPayload.status).toBe('review');
  });

  it('restricts allowable entity patch attributes based on declared source state', () => {
    // For 'review' state, only allow updating 'status' and 'content'
    type ReviewStateUpdate = StateUpdateDTO<Article, 'status', 'review', typeof transitions, 'status' | 'content'>;

    const validReviewUpdate: ReviewStateUpdate = {
      status: 'published',
      content: 'Approved content',
    };

    expect(validReviewUpdate.status).toBe('published');
  });

  it('creates state transition payload via standalone helper function', () => {
    const payload = createStateUpdatePayload<Article, 'status', 'draft', typeof transitions>(
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
      createStateUpdatePayload<Article, 'status', 'draft', typeof transitions>(
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

  it('rejects state transition payloads violating declared allowedFields (key limits)', () => {
    const stateMachine = defineEntityStateMachine({
      schema: ArticleSchema,
      stateField: 'status',
      transitions: {
        draft: ['review'],
        review: ['published'],
      } as const,
      allowedFields: {
        review: ['status', 'content'],
      } as const,
    });

    expect(() =>
      stateMachine.createUpdatePayload('review', 'published', {
        title: 'Forbidden title update',
      } as never),
    ).toThrow('Field "title" is not allowed to be updated during transition from "review"');
  });

  it('rejects state transition payloads violating schema column rules', () => {
    const stateMachine = defineEntityStateMachine({
      schema: ArticleSchema,
      stateField: 'status',
      transitions: {
        draft: ['review'],
      } as const,
    });

    // 'title' minLength is 5, 'abc' has length 3
    expect(() =>
      stateMachine.createUpdatePayload('draft', 'review', {
        title: 'abc',
      }),
    ).toThrow(ValidationError);
  });
});
