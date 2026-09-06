import { createFixtureScope, readFixtureObservation } from '@fixture/lib/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const scope = await createFixtureScope({ cache: 'no-store' });
  const getWidget = scope.memoize(
    (client, id: string) => client.getWidget({ id }),
    id => id,
  );
  const [firstWidget, duplicateWidget] = await Promise.all([getWidget('route-handler'), getWidget('route-handler')]);
  const first = readFixtureObservation(firstWidget);
  const duplicate = readFixtureObservation(duplicateWidget);
  return Response.json({
    ...first,
    duplicate: first.requestId === duplicate.requestId,
  });
}
