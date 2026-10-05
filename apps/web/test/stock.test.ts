import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adjustmentInputSchema,
  movementTypeLabels,
  movementTypeTone,
  stockLevelListSchema,
  stockMovementListSchema,
  stockMovementTypeSchema,
  stockValuationSchema,
  transferInputSchema,
  trendListSchema,
  valuationSnapshotListSchema,
  valuationSnapshotSchema,
} from '../src/lib/contracts';

const uuid = '8ed13b94-fd8b-4079-848e-f22edaa8ce05';
const otherUuid = '2b8fa8f2-15a5-4a37-a1a5-0e6ad1c2b6c1';

test('validates weekly trend reports', () => {
  const week = { weekStart: '2026-09-28', ordersCreated: 3, unitsReceived: 10, movements: 5 };
  assert.equal(trendListSchema.safeParse({ weeks: [week] }).success, true);
  assert.equal(trendListSchema.safeParse({ weeks: [] }).success, true);
  assert.equal(
    trendListSchema.safeParse({ weeks: [{ ...week, weekStart: '28-09-2026' }] }).success,
    false,
  );
  assert.equal(trendListSchema.safeParse({ weeks: [{ ...week, movements: -1 }] }).success, false);
});

test('validates valuation reports with nullable costs', () => {
  const item = {
    product: { id: uuid, sku: 'CHARGER-65', name: 'USB-C Charger', unit: 'piece' },
    onHand: 9,
    averageCost: '5.20',
    value: '46.80',
  };
  assert.equal(
    stockValuationSchema.safeParse({ items: [item], totalValue: '46.80' }).success,
    true,
  );
  assert.equal(
    stockValuationSchema.safeParse({
      items: [{ ...item, averageCost: null, value: null }],
      totalValue: '0.00',
    }).success,
    true,
  );
  assert.equal(
    stockValuationSchema.safeParse({ items: [{ ...item, value: '46.8' }], totalValue: '46.80' })
      .success,
    false,
  );
  assert.equal(stockValuationSchema.safeParse({ items: [item] }).success, false);
});

test('validates frozen valuation snapshots and their history list', () => {
  const snapshot = {
    id: uuid,
    type: 'valuation',
    payload: {
      currency: 'ETB',
      totalValue: '46.80',
      items: [
        {
          product: { id: uuid, sku: 'CHARGER-65', name: 'USB-C Charger', unit: 'piece' },
          onHand: 9,
          averageCost: '5.20',
          value: '46.80',
        },
      ],
    },
    createdAt: new Date().toISOString(),
    createdBy: { id: otherUuid, displayName: 'Snapshot Manager' },
  };
  assert.equal(valuationSnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(valuationSnapshotSchema.safeParse({ ...snapshot, createdBy: null }).success, true);
  assert.equal(valuationSnapshotSchema.safeParse({ ...snapshot, type: 'profit' }).success, false);
  assert.equal(
    valuationSnapshotSchema.safeParse({
      ...snapshot,
      payload: { ...snapshot.payload, currency: 'birr' },
    }).success,
    false,
  );
  const row = {
    id: uuid,
    createdAt: new Date().toISOString(),
    createdBy: null,
    currency: 'ETB',
    totalValue: '46.80',
    productCount: 1,
  };
  assert.equal(
    valuationSnapshotListSchema.safeParse({ items: [row], total: 1, page: 1, pageSize: 20 })
      .success,
    true,
  );
  assert.equal(
    valuationSnapshotListSchema.safeParse({
      items: [{ ...row, productCount: -1 }],
      total: 1,
      page: 1,
      pageSize: 20,
    }).success,
    false,
  );
});

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
