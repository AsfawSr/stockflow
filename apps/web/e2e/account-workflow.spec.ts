import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const runId = randomUUID();
const emails = [`browser-${runId}@example.test`, `outsider-${runId}@example.test`];
const password = 'a browser-only test passphrase';
const firstName = `Browser ${runId.slice(0, 8)} North`;
const renamed = `${firstName} Updated`;
const longName = `Browser ${runId.slice(0, 8)} ${'Warehouse'.repeat(14)}`;
const organizationIds: string[] = [];
const mailDirectory = resolve(__dirname, '../../api/.local/mail');
const mailPrefixes = emails.map((email) => createHash('sha256').update(email).digest('hex') + '-');
let database: Client;

test.beforeAll(async () => {
  config({ path: resolve(__dirname, '../../api/.env'), quiet: true });
  if (process.env.MAIL_TRANSPORT && process.env.MAIL_TRANSPORT !== 'file')
    throw new Error('Browser tests require MAIL_TRANSPORT=file, never external SMTP.');
  if (!process.env.DATABASE_URL)
    throw new Error(
      'DATABASE_URL is required for browser fixture cleanup. Use a development or test database.',
    );
  database = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });
  await database.connect();
});

test.afterAll(async () => {
  if (!database) return;
  try {
    await database.query('BEGIN');
    const users = await database.query<{ id: string }>(
      'SELECT id FROM users WHERE email = ANY($1::text[])',
      [emails],
    );
    const userIds = users.rows.map((user) => user.id);
    const organizations = await database.query<{ id: string }>(
      'SELECT id FROM organizations WHERE name = ANY($2::text[]) AND (id = ANY($1::uuid[]) OR EXISTS (SELECT 1 FROM memberships WHERE organization_id = organizations.id AND user_id = ANY($3::uuid[])))',
      [organizationIds, [firstName, renamed, longName], userIds],
    );
    const ownedIds = organizations.rows.map((organization) => organization.id);
    const foreign = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM memberships WHERE organization_id = ANY($1::uuid[]) AND NOT (user_id = ANY($2::uuid[]))',
      [ownedIds, userIds],
    );
    if (foreign.rows[0].count)
      throw new Error('Refusing to clean test organizations with non-test members.');
    await database.query(
      'DELETE FROM memberships WHERE organization_id = ANY($1::uuid[]) AND user_id = ANY($2::uuid[])',
      [ownedIds, userIds],
    );
    await database.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [ownedIds]);
    await database.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  } finally {
    await database.end();
    const files = await readdir(mailDirectory).catch(() => []);
    for (const file of files.filter((name) =>
      mailPrefixes.some((prefix) => name.startsWith(prefix)),
    )) {
      await unlink(resolve(mailDirectory, file));
    }
  }
});

async function accountLink(email: string, path: string) {
  const prefix = createHash('sha256').update(email).digest('hex') + '-';
  const names = (await readdir(mailDirectory)).filter((name) => name.startsWith(prefix));
  const messages = await Promise.all(
    names.map(async (name) => ({
      data: JSON.parse(await readFile(resolve(mailDirectory, name), 'utf8')) as {
        to: string;
        actionUrl: string;
      },
      time: (await stat(resolve(mailDirectory, name))).mtimeMs,
    })),
  );
  const match = messages
    .filter(({ data }) => data.to === email && new URL(data.actionUrl).pathname === path)
    .sort((left, right) => right.time - left.time)[0];
  if (!match) throw new Error('Expected development account email was not delivered.');
  expect(new URL(match.data.actionUrl).origin).toBe('http://127.0.0.1:3000');
  expect(new URL(match.data.actionUrl).search).toBe('');
  return match.data.actionUrl;
}

