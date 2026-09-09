const pairs = [
  ['@zmdb/app', '@zmdb/core/app'],
  ['@zmdb/app/commands', '@zmdb/core/app/commands'],
  ['@zmdb/app/cqrs', '@zmdb/core/app/cqrs'],
  ['@zmdb/app/data', '@zmdb/core/app/data'],
  ['@zmdb/app/di', '@zmdb/core/app/di'],
  ['@zmdb/app/events', '@zmdb/core/app/events'],
  ['@zmdb/app/health', '@zmdb/core/app/health'],
  ['@zmdb/app/lifecycle', '@zmdb/core/app/lifecycle'],
  ['@zmdb/app/messaging', '@zmdb/core/app/messaging'],
  ['@zmdb/app/modules', '@zmdb/core/app/modules'],
  ['@zmdb/app/observability', '@zmdb/core/app/observability'],
  ['@zmdb/app/state', '@zmdb/core/app/state'],
  ['@zmdb/web', '@zmdb/core/web'],
  ['@zmdb/web/app', '@zmdb/core/web/app'],
  ['@zmdb/web/compression', '@zmdb/core/web/compression'],
  ['@zmdb/web/context', '@zmdb/core/web/context'],
  ['@zmdb/web/contract', '@zmdb/core/web/contract'],
  ['@zmdb/web/contract/compiler', '@zmdb/core/web/contract/compiler'],
  ['@zmdb/web/csrf', '@zmdb/core/web/csrf'],
  ['@zmdb/web/data', '@zmdb/core/web/data'],
  ['@zmdb/web/devtools', '@zmdb/core/web/devtools'],
  ['@zmdb/web/dto-pipes', '@zmdb/core/web/dto-pipes'],
  ['@zmdb/web/gateways', '@zmdb/core/web/gateways'],
  ['@zmdb/web/health', '@zmdb/core/web/health'],
  ['@zmdb/web/middleware', '@zmdb/core/web/middleware'],
  ['@zmdb/web/openapi', '@zmdb/core/web/openapi'],
  ['@zmdb/web/pipeline', '@zmdb/core/web/pipeline'],
  ['@zmdb/web/routing', '@zmdb/core/web/routing'],
  ['@zmdb/web/static', '@zmdb/core/web/static'],
  ['@zmdb/web/testing', '@zmdb/core/web/testing'],
  ['@zmdb/web/upload', '@zmdb/core/web/upload'],
  ['@zmdb/web/versioning', '@zmdb/core/web/versioning'],
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

const product = await import('@zmdb/core');
const app = await import('@zmdb/app');
const appCommands = await import('@zmdb/app/commands');
const appData = await import('@zmdb/app/data');
const appEvents = await import('@zmdb/app/events');
const appMessaging = await import('@zmdb/app/messaging');
const web = await import('@zmdb/web');
for (const [owner, names] of [
  [app, ['Container', 'Inject', 'Module', 'createApplication', 'createToken']],
  [appCommands, ['Command', 'createCommandApp']],
  [appData, ['repositoryToken']],
  [appEvents, ['OnEvent', 'createEvents']],
  [appMessaging, ['EventPattern', 'MessagePattern']],
  [
    web,
    [
      'Controller',
      'Delete',
      'Gateway',
      'Get',
      'Patch',
      'Post',
      'Public',
      'Put',
      'Subscribe',
      'Version',
      'VersionNeutral',
      'createApp',
    ],
  ],
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
if ((await import('@zmdb/core/app')).metadataOf !== app.metadataOf) {
  throw new Error('@zmdb/core/app created a second metadata reader');
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

for (const removedFacade of ['@zmdb/core/jobs', '@zmdb/core/jobs/memory', '@zmdb/core/jobs/schedule']) {
  try {
    await import(removedFacade);
    throw new Error(`${removedFacade} remains resolvable`);
  } catch (error) {
    if (error instanceof Error && error.message === `${removedFacade} remains resolvable`) {
      throw error;
    }
  }
}

console.log(JSON.stringify({ facadePairs: pairs.length, metadataIdentity: true, oldPathsAbsent: 11 }));
