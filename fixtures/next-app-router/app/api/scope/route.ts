import { createFixtureScope } from '@fixture/lib/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const scope = await createFixtureScope({ cache: 'no-store' });
  const getProbe = scope.memoize(
    (client, id: string) => client.getProbe({ id }),
    id => id,
  );
  const [first, duplicate] = await Promise.all([getProbe('route-handler'), getProbe('route-handler')]);
  return Response.json({
    ...first,
    duplicate: first.requestId === duplicate.requestId,
  });
}
