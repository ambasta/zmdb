import { SERVER_CREDENTIAL } from '@fixture/lib/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest, context: { readonly params: Promise<{ readonly id: string }> }) {
  if (request.headers.get('x-server-secret') !== SERVER_CREDENTIAL) {
    return Response.json({ error: 'missing server credential' }, { status: 401 });
  }
  return context.params.then(params =>
    Response.json({
      id: params.id,
      name: JSON.stringify({
        requestId: globalThis.crypto.randomUUID(),
        authorization: request.headers.get('authorization') ?? '',
        tenant: request.headers.get('x-tenant-id') ?? '',
        session: request.cookies.get('session')?.value ?? '',
        ignoredHeader: request.headers.has('x-ignored'),
        ignoredCookie: request.cookies.has('ignored'),
      }),
    }),
  );
}
