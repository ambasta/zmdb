import { defineEventHandler } from 'h3';

import { requestObservations } from '../utils/observations.js';

export default defineEventHandler(() => requestObservations());
