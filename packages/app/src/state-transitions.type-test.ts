// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import {
  defineStateTransitions,
  defineEntityStateMachine,
  createStateUpdatePayload,
  type StateUpdateDTO,
} from '@zmdb/app';
import { schemasFrom } from '@zmdb/compiler/testing';
import { type UpdateDTO, type Equal, type Expect, type Extends } from '@zmdb/schema';
import { type PrimaryKey, type Serial, type Sql, type Table } from '@zmdb/schema/tags';

export interface Article extends Table<'articles'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  content: string & Sql<'text'>;
  status: string & Sql<'text'>;
}

const ArticleSchema = schemasFrom<{ Article: Article }>(import.meta.url, ['Article']).Article;

type ArticleUpdate = UpdateDTO<Article>;

const transitions = defineStateTransitions({
  draft: ['review', 'published'],
  review: ['published', 'draft'],
  published: ['archived'],
  archived: [],
} as const);

// Test 1: DraftUpdatePayload['status'] is 'review' | 'published' | undefined
type DraftUpdatePayload = StateUpdateDTO<Article, 'status', 'draft', typeof transitions>;
type _TestDraftStatus = Expect<Equal<DraftUpdatePayload['status'], 'review' | 'published' | undefined>>;

// Test 2: DraftUpdatePayload assignable to ArticleUpdate
declare const validPayload: DraftUpdatePayload;
type _TestDraftPayloadAssignable = Expect<Extends<typeof validPayload, ArticleUpdate>>;

// Test 3: ReviewStateUpdate keys
type ReviewStateUpdate = StateUpdateDTO<Article, 'status', 'review', typeof transitions, 'status' | 'content'>;
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
