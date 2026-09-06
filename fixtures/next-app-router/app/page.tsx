import { ClientProbe } from '@fixture/app/client-probe';
import { createFixtureScope, readFixtureObservation } from '@fixture/lib/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const scope = await createFixtureScope({ cache: 'no-store' });
  const getWidget = scope.memoize(
    (client, id: string) => client.getWidget({ id }),
    id => id,
  );
  const [firstWidget, duplicateWidget] = await Promise.all([
    getWidget('server-component'),
    getWidget('server-component'),
  ]);
  const first = readFixtureObservation(firstWidget);
  const duplicate = readFixtureObservation(duplicateWidget);

  return (
    <main
      data-authorization={first.authorization}
      data-duplicate={String(first.requestId === duplicate.requestId)}
      data-ignored-cookie={String(first.ignoredCookie)}
      data-ignored-header={String(first.ignoredHeader)}
      data-request-id={first.requestId}
      data-session={first.session}
      data-tenant={first.tenant}
    >
      <h1>{first.id}</h1>
      <ClientProbe />
    </main>
  );
}
