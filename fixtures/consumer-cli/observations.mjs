import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { pty } from './pty.mjs';
import {
  appRoots,
  cleanEnvironment,
  command,
  createFixture,
  dataRoots,
  evidence,
  root,
  startRegistry,
  trackChild,
} from './registry.mjs';

const inputs = fileURLToPath(new URL('.', import.meta.url));
const contractExpected = JSON.parse(await readFile(join(inputs, 'expected.json'), 'utf8'));
let pending;
let sequence = 0;
const typeOptions = JSON.parse(await readFile(join(inputs, 'types/tsconfig.json'), 'utf8'));
export async function close() {
  if (!pending) return { children: [], ports: [], processes: [] };
  const current = pending;
  pending = undefined;
  const fixture = await current;
  return fixture.cleanup();
}
export async function node(consumer, source, expected = 0, env = {}) {
  return command(process.execPath, ['--input-type=module', '-e', source], { cwd: consumer, env, expected });
}
async function copyProject(consumer, kind) {
  const project = join(consumer, `project-${kind}-${sequence++}`);
  await cp(join(inputs, 'projects', kind), project, { recursive: true });
  return project;
}
export async function snapshot(directory) {
  const entries = [];
  async function visit(current) {
    for (const name of (await readdir(current)).toSorted()) {
      if (name === 'node_modules' || name === '.npm-cache') continue;
      const path = join(current, name),
        metadata = await lstat(path, { bigint: true });
      if (metadata.isDirectory()) await visit(path);
      else
        entries.push({
          path: relative(directory, path),
          bytes: (await readFile(path)).toString('base64'),
          mtime: String(metadata.mtimeNs),
        });
    }
  }
  await visit(directory);
  return entries;
}
async function compileType(consumer, file, diagnostic) {
  const target = join(consumer, 'types');
  await mkdir(target, { recursive: true });
  await cp(join(inputs, 'types', file), join(target, file));
  await writeFile(join(target, 'tsconfig.json'), JSON.stringify({ ...typeOptions, files: [file] }, null, 2) + '\n');
  const result = await command(
    join(consumer, 'node_modules/.bin/tsc'),
    ['-p', 'types/tsconfig.json', '--pretty', 'false'],
    { cwd: consumer },
  );
  if (!diagnostic) assert.equal(result.code, 0, result.stdout + result.stderr);
  else {
    assert.equal(result.code, 1, result.stdout + result.stderr);
    const errors = result.stdout.split('\n').filter(line => /error TS\d+:/.test(line));
    assert.equal(errors.length, 1, result.stdout);
    assert.match(
      errors[0],
      new RegExp(
        `types/${file.replace('.', '\\.')}\\(${diagnostic.line},${diagnostic.column}\\): error TS${diagnostic.code}:`,
      ),
    );
  }
  return result;
}
async function lowerApp(consumer, project) {
  await node(
    consumer,
    `import {readFileSync,readdirSync,writeFileSync} from 'node:fs'; import {join} from 'node:path'; import {transformSync} from 'esbuild'; const root=${JSON.stringify(join(project, 'src'))}; for(const name of readdirSync(root)){if(!name.endsWith('.ts'))continue;const file=join(root,name);writeFileSync(file.slice(0,-3)+'.js',transformSync(readFileSync(file,'utf8'),{loader:'ts',format:'esm',target:'es2022',sourcefile:file,tsconfigRaw:{compilerOptions:{experimentalDecorators:false,useDefineForClassFields:true}}}).code);}`,
  );
}
export async function setup() {
  pending ??= (async () => {
    const fixture = await createFixture();
    try {
      fixture.roles = new Map();
      const data = await fixture.install('setup-data', dataRoots);
      const app = await fixture.install('setup-application-http', appRoots);
      const dataProject = await copyProject(data, 'data');
      const appProject = await copyProject(app, 'app');
      const httpProject = await copyProject(app, 'http');
      await command(
        join(data, 'node_modules/.bin/tsc'),
        ['-p', join(dataProject, 'tsconfig.json'), '--pretty', 'false'],
        { cwd: data, expected: 0, log: join(evidence, 'setup-data-types.json') },
      );
      await node(
        data,
        `import assert from 'node:assert/strict'; import {compileProject,writeCompileResult} from '@zmdb/compiler'; const result=await compileProject({project:${JSON.stringify(join(dataProject, 'tsconfig.json'))}}); assert.deepEqual(result.diagnostics,[]); assert(result.artifacts.length>0); const published=await writeCompileResult(result); assert(published.written.length>0);`,
      );
      await node(
        data,
        `import assert from 'node:assert/strict'; import {DatabaseSync} from 'node:sqlite'; import {sqliteDriver} from '@zmdb/sqlite'; const db=new DatabaseSync(':memory:');try {const driver=sqliteDriver(db);await driver.execute({text:'CREATE TABLE probe(id INTEGER PRIMARY KEY)',parameters:[]});await driver.execute({text:'INSERT INTO probe VALUES (?)',parameters:[7]});assert.deepEqual((await driver.execute({text:'SELECT id FROM probe',parameters:[]})).map(row=>row.id),[7]);}finally{db.close();}`,
      );
      await command(
        join(app, 'node_modules/.bin/tsc'),
        ['-p', join(appProject, 'tsconfig.json'), '--pretty', 'false'],
        { cwd: app, expected: 0, log: join(evidence, 'setup-app-types.json') },
      );
      await command(
        join(app, 'node_modules/.bin/tsc'),
        ['-p', join(httpProject, 'tsconfig.json'), '--pretty', 'false'],
        { cwd: app, expected: 0, log: join(evidence, 'setup-http-types.json') },
      );
      await lowerApp(app, appProject);
      await lowerApp(app, httpProject);
      await node(
        app,
        `import assert from 'node:assert/strict'; import {createApp} from '@zmdb/web'; import {describeGraph} from '@zmdb/web/devtools'; import {AppModule} from ${JSON.stringify(pathToFileURL(join(appProject, 'src/app.module.js')).href)}; const graph=describeGraph(AppModule); assert.equal(graph.findings.filter(row=>row.severity==='error').length,0); const app=createApp(AppModule);try{await app.init();const response=await app.fetch(new Request('http://localhost/health/'));assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,users:'users@fixture'});}finally{await app[Symbol.asyncDispose]();}`,
      );
      await mkdir(join(app, 'projects'), { recursive: true });
      await cp(join(inputs, 'projects/app'), join(app, 'projects/app'), { recursive: true });
      await cp(join(inputs, 'projects/http'), join(app, 'projects/http'), { recursive: true });
      await compileType(app, 'setup-current.ts');
      fixture.roles.set('setup-data', data);
      fixture.roles.set('setup-app', app);
      await writeFile(
        join(evidence, 'setup.json'),
        JSON.stringify(
          {
            ok: true,
            data: true,
            sqlite: true,
            application: true,
            httpTypes: true,
            currentTypes: true,
            packages: [...fixture.records.keys()],
          },
          null,
          2,
        ) + '\n',
      );
      return fixture;
    } catch (error) {
      await fixture.cleanup();
      throw error;
    }
  })();
  return pending;
}

