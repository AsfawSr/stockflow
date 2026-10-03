import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createOrderInputSchema,
  orderLineInputSchema,
  orderStatusLabels,
  orderStatusTone,
  purchaseOrderListSchema,
  purchaseOrderSchema,
  rejectInputSchema,
  reorderSuggestionListSchema,
  supplierPriceListSchema,
} from '../src/lib/contracts';

const uuid = '8ed13b94-fd8b-4079-848e-f22edaa8ce05';

test('validates supplier price lists with strict money strings', () => {
  const item = {
    product: { id: uuid, sku: 'CHARGER-65', name: 'USB-C Charger', unit: 'piece' },
    unitPrice: '12.50',
    reference: 'PO-0002',
    decidedAt: new Date().toISOString(),
  };
  assert.equal(supplierPriceListSchema.safeParse({ items: [item] }).success, true);
  assert.equal(supplierPriceListSchema.safeParse({ items: [] }).success, true);
  assert.equal(
    supplierPriceListSchema.safeParse({ items: [{ ...item, unitPrice: '12.5' }] }).success,
    false,
  );
  assert.equal(
    supplierPriceListSchema.safeParse({ items: [{ ...item, reference: '' }] }).success,
    false,
  );
});

test('validates reorder suggestion lists with nullable sourcing', () => {
  const item = {
    product: { id: uuid, sku: 'CHARGER-65', name: 'USB-C Charger', unit: 'piece' },
    reorderPoint: 10,
    onHand: 4,
    suggestedQuantity: 16,
    supplier: { id: uuid, name: 'Nile Electronics' },
    unitPrice: '25.50',
    reference: 'PO-0001',
  };
  assert.equal(reorderSuggestionListSchema.safeParse({ items: [item] }).success, true);
  assert.equal(
    reorderSuggestionListSchema.safeParse({
      items: [{ ...item, supplier: null, unitPrice: null, reference: null }],
    }).success,
    true,
  );
  assert.equal(reorderSuggestionListSchema.safeParse({ items: [] }).success, true);
  assert.equal(
    reorderSuggestionListSchema.safeParse({ items: [{ ...item, unitPrice: '25.5' }] }).success,
    false,
  );
  assert.equal(
    reorderSuggestionListSchema.safeParse({ items: [{ ...item, suggestedQuantity: 0 }] }).success,
    false,
  );
});

test('validates order creation input', () => {
  assert.deepEqual(
    createOrderInputSchema.parse({ supplierId: uuid, locationId: uuid, note: '  ' }),
    { supplierId: uuid, locationId: uuid, note: null },
  );
  assert.equal(
    createOrderInputSchema.safeParse({ supplierId: 'x', locationId: uuid, note: '' }).success,
    false,
  );
});

test('validates line input with strict money strings and integer quantities', () => {
  assert.deepEqual(
    orderLineInputSchema.parse({ productId: uuid, quantity: '10', unitPrice: '25.50' }),
    { productId: uuid, quantity: 10, unitPrice: '25.50' },
  );
  for (const invalid of [
    { productId: uuid, quantity: '2.5', unitPrice: '5' },
    { productId: uuid, quantity: '0', unitPrice: '5' },
    { productId: uuid, quantity: '1', unitPrice: '5,50' },
    { productId: uuid, quantity: '1', unitPrice: '5.123' },
    { productId: uuid, quantity: '1', unitPrice: '-5' },
  ]) {
    assert.equal(orderLineInputSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test('requires a rejection reason', () => {
  assert.equal(rejectInputSchema.safeParse({ note: '   ' }).success, false);
  assert.equal(rejectInputSchema.safeParse({ note: 'Budget exceeded' }).success, true);
});

test('covers every order status with a label and tone', () => {
  for (const status of purchaseOrderSchema.shape.status.options) {
    assert.ok(orderStatusLabels[status], status);
    assert.ok(orderStatusTone[status], status);
  }
});

test('rejects malformed order list responses', () => {
  const item = {
    id: uuid,
    number: 1,
    reference: 'PO-0001',
    status: 'DRAFT',
    supplier: { id: uuid, name: 'Supplier' },
    location: { id: uuid, name: 'Warehouse' },
    lineCount: 0,
    total: '0.00',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const list = { items: [item], total: 1, page: 1, pageSize: 20 };
  assert.equal(purchaseOrderListSchema.safeParse(list).success, true);
  assert.equal(
    purchaseOrderListSchema.safeParse({ ...list, items: [{ ...item, total: '1.5' }] }).success,
    false,
  );
  assert.equal(
    purchaseOrderListSchema.safeParse({ ...list, items: [{ ...item, status: 'SENT' }] }).success,
    false,
  );
});