async function verifyAccount(page: Page, email: string) {
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.goto('/organizations');
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.goto(await accountLink(email, '/verify-email/confirm'));
  await expect(page.getByRole('button', { name: 'Verify email', exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page).toHaveURL(/\/organizations$/);
}

async function fillSignup(page: Page, email: string) {
  await page.getByLabel('Full name', { exact: true }).fill('Browser Test Operator');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
}

async function createOrganization(page: Page, name: string, currency: string) {
  await page.getByRole('button', { name: 'New organization', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Organization name', { exact: true }).fill(name);
  await dialog.getByLabel('Currency', { exact: true }).selectOption(currency);
  await dialog.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/[a-f0-9-]+$/);
  const id = new URL(page.url()).pathname.split('/').pop()!;
  organizationIds.push(id);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return id;
}

async function checkLayouts(page: Page) {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(async () => {
      await document.fonts.ready;
      return { width: window.innerWidth, content: document.documentElement.scrollWidth };
    });
    expect(layout.content, `Horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(
      layout.width,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test('account access, cookie privacy, organization selection, and revoked permissions', async ({
  page,
  context,
}, testInfo) => {
  const browserErrors: string[] = [];
  const directApiRequests: string[] = [];
  let loginActionId: string | undefined;
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).port === '3001') directApiRequests.push(request.url());
    if (new URL(request.url()).pathname === '/login' && request.method() === 'POST')
      loginActionId = request.headers()['next-action'];
  });

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await checkLayouts(page);
  await page.screenshot({ path: testInfo.outputPath('login-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: 'Create account', exact: true }).click();
  await fillSignup(page, emails[0]);
  await page.getByLabel('Confirm password', { exact: true }).fill('a different long passphrase');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Passwords must match.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(emails[0]);
  await fillSignup(page, emails[0]);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
  await checkLayouts(page);
  await page.screenshot({ path: testInfo.outputPath('verification-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('verification-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Resend verification email', exact: true }).click();
  await expect(page.locator('form').getByRole('status')).toContainText(
    'Verification link requested.',
  );
  await verifyAccount(page, emails[0]);
  await expect(page).toHaveURL(/\/organizations$/);
  await expect(
    page.getByRole('heading', { name: 'No organizations yet', exact: true }),
  ).toBeVisible();

  const session = (await context.cookies()).find((cookie) => cookie.name === 'stockflow_session');
  expect(Boolean(session?.httpOnly)).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie.includes('stockflow_session'))).toBe(false);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect((await page.content()).includes(session!.value)).toBe(false);

  const firstId = await createOrganization(page, firstName, 'ETB');
  await expect(page.locator('.organization-details')).toContainText('ETB');
  await page.getByLabel('Organization name', { exact: true }).fill(renamed);
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Organization updated.');
  await page.getByRole('link', { name: 'Switch organization', exact: true }).click();
  const secondId = await createOrganization(page, longName, 'USD');
  await checkLayouts(page);
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('workspace-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/workspace/${secondId}$`));
  await page.getByRole('link', { name: 'Switch organization', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search organizations', exact: true }).fill('North');
  await page.getByRole('button', { name: `Open ${renamed}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${firstId}$`));

  const account = await database.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
    emails[0],
  ]);
  const userId = account.rows[0].id;
  await database.query(
    "UPDATE memberships SET roles = ARRAY['WAREHOUSE']::organization_role[] WHERE organization_id = $1 AND user_id = $2",
    [firstId, userId],
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save name', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Members', exact: true })).toHaveCount(0);
  await database.query('DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2', [
    secondId,
    userId,
  ]);
  await page.goto(`/workspace/${secondId}`);
  await expect(page).toHaveURL(/\/organizations\?notice=unavailable$/);
  await expect(page.getByRole('button', { name: `Open ${longName}`, exact: true })).toHaveCount(0);

  await database.query(
    "UPDATE sessions SET created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute' WHERE user_id = $1",
    [userId],
  );
  const expired = await context.request.get('http://127.0.0.1:3001/api/auth/me', {
    headers: { Authorization: `Bearer ${session!.value}` },
  });
  expect(expired.status()).toBe(401);
  await page.goto('/organizations');
  await expect(page).toHaveURL(/\/login\?notice=expired$/);
  await page.getByLabel('Email address', { exact: true }).fill(emails[0]);
  await page.getByLabel('Password', { exact: true }).fill('an incorrect passphrase');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText(
    'Email or password is incorrect.',
  );
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/organizations$/);
  expect(Boolean(loginActionId)).toBe(true);
  const forged = await context.request.post('/login', {
    headers: { 'Next-Action': loginActionId!, Origin: 'https://untrusted.example' },
    multipart: { email: emails[0], password },
  });
  expect([403, 500]).toContain(forged.status());
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
  expect((await context.cookies()).some((cookie) => cookie.name === 'stockflow_session')).toBe(
    false,
  );

  await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reset your password', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill(emails[0]);
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  await expect(page.locator('form').getByRole('status')).toContainText('If an account exists');
  const resetLink = await accountLink(emails[0], '/reset-password');
  await page.goto(resetLink);
  await expect(
    page.getByRole('heading', { name: 'Choose a new password', exact: true }),
  ).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await checkLayouts(page);
  await page.screenshot({ path: testInfo.outputPath('reset-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('reset-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const newPassword = 'a changed browser-only passphrase';
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?notice=password-reset$/);
  await page.goto(resetLink);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('invalid or expired');
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(emails[0]);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText(
    'Email or password is incorrect.',
  );
  await page.getByLabel('Password', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/organizations$/);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed-out$/);

  await page.goto('/signup');
  await fillSignup(page, emails[1]);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await verifyAccount(page, emails[1]);
  await expect(page).toHaveURL(/\/organizations$/);
  await page.goto(`/workspace/${firstId}`);
  await expect(page).toHaveURL(/\/organizations\?notice=unavailable$/);
  await expect(
    page.getByRole('heading', { name: 'No organizations yet', exact: true }),
  ).toBeVisible();
  expect((await page.content()).includes(emails[0])).toBe(false);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
  expect(browserErrors).toEqual([]);
  expect(directApiRequests).toEqual([]);
});
