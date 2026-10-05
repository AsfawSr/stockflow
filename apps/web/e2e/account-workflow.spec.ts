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
const supplierEmail = 'sales@nile.test';
const mailPrefixes = [...emails, supplierEmail].map(
  (email) => createHash('sha256').update(email).digest('hex') + '-',
);
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
    await database.query('DELETE FROM stock_movements WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query('DELETE FROM stock_transfers WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query('DELETE FROM stock_adjustments WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query('DELETE FROM stock_levels WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query(
      'DELETE FROM goods_receipt_lines WHERE goods_receipt_id IN (SELECT id FROM goods_receipts WHERE organization_id = ANY($1::uuid[]))',
      [ownedIds],
    );
    await database.query('DELETE FROM goods_receipts WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query(
      'DELETE FROM purchase_order_lines WHERE organization_id = ANY($1::uuid[])',
      [ownedIds],
    );
    await database.query('DELETE FROM purchase_orders WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query('DELETE FROM products WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query('DELETE FROM suppliers WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query('DELETE FROM locations WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query('DELETE FROM invitations WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query('DELETE FROM audit_events WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query('DELETE FROM webhook_deliveries WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
    await database.query('DELETE FROM webhook_endpoints WHERE organization_id = ANY($1::uuid[])', [
      ownedIds,
    ]);
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
      const wide: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth) {
        for (const element of document.querySelectorAll('body *')) {
          const box = element.getBoundingClientRect();
          if (box.right > window.innerWidth && box.width > 0) {
            const tag = element.tagName.toLowerCase();
            const names = (element.className && String(element.className)) || '';
            wide.push(`${tag}.${names.split(' ')[0]} right=${Math.round(box.right)}`);
          }
        }
      }
      return {
        width: window.innerWidth,
        content: document.documentElement.scrollWidth,
        wide: wide.slice(0, 12),
      };
    });
    expect(
      layout.content,
      `Horizontal overflow at ${viewport.width}px: ${layout.wide.join(', ')}`,
    ).toBeLessThanOrEqual(layout.width);
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
  await page.getByLabel('Order reply-to email (optional)', { exact: true }).fill(emails[0]);
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Organization updated.');

  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No products yet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New product', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: 'New product', exact: true });
  await createDialog.getByLabel('SKU', { exact: true }).fill(' usb-c_65w.01 ');
  await createDialog.getByLabel('Product name', { exact: true }).fill('USB-C Charger');
  await createDialog.getByLabel('Stock unit', { exact: true }).fill('piece');
  await createDialog.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(createDialog).not.toBeVisible();
  await expect(page.getByText('USB-C_65W.01', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'New product', exact: true }).click();
  await createDialog.getByLabel('SKU', { exact: true }).fill('USB-C_65W.01');
  await createDialog.getByLabel('Product name', { exact: true }).fill('Duplicate Charger');
  await createDialog.getByLabel('Stock unit', { exact: true }).fill('piece');
  await createDialog.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(createDialog.getByRole('alert')).toContainText(
    'This SKU is already used in this organization.',
  );
  await createDialog.getByLabel('SKU', { exact: true }).fill('CABLE-01');
  await createDialog.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(createDialog).not.toBeVisible();
  await expect(page.getByText('CABLE-01', { exact: true })).toBeVisible();

  await page.getByLabel('Search products', { exact: true }).fill('usb');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).toHaveURL(/\/products\?search=usb&status=active$/);
  await expect(page.getByText('CABLE-01', { exact: true })).toHaveCount(0);
  await expect(page.getByText('USB-C_65W.01', { exact: true })).toBeVisible();
  await checkLayouts(page);
  await page.screenshot({ path: testInfo.outputPath('products-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Edit USB-C_65W.01', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit USB-C_65W.01', exact: true });
  await editDialog.getByLabel('Product name', { exact: true }).fill('USB-C Charger 65W');
  await editDialog.getByLabel('Description (optional)', { exact: true }).fill('Fast charger');
  await editDialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(editDialog).not.toBeVisible();
  await expect(page.getByText('USB-C Charger 65W', { exact: true })).toBeVisible();
  await expect(
    page.locator('.member-name').getByText('Fast charger', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Archive USB-C_65W.01', exact: true }).click();
  await expect(page.getByText('USB-C_65W.01', { exact: true })).toHaveCount(0);
  await page.getByLabel('Show', { exact: true }).selectOption('archived');
  await page.getByLabel('Search products', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('USB-C_65W.01', { exact: true })).toBeVisible();
  await expect(page.locator('.badge.offline')).toContainText('Archived');
  await page.getByRole('button', { name: 'Restore USB-C_65W.01', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No archived products' })).toBeVisible();

  // CSV import creates every valid row at once and reports bad files by line.
  await page.getByLabel('Show', { exact: true }).selectOption('active');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import products', exact: true });
  await importDialog.getByLabel('CSV file', { exact: true }).setInputFiles({
    name: 'catalog.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'sku,name,unit,description\nDESK-LAMP,Desk Lamp,piece,"Warm, dimmable LED"\nMOUSE-PAD,Mouse Pad,piece,\n',
    ),
  });
  await importDialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(importDialog).not.toBeVisible();
  await expect(page.getByText('Desk Lamp', { exact: true })).toBeVisible();
  await expect(page.getByText('Mouse Pad', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await importDialog.getByLabel('CSV file', { exact: true }).setInputFiles({
    name: 'broken.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('sku,name\nBAD-ROW,Missing Unit\n'),
  });
  await importDialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(importDialog.getByRole('alert')).toContainText(
    'Line 1: Missing required column "unit".',
  );
  await importDialog.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await page.getByRole('link', { name: 'Suppliers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No suppliers yet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New supplier', exact: true }).click();
  const supplierDialog = page.getByRole('dialog', { name: 'New supplier', exact: true });
  await supplierDialog.getByLabel('Supplier name', { exact: true }).fill('Nile Electronics');
  await supplierDialog.getByLabel('Email (optional)', { exact: true }).fill(' SALES@NILE.TEST ');
  await supplierDialog.getByLabel('Phone (optional)', { exact: true }).fill('+251 11 555-0100');
  await supplierDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(supplierDialog).not.toBeVisible();
  await expect(page.getByText('sales@nile.test', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New supplier', exact: true }).click();
  await supplierDialog.getByLabel('Supplier name', { exact: true }).fill('Nile Electronics');
  await supplierDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(supplierDialog.getByRole('alert')).toContainText(
    'This supplier name is already used in this organization.',
  );
  await supplierDialog.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await page.getByRole('link', { name: 'Locations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No locations yet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New location', exact: true }).click();
  const locationDialog = page.getByRole('dialog', { name: 'New location', exact: true });
  await locationDialog.getByLabel('Location name', { exact: true }).fill(' Main Warehouse ');
  await locationDialog.getByLabel('Address (optional)', { exact: true }).fill('Industrial Zone 4');
  await locationDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(locationDialog).not.toBeVisible();
  await expect(page.getByText('Main Warehouse', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Industrial Zone 4', exact: true })).toBeVisible();
  await checkLayouts(page);
  await page.screenshot({ path: testInfo.outputPath('locations-desktop.png'), fullPage: true });

  await page.getByRole('link', { name: 'Purchase orders', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No purchase orders yet', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New order', exact: true }).click();
  const orderDialog = page.getByRole('dialog', { name: 'New purchase order', exact: true });
  await orderDialog
    .getByLabel('Supplier', { exact: true })
    .selectOption({ label: 'Nile Electronics' });
  await orderDialog
    .getByLabel('Deliver to', { exact: true })
    .selectOption({ label: 'Main Warehouse' });
  await orderDialog.getByLabel('Note (optional)', { exact: true }).fill('Urgent restock');
  await orderDialog.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page).toHaveURL(/\/purchase-orders\/[a-f0-9-]+$/);
  await expect(page.getByRole('heading', { name: 'PO-0001', exact: true })).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();

  await page
    .getByLabel('Product', { exact: true })
    .selectOption({ label: 'USB-C_65W.01 · USB-C Charger 65W' });
  await page.getByLabel('Quantity', { exact: true }).fill('10');
  await page.getByLabel('Unit price', { exact: true }).fill('25.50');
  await page.getByRole('button', { name: 'Add line', exact: true }).click();
  await expect(page.getByRole('cell', { name: '255.00', exact: true })).toBeVisible();
  await checkLayouts(page);
  await page.screenshot({ path: testInfo.outputPath('order-draft-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await expect(page.getByText('Awaiting approval', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();

  // Approval emails the order to the supplier contact through the file transport.
  const supplierPrefix = createHash('sha256').update(supplierEmail).digest('hex') + '-';
  const supplierMailNames = (await readdir(mailDirectory)).filter((name) =>
    name.startsWith(supplierPrefix),
  );
  const supplierMails = await Promise.all(
    supplierMailNames.map(
      async (name) =>
        JSON.parse(await readFile(resolve(mailDirectory, name), 'utf8')) as {
          to: string;
          subject: string;
          text: string;
          actionUrl?: string;
          replyTo?: string;
        },
    ),
  );
  const orderMail = supplierMails.find(
    (mail) => mail.subject === `Purchase order PO-0001 from ${renamed}`,
  );
  expect(orderMail).toBeTruthy();
  expect(orderMail!.to).toBe(supplierEmail);
  expect(orderMail!.actionUrl).toBeUndefined();
  expect(orderMail!.replyTo).toBe(emails[0]);
  expect(orderMail!.text).toContain(
    '- USB-C Charger 65W (USB-C_65W.01): 10 piece @ 25.50 = 255.00',
  );
  expect(orderMail!.text).toContain('Total: 255.00 ETB');
  expect(orderMail!.text).toContain('Deliver to: Main Warehouse, Industrial Zone 4');
  expect(orderMail!.text).toContain('Note: Urgent restock');

  await page.getByLabel(/USB-C_65W\.01/).fill('6');
  await page.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(page.getByText('Partially received', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '6 of 10', exact: true })).toBeVisible();
  await expect(page.getByText('4 of 10 piece remaining', { exact: true })).toBeVisible();
  await page.getByLabel(/USB-C_65W\.01/).fill('4');
  await page.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(page.getByText('Received', { exact: true })).toBeVisible();
  await expect(page.getByText('2 receipts', { exact: true })).toBeVisible();

  // The print view renders a clean standalone document for the order.
  await page.getByRole('link', { name: 'Print view', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PO-0001', exact: true })).toBeVisible();
  await expect(page.getByText('Status: Received', { exact: true })).toBeVisible();
  await expect(page.getByText('sales@nile.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Industrial Zone 4', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '10 piece', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '255.00 ETB', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  await checkLayouts(page);
  await page.getByRole('link', { name: 'Back to order', exact: true }).click();
  await expect(page.getByText('2 receipts', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('order-received-desktop.png'),
    fullPage: true,
  });
  const stock = await database.query<{ quantity: number }>(
    'SELECT quantity FROM stock_levels WHERE organization_id = $1',
    [firstId],
  );
  expect(stock.rows).toEqual([{ quantity: 10 }]);

  // A new order for the same supplier pre-fills the last confirmed price.
  await page.getByRole('link', { name: 'Purchase orders', exact: true }).click();
  await page.getByRole('button', { name: 'New order', exact: true }).click();
  await orderDialog
    .getByLabel('Supplier', { exact: true })
    .selectOption({ label: 'Nile Electronics' });
  await orderDialog
    .getByLabel('Deliver to', { exact: true })
    .selectOption({ label: 'Main Warehouse' });
  await orderDialog.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PO-0002', exact: true })).toBeVisible();
  await page
    .getByLabel('Product', { exact: true })
    .selectOption({ label: 'USB-C_65W.01 · USB-C Charger 65W' });
  await expect(page.getByLabel('Unit price', { exact: true })).toHaveValue('25.50');
  await expect(page.getByText('Last confirmed: 25.50 (PO-0001', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();

  // A rejected order reopens as a draft for revision and goes through approval again.
  await page.getByRole('link', { name: 'Purchase orders', exact: true }).click();
  await page.getByRole('button', { name: 'New order', exact: true }).click();
  await orderDialog
    .getByLabel('Supplier', { exact: true })
    .selectOption({ label: 'Nile Electronics' });
  await orderDialog
    .getByLabel('Deliver to', { exact: true })
    .selectOption({ label: 'Main Warehouse' });
  await orderDialog.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PO-0003', exact: true })).toBeVisible();
  await page
    .getByLabel('Product', { exact: true })
    .selectOption({ label: 'USB-C_65W.01 · USB-C Charger 65W' });
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Add line', exact: true }).click();
  await expect(page.getByRole('cell', { name: '51.00', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await expect(page.getByText('Awaiting approval', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  const rejectDialog = page.getByRole('dialog', { name: 'Reject order', exact: true });
  await rejectDialog
    .getByLabel('Why is this order rejected?', { exact: true })
    .fill('Budget exceeded');
  await rejectDialog.getByRole('button', { name: 'Reject order', exact: true }).click();
  await expect(page.getByText('Rejected', { exact: true })).toBeVisible();
  await expect(page.getByText('Budget exceeded', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Revise order', exact: true }).click();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByText('Budget exceeded', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();

  // The supplier price history lists the confirmed price with its source order.
  await page.getByRole('link', { name: 'Suppliers', exact: true }).click();
  await page.getByRole('link', { name: 'Nile Electronics', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Latest confirmed prices', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('1 (0 open)', { exact: true })).toBeVisible();
  await expect(page.getByText('100.0% (10 of 10 units)', { exact: true })).toBeVisible();
  await expect(page.getByText('0.0 days', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '25.50 ETB', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'PO-0001', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Locations', exact: true }).click();
  await page.getByRole('button', { name: 'New location', exact: true }).click();
  const storeDialog = page.getByRole('dialog', { name: 'New location', exact: true });
  await storeDialog.getByLabel('Location name', { exact: true }).fill('Retail Store');
  await storeDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(storeDialog).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'Retail Store', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stock', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '10 piece', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Delivery for PO-0001', exact: true })).toHaveCount(
    2,
  );

  await page.getByRole('button', { name: 'Transfer stock', exact: true }).click();
  const transferDialog = page.getByRole('dialog', { name: 'Transfer stock', exact: true });
  await transferDialog
    .getByLabel('Product', { exact: true })
    .selectOption({ label: 'USB-C Charger 65W (USB-C_65W.01)' });
  await transferDialog
    .getByLabel('From location', { exact: true })
    .selectOption({ label: 'Main Warehouse' });
  await transferDialog
    .getByLabel('To location', { exact: true })
    .selectOption({ label: 'Retail Store' });
  await transferDialog.getByLabel('Quantity', { exact: true }).fill('100');
  await transferDialog.getByRole('button', { name: 'Record transfer', exact: true }).click();
  await expect(transferDialog.getByRole('alert')).toContainText('Not enough stock at the source');
  await transferDialog.getByLabel('Quantity', { exact: true }).fill('4');
  await transferDialog.getByLabel('Note (optional)', { exact: true }).fill('Restock shelf');
  await transferDialog.getByRole('button', { name: 'Record transfer', exact: true }).click();
  await expect(transferDialog).not.toBeVisible();
  await expect(page.getByRole('cell', { name: '6 piece', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '4 piece', exact: true })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Main Warehouse to Retail Store - Restock shelf', exact: true }),
  ).toHaveCount(2);

  await page.getByRole('button', { name: 'Adjust stock', exact: true }).click();
  const adjustDialog = page.getByRole('dialog', { name: 'Adjust stock', exact: true });
  await adjustDialog
    .getByLabel('Product', { exact: true })
    .selectOption({ label: 'USB-C Charger 65W (USB-C_65W.01)' });
  await adjustDialog
    .getByLabel('Location', { exact: true })
    .selectOption({ label: 'Main Warehouse' });
  await adjustDialog.getByLabel('Quantity change', { exact: true }).fill('-1');
  await adjustDialog.getByRole('button', { name: 'Record adjustment', exact: true }).click();
  await expect(adjustDialog.getByText('Explain the adjustment.', { exact: true })).toBeVisible();
  await adjustDialog.getByLabel('Reason', { exact: true }).fill('Damaged unit');
  await adjustDialog.getByRole('button', { name: 'Record adjustment', exact: true }).click();
  await expect(adjustDialog).not.toBeVisible();
  await expect(page.getByRole('cell', { name: '5 piece', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Damaged unit', exact: true })).toBeVisible();
  await checkLayouts(page);
  await page.screenshot({ path: testInfo.outputPath('stock-desktop.png'), fullPage: true });

  await page
    .locator('.catalog-toolbar')
    .getByLabel('Location', { exact: true })
    .selectOption({ label: 'Retail Store' });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('cell', { name: '5 piece', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '4 piece', exact: true })).toBeVisible();
  const balances = await database.query<{ quantity: number }>(
    'SELECT quantity FROM stock_levels WHERE organization_id = $1 ORDER BY quantity',
    [firstId],
  );
  expect(balances.rows).toEqual([{ quantity: 4 }, { quantity: 5 }]);

  // Reorder points flag low balances and power the low-stock filter.
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'Edit USB-C_65W.01', exact: true }).click();
  const reorderDialog = page.getByRole('dialog', { name: 'Edit USB-C_65W.01', exact: true });
  await reorderDialog.getByLabel('Reorder point (optional)', { exact: true }).fill('4');
  await reorderDialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(reorderDialog).not.toBeVisible();
  await page.getByRole('link', { name: 'Stock', exact: true }).click();
  const levelsTable = page.locator('.service-table').first();
  await expect(
    levelsTable.getByRole('row', { name: /Retail Store/ }).getByText('Low', { exact: true }),
  ).toBeVisible();
  await expect(
    levelsTable.getByRole('row', { name: /Main Warehouse/ }).getByText('Low', { exact: true }),
  ).toHaveCount(0);
  await page.locator('.catalog-toolbar').getByLabel('Show', { exact: true }).selectOption('low');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(levelsTable.getByRole('row', { name: /Retail Store/ })).toBeVisible();
  await expect(levelsTable.getByRole('row', { name: /Main Warehouse/ })).toHaveCount(0);

  // The full movement history pages and filters by location.
  await page.getByRole('link', { name: 'View all movements', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stock movements', exact: true })).toBeVisible();
  // Two partial deliveries, a transfer pair, and one adjustment.
  await expect(page.getByText('5 movements', { exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Damaged unit', exact: true })).toBeVisible();
  await page.getByLabel('Location', { exact: true }).selectOption({ label: 'Retail Store' });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('cell', { name: 'Transfer in', exact: true })).toBeVisible();

  // CSV exports stream through the web session without exposing the API token.
  await expect(page.getByRole('link', { name: 'Export CSV', exact: true })).toBeVisible();
  const levelsCsv = await context.request.get(`/workspace/${firstId}/stock/export/levels`);
  expect(levelsCsv.status()).toBe(200);
  expect(levelsCsv.headers()['content-type']).toContain('text/csv');
  const levelsCsvText = await levelsCsv.text();
  expect(
    levelsCsvText.startsWith('sku,product,location,quantity,unit,reorder_point,low,updated_at'),
  ).toBe(true);
  expect(levelsCsvText).toContain('USB-C_65W.01,USB-C Charger 65W,Retail Store,4,piece,4,true');
  const movementsCsv = await context.request.get(`/workspace/${firstId}/stock/export/movements`);
  expect(movementsCsv.status()).toBe(200);
  expect((await movementsCsv.text()).split('\r\n').filter(Boolean)).toHaveLength(6);

  // Valuation prices the remaining stock at the weighted average receipt cost.
  await page.getByRole('link', { name: 'Stock', exact: true }).click();
  await page.getByRole('link', { name: 'Valuation', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Inventory valuation', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Total 229.50 ETB', { exact: true })).toBeVisible();
  const valuationRow = page.getByRole('row', { name: /USB-C Charger 65W/ });
  await expect(valuationRow.getByRole('cell', { name: '9 piece', exact: true })).toBeVisible();
  await expect(valuationRow.getByRole('cell', { name: '25.50 ETB', exact: true })).toBeVisible();
  await expect(valuationRow.getByRole('cell', { name: '229.50 ETB', exact: true })).toBeVisible();
  await checkLayouts(page);

  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();

  // The pulse cards reflect the ledger and the activity feed shows the latest movement.
  await expect(page.locator('.stat-card').filter({ hasText: 'On-hand balances' })).toContainText(
    '2',
  );
  await expect(page.locator('.stat-card').filter({ hasText: 'Low stock' })).toContainText('1');
  await expect(page.locator('.stat-card').filter({ hasText: 'Awaiting approval' })).toContainText(
    '0',
  );
  await expect(page.locator('.activity-list li').first()).toContainText('Adjustment');
  await expect(page.locator('.activity-list li').first()).toContainText('at Main Warehouse');

  // The weekly trend table counts this week's orders, received units, and movements.
  const currentWeekRow = page.locator('.trend-table tbody tr').first();
  await expect(currentWeekRow.getByRole('cell', { name: '3', exact: true })).toBeVisible();
  await expect(currentWeekRow.getByRole('cell', { name: '10', exact: true })).toBeVisible();
  await expect(currentWeekRow.getByRole('cell', { name: '5', exact: true })).toBeVisible();
  await expect(page.locator('.trend-table tbody tr')).toHaveCount(8);

  // Administrators can trace every workspace action in the audit log.
  await page.getByRole('link', { name: 'Audit log', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible();
  const auditRows = page.locator('tbody tr');
  await expect(auditRows.first()).toContainText(
    'Adjusted USB-C Charger 65W by -1 piece at Main Warehouse (Damaged unit)',
  );
  await expect(auditRows.first()).toContainText('stock.adjusted');
  await expect(
    page.getByRole('cell', {
      name: 'Transferred 4 piece USB-C Charger 65W from Main Warehouse to Retail Store',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Approved purchase order PO-0001', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Received 6 units for purchase order PO-0001', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Reopened purchase order PO-0003 for revision', exact: true }),
  ).toBeVisible();
  await checkLayouts(page);
  await page.getByRole('link', { name: 'Back to overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();

  // Reorder suggestions surface shortages with the last confirmed supplier and price.
  await page.getByRole('link', { name: 'Purchase orders', exact: true }).click();
  await page.getByRole('link', { name: 'Reorder suggestions', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reorder suggestions', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Nothing to reorder', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'Edit USB-C_65W.01', exact: true }).click();
  const raiseDialog = page.getByRole('dialog', { name: 'Edit USB-C_65W.01', exact: true });
  await raiseDialog.getByLabel('Reorder point (optional)', { exact: true }).fill('9');
  await raiseDialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(raiseDialog).not.toBeVisible();
  await page.getByRole('link', { name: 'Purchase orders', exact: true }).click();
  await page.getByRole('link', { name: 'Reorder suggestions', exact: true }).click();
  const suggestionRow = page.getByRole('row', { name: /USB-C Charger 65W/ });
  await expect(suggestionRow.getByRole('cell', { name: '9 piece', exact: true })).toHaveCount(2);
  await expect(suggestionRow.getByRole('cell', { name: '9', exact: true })).toBeVisible();
  await expect(
    suggestionRow.getByRole('cell', { name: 'Nile Electronics', exact: true }),
  ).toBeVisible();
  await expect(
    suggestionRow.getByRole('cell', { name: '25.50 ETB (PO-0001)', exact: true }),
  ).toBeVisible();
  await checkLayouts(page);

  // One click turns the suggestion into a pre-filled draft order.
  await suggestionRow.getByRole('button', { name: 'Order USB-C_65W.01', exact: true }).click();
  const suggestionDialog = page.getByRole('dialog', {
    name: 'Order USB-C Charger 65W',
    exact: true,
  });
  await expect(suggestionDialog.getByLabel('Quantity', { exact: true })).toHaveValue('9');
  await expect(suggestionDialog.getByLabel('Unit price', { exact: true })).toHaveValue('25.50');
  await suggestionDialog
    .getByLabel('Deliver to', { exact: true })
    .selectOption({ label: 'Main Warehouse' });
  await suggestionDialog.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'PO-0004', exact: true })).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '229.50', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'All purchase orders', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Purchase orders', exact: true })).toBeVisible();
  // Restore the original reorder point so later low-stock expectations hold.
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'Edit USB-C_65W.01', exact: true }).click();
  await raiseDialog.getByLabel('Reorder point (optional)', { exact: true }).fill('4');
  await raiseDialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(raiseDialog).not.toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();

  // Invite, revoke, and re-invite the outsider before their account exists.
  await page.getByRole('button', { name: 'Invite member', exact: true }).click();
  const inviteDialog = page.getByRole('dialog', { name: 'Invite member', exact: true });
  await inviteDialog.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(
    inviteDialog.getByText('Enter a valid email address.', { exact: true }),
  ).toBeVisible();
  await expect(inviteDialog.getByText('Choose at least one role.', { exact: true })).toBeVisible();
  await inviteDialog.getByLabel('Email address', { exact: true }).fill(emails[1]);
  await inviteDialog.getByLabel('Manager', { exact: true }).check();
  await inviteDialog.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(inviteDialog).not.toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Pending invitations', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: emails[1], exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: `Revoke invitation for ${emails[1]}`, exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Pending invitations', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Invite member', exact: true }).click();
  await inviteDialog.getByLabel('Email address', { exact: true }).fill(emails[1]);
  await inviteDialog.getByLabel('Manager', { exact: true }).check();
  await inviteDialog.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(inviteDialog).not.toBeVisible();
  await expect(page.getByRole('cell', { name: emails[1], exact: true })).toBeVisible();

  // The only administrator can be neither demoted nor removed.
  await page.getByRole('button', { name: `Edit roles for ${emails[0]}`, exact: true }).click();
  const rolesDialog = page.getByRole('dialog', {
    name: `Edit roles for ${emails[0]}`,
    exact: true,
  });
  await rolesDialog.getByLabel('Administrator', { exact: true }).uncheck();
  await rolesDialog.getByLabel('Purchasing', { exact: true }).check();
  await rolesDialog.getByRole('button', { name: 'Save roles', exact: true }).click();
  await expect(rolesDialog.getByRole('alert')).toContainText(
    'An organization needs at least one administrator.',
  );
  await rolesDialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: `Remove ${emails[0]}`, exact: true }).click();
  await expect(
    page
      .locator('.row-action-form')
      .getByText('An organization needs at least one administrator.', { exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Switch organization', exact: true }).click();
  const secondId = await createOrganization(page, longName, 'USD');
  await checkLayouts(page);
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('workspace-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/workspace/${secondId}$`));

  // Webhooks stream order events to admin-managed endpoints; the secret is shown exactly once.
  const webhookUrl = 'https://example.test/hooks/stockflow';
  await page.getByRole('link', { name: 'Webhooks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No webhooks yet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add webhook', exact: true }).click();
  const webhookDialog = page.getByRole('dialog', { name: 'Add webhook', exact: true });
  await webhookDialog.getByLabel('Delivery URL', { exact: true }).fill(webhookUrl);
  await webhookDialog.getByRole('button', { name: 'Add webhook', exact: true }).click();
  const secret = await webhookDialog.getByTestId('webhook-secret').innerText();
  expect(secret).toMatch(/^[0-9a-f]{64}$/);
  await webhookDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(webhookDialog).not.toBeVisible();
  await expect(page.getByRole('cell', { name: webhookUrl, exact: true })).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByText(secret)).toHaveCount(0);
  await checkLayouts(page);
  await page.getByRole('button', { name: `Disable ${webhookUrl}`, exact: true }).click();
  await expect(page.getByText('Disabled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Enable ${webhookUrl}`, exact: true }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  // The delivery log starts empty and explains the retry policy.
  await page.getByRole('link', { name: `Deliveries for ${webhookUrl}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deliveries', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: webhookUrl, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No deliveries yet', exact: true })).toBeVisible();
  await checkLayouts(page);
  await page.getByRole('link', { name: 'Back to webhooks', exact: true }).click();
  await expect(page.getByRole('cell', { name: webhookUrl, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Delete ${webhookUrl}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No webhooks yet', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to overview', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${secondId}$`));

  // Archiving locks the workspace to read-only until an administrator restores it.
  const archivedBanner = page.locator('.form-notice', { hasText: 'archived and read-only' });
  await page.getByRole('button', { name: 'Archive organization', exact: true }).click();
  const archiveDialog = page.getByRole('dialog', { name: `Archive ${longName}`, exact: true });
  await expect(archiveDialog.getByText('No data is deleted.')).toBeVisible();
  await archiveDialog.getByRole('button', { name: 'Archive organization', exact: true }).click();
  await expect(archiveDialog).not.toBeVisible();
  await expect(archivedBanner).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive organization', exact: true })).toHaveCount(
    0,
  );
  await checkLayouts(page);
  // The API rejects every change while archived, even from administrators.
  await page.getByRole('button', { name: 'Invite member', exact: true }).click();
  const archivedInvite = page.getByRole('dialog', { name: 'Invite member', exact: true });
  await archivedInvite.getByLabel('Email address', { exact: true }).fill(emails[1]);
  await archivedInvite.getByLabel('Manager', { exact: true }).check();
  await archivedInvite.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(archivedInvite.getByRole('alert')).toContainText(
    'This organization is archived and read-only.',
  );
  await archivedInvite.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(archivedInvite).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pending invitations', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Restore organization', exact: true }).click();
  await expect(archivedBanner).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Archive organization', exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Switch organization', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search organizations', exact: true }).fill('North');
  await page.getByRole('button', { name: `Open ${renamed}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${firstId}$`));

  const account = await database.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
    emails[0],
  ]);
  const userId = account.rows[0].id;
  await database.query(
    "UPDATE memberships SET roles = ARRAY['PURCHASER']::organization_role[] WHERE organization_id = $1 AND user_id = $2",
    [firstId, userId],
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Members', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByText('USB-C_65W.01', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New product', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit USB-C_65W.01', exact: true })).toHaveCount(0);
  // A purchaser manages suppliers but not products or locations.
  await page.getByRole('link', { name: 'Suppliers', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New supplier', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit Nile Electronics', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Locations', exact: true }).click();
  await expect(page.getByText('Main Warehouse', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New location', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Main Warehouse', exact: true })).toHaveCount(
    0,
  );
  // A purchaser reads stock but cannot move it.
  await page.getByRole('link', { name: 'Stock', exact: true }).click();
  await expect(page.getByRole('cell', { name: '5 piece', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transfer stock', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adjust stock', exact: true })).toHaveCount(0);
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

  // Signed-in password change keeps this session and rejects a wrong current password.
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Account security', exact: true })).toBeVisible();
  const changedPassword = 'a rotated browser-only passphrase';
  await page.getByLabel('Current password', { exact: true }).fill('not the right passphrase');
  await page.getByLabel('New password', { exact: true }).fill(changedPassword);
  await page.getByLabel('Confirm new password', { exact: true }).fill(changedPassword);
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText(
    'current password is incorrect',
  );
  await page.getByLabel('Current password', { exact: true }).fill(newPassword);
  await page.getByLabel('New password', { exact: true }).fill(changedPassword);
  await page.getByLabel('Confirm new password', { exact: true }).fill(changedPassword);
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.locator('form').getByRole('status')).toContainText('Password updated');
  await checkLayouts(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
  await page.getByLabel('Email address', { exact: true }).fill(emails[0]);
  await page.getByLabel('Password', { exact: true }).fill(changedPassword);
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

  // The invited outsider joins through the emailed link with the invited role.
  const inviteLink = await accountLink(emails[1], '/invitations/accept');
  await page.goto(inviteLink);
  await expect(
    page.getByRole('heading', { name: 'Join the organization', exact: true }),
  ).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${firstId}$`));
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
  await expect(page.locator('.heading-roles').getByText('Manager', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Members', exact: true })).toHaveCount(0);
  await page.goto(inviteLink);
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('invalid or expired');
  await page.goto('/organizations');
  await expect(page.getByRole('button', { name: `Open ${renamed}`, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?notice=signed-out$/);
  expect(browserErrors).toEqual([]);
  expect(directApiRequests).toEqual([]);
});
