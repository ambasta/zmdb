import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [candidate, out, nonce, zmdbBundle = 'zmdb'] = process.argv.slice(2);
const artifact = name => import(pathToFileURL(path.join(out, 'artifacts', `${name}.mjs`)).href);
const { assertUserCreate } = await artifact('validator');
const jsonUser = raw => {
  const value = assertUserCreate(raw);
  return { name: value.name, email: value.email };
};
const peerRequire = createRequire(path.join(out, 'tooling/package.json'));
let close;
let port;

function rawResponse(request) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/text')
    return new Response('hello world', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (request.method === 'GET' && url.pathname.startsWith('/user/'))
    return new Response(decodeURIComponent(url.pathname.slice(6)), {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  if (request.method === 'POST' && url.pathname === '/user') {
    return request
      .json()
      .then(body => Response.json(jsonUser(body)))
      .catch(() => new Response('invalid', { status: 400 }));
  }
  return new Response('not found', { status: 404 });
}

if (candidate === 'fastify-node') {
  const app = peerRequire('fastify')({ logger: false });
  app.get('/text', (_request, reply) => reply.type('text/plain; charset=utf-8').send('hello world'));
  app.get('/user/:id', (request, reply) => reply.type('text/plain; charset=utf-8').send(request.params.id));
  app.post('/user', (request, reply) => {
    try {
      return jsonUser(request.body);
    } catch {
      return reply.code(400).send('invalid');
    }
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  port = app.server.address().port;
  close = () => app.close();
} else if (candidate === 'elysia-bun') {
  const { Elysia } = peerRequire('elysia');
  const app = new Elysia()
    .get('/text', () => 'hello world')
    .get('/user/:id', ({ params }) => params.id)
    .post('/user', ({ body, set }) => {
      try {
        return jsonUser(body);
      } catch {
        set.status = 400;
        return 'invalid';
      }
    })
    .listen({ hostname: '127.0.0.1', port: 0 });
  port = app.server.port;
  close = () => app.stop(true);
} else if (candidate.endsWith('-node')) {
  const zmdb = candidate === 'zmdb-node' ? (await artifact(zmdbBundle)).nodeHandler : undefined;
  const server = createServer(
    zmdb ??
      ((request, response) => {
        if (request.method === 'GET' && request.url === '/text') {
          response.setHeader('content-type', 'text/plain; charset=utf-8');
          response.end('hello world');
          return;
        }
        if (request.method === 'GET' && request.url.startsWith('/user/')) {
          response.setHeader('content-type', 'text/plain; charset=utf-8');
          response.end(decodeURIComponent(request.url.slice(6)));
          return;
        }
        if (request.method === 'POST' && request.url === '/user') {
          let body = '';
          request.setEncoding('utf8');
          request.on('data', chunk => {
            body += chunk;
          });
          request.on('end', () => {
            try {
              response.setHeader('content-type', 'application/json');
              response.end(JSON.stringify(jsonUser(JSON.parse(body))));
            } catch {
              response.statusCode = 400;
              response.end('invalid');
            }
          });
          return;
        }
        response.statusCode = 404;
        response.end('not found');
      }),
  );
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  close = () => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
} else {
  let handler;
  if (candidate.startsWith('zmdb-')) handler = (await artifact(zmdbBundle)).fetchHandler;
  else if (candidate === 'hono-deno') {
    const { Hono } = await artifact('hono');
    const app = new Hono();
    app.get('/text', context => context.text('hello world'));
    app.get('/user/:id', context => context.text(context.req.param('id')));
    app.post('/user', async context => {
      try {
        return context.json(jsonUser(await context.req.json()));
      } catch {
        return context.text('invalid', 400);
      }
    });
    handler = app.fetch;
  } else handler = rawResponse;
  if (globalThis.Bun) {
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler });
    port = server.port;
    close = () => server.stop(true);
  } else {
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, handler);
    port = server.addr.port;
    close = () => server.shutdown();
  }
}

console.log(JSON.stringify({ candidate, nonce, pid: process.pid, port }));
process.once('SIGTERM', async () => {
  try {
    await close();
    process.exitCode = 0;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