async function role(name) {
  const fixture = await setup();
  if (!fixture.roles.has(name)) {
    assert(fixture.records.has('@zmdb/cli'), 'the sole installed @zmdb/cli package is absent on this exact base');
    const roots =
      name === 'minimal' || name === 'nested'
        ? ['@zmdb/cli', 'typescript', '@types/node']
        : name === 'data'
          ? ['@zmdb/cli', ...dataRoots]
          : name === 'product'
            ? ['zmdb', '@zmdb/sqlite', 'typescript', '@types/node', 'esbuild']
            : name === 'public'
              ? ['zmdb', '@zmdb/cli', '@zmdb/compiler', '@zmdb/migrations', '@zmdb/schema', 'typescript', '@types/node']
              : ['@zmdb/cli', ...appRoots];
    fixture.roles.set(name, await fixture.install(name, roots, name === 'nested'));
  }
  return fixture.roles.get(name);
}
async function bin(consumer, project, argv, expected, options = {}) {
  const path = join(consumer, 'node_modules/.bin/zmdb');
  const target = await realpath(path);
  assert(target.startsWith(join(consumer, 'node_modules') + '/'));
  assert(target.includes('/@zmdb/cli/dist/'));
  const result = await command(process.execPath, [path, ...argv], {
    cwd: project,
    expected,
    env: {
      ZMDB_TEST_DATABASE: join(project, 'database.sqlite'),
      ZMDB_FIXTURE_EVENTS: join(project, 'events.log'),
      ...options.env,
    },
    ...options,
  });
  if (argv.includes('--json')) {
    assert(result.stdout.endsWith('\n'));
    assert.equal(result.stdout.trim().split('\n').length, 1, result.stdout);
    const json = JSON.parse(result.stdout);
    assert.equal(json.ok, result.code === 0);
    assert.equal(typeof json.command, 'string');
    assert.equal(typeof json.config, 'string');
    result.json = json;
  }
  return result;
}
async function dataCase() {
  const consumer = await role('data');
  const project = await copyProject(consumer, 'data');
  return { consumer, project };
}
function sql(project, text, parameters = []) {
  const db = new DatabaseSync(join(project, 'database.sqlite'));
  try {
    return db
      .prepare(text)
      .all(...parameters)
      .map(row => ({ ...row }));
  } finally {
    db.close();
  }
}
function execSql(project, text) {
  const db = new DatabaseSync(join(project, 'database.sqlite'));
  try {
    db.exec(text);
  } finally {
    db.close();
  }
}
async function waitFor(read, predicate, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(accept => setTimeout(accept, 20));
  }
  throw new Error('TIMEOUT waiting for real observable');
}

const cases = {};
export async function runCase(id) {
  assert.equal(typeof cases[id], 'function', `unimplemented fixture test ${id}`);
  return cases[id]();
}
export async function runAll() {
  const rows = [];
  for (const id of Object.keys(cases).toSorted()) {
    try {
      await runCase(id);
      rows.push({ id, ok: true, exitCode: 0 });
    } catch (error) {
      rows.push({ id, ok: false, exitCode: 1 });
      await writeFile(join(evidence, `${id}.failure.txt`), String(error.stack ?? error));
    }
  }
  return rows;
}

