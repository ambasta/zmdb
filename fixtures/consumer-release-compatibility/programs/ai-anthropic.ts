import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import Anthropic from '@anthropic-ai/sdk';
import { anthropicDriver } from '@zmdb/ai-anthropic';

const requests: { path: string | undefined; key: string | string[] | undefined; body: unknown }[] = [];
const server = createServer(async (request, response) => {
  const chunks: string[] = [];
  request.setEncoding('utf8');
  for await (const chunk of request) chunks.push(String(chunk));
  requests.push({
    path: request.url,
    key: request.headers['x-api-key'],
    body: JSON.parse(chunks.join('')),
  });
  response.setHeader('content-type', 'application/json');
  response.end(
    JSON.stringify({
      id: 'msg-release',
      type: 'message',
      role: 'assistant',
      model: 'wiremock',
      content: [{ type: 'text', text: 'reply-π' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );
});
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
try {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = new Anthropic({ apiKey: 'wiremock-only', baseURL: `http://127.0.0.1:${address.port}`, maxRetries: 0 });
  const driver = anthropicDriver({ client, model: 'wiremock', maxOutputTokens: 16 });
  assert.deepEqual(
    await driver.next(
      [
        { role: 'system', content: 'system-π' },
        { role: 'user', content: 'request-π' },
      ],
      [],
    ),
    { role: 'assistant', content: 'reply-π' },
  );
  assert.deepEqual(requests, [
    {
      path: '/v1/messages',
      key: 'wiremock-only',
      body: {
        model: 'wiremock',
        max_tokens: 16,
        system: 'system-π',
        messages: [{ role: 'user', content: 'request-π' }],
        tools: [],
      },
    },
  ]);
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}
