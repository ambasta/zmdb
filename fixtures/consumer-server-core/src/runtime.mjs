const pairs = [
  ['@zmdb/app', 'zmdb/app'],
  ['@zmdb/app/commands', 'zmdb/app/commands'],
  ['@zmdb/app/cqrs', 'zmdb/app/cqrs'],
  ['@zmdb/app/data', 'zmdb/app/data'],
  ['@zmdb/app/di', 'zmdb/app/di'],
  ['@zmdb/app/events', 'zmdb/app/events'],
  ['@zmdb/app/health', 'zmdb/app/health'],
  ['@zmdb/app/lifecycle', 'zmdb/app/lifecycle'],
  ['@zmdb/app/messaging', 'zmdb/app/messaging'],
  ['@zmdb/app/modules', 'zmdb/app/modules'],
  ['@zmdb/app/observability', 'zmdb/app/observability'],
  ['@zmdb/app/state', 'zmdb/app/state'],
  ['@zmdb/jobs', 'zmdb/jobs'],
  ['@zmdb/jobs/memory', 'zmdb/jobs/memory'],
  ['@zmdb/jobs/schedule', 'zmdb/jobs/schedule'],
  ['@zmdb/web', 'zmdb/web'],
  ['@zmdb/web/app', 'zmdb/web/app'],
  ['@zmdb/web/compression', 'zmdb/web/compression'],
  ['@zmdb/web/context', 'zmdb/web/context'],
  ['@zmdb/web/csrf', 'zmdb/web/csrf'],
  ['@zmdb/web/data', 'zmdb/web/data'],
  ['@zmdb/web/devtools', 'zmdb/web/devtools'],
  ['@zmdb/web/dto-pipes', 'zmdb/web/dto-pipes'],
  ['@zmdb/web/gateways', 'zmdb/web/gateways'],
  ['@zmdb/web/health', 'zmdb/web/health'],
  ['@zmdb/web/middleware', 'zmdb/web/middleware'],
  ['@zmdb/web/openapi', 'zmdb/web/openapi'],
  ['@zmdb/web/pipeline', 'zmdb/web/pipeline'],
  ['@zmdb/web/routing', 'zmdb/web/routing'],
  ['@zmdb/web/static', 'zmdb/web/static'],
  ['@zmdb/web/testing', 'zmdb/web/testing'],
  ['@zmdb/web/upload', 'zmdb/web/upload'],
  ['@zmdb/web/versioning', 'zmdb/web/versioning'],
];

for (const [directName, facadeName] of pairs) {
  const direct = await import(directName);
  const facade = await import(facadeName);
  for (const name of Object.keys(direct)) {
    if (!(name in facade)) {
      throw new Error(`${facadeName} omitted ${name} from ${directName}`);
    }
    if (facade[name] !== direct[name]) {
      throw new Error(`${facadeName} changed ${directName}#${name} identity`);
    }
  }
}

const product = await import('zmdb');
const app = await import('@zmdb/app');
const web = await import('@zmdb/web');
const jobs = await import('@zmdb/jobs');
for (const [owner, names] of [
  [app, ['Container', 'Module', 'createApplication', 'createToken', 'repositoryToken']],
  [web, ['Controller', 'Get', 'createApp']],
  [jobs, ['createMemoryJobStore', 'createQueue', 'createScheduler', 'createWorker']],
]) {
  for (const name of names) {
    if (product[name] !== owner[name]) {
      throw new Error(`zmdb root changed ${name} identity`);
    }
  }
}

const metadata = Object.freeze({ fixture: true });
const metadataCarrier = Object.defineProperty({}, Symbol.metadata, { value: metadata });
if (app.metadataOf(metadataCarrier) !== metadata) {
  throw new Error('@zmdb/app did not preserve the Stage-3 metadata record');
}
if ((await import('zmdb/app')).metadataOf !== app.metadataOf) {
  throw new Error('zmdb/app created a second metadata reader');
}

for (const oldPath of [
  '@zmdb/web/cli',
  '@zmdb/web/cqrs',
  '@zmdb/web/di',
  '@zmdb/web/events',
  '@zmdb/web/microservices',
  '@zmdb/web/modules',
  '@zmdb/web/observability',
  '@zmdb/web/queues',
  '@zmdb/web/queues/backends/memory',
  '@zmdb/web/schedule',
  '@zmdb/web/state',
]) {
  try {
    await import(oldPath);
    throw new Error(`${oldPath} remains resolvable`);
  } catch (error) {
    if (error instanceof Error && error.message === `${oldPath} remains resolvable`) {
      throw error;
    }
  }
}

console.log(JSON.stringify({ facadePairs: pairs.length, metadataIdentity: true, oldPathsAbsent: 11 }));
