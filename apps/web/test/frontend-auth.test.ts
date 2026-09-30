import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiRequest } from '../src/lib/api-client';
import { cookieNames, privateCookieOptions } from '../src/lib/cookie-policy';
import {
  emptySchema,
  loginSchema,
  sessionSchema,
  signupSchema,
  userSchema,
} from '../src/lib/contracts';

const user = {
  id: '8ed13b94-fd8b-4079-848e-f22edaa8ce05',
  email: 'user@example.test',
  displayName: 'User',
};
const password = 'a long test passphrase';

test('normalizes email without modifying passwords', () => {
  assert.deepEqual(loginSchema.parse({ email: ' USER@EXAMPLE.TEST ', password: ` ${password} ` }), {
    email: user.email,
    password: ` ${password} `,
  });
});

test('requires a matching confirmation and a sufficiently long signup password', () => {
  const input = { email: user.email, displayName: 'User', password, confirmPassword: password };
  assert.equal(signupSchema.safeParse(input).success, true);
  assert.equal(signupSchema.safeParse({ ...input, confirmPassword: 'different' }).success, false);
  assert.equal(
    signupSchema.safeParse({ ...input, password: 'short', confirmPassword: 'short' }).success,
    false,
  );
});

test('does not accept expired or malformed session responses', () => {
  const session = {
    user,
    accessToken: 'a'.repeat(43),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  assert.equal(sessionSchema.safeParse(session).success, true);
  assert.equal(sessionSchema.safeParse({ ...session, accessToken: 'invalid' }).success, false);
  assert.equal(
    sessionSchema.safeParse({ ...session, expiresAt: new Date(0).toISOString() }).success,
    false,
  );
});

test('uses HTTP-only same-site cookies with secure host-only production names', () => {
  assert.deepEqual(privateCookieOptions(true), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
  assert.equal(privateCookieOptions(false).httpOnly, true);
  assert.equal(privateCookieOptions(false).secure, false);
  assert.ok(cookieNames(true).session.startsWith('__Host-'));
});

test('sends tokens only as headers, disables caching and redirects, and strips private response fields', async (context) => {
  context.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.ok(url.endsWith('/api/auth/me'));
    assert.ok(!url.includes('test-token'));
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer test-token');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ ...user, passwordHash: 'private' });
  });
  const result = await apiRequest('/auth/me', userSchema, { token: 'test-token' });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.data, user);
});

test('does not expose upstream error contents', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: 'private database details' }, { status: 500 }),
  );
  const result = await apiRequest('/auth/me', userSchema);
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('handles service outages without treating them as signed-out sessions', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('connection failed');
  });
  const result = await apiRequest('/auth/me', userSchema);
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('rejects malformed success bodies', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'unexpected' }));
  const result = await apiRequest('/auth/me', userSchema);
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
});

test('accepts an empty logout response', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  assert.deepEqual(await apiRequest('/auth/logout', emptySchema, { method: 'POST' }), {
    ok: true,
    status: 204,
    data: null,
  });
});
