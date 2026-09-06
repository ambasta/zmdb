import { defineEventHandler, getCookie, getRequestHeader, getRouterParam } from 'h3';

import { recordObservation } from '../../utils/observations.js';

export default defineEventHandler(event => {
  const id = getRouterParam(event, 'id') ?? 'missing';
  const authorization = getRequestHeader(event, 'authorization') ?? null;
  const session = getCookie(event, 'session') ?? null;
  const hiddenCookie = getCookie(event, 'hidden') ?? null;
  const hiddenHeader = getRequestHeader(event, 'x-hidden') ?? null;
  recordObservation({
    authorization,
    hiddenCookie,
    hiddenHeader,
    id,
    session,
  });
  return {
    id,
    name: `${authorization ?? 'none'}|${session ?? 'none'}|${hiddenHeader ?? 'none'}|${hiddenCookie ?? 'none'}`,
  };
});
