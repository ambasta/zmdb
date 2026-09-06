import { ClientProbe } from '@fixture/app/client-probe';
import { createFixtureScope } from '@fixture/lib/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const scope = await createFixtureScope({ cache: 'no-store' });
  const getProbe = scope.memoize(
    (client, id: string) => client.getProbe({ id }),
    id => id,
  );
  const [first, duplicate] = await Promise.all([getProbe('server-component'), getProbe('server-component')]);

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
