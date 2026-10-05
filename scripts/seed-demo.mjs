// Seeds a demo workspace through the real API so every invariant, audit row, and
// ledger entry is produced the same way the application produces them.
// Dev-only: requires the API to run with MAIL_TRANSPORT=file for self-verification.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.STOCKFLOW_API ?? 'http://127.0.0.1:3001/api';
const WEB = process.env.STOCKFLOW_WEB ?? 'http://127.0.0.1:3000';
const EMAIL = (process.env.DEMO_EMAIL ?? 'demo@example.test').toLowerCase();
const PASSWORD = process.env.DEMO_PASSWORD ?? 'stockflow demo passphrase';
const mailDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/api/.local/mail');

let token = '';

async function call(method, path, body, { auth = true, allow = [] } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok && !allow.includes(response.status)) {
    throw new Error(`${method} ${path} -> ${response.status}: ${await response.text()}`);
  }
  if (!response.ok) return { status: response.status };
  return response.status === 204 ? null : response.json();
}

async function verificationToken() {
  const prefix = createHash('sha256').update(EMAIL).digest('hex') + '-';
  const names = (await readdir(mailDirectory)).filter((name) => name.startsWith(prefix));
  const messages = await Promise.all(
    names.map(async (name) => ({
      data: JSON.parse(await readFile(resolve(mailDirectory, name), 'utf8')),
      time: (await stat(resolve(mailDirectory, name))).mtimeMs,
    })),
  );
  const match = messages
    .filter(
      ({ data }) => data.actionUrl && new URL(data.actionUrl).pathname === '/verify-email/confirm',
    )
    .sort((left, right) => right.time - left.time)[0];
  if (!match) throw new Error('No verification email found; is MAIL_TRANSPORT=file?');
  return new URLSearchParams(new URL(match.data.actionUrl).hash.slice(1)).get('token');
}

async function signIn() {
  const login = await call(
    'POST',
    '/auth/login',
    { email: EMAIL, password: PASSWORD },
    {
      auth: false,
      allow: [401],
    },
  );
  if (login.accessToken) {
    token = login.accessToken;
    return;
  }
  const registered = await call(
    'POST',
    '/auth/register',
    { email: EMAIL, password: PASSWORD, displayName: 'Demo Operator' },
    { auth: false },
  );
  token = registered.accessToken;
  await call('POST', '/auth/email/verify', { token: await verificationToken() }, { auth: false });
}

async function createOrder(base, { supplierId, locationId, note, lines }) {
  const order = await call('POST', base, { supplierId, locationId, note: note ?? null });
  let detail = order;
  for (const line of lines) {
    detail = await call('POST', `${base}/${order.id}/lines`, line);
  }
  return { id: order.id, lines: detail.lines };
}

async function receive(base, order, quantities) {
  await call('POST', `${base}/${order.id}/receipts`, {
    lines: order.lines
      .filter((line) => quantities[line.product.sku])
      .map((line) => ({ purchaseOrderLineId: line.id, quantity: quantities[line.product.sku] })),
  });
}

