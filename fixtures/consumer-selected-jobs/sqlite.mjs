import assert from 'node:assert/strict';

import { createApplication } from '@zmdb/app';
import { createApplication as productApplication } from 'zmdb/app';

import './dist/default.js';
import './providers/sqlite.mjs';

assert.equal(createApplication, productApplication, 'selected jobs and the product share one application owner');
