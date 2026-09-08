import type { Max, Min } from '@zmdb/schema/tags';
import { equals, is } from '@zmdb/validator';

import type { Model } from './model.js';

type Bounded = Model<number & Min<-1000000> & Max<1000000>>;

export const loose = (value: unknown): boolean => is<Bounded>(value);
export const strict = (value: unknown): boolean => equals<Bounded>(value);
