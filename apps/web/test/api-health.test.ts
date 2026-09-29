import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getApiHealth, isDatabaseReady } from '../src/lib/api-health';

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

test('checks database readiness with a fresh bounded request', async (context) => {
  context.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.ok(url.endsWith('/api/health/ready'));
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ status: 'ok', service: 'stockflow-api', database: 'connected' });
  });

  assert.equal(await isDatabaseReady(), true);
});

test('does not treat liveness alone as database readiness', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ status: 'ok', service: 'stockflow-api' }),
  );

  assert.equal(await isDatabaseReady(), false);
});

test('marks the database unavailable after a readiness failure', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ status: 'error', database: 'unavailable' }, { status: 503 }),
  );

  assert.equal(await isDatabaseReady(), false);
});

test('rejects readiness from another service', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ status: 'ok', service: 'other-api', database: 'connected' }),
  );

  assert.equal(await isDatabaseReady(), false);
});

test('handles database readiness connection failures', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });

  assert.equal(await isDatabaseReady(), false);
});

test('handles malformed database readiness JSON', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('not json'));

  assert.equal(await isDatabaseReady(), false);
});
