import typia, { type tags } from 'typia';

import type { Model } from './model.js';

type Bounded = Model<number & tags.Minimum<-1000000> & tags.Maximum<1000000>>;

export const loose = typia.createIs<Bounded>();
export const strict = typia.createEquals<Bounded>();
export const stringify = typia.json.createStringify<Bounded>();
