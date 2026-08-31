// Shared-contract correctness check — the Node equivalent of the-benchmarker's
// `.spec/route_spec.rb`. Validates the running app (default http://localhost:3000)
// against the exact contract BEFORE any load test:
//   GET  /          → 2xx, empty body
//   GET  /user/:id  → 2xx, body === the id path param
//   POST /user      → 2xx, empty body
// Exits non-zero on any violation (so the runner refuses to benchmark a wrong app).

const HOST = process.env.HOST ?? 'http://localhost:3000';

function assert(cond, message) {
  if (!cond) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
  } else {
    console.info(`✓ ${message}`);
  }
}

async function main() {
  // GET / → 2xx, empty
  {
    const res = await fetch(`${HOST}/`);
    const body = await res.text();
    assert(res.status >= 200 && res.status < 300, `GET / responds 2xx (got ${res.status})`);
    assert(body === '', `GET / body is empty (got ${JSON.stringify(body)})`);
  }

  // GET /user/:id → 2xx, body is the id
  {
    const id = '42';
    const res = await fetch(`${HOST}/user/${id}`);
    const body = await res.text();
    assert(res.status >= 200 && res.status < 300, `GET /user/:id responds 2xx (got ${res.status})`);
    assert(body === id, `GET /user/:id body equals the id (want "${id}", got ${JSON.stringify(body)})`);
  }

  // GET /user/:id with a different id → echoes that id
  {
    const id = '99999';
    const res = await fetch(`${HOST}/user/${id}`);
    const body = await res.text();
    assert(body === id, `GET /user/:id echoes the given id (want "${id}", got ${JSON.stringify(body)})`);
  }

  // POST /user → 2xx, empty
  {
    const res = await fetch(`${HOST}/user`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    const body = await res.text();
    assert(res.status >= 200 && res.status < 300, `POST /user responds 2xx (got ${res.status})`);
    assert(body === '', `POST /user body is empty (got ${JSON.stringify(body)})`);
  }

  if (process.exitCode === 1) {
    console.error('\nContract check FAILED — refusing to benchmark a non-compliant app.');
  } else {
    console.info('\nContract check PASSED — app fulfills the-benchmarker/web-frameworks contract.');
  }
}

main().catch(err => {
  console.error('contract check error:', err);
  process.exit(1);
});
