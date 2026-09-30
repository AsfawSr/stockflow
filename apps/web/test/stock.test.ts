import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adjustmentInputSchema,
  movementTypeLabels,
  movementTypeTone,
  stockLevelListSchema,
  stockMovementListSchema,
  stockMovementTypeSchema,
  transferInputSchema,
} from '../src/lib/contracts';

const uuid = '8ed13b94-fd8b-4079-848e-f22edaa8ce05';
const otherUuid = '2b8fa8f2-15a5-4a37-a1a5-0e6ad1c2b6c1';

test('validates transfer input', () => {
  assert.deepEqual(
    transferInputSchema.parse({
      productId: uuid,
      fromLocationId: uuid,
      toLocationId: otherUuid,
      quantity: '4',
      note: '  Restock shelf  ',
    }),
    {
      productId: uuid,
      fromLocationId: uuid,
      toLocationId: otherUuid,
      quantity: 4,
      note: 'Restock shelf',
    },
  );
  for (const invalid of [
    { productId: uuid, fromLocationId: uuid, toLocationId: uuid, quantity: '1', note: '' },
    { productId: uuid, fromLocationId: uuid, toLocationId: otherUuid, quantity: '0', note: '' },
    { productId: uuid, fromLocationId: uuid, toLocationId: otherUuid, quantity: '2.5', note: '' },
    { productId: uuid, fromLocationId: uuid, toLocationId: otherUuid, quantity: '-1', note: '' },
    { productId: uuid, fromLocationId: 'x', toLocationId: otherUuid, quantity: '1', note: '' },
  ]) {
    assert.equal(transferInputSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test('validates adjustment input with a required reason and non-zero quantity', () => {
  assert.deepEqual(
    adjustmentInputSchema.parse({
      productId: uuid,
      locationId: uuid,
      quantity: '-2',
      reason: ' Damaged unit ',
    }),
    { productId: uuid, locationId: uuid, quantity: -2, reason: 'Damaged unit' },
  );
  for (const invalid of [
    { productId: uuid, locationId: uuid, quantity: '0', reason: 'Stocktake' },
    { productId: uuid, locationId: uuid, quantity: '', reason: 'Stocktake' },
    { productId: uuid, locationId: uuid, quantity: '1.5', reason: 'Stocktake' },
    { productId: uuid, locationId: uuid, quantity: '1', reason: '   ' },
  ]) {
    assert.equal(adjustmentInputSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test('covers every movement type with a label and tone', () => {
  for (const type of stockMovementTypeSchema.options) {
    assert.ok(movementTypeLabels[type], type);
    assert.ok(movementTypeTone[type], type);
  }
});

test('validates stock level and movement list responses', () => {
  const product = {
    id: uuid,
    sku: 'STOCK-01',
    name: 'Stock Product',
    unit: 'piece',
    reorderPoint: 4,
  };
  const location = { id: otherUuid, name: 'Main Warehouse' };
  const levels = {
    items: [{ product, location, quantity: 5, low: false, updatedAt: new Date().toISOString() }],
    total: 1,
    page: 1,
    pageSize: 20,
  };
  assert.equal(stockLevelListSchema.safeParse(levels).success, true);
  assert.equal(
    stockLevelListSchema.safeParse({
      ...levels,
      items: [{ ...levels.items[0], quantity: -1 }],
    }).success,
    false,
  );
  assert.equal(
    stockLevelListSchema.safeParse({
      ...levels,
      items: [{ ...levels.items[0], low: 'yes' }],
    }).success,
    false,
  );
  const movements = {
    items: [
      {
        id: uuid,
        type: 'TRANSFER_OUT',
        quantity: -4,
        product,
        location,
        createdBy: { id: uuid, displayName: 'Warehouse User' },
        createdAt: new Date().toISOString(),
        detail: 'Main Warehouse to Retail Store',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  };
  assert.equal(stockMovementListSchema.safeParse(movements).success, true);
  assert.equal(
    stockMovementListSchema.safeParse({
      ...movements,
      items: [{ ...movements.items[0], type: 'MOVED' }],
    }).success,
    false,
  );
});
