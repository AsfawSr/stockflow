import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getApiHealth } from '../src/lib/api-health';

test('recognizes the StockFlow API and avoids caching health checks', async (context) => {
  context.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.ok(url.endsWith('/api/health'));
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ status: 'ok', service: 'stockflow-api' });
  });

  const health = await getApiHealth();
  assert.equal(health.connected, true);
  assert.deepEqual(health.response, { status: 'ok', service: 'stockflow-api' });
  assert.ok(health.durationMs >= 0);
  assert.ok(Number.isFinite(Date.parse(health.checkedAt)));
});

test('handles an unavailable API', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });

  const health = await getApiHealth();
  assert.equal(health.connected, false);
  assert.equal(health.response, null);
});

test('handles a failed HTTP response', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));

  const health = await getApiHealth();
  assert.equal(health.connected, false);
  assert.equal(health.detail, 'API returned HTTP 503.');
});

test('rejects a response from the wrong service', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ status: 'ok', service: 'other-api' }),
  );

  const health = await getApiHealth();
  assert.equal(health.connected, false);
  assert.equal(health.detail, 'Unexpected health response.');
});

test('handles malformed JSON', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('not json'));

  const health = await getApiHealth();
  assert.equal(health.connected, false);
  assert.equal(health.response, null);
});
