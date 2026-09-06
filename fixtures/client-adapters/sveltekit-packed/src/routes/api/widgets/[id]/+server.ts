import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = event => {
  const tenant = event.request.headers.get('x-tenant') ?? 'no-tenant';
  const cookie = event.request.headers.get('cookie') ?? 'no-cookie';
  return json({
    id: event.params.id,
    name: `${tenant}:${cookie}`,
  });
};
