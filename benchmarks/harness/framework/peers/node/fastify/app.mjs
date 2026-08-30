// fastify — the-benchmarker contract (GET / empty, GET /user/:id -> id, POST /user empty)
import Fastify from 'fastify';
const app = Fastify();
// The contract's POST /user has no body/content-type; accept any content type
// (incl. none) so an empty POST is 2xx rather than 415.
app.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined));
app.get('/', (_req, reply) => reply.send(''));
app.get('/user/:id', (req, reply) => reply.send(String(req.params.id)));
app.post('/user', (_req, reply) => reply.send(''));
app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