cases.T01 = async () => {
  const minimal = await role('minimal'),
    product = await role('product');
  for (const consumer of [minimal, product]) {
    const target = await realpath(join(consumer, 'node_modules/.bin/zmdb'));
    assert(target.startsWith(join(consumer, 'node_modules/@zmdb/cli/dist/')));
    const manifest = JSON.parse(await readFile(join(consumer, 'node_modules/@zmdb/cli/package.json'), 'utf8'));
    assert.deepEqual(Object.keys(manifest.exports), ['.']);
    assert.deepEqual(manifest.bin, { zmdb: './dist/bin.js' });
    assert.equal(manifest.exports['.'].import, './dist/index.js');
    assert.equal(manifest.exports['.'].types, './dist/index.d.ts');
    await assert.rejects(lstat(join(consumer, 'node_modules/.bin/zmdb-codegen')), { code: 'ENOENT' });
    await bin(consumer, consumer, ['--version'], 0);
  }
  const manifest = JSON.parse(await readFile(join(product, 'node_modules/zmdb/package.json'), 'utf8'));
  assert.equal(manifest.bin, undefined);
  assert.equal(manifest.dependencies['@zmdb/cli'], '1.0.0-beta.1');
  await node(
    product,
    `import assert from 'node:assert/strict';import * as cli from '@zmdb/cli';import * as facade from 'zmdb/cli';assert.deepEqual(Object.keys(facade).toSorted(),Object.keys(cli).toSorted());for(const name of Object.keys(cli))assert.equal(facade[name],cli[name]);`,
  );
  const result = await command('npm', ['exec', '--offline', '--', 'zmdb', '--version'], { cwd: product, expected: 0 });
  assert.equal(result.stdout, 'zmdb 1.0.0-beta.1\n');
};
cases.T02 = async () => {
  const fixture = await setup();
  const original = fixture.records.get('@zmdb/ai');
  assert(original);
  const corrupt = join(fixture.consumers, 'corrupt.tgz');
  await writeFile(corrupt, new TextEncoder().encode('intentionally corrupted archive\n'));
  const records = new Map(fixture.records);
  records.set('@zmdb/ai', { ...original, file: corrupt });
  const registry = await startRegistry(records);
  try {
    const consumer = join(fixture.consumers, 'integrity');
    await mkdir(consumer);
    await writeFile(
      join(consumer, 'package.json'),
      JSON.stringify({ name: 'integrity', private: true, dependencies: { '@zmdb/ai': '1.0.0-beta.1' } }),
    );
    const result = await command(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--fetch-retries=0',
        '--registry',
        registry.origin,
        '--cache',
        join(consumer, 'cache'),
        '--userconfig',
        join(consumer, 'empty.npmrc'),
      ],
      { cwd: consumer },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /EINTEGRITY/);
    assert(registry.requested.includes(`/tarballs/${original.sha256}.tgz`));
  } finally {
    await registry.close();
  }
  const requested = Promise.withResolvers();
  const held = createHttpServer((request, response) => {
    if (decodeURIComponent(request.url).startsWith('/@zmdb/')) requested.resolve(request.url);
    else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((accept, reject) => {
    held.once('error', reject);
    held.listen(0, '127.0.0.1', accept);
  });
  const installRoot = join(fixture.consumers, 'interrupted-install');
  await mkdir(installRoot);
  await writeFile(
    join(installRoot, 'package.json'),
    JSON.stringify({ name: 'interrupted-install', private: true, dependencies: { '@zmdb/ai': '1.0.0-beta.1' } }),
  );
  const installer = spawn(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--fetch-retries=0',
      '--registry',
      `http://127.0.0.1:${held.address().port}`,
      '--cache',
      join(installRoot, 'cache'),
      '--userconfig',
      join(installRoot, 'empty.npmrc'),
    ],
    { cwd: installRoot, env: cleanEnvironment(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const interrupted = new Promise((accept, reject) => {
    installer.once('error', reject);
    installer.once('close', (code, signal) => accept({ code, signal }));
  });
  trackChild(installer);
  installer.stdout.resume();
  installer.stderr.resume();
  try {
    const request = await Promise.race([
      requested.promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT installer package request')), 20_000).unref(),
      ),
    ]);
    assert.match(decodeURIComponent(request), /@zmdb/);
    process.kill(-installer.pid, 'SIGTERM');
    const result = await interrupted;
    assert(result.signal === 'SIGTERM' || result.code === 143);
    assert.throws(() => process.kill(-installer.pid, 0), { code: 'ESRCH' });
  } finally {
    if (installer.exitCode === null && installer.signalCode === null) process.kill(-installer.pid, 'SIGTERM');
    await interrupted;
    held.closeAllConnections();
    await new Promise(accept => held.close(accept));
  }
  const unexpected = join(fixture.directory, 'unexpected');
  await writeFile(unexpected, 'sentinel');
  const before = await readdir(fixture.directory);
  await assert.rejects(fixture.cleanup(), /unexpected child/);
  assert.deepEqual(await readdir(fixture.directory), before);
  assert.equal(await readFile(unexpected, 'utf8'), 'sentinel');
  await unlink(unexpected);
};
cases.T03 = async () => {
  const consumer = await role('public');
  await compileType(consumer, 'accepted.ts');
  const minimal = await role('minimal');
  for (const [file, line, column, code] of [
    ['rejected-argv.ts', 2, 8, 2345],
    ['rejected-env.ts', 2, 14, 2322],
    ['rejected-readonly.ts', 3, 13, 2540],
    ['rejected-result.ts', 2, 7, 2322],
  ])
    await compileType(minimal, file, { line, column, code });
  await compileType(await role('data'), 'rejected-watch.ts', { line: 2, column: 16, code: 2322 });
  await compileType(await role('nested'), 'rejected-private.ts', { line: 1, column: 28, code: 2307 });
  await node(
    consumer,
    `import assert from 'node:assert/strict';import * as cli from '@zmdb/cli';import * as facade from 'zmdb/cli';const values=['runCli','embedMigrations','exportSchema','generateMigration','pullDeclarations','generateHttpArtifacts','watchHttpArtifacts'];assert.deepEqual(Object.keys(cli).toSorted(),values.toSorted());for(const key of values)assert.equal(cli[key],facade[key]);const argv=Object.freeze(['--version']);assert.equal(await cli.runCli(argv,{stdout(){},stderr(){}}),0);assert.deepEqual(argv,['--version']);`,
  );
};
const commands = contractExpected.commands;
cases.T04 = async () => {
  const consumer = await role('minimal');
  const help = await bin(consumer, consumer, ['--help'], 0);
  assert.equal(help.stderr, '');
  assert.deepEqual(
    help.stdout
      .split('\n')
      .filter(line => /^  [a-z]+\s{2,}/.test(line))
      .map(line => line.trim().split(/\s+/)[0]),
    commands,
  );
  const version = await bin(consumer, consumer, ['--version'], 0);
  assert.equal(version.stdout, 'zmdb 1.0.0-beta.1\n');
  assert.equal(version.stderr, '');
  for (const name of commands) {
    const own = await bin(consumer, consumer, [name, '--help'], 0);
    assert.match(own.stdout, new RegExp(`zmdb ${name}`));
    assert.equal(own.stderr, '');
    const unknown = await bin(consumer, consumer, [name, '--unknown', '--json'], 2);
    assert.match(unknown.json.errors[0].message, /unknown option/);
    const missing = await bin(consumer, consumer, [name, '--config'], 2);
    assert.match(missing.stderr, /argument|value|requires/i);
    await bin(consumer, consumer, [name, 'one', 'two', 'three', '--json'], 2);
  }
  for (const args of [
    ['codegen', '--watch', '--check'],
    ['codegen', '--watch', '--json'],
    ['client', 'generate', '--watch', '--check'],
    ['client', 'generate', '--watch', '--json'],
    ['rollback', '--to', '-1'],
    ['rollback', '--to', '9007199254740992'],
    ['studio', '--port', '65536'],
    ['modules', '--depth', '-1'],
    ['modules', '--json', '--format', 'dot'],
  ])
    await bin(consumer, consumer, args, 2);
  const up = await bin(consumer, consumer, ['up'], 2);
  assert.match(up.stderr, /migrate.*upgrade/);
  await assert.rejects(lstat(join(consumer, 'events.log')), { code: 'ENOENT' });
};
cases.T05 = async () => {
  const minimal = await role('minimal');
  for (const args of [['--help'], ['--version']]) {
    const observed = await node(
      minimal,
      `import {registerHooks} from 'node:module';const loaded=[];registerHooks({load(url,context,next){loaded.push(url);return next(url,context);}});const {runCli}=await import('@zmdb/cli');const code=await runCli(${JSON.stringify(args)},{stdout(){},stderr(){}});console.log(JSON.stringify({code,loaded}));`,
    );
    const value = JSON.parse(observed.stdout);
    assert.equal(value.code, 0);
    assert(
      !value.loaded.some(url => /node:repl|\/@zmdb\/(?:app|web|compiler|migrations)|\/oxfmt\/|\/esbuild\//.test(url)),
      observed.stdout,
    );
  }
  for (const name of ['modules', 'repl', 'studio', 'client']) {
    const args = name === 'client' ? ['client', 'generate'] : name === 'repl' ? ['repl'] : [name];
    const result = await bin(minimal, minimal, args, 2);
    assert.match(result.stderr, new RegExp(`requires @zmdb/(?:app|web); install @zmdb/(?:app|web)`));
  }
  const { consumer, project } = await dataCase();
  const observed = await node(
    consumer,
    `import {registerHooks} from 'node:module';const loaded=[];registerHooks({load(url,context,next){loaded.push(url);return next(url,context);}});const {runCli}=await import('@zmdb/cli');const code=await runCli(['codegen','--project',${JSON.stringify(join(project, 'tsconfig.json'))}],{cwd:${JSON.stringify(project)},stdout(){},stderr(){}});console.log(JSON.stringify({code,loaded}));`,
  );
  const value = JSON.parse(observed.stdout);
  assert.equal(value.code, 0);
  assert(!value.loaded.some(url => /node:repl|\/@zmdb\/(?:app|web)|\/oxfmt\/|\/esbuild\//.test(url)), observed.stdout);
};
cases.T06 = async () => {
  const { consumer, project } = await dataCase();
  const before = await snapshot(join(project, 'src'));
  const stale = await bin(consumer, project, ['codegen', '--check', '--json'], 1);
  assert(stale.json.result.stale.length > 0);
  assert.deepEqual(await snapshot(join(project, 'src')), before);
  const first = await bin(consumer, project, ['codegen', '--json'], 0);
  assert(first.json.result.written.length > 0);
  assert.deepEqual(Object.keys(first.json.result).toSorted(), ['deleted', 'stale', 'written']);
  const current = await snapshot(join(project, 'src'));
  const check = await bin(consumer, project, ['codegen', '--check', '--json'], 0);
  assert.deepEqual(check.json.result.stale, []);
  assert.deepEqual(await snapshot(join(project, 'src')), current);
  await node(
    consumer,
    `import assert from 'node:assert/strict';import {isUser,validateUser} from ${JSON.stringify(pathToFileURL(join(project, 'src/validate.ts')).href)};assert.equal(isUser({id:1,email:'x'}),true);assert.equal(isUser({id:'1',email:'x'}),false);assert.equal(isUser({id:1}),false);assert.equal(validateUser({id:1,email:'x'}).success,true);`,
  );
  const user = join(project, 'src/user.ts');
  await writeFile(
    user,
    (await readFile(user, 'utf8')).replace(
      "email: string & Sql<'text'>;",
      "email: string & Sql<'text'>;\n  active: boolean;",
    ),
  );
  const changed = await snapshot(join(project, 'src'));
  await bin(consumer, project, ['codegen', '--check', '--json'], 1);
  assert.deepEqual(await snapshot(join(project, 'src')), changed);
};
cases.T07 = async () => {
  const fixture = await setup();
  const consumer = fixture.roles.get('setup-data');
  const project = await copyProject(consumer, 'data');
  await node(
    consumer,
    `import assert from 'node:assert/strict';import {existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';import {watchCodegen} from '@zmdb/compiler';import {apiInstanceCount,ReflectSession} from '@zmdb/compiler/reflect';const pause=ms=>new Promise(r=>setTimeout(r,ms));const wait=async predicate=>{for(let i=0;i<1000&&!predicate();i++)await pause(20);assert(predicate());};const stop=Promise.withResolvers();const count=apiInstanceCount();let closes=0,session;const open=ReflectSession.open;ReflectSession.open=function(...args){session=open.apply(this,args);const close=session.close.bind(session);session.close=()=>{closes++;return close();};return session;};const project=${JSON.stringify(join(project, 'tsconfig.json'))};const file=${JSON.stringify(join(project, 'src/user.ts'))};const artifact=${JSON.stringify(join(project, 'src/validate.zmdb.generated.js'))};const fresh=${JSON.stringify(join(project, 'src/new.ts'))};const watching=watchCodegen({project,until:stop.promise,debounceMs:15});try{await wait(()=>existsSync(artifact));assert.equal(apiInstanceCount(),count+1);await pause(30);let before=session.updates.length;writeFileSync(file,readFileSync(file,'utf8')+'\\nexport const changed=1;\\n');await wait(()=>session.updates.length>before);before=session.updates.length;writeFileSync(fresh,'export const added=1;\\n');await wait(()=>session.updates.length>before);assert(session.sourceFile(fresh));before=session.updates.length;unlinkSync(fresh);await wait(()=>session.updates.length>before);assert.equal(session.sourceFile(fresh),undefined);assert.equal(apiInstanceCount(),count+1);}finally{stop.resolve();await watching;ReflectSession.open=open;}assert.equal(closes,1);const bytes=readFileSync(artifact,'utf8');await pause(100);assert.equal(readFileSync(artifact,'utf8'),bytes);`,
  );
};
cases.T08 = async () => {
  const fixture = await setup();
  const consumer = fixture.roles.get('setup-data');
  const project = await copyProject(consumer, 'data');
  await node(
    consumer,
    `import assert from 'node:assert/strict';import {readFileSync,writeFileSync,readdirSync} from 'node:fs';import {watchCodegen} from '@zmdb/compiler';import {ReflectSession} from '@zmdb/compiler/reflect';const project=${JSON.stringify(join(project, 'tsconfig.json'))};const file=${JSON.stringify(join(project, 'src/user.ts'))};const pause=ms=>new Promise(r=>setTimeout(r,ms));const session=ReflectSession.open({project});let borrowedCloses=0;const borrowedClose=session.close.bind(session);session.close=()=>{borrowedCloses++;return borrowedClose();};const usable=()=>{const n=session.updates.length;session.refresh([file]);assert.equal(session.updates.length,n+1);assert(session.sourceFile(file));assert.equal(borrowedCloses,0);};try{for(const rejected of [false,true]){const until=rejected?Promise.reject(new Error('stop')):Promise.resolve();void until.catch(()=>{});await watchCodegen({project,session,until});usable();}const failure=new Error('initial report');await assert.rejects(watchCodegen({project,session,until:Promise.resolve(),log(){throw failure;}}),error=>error===failure);usable();assert(readdirSync(${JSON.stringify(join(project, 'src'))}).some(name=>name.endsWith('.zmdb.generated.js')));let runs=0;const timerFailure=new Error('timer report');const watching=watchCodegen({project,session,debounceMs:10,log(){if(++runs>1)throw timerFailure;}});for(let i=0;i<100&&runs===0;i++)await pause(20);assert.equal(runs,1);writeFileSync(file,readFileSync(file,'utf8')+'\\nexport const tick=1;\\n');await assert.rejects(watching,error=>error===timerFailure);usable();const after=runs;await pause(100);assert.equal(runs,after);const stop=Promise.withResolvers();let pendingLogs=0;const pending=watchCodegen({project,session,until:stop.promise,debounceMs:100,log(){pendingLogs++;}});await pause(25);writeFileSync(file,readFileSync(file,'utf8')+'\\nexport const pending=1;\\n');await pause(10);stop.resolve();await pending;const frozen=pendingLogs;await pause(150);assert.equal(pendingLogs,frozen);usable();}finally{session.close();}assert.equal(borrowedCloses,1);let ownedCloses=0;const open=ReflectSession.open;ReflectSession.open=function(...args){const session=open.apply(this,args);const close=session.close.bind(session);session.close=()=>{ownedCloses++;return close();};return session;};try{const initial=new Error('owned initial');await assert.rejects(watchCodegen({project,log(){throw initial;}}),error=>error===initial);assert.equal(ownedCloses,1);}finally{ReflectSession.open=open;}`,
  );
};
cases.T09 = async () => {
  const { consumer, project } = await dataCase();
  await rm(join(project, 'migrations'), { recursive: true });
  const generated = await bin(consumer, project, ['generate', '--name', 'initial', '--json'], 0);
  assert.equal(generated.json.result.name, 'initial');
  assert(generated.json.result.ops.length > 0);
  const text = await readFile(generated.json.result.file, 'utf8');
  assert.match(text, /CREATE TABLE "users"/);
  assert.match(text, /"id"/);
  assert.match(text, /"email"/);
  assert.match(text, /-- zmdb:up/);
  assert.match(text, /-- zmdb:down/);
  assert.equal(JSON.parse(await readFile(join(project, 'migrations/snapshot.json'), 'utf8')).version, 1);
  const before = await snapshot(join(project, 'migrations'));
  const second = await bin(consumer, project, ['generate', '--json'], 0);
  assert.deepEqual(second.json.result, { ops: [] });
  assert.deepEqual(await snapshot(join(project, 'migrations')), before);
  assert.equal(
    (await readFile(join(project, 'events.log'), 'utf8')).split('\n').filter(row => row === 'config').length,
    2,
  );
};
cases.T10 = async () => {
  const { consumer, project } = await dataCase();
  const first = { version: 20260907000001, name: 'initial' },
    second = { version: 20260907000002, name: 'email' };
  const applied = await bin(consumer, project, ['migrate', '--json'], 0);
  assert.deepEqual(applied.json.result, { applied: [first, second] });
  execSql(project, "INSERT INTO ledger_users VALUES(7,'seven','seven@example.test')");
  assert.deepEqual(sql(project, 'SELECT * FROM ledger_users'), [{ id: 7, name: 'seven', email: 'seven@example.test' }]);
  assert.deepEqual(
    sql(project, 'SELECT version FROM _zmdb_migrations ORDER BY version').map(row => row.version),
    [first.version, second.version],
  );
  const status = await bin(consumer, project, ['status', '--json'], 0);
  assert.deepEqual(status.json.result, {
    migrations: [
      { ...first, applied: true },
      { ...second, applied: true },
    ],
  });
  assert.deepEqual((await bin(consumer, project, ['rollback', '--json'], 0)).json.result, {
    reverted: second,
    versions: [second],
  });
  assert.deepEqual(
    sql(project, 'PRAGMA table_info(ledger_users)').map(row => row.name),
    ['id', 'name'],
  );
  await bin(consumer, project, ['migrate', '--json'], 0);
  assert.deepEqual((await bin(consumer, project, ['rollback', '--to', '0', '--json'], 0)).json.result, {
    reverted: second,
    versions: [second, first],
  });
  assert.deepEqual(sql(project, "SELECT name FROM sqlite_master WHERE name='ledger_users'"), []);
  assert.deepEqual(sql(project, 'SELECT version FROM _zmdb_migrations'), []);
  for (const args of [
    ['rollback', '--to', '0', '--json'],
    ['rollback', '--json'],
  ])
    assert.deepEqual((await bin(consumer, project, args, 0)).json.result, { reverted: null, versions: [] });
};
cases.T11 = async () => {
  const { consumer, project } = await dataCase();
  await writeFile(
    join(project, 'migrations/20260907000002_email.sql'),
    '-- zmdb:up\nCREATE TABLE partial(id INTEGER);\nTHIS IS NOT SQL;\n-- zmdb:down\nDROP TABLE partial;\n',
  );
  await bin(consumer, project, ['migrate', '--json'], 1);
  assert.deepEqual(
    sql(project, 'SELECT version FROM _zmdb_migrations').map(row => row.version),
    [20260907000001],
  );
  assert.deepEqual(sql(project, "SELECT name FROM sqlite_master WHERE name='partial'"), []);
  execSql(project, 'CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL,legacy TEXT);');
  for (const flags of [[], ['--yes'], ['--force']]) {
    const result = await bin(consumer, project, ['push', ...flags, '--json'], 2);
    assert.match(result.json.errors[0].message, flags.includes('--force') ? /--yes/ : /--force/);
    assert(sql(project, 'PRAGMA table_info(users)').some(row => row.name === 'legacy'));
  }
  const terminal = pty([process.execPath, join(consumer, 'node_modules/.bin/zmdb'), 'push', '--force'], {
    cwd: project,
    env: { ZMDB_TEST_DATABASE: join(project, 'database.sqlite') },
  });
  try {
    await waitFor(terminal.read, text => text.includes('[y/N]'));
    terminal.write('n\n');
    const result = await terminal.exited;
    assert.equal(result.code, 1);
    assert(sql(project, 'PRAGMA table_info(users)').some(row => row.name === 'legacy'));
  } finally {
    await terminal.close();
  }
  await bin(consumer, project, ['push', '--force', '--yes', '--json'], 0);
  assert(!sql(project, 'PRAGMA table_info(users)').some(row => row.name === 'legacy'));
};
cases.T12 = async () => {
  const consumer = await role('data');
  for (const kind of [
    'uncommitted-schema',
    'duplicate-version',
    'snapshot-version',
    'missing-down',
    'stale-embedded',
    'drift',
  ]) {
    const project = await copyProject(consumer, 'data');
    await rm(join(project, 'migrations'), { recursive: true });
    await bin(consumer, project, ['generate', '--name', 'initial', '--json'], 0);
    await bin(consumer, project, ['migrate', '--json'], 0);
    const files = await readdir(join(project, 'migrations'));
    const migration = files.find(name => name.endsWith('.sql'));
    assert(migration);
    if (kind === 'uncommitted-schema')
      await writeFile(
        join(project, 'migrations/snapshot.json'),
        JSON.stringify({ version: 1, extensions: [], tables: [] }),
      );
    if (kind === 'duplicate-version')
      await cp(
        join(project, 'migrations', migration),
        join(project, 'migrations', migration.replace('_initial', '_duplicate')),
      );
    if (kind === 'snapshot-version') {
      const path = join(project, 'migrations/snapshot.json'),
        value = JSON.parse(await readFile(path, 'utf8'));
      value.version = 999;
      await writeFile(path, JSON.stringify(value));
    }
    if (kind === 'missing-down') {
      const path = join(project, 'migrations', migration);
      await writeFile(path, (await readFile(path, 'utf8')).split('-- zmdb:down')[0]);
    }
    if (kind === 'stale-embedded') {
      await bin(consumer, project, ['embed'], 0);
      const path = join(project, 'migrations', migration);
      await writeFile(path, (await readFile(path, 'utf8')).replace('-- zmdb:down', '-- changed up\n-- zmdb:down'));
    }
    if (kind === 'drift') execSql(project, 'ALTER TABLE users ADD COLUMN drift TEXT;');
    const result = await bin(consumer, project, ['check', '--json'], 1);
    assert(
      result.json.result.findings.some(row => row.kind === kind),
      JSON.stringify(result.json),
    );
  }
  const project = await copyProject(consumer, 'data');
  await writeFile(
    join(project, 'zmdb.config.ts'),
    "import {sqlite} from '@zmdb/sqlite';export default {schema:'./src/user.ts',dialect:sqlite,project:'./tsconfig.json',out:'./migrations'};\n",
  );
  const result = await bin(consumer, project, ['check', '--json'], undefined);
  assert(result.json.result.skipped.some(row => row.kind === 'drift' && typeof row.reason === 'string'));
};
cases.T13 = async () => {
  const { consumer, project } = await dataCase();
  await bin(consumer, project, ['embed', '--with-down', '--json'], 0);
  const path = join(project, 'migrations/embedded.ts'),
    text = await readFile(path, 'utf8');
  assert(text.indexOf('20260907000001') < text.indexOf('20260907000002'));
  assert.match(text, /sha256:[a-f0-9]{64}/);
  assert.match(text, /DROP TABLE ledger_users/);
  await node(
    consumer,
    `import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {runEmbedded} from '@zmdb/migrations/embedded';import {migrations} from ${JSON.stringify(pathToFileURL(path).href)};const up=['CREATE TABLE ledger_users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);','ALTER TABLE ledger_users ADD COLUMN email TEXT;'];const down=['DROP TABLE ledger_users;','ALTER TABLE ledger_users DROP COLUMN email;'];assert.deepEqual(migrations.map(row=>row.version),[20260907000001,20260907000002]);for(let index=0;index<2;index++){assert.equal(migrations[index].up.trim(),up[index]);assert.equal(migrations[index].down.trim(),down[index]);assert.equal(migrations[index].checksum,'sha256:'+createHash('sha256').update(migrations[index].up).digest('hex'));}const db=new DatabaseSync(':memory:');try{const connection={exec:sql=>db.exec(sql),run:(sql,params)=>db.prepare(sql).run(...params),rows:(sql,params=[])=>db.prepare(sql).all(...params)};assert.deepEqual(await runEmbedded(connection,migrations),[20260907000001,20260907000002]);assert.deepEqual(db.prepare('PRAGMA table_info(ledger_users)').all().map(row=>row.name),['id','name','email']);assert.deepEqual(await runEmbedded(connection,migrations),[]);}finally{db.close();}`,
  );
  const original = await snapshot(join(project, 'migrations'));
  await bin(consumer, project, ['embed', '--with-down', '--json'], 0);
  assert.deepEqual(await snapshot(join(project, 'migrations')), original);
  const config = join(project, 'zmdb.config.ts');
  await writeFile(
    config,
    (await readFile(config, 'utf8')).replace(
      'dialect: sqlite,',
      "dialect: { ...sqlite, name: 'other', migrations: { ...sqlite.migrations, embedded: undefined } },",
    ),
  );
  await bin(consumer, project, ['embed', '--json'], 2);
};
cases.T14 = async () => {
  const { consumer, project } = await dataCase();
  const out = await bin(consumer, project, ['export', '--json'], 0);
  assert(out.json.result.statements.some(text => text.includes('CREATE TABLE "users"')));
  await assert.rejects(lstat(join(project, 'database.sqlite')), { code: 'ENOENT' });
  execSql(project, 'CREATE TABLE remote_users(id INTEGER PRIMARY KEY,email TEXT NOT NULL);');
  const before = await snapshot(join(project, 'src'));
  await bin(consumer, project, ['pull', '--dry-run', '--json'], 0);
  assert.deepEqual(await snapshot(join(project, 'src')), before);
  await bin(consumer, project, ['pull', '--check', '--json'], 1);
  const pulled = await bin(consumer, project, ['pull', '--json'], 0);
  assert(pulled.json.result.files.length > 0);
  const reported = pulled.json.result.files[0].path;
  const target = resolve(project, reported);
  assert.match(await readFile(target, 'utf8'), /interface|type/);
  await writeFile(target, '// human-owned sentinel\n');
  const metadata = await stat(target, { bigint: true });
  const again = await bin(consumer, project, ['pull', '--json'], 1);
  assert(again.json.result.skipped.some(row => row.path === reported));
  assert.equal(await readFile(target, 'utf8'), '// human-owned sentinel\n');
  assert.equal((await stat(target, { bigint: true })).mtimeNs, metadata.mtimeNs);
};
cases.T15 = async () => {
  const { consumer, project } = await dataCase();
  const path = join(project, 'migrations/snapshot.json');
  for (const version of [1, 0, 2]) {
    await writeFile(path, JSON.stringify({ version, tables: [], extensions: [] }) + '\n');
    const before = await snapshot(join(project, 'migrations'));
    const result = await bin(consumer, project, ['upgrade', '--json'], version === 1 ? 0 : 2);
    if (version === 1) assert.deepEqual(result.json.result, { from: 1, to: 1, changed: false });
    assert.deepEqual(await snapshot(join(project, 'migrations')), before);
  }
};

function running(consumer, project, args, env = {}) {
  const child = spawn(process.execPath, [join(consumer, 'node_modules/.bin/zmdb'), ...args], {
    cwd: project,
    env: {
      ...cleanEnvironment(),
      ZMDB_TEST_DATABASE: join(project, 'database.sqlite'),
      ZMDB_FIXTURE_EVENTS: join(project, 'events.log'),
      ...env,
    },
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  trackChild(child);
  let stdout = '',
    stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', text => {
    stdout += text;
  });
  child.stderr.on('data', text => {
    stderr += text;
  });
  const exited = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => accept({ code, signal, stdout, stderr }));
  });
  return {
    child,
    exited,
    read: () => stdout,
    errors: () => stderr,
    async stop(signal = 'SIGTERM') {
      if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, signal);
      const result = await Promise.race([
        exited,
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT stopping owned CLI')), 20_000).unref()),
      ]);
      assert.equal(result.signal, null, result.stderr);
      assert.equal(result.code, 0, result.stderr);
      return result;
    },
  };
}
async function bindPort(port = 0) {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', accept);
  });
  return {
    port: server.address().port,
    async close() {
      await new Promise((accept, reject) => server.close(error => (error ? reject(error) : accept())));
    },
  };
}
cases.T16 = async () => {
  const consumer = await role('product'),
    fixture = await setup(),
    parent = join(consumer, `scaffolds-${sequence++}`);
  await mkdir(parent);
  const result = await bin(consumer, parent, ['new', 'project', 'example', '--json'], 0),
    project = join(parent, 'example');
  const expected = [
    '.gitignore',
    'package.json',
    'scripts/build.mjs',
    'src/app.module.ts',
    'src/health.controller.spec.ts',
    'src/health.controller.ts',
    'src/main.ts',
    'tsconfig.json',
    'vitest.config.ts',
    'zmdb.config.ts',
  ];
  assert.deepEqual(result.json.result.files.map(path => path.slice('example/'.length)).toSorted(), expected.toSorted());
  assert.deepEqual(
    (await snapshot(project)).map(row => row.path),
    expected.toSorted(),
  );
  for (const [kind, name, files] of [
    ['schema', 'account', ['src/account.ts', 'src/account.spec.ts']],
    ['controller', 'posts', ['src/posts.controller.ts', 'src/posts.controller.spec.ts']],
    ['module', 'billing', ['src/billing.module.ts', 'src/billing.module.spec.ts']],
    ['repository', 'account', ['src/account.repository.ts', 'src/account.repository.spec.ts']],
    ['command', 'import-users', ['src/import-users.command.ts', 'src/import-users.command.spec.ts']],
  ]) {
    const created = await bin(consumer, project, ['new', kind, name, '--json'], 0);
    assert.deepEqual(created.json.result.files.toSorted(), files.toSorted());
    assert.match(
      await readFile(
        join(
          project,
          files.find(path => path.endsWith('.spec.ts')),
        ),
        'utf8',
      ),
      /expect\([^)]*\)\./,
    );
  }
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.dependencies).toSorted(), ['@zmdb/sqlite', 'zmdb']);
  for (const range of Object.values({ ...manifest.dependencies, ...manifest.devDependencies }))
    assert.match(range, /^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
  await command(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry',
      fixture.registry.origin,
      '--cache',
      join(project, '.cache'),
      '--userconfig',
      join(project, '.npmrc'),
    ],
    { cwd: project, timeout: 600_000, expected: 0 },
  );
  for (const script of ['typecheck', 'lint', 'fmt:check', 'test', 'build'])
    await command('npm', ['run', script], { cwd: project, timeout: 120_000, expected: 0 });
  const child = spawn(process.execPath, ['dist/main.mjs'], {
    cwd: project,
    env: { ...cleanEnvironment(), PORT: '0' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  trackChild(child);
  const exited = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', accept);
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', text => {
    output += text;
  });
  try {
    const ready = await waitFor(
      () => output,
      text => /http:\/\/127\.0\.0\.1:\d+/.test(text),
    );
    const url = /http:\/\/127\.0\.0\.1:\d+/.exec(ready)[0];
    const response = await fetch(`${url}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGTERM');
    await exited;
  }
};
cases.T17 = async () => {
  const consumer = await role('product'),
    project = join(consumer, `collisions-${sequence++}`);
  await mkdir(project);
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'collisions', private: true, type: 'module' }));
  const before = await snapshot(project);
  await bin(consumer, project, ['new', 'schema', 'account', '--dry-run'], 0);
  assert.deepEqual(await snapshot(project), before);
  await mkdir(join(project, 'src'));
  await writeFile(join(project, 'src/account.ts'), '// rival\n');
  const identity = await stat(join(project, 'src/account.ts'), { bigint: true });
  await bin(consumer, project, ['new', 'schema', 'account', '--force'], 1);
  assert.equal(await readFile(join(project, 'src/account.ts'), 'utf8'), '// rival\n');
  assert.equal((await stat(join(project, 'src/account.ts'), { bigint: true })).ino, identity.ino);
  await bin(consumer, project, ['new', 'schema', '../escape'], 2);
  await bin(consumer, project, ['new', 'bogus', 'name'], 2);
  const outside = join(consumer, `outside-${sequence++}`);
  await mkdir(outside);
  await rm(join(project, 'src'), { recursive: true });
  await symlink(outside, join(project, 'src'));
  await bin(consumer, project, ['new', 'schema', 'escape'], undefined);
  assert.deepEqual(await readdir(outside), []);
  await unlink(join(project, 'src'));
  await node(
    consumer,
    `import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {spawnSync} from 'node:child_process';const original=fs.writeFile;let seen=0;fs.writeFile=async function(path,...args){if(String(path).startsWith(${JSON.stringify(project)})&&String(path).endsWith('.ts')&&++seen===2){const raced=spawnSync(process.execPath,['--input-type=module','-e','import {writeFileSync} from "node:fs";writeFileSync('+JSON.stringify(String(path))+','+JSON.stringify('// real competing writer\\n')+',{flag:"wx"});']);assert.equal(raced.status,0);}return original.call(this,path,...args);};syncBuiltinESMExports();const {runCli}=await import('@zmdb/cli');let errors='';const code=await runCli(['new','schema','raced'],{cwd:${JSON.stringify(project)},stdout(){},stderr(text){errors+=text;}});assert.equal(code,1);assert.match(errors,/overwrite|exist/);assert.equal(seen,2);const files=await fs.readdir(${JSON.stringify(join(project, 'src'))});assert.deepEqual(files.toSorted(),['raced.spec.ts','raced.ts']);assert.equal(await fs.readFile(${JSON.stringify(join(project, 'src/raced.spec.ts'))},'utf8'),'// real competing writer\\n');assert((await fs.readFile(${JSON.stringify(join(project, 'src/raced.ts'))},'utf8')).includes('interface'));`,
  );
  const workspace = join(consumer, `workspace-${sequence++}`);
  await mkdir(join(workspace, 'packages/a'), { recursive: true });
  await mkdir(join(workspace, 'packages/b'), { recursive: true });
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  for (const name of ['a', 'b'])
    await writeFile(join(workspace, 'packages', name, 'package.json'), JSON.stringify({ name }));
  await bin(consumer, workspace, ['new', 'schema', 'account'], 2);
  await bin(consumer, workspace, ['new', 'schema', 'account', '--package', 'a'], 0);
  assert.deepEqual(await readdir(join(workspace, 'packages/b')), ['package.json']);
};
cases.T18 = async () => {
  const consumer = await role('app'),
    project = await copyProject(consumer, 'app');
  const result = await bin(consumer, project, ['modules', '--providers', '--json'], 0);
  assert.deepEqual(
    result.json.result.findings.filter(row => row.severity === 'error'),
    [],
  );
  const encoded = JSON.stringify(result.json.result);
  for (const value of ['AppModule', 'AdminModule', 'HealthController', 'DATABASE', 'USERS', 'ADMIN'])
    assert(encoded.includes(value), encoded);
  for (const format of ['tree', 'dot']) {
    const rendered = await bin(consumer, project, ['modules', '--providers', '--format', format], 0);
    assert.match(rendered.stdout, /AppModule/);
    if (format === 'dot') assert.match(rendered.stdout, /digraph/);
  }
  await assert.rejects(lstat(join(project, 'events.log')), { code: 'ENOENT' });
};
cases.T19 = async () => {
  const consumer = await role('app'),
    project = await copyProject(consumer, 'app');
  for (const args of [
    ['modules', './src/app.module.ts#Missing'],
    ['modules', '--format', 'json'],
    ['modules', '--depth', '-1'],
    ['modules', '--depth', '0.5'],
    ['modules', '--json', '--format', 'tree'],
    ['graph'],
  ])
    await bin(consumer, project, args, 2);
  const file = join(project, 'src/app.module.ts'),
    source = await readFile(file, 'utf8');
  await writeFile(
    file,
    source.replace(
      '@Module({ providers: [{ token: ADMIN',
      '@Module({ providers: [{ token: DATABASE, useValue: {name:"duplicate",onShutdown(){}} }, { token: ADMIN',
    ),
  );
  const errors = await bin(consumer, project, ['modules', '--json'], 1);
  assert(errors.json.result.findings.some(row => row.severity === 'error'));
  await writeFile(file, source.replace('import { Module, lazy }', 'import { Module, lazy }'));
  const warningSource = source
    .replace(
      "import { Module, lazy } from '@zmdb/app/modules';",
      "import { Module, lazy } from '@zmdb/app/modules';\nimport {createToken} from '@zmdb/app/di';\nconst FIRST=createToken('duplicate'), SECOND=createToken('duplicate');",
    )
    .replace('  providers: [', '  providers: [{token:FIRST,useValue:1},{token:SECOND,useValue:2},');
  await writeFile(file, warningSource);
  const warning = await bin(consumer, project, ['modules', '--json'], 0);
  assert(
    warning.json.result.findings.some(row => row.kind === 'duplicate-token-description' && row.severity === 'warning'),
  );
  assert(!warning.json.result.findings.some(row => row.severity === 'error'));
  await writeFile(file, source);
  const filtered = await bin(consumer, project, ['modules', '--module', 'AppModule', '--depth', '0', '--providers'], 0);
  assert.match(filtered.stdout, /AppModule/);
};
cases.T20 = async () => {
  const consumer = await role('app'),
    project = await copyProject(consumer, 'app'),
    history = join(consumer, `history-${sequence++}`),
    events = join(project, 'events.log');
  await writeFile(history, 'existing history\n');
  await chmod(history, 0o644);
  assert.equal((await stat(history)).mode & 0o777, 0o644);
  const terminal = pty([process.execPath, join(consumer, 'node_modules/.bin/zmdb'), 'repl'], {
    cwd: project,
    env: { ZMDB_FIXTURE_EVENTS: events, ZMDB_REPL_HISTORY: history, FORCE_COLOR: '1' },
  });
  try {
    await waitFor(terminal.read, text => text.includes('zmdb> '));
    assert.match(await readFile(events, 'utf8'), /factory:database/);
    terminal.write('get("USERS").list()\n');
    await waitFor(terminal.read, text => text.includes('users@fixture'));
    terminal.write('tokens\n');
    await waitFor(terminal.read, text => text.includes('ADMIN'));
    terminal.write('await request("/health/")\n');
    await waitFor(terminal.read, text => text.includes('200'));
    terminal.write('await load("AdminModule"); get("ADMIN")\n');
    await waitFor(terminal.read, text => text.includes('enabled: true'));
    terminal.eof();
    const result = await terminal.exited;
    assert.equal(result.code, 0, result.stderr);
  } finally {
    await terminal.close();
  }
  assert.equal((await stat(history)).mode & 0o777, 0o600);
  assert.match(await readFile(history, 'utf8'), /get\("USERS"\)/);
  const recorded = (await readFile(events, 'utf8')).trim().split('\n');
  assert(recorded.indexOf('shutdown:repository') < recorded.indexOf('shutdown:database'));
  assert.equal(recorded.filter(row => row === 'shutdown:database').length, 1);
};
cases.T21 = async () => {
  const consumer = await role('app'),
    project = await copyProject(consumer, 'app');
  for (const args of [['repl'], ['repl', '--json'], ['repl', '--host', '0.0.0.0'], ['repl', '--port', '1']])
    await bin(consumer, project, args, 2);
  const invalid = pty([process.execPath, join(consumer, 'node_modules/.bin/zmdb'), 'repl'], {
    cwd: project,
    env: { ZMDB_REPL_HISTORY: join(project, 'history') },
  });
  try {
    const result = await invalid.exited;
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /history.*project|project.*history/);
  } finally {
    await invalid.close();
  }
  for (const phase of ['onModuleInit', 'onShutdown']) {
    const file = join(project, 'src/app.module.ts'),
      source = await readFile(file, 'utf8');
    const eventName = phase === 'onModuleInit' ? 'init:database' : 'shutdown:database';
    const fault = new RegExp(`${phase}\\(\\)\\s*\\{\\s*event\\('` + eventName + `'\\);`, 'g');
    assert.equal([...source.matchAll(fault)].length, 1);
    await writeFile(file, source.replace(fault, `${phase}() { throw new Error('fixture ${phase}');`));
    const terminal = pty([process.execPath, join(consumer, 'node_modules/.bin/zmdb'), 'repl', '--no-history'], {
      cwd: project,
    });
    try {
      if (phase === 'onShutdown') {
        await waitFor(terminal.read, text => text.includes('zmdb> '));
        terminal.eof();
      }
      const result = await terminal.exited;
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, new RegExp(`fixture ${phase}`));
    } finally {
      await terminal.close();
      await writeFile(file, source);
    }
  }
};
cases.T22 = async () => {
  const consumer = await role('app'),
    project = await copyProject(consumer, 'data');
  execSql(
    project,
    "CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL);INSERT INTO users VALUES(1,'public@example.test');CREATE TABLE private_users(id INTEGER PRIMARY KEY,secret TEXT NOT NULL);INSERT INTO private_users VALUES(1,'never-show-me');CREATE TABLE undeclared(secret TEXT);INSERT INTO undeclared VALUES('unlisted');",
  );
  const active = running(consumer, project, ['studio']);
  let port;
  try {
    const text = await waitFor(active.read, output => /http:\/\/127\.0\.0\.1:\d+/.test(output));
    const url = /http:\/\/127\.0\.0\.1:(\d+)/.exec(text);
    port = Number(url[1]);
    const processRoot = `/proc/${active.child.pid}`;
    const sockets = new Set();
    for (const fd of await readdir(join(processRoot, 'fd'))) {
      try {
        const link = await readlink(join(processRoot, 'fd', fd));
        const match = /^socket:\[(\d+)\]$/.exec(link);
        if (match) sockets.add(match[1]);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const portHex = port.toString(16).toUpperCase().padStart(4, '0');
    const listeners = (await readFile(join(processRoot, 'net/tcp'), 'utf8'))
      .trim()
      .split('\n')
      .slice(1)
      .map(line => line.trim().split(/\s+/))
      .filter(fields => fields[3] === '0A' && sockets.has(fields[9]) && fields[1].endsWith(`:${portHex}`));
    assert.deepEqual(
      listeners.map(fields => fields[1]),
      [`0100007F:${portHex}`],
    );
    const index = await fetch(url[0]);
    assert.equal(index.status, 200);
    const html = await index.text();
    assert.match(html, /users/);
    assert(!html.includes('undeclared'));
    assert.match(html, /<html|<!doctype/i);
    const users = await fetch(`${url[0]}/tables/users`);
    assert.equal(users.status, 200);
    assert.match(await users.text(), /public@example\.test/);
    const secret = await fetch(`${url[0]}/tables/private_users`);
    assert.equal(secret.status, 200);
    assert(!(await secret.text()).includes('never-show-me'));
    const undeclared = await fetch(`${url[0]}/tables/undeclared`);
    assert.equal(undeclared.status, 400);
    assert.match(await undeclared.text(), /undeclared table/);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      assert.equal((await fetch(`${url[0]}/tables/users`, { method })).status, 405);
  } finally {
    await active.stop();
  }
  const probe = await bindPort(port);
  await probe.close();
};
cases.T23 = async () => {
  const consumer = await role('app');
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const project = await copyProject(consumer, 'data');
    execSql(project, 'CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL);');
    const active = running(consumer, project, ['studio']);
    const ready = await waitFor(active.read, output => /http:\/\/127\.0\.0\.1:\d+/.test(output));
    const port = Number(/127\.0\.0\.1:(\d+)/.exec(ready)[1]);
    await active.stop(signal);
    const probe = await bindPort(port);
    await probe.close();
    const events = await readFile(join(project, 'events.log'), 'utf8');
    assert.equal(events.split('\n').filter(row => row === 'driver:close').length, 1);
  }
  const project = await copyProject(consumer, 'data'),
    occupied = await bindPort();
  try {
    const result = await bin(consumer, project, ['studio', '--port', String(occupied.port)], 1);
    assert(!result.stdout.includes('http://'));
    assert.match(result.stderr, /EADDRINUSE|address already in use/);
  } finally {
    await occupied.close();
  }
  await bin(consumer, project, ['studio', '--host', '0.0.0.0'], 2);
  await bin(consumer, project, ['studio', '--write'], 2);
};
cases.T24 = async () => {
  const consumer = await role('app'),
    project = await copyProject(consumer, 'http');
  const run = await bin(consumer, project, ['client', 'generate', '--json'], 0);
  assert.deepEqual(run.json.result.operations, ['get_health', 'get_users_userId']);
  assert.equal(run.json.result.contractFormat, 1);
  const document = JSON.parse(await readFile(join(project, 'generated/openapi.json'), 'utf8'));
  const operation = document.paths['/users/{userId}'].get;
  assert.equal(operation.operationId, 'get_users_userId');
  assert.equal(operation.parameters[0].name, 'userId');
  assert.equal(operation.parameters[0].in, 'path');
  assert.equal(operation.parameters[0].required, true);
  const schemas = document.components?.schemas ?? {};
  const response = operation.responses['200'].content['application/json'].schema;
  const body = response.$ref ? schemas[response.$ref.split('/').at(-1)] : response;
  assert.deepEqual(Object.keys(body.properties).toSorted(), ['displayName', 'id']);
  assert.deepEqual(body.required.toSorted(), ['displayName', 'id']);
  assert.equal(body.properties.displayName.type, 'string');
  assert.equal(body.properties.id.type, 'string');
  const client = await readFile(join(project, 'generated/http-client.generated.ts'), 'utf8');
  assert.match(client, /get_users_userId/);
  assert.match(client, /displayName/);
  assert(!client.includes(root));
  assert(!client.includes(project));
  await command(
    join(consumer, 'node_modules/.bin/tsc'),
    [
      '--ignoreConfig',
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      join(project, 'generated/http-client.generated.ts'),
    ],
    { cwd: consumer, expected: 0 },
  );
  await node(
    consumer,
    `import assert from 'node:assert/strict';import {registerHooks} from 'node:module';globalThis.__cliCompilerCalls=0;registerHooks({load(url,context,next){const loaded=next(url,context);if(url.endsWith('/@zmdb/web/dist/contract/compiler/index.js')){const text=String(loaded.source);assert(text.includes('export function compileHttpContracts('));return {...loaded,source:text.replace('export function compileHttpContracts(', 'function originalCompileHttpContracts(')+'\\nexport function compileHttpContracts(...args){globalThis.__cliCompilerCalls++;return originalCompileHttpContracts(...args);}' };}return loaded;}});const {loadConfig}=await import('@zmdb/compiler/config');const {generateHttpArtifacts}=await import('@zmdb/cli');const config=await loadConfig({cwd:${JSON.stringify(project)}});delete globalThis.__zmdbHttpContractFixtureLoads;const generated=await generateHttpArtifacts(config);assert.equal(globalThis.__zmdbHttpContractFixtureLoads,1);assert.equal(globalThis.__cliCompilerCalls,1);assert.deepEqual(generated.result.operations,['get_health','get_users_userId']);const client=await import(${JSON.stringify(pathToFileURL(join(project, 'generated/http-client.generated.ts')).href)});assert.equal(typeof client.createApiClient,'function');`,
  );
};
cases.T25 = async () => {
  const consumer = await role('app'),
    project = await copyProject(consumer, 'http');
  await bin(consumer, project, ['client', 'generate', '--json'], 0);
  const before = await snapshot(join(project, 'generated'));
  await bin(consumer, project, ['client', 'generate', '--json'], 0);
  assert.deepEqual(await snapshot(join(project, 'generated')), before);
  await bin(consumer, project, ['client', 'generate', '--check', '--json'], 0);
  assert.deepEqual(await snapshot(join(project, 'generated')), before);
  const models = join(project, 'src/models.ts');
  await writeFile(models, (await readFile(models, 'utf8')).replace('displayName: string', 'displayName: number'));
  await bin(consumer, project, ['client', 'generate', '--check', '--json'], 1);
  assert.deepEqual(await snapshot(join(project, 'generated')), before);
  await bin(consumer, project, ['client', 'generate', '--json'], 0);
  const active = running(consumer, project, ['client', 'generate', '--watch']);
  try {
    await waitFor(active.read, text => /current|generated/.test(text));
    const prior = await snapshot(join(project, 'generated'));
    await writeFile(join(project, 'src/unrelated.ts'), "export const unrelated='changed';\n");
    await new Promise(accept => setTimeout(accept, 150));
    assert.deepEqual(await snapshot(join(project, 'generated')), prior);
    await writeFile(models, (await readFile(models, 'utf8')).replace('displayName: number', 'displayName: boolean'));
    await waitFor(
      () => readFile(join(project, 'generated/http-client.generated.ts'), 'utf8'),
      text => text.includes('displayName: boolean'),
    );
  } finally {
    await active.stop();
  }
  const oldClient = await readFile(join(project, 'generated/http-client.generated.ts'), 'utf8'),
    oldOpenApi = await readFile(join(project, 'generated/openapi.json'), 'utf8');
  await writeFile(models, (await readFile(models, 'utf8')).replace('displayName: boolean', 'displayName: number'));
  await node(
    consumer,
    `import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {dirname} from 'node:path';const rename=fs.rename;let rejected=0;fs.rename=async function(from,to){if(String(to)===${JSON.stringify(join(project, 'generated/http-client.generated.ts'))}){rejected++;const parent=dirname(to);await fs.chmod(parent,0o500);try{return await rename.call(this,from,to);}finally{await fs.chmod(parent,0o700);}}return rename.call(this,from,to);};syncBuiltinESMExports();const {runCli}=await import('@zmdb/cli');let error='';const code=await runCli(['client','generate'],{cwd:${JSON.stringify(project)},stdout(){},stderr(text){error+=text;}});assert.equal(rejected,1);assert.equal(code,1);assert.match(error,/EACCES|permission denied/);`,
  );
  assert.equal(await readFile(join(project, 'generated/http-client.generated.ts'), 'utf8'), oldClient);
  const completed = await readFile(join(project, 'generated/openapi.json'), 'utf8');
  assert.notEqual(completed, oldOpenApi);
  const document = JSON.parse(completed);
  const operation = document.paths['/users/{userId}'].get;
  const projected = operation.responses['200'].content['application/json'].schema;
  const shape = projected.$ref ? document.components.schemas[projected.$ref.split('/').at(-1)] : projected;
  assert.equal(shape.properties.displayName.type, 'number');
  assert(!(await readdir(join(project, 'generated'))).some(name => name.endsWith('.tmp')));
};
cases.T27 = async () => {
  const consumer = await role('app');
  for (const args of [['codegen', '--watch'], ['client', 'generate', '--watch'], ['studio']]) {
    const kind = args[0] === 'client' ? 'http' : 'data',
      one = await copyProject(consumer, kind),
      two = await copyProject(consumer, kind),
      first = running(consumer, one, args),
      second = running(consumer, two, args);
    try {
      if (args[0] === 'codegen') {
        await waitFor(
          () => readdir(join(one, 'src')),
          names => names.some(name => name.endsWith('.generated.js')),
        );
        await waitFor(
          () => readdir(join(two, 'src')),
          names => names.some(name => name.endsWith('.generated.js')),
        );
      } else {
        await waitFor(first.read, text => text.length > 0);
        await waitFor(second.read, text => text.length > 0);
      }
      await first.stop('SIGINT');
      assert.equal(second.child.exitCode, null);
      assert.equal(second.child.signalCode, null);
    } finally {
      const stopped = await Promise.allSettled([first.stop(), second.stop('SIGTERM')]);
      const failures = stopped.filter(result => result.status === 'rejected').map(result => result.reason);
      assert.deepEqual(failures, [], 'CLI sibling termination failed');
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const project = await copyProject(consumer, 'app'),
      terminal = pty([process.execPath, join(consumer, 'node_modules/.bin/zmdb'), 'repl', '--no-history'], {
        cwd: project,
        env: { ZMDB_FIXTURE_EVENTS: join(project, 'events.log') },
      });
    try {
      await waitFor(terminal.read, text => text.includes('zmdb> '));
      terminal.signal(signal);
      const result = await terminal.exited;
      assert.equal(result.code, 0, result.output);
    } finally {
      await terminal.close();
    }
  }
  const project = await copyProject(consumer, 'data');
  await bin(consumer, project, ['status', '--json'], 0);
  assert.equal(
    (await readFile(join(project, 'events.log'), 'utf8')).split('\n').filter(row => row === 'driver:close').length,
    1,
  );
};
cases.T28 = async () => {
  const consumer = await role('nested');
  await node(
    consumer,
    `import assert from 'node:assert/strict';const {runCli}=await import('@zmdb/cli');assert.equal(await runCli(['--version'],{stdout(){},stderr(){}}),0);await assert.rejects(import('@zmdb/compiler'),{code:'ERR_MODULE_NOT_FOUND'});for(const name of ['@zmdb/cli/config','@zmdb/cli/bin','zmdb-codegen'])await assert.rejects(import(name));`,
  );
  const data = await role('data');
  const installed = await realpath(join(data, 'node_modules/@zmdb/cli'));
  assert(installed.startsWith(join(data, 'node_modules') + '/'));
  assert(!installed.startsWith(root + '/'));
};