async function main() {
  await signIn();
  const stamp = new Date().toISOString().slice(0, 10);
  const organization = await call('POST', '/organizations', {
    name: `Demo Hardware ${stamp} ${Math.random().toString(36).slice(2, 6)}`,
    currency: 'ETB',
  });
  const org = `/organizations/${organization.id}`;
  await call('PATCH', org, { replyToEmail: EMAIL });

  const products = {};
  for (const [sku, name, unit, reorderPoint] of [
    ['USB-C-65W', 'USB-C Charger 65W', 'piece', 10],
    ['HDMI-2M', 'HDMI Cable 2m', 'piece', 20],
    ['SSD-1TB', 'NVMe SSD 1TB', 'piece', 5],
    ['KB-TKL', 'Mechanical Keyboard TKL', 'piece', 8],
    ['MON-27', '27-inch Monitor', 'piece', 4],
    ['PSU-650', 'Power Supply 650W', 'piece', 6],
  ]) {
    products[sku] = (await call('POST', `${org}/products`, { sku, name, unit, reorderPoint })).id;
  }
  const suppliers = {};
  for (const supplier of [
    {
      name: 'Nile Electronics',
      email: 'sales@nile.example',
      phone: '+251 11 555 0100',
      address: 'Bole Road 14, Addis Ababa',
    },
    { name: 'Addis Components', email: 'orders@addis.example' },
    { name: 'Red Sea Imports' },
  ]) {
    suppliers[supplier.name] = (await call('POST', `${org}/suppliers`, supplier)).id;
  }
  const locations = {};
  for (const location of [
    { name: 'Main Warehouse', address: 'Industrial Zone 4' },
    { name: 'Retail Store', address: 'Churchill Avenue 22' },
    { name: 'Service Bench' },
  ]) {
    locations[location.name] = (await call('POST', `${org}/locations`, location)).id;
  }

  // Catalog quotes: some beat confirmed history, one covers a product with no history.
  for (const [supplier, sku, unitPrice] of [
    ['Nile Electronics', 'USB-C-65W', '24.00'],
    ['Nile Electronics', 'HDMI-2M', '5.10'],
    ['Addis Components', 'SSD-1TB', '89.50'],
    ['Red Sea Imports', 'PSU-650', '55.00'],
  ]) {
    await call('PUT', `${org}/suppliers/${suppliers[supplier]}/catalog/${products[sku]}`, {
      unitPrice,
    });
  }

  const base = `${org}/purchase-orders`;
  const act = (id, transition, body) => call('POST', `${base}/${id}/${transition}`, body ?? {});

  // PO-0001: fully received across two deliveries.
  const first = await createOrder(base, {
    supplierId: suppliers['Nile Electronics'],
    locationId: locations['Main Warehouse'],
    note: 'Quarterly restock',
    lines: [
      { productId: products['USB-C-65W'], quantity: 30, unitPrice: '25.50' },
      { productId: products['HDMI-2M'], quantity: 40, unitPrice: '4.75' },
    ],
  });
  await act(first.id, 'submit');
  await act(first.id, 'approve', { note: 'Within budget' });
  await receive(base, first, { 'USB-C-65W': 20, 'HDMI-2M': 40 });
  await receive(base, first, { 'USB-C-65W': 10 });

  // PO-0002: partially received.
  const second = await createOrder(base, {
    supplierId: suppliers['Addis Components'],
    locationId: locations['Main Warehouse'],
    lines: [
      { productId: products['SSD-1TB'], quantity: 10, unitPrice: '92.00' },
      { productId: products['KB-TKL'], quantity: 12, unitPrice: '38.00' },
    ],
  });
  await act(second.id, 'submit');
  await act(second.id, 'approve');
  await receive(base, second, { 'SSD-1TB': 6 });

  // PO-0003: awaiting approval.
  const third = await createOrder(base, {
    supplierId: suppliers['Red Sea Imports'],
    locationId: locations['Retail Store'],
    lines: [{ productId: products['MON-27'], quantity: 6, unitPrice: '180.00' }],
  });
  await act(third.id, 'submit');

  // PO-0004: rejected with a reason.
  const fourth = await createOrder(base, {
    supplierId: suppliers['Nile Electronics'],
    locationId: locations['Main Warehouse'],
    lines: [{ productId: products['PSU-650'], quantity: 10, unitPrice: '41.00' }],
  });
  await act(fourth.id, 'submit');
  await act(fourth.id, 'reject', { note: 'Budget freeze this month' });

  // PO-0005: still a draft.
  await createOrder(base, {
    supplierId: suppliers['Addis Components'],
    locationId: locations['Retail Store'],
    lines: [{ productId: products['HDMI-2M'], quantity: 15, unitPrice: '4.60' }],
  });

  const stock = `${org}/stock`;
  await call('POST', `${stock}/transfers`, {
    productId: products['USB-C-65W'],
    fromLocationId: locations['Main Warehouse'],
    toLocationId: locations['Retail Store'],
    quantity: 8,
    note: 'Front display',
  });
  await call('POST', `${stock}/transfers`, {
    productId: products['HDMI-2M'],
    fromLocationId: locations['Main Warehouse'],
    toLocationId: locations['Retail Store'],
    quantity: 12,
  });
  await call('POST', `${stock}/adjustments`, {
    productId: products['USB-C-65W'],
    locationId: locations['Main Warehouse'],
    quantity: -2,
    reason: 'Damaged in handling',
  });
  await call('POST', `${stock}/adjustments`, {
    productId: products['KB-TKL'],
    locationId: locations['Main Warehouse'],
    quantity: 1,
    reason: 'Found during recount',
  });
  await call('POST', `${stock}/adjustments`, {
    productId: products['MON-27'],
    locationId: locations['Service Bench'],
    quantity: 2,
    reason: 'Opening balance',
  });

  // A completed cycle count: one shelf short, one surprise find, one match.
  const count = await call('POST', `${org}/cycle-counts`, {
    locationId: locations['Main Warehouse'],
    note: 'Friday sweep, aisles 1-3',
  });
  const recount = (sku, countedQuantity) =>
    call('PUT', `${org}/cycle-counts/${count.id}/lines/${products[sku]}`, { countedQuantity });
  await recount('USB-C-65W', 19);
  await recount('KB-TKL', 1);
  await recount('PSU-650', 2);
  await call('POST', `${org}/cycle-counts/${count.id}/complete`);
  // A second session left open for the demo walkthrough.
  await call('POST', `${org}/cycle-counts`, {
    locationId: locations['Retail Store'],
    note: 'Evening spot check',
  });

  const [levels, suggestions, valuation, audit] = await Promise.all([
    call('GET', `${stock}/levels?pageSize=1`),
    call('GET', `${base}/suggestions`),
    call('GET', `${stock}/valuation`),
    call('GET', `${org}/audit?pageSize=1`),
  ]);
  console.log('Demo workspace ready.');
  console.log(`  Sign in:   ${WEB}/login`);
  console.log(`  Email:     ${EMAIL}`);
  console.log(`  Password:  ${PASSWORD}`);
  console.log(`  Workspace: ${WEB}/workspace/${organization.id}`);
  console.log(
    `  Data:      ${levels.total} stock balances, ${suggestions.items.length} reorder suggestions, ` +
      `${valuation.items.length} valued products (total ${valuation.totalValue} ETB), ${audit.total} audit events`,
  );
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
