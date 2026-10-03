import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  locationInputSchema,
  locationListSchema,
  supplierInputSchema,
  supplierPerformanceSchema,
  supplierSchema,
} from '../src/lib/contracts';

test('validates supplier performance metrics with nullable rates', () => {
  const metrics = {
    confirmedOrders: 2,
    openOrders: 1,
    orderedUnits: 20,
    receivedUnits: 10,
    fillRatePercent: '50.0',
    averageLeadDays: '2.0',
  };
  assert.equal(supplierPerformanceSchema.safeParse(metrics).success, true);
  assert.equal(
    supplierPerformanceSchema.safeParse({
      ...metrics,
      fillRatePercent: null,
      averageLeadDays: null,
    }).success,
    true,
  );
  assert.equal(
    supplierPerformanceSchema.safeParse({ ...metrics, fillRatePercent: '50' }).success,
    false,
  );
  assert.equal(
    supplierPerformanceSchema.safeParse({ ...metrics, confirmedOrders: -1 }).success,
    false,
  );
});

const supplier = {
  id: '8ed13b94-fd8b-4079-848e-f22edaa8ce05',
  name: 'Nile Electronics',
  contactName: null,
  email: null,
  phone: null,
  address: null,
  archivedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test('normalizes supplier input and stores blanks as null', () => {
  const parsed = supplierInputSchema.parse({
    name: ' Nile Electronics ',
    contactName: '  ',
    email: ' SALES@NILE.TEST ',
    phone: ' +251 11 555-0100 ',
    address: '',
  });
  assert.deepEqual(parsed, {
    name: 'Nile Electronics',
    contactName: null,
    email: 'sales@nile.test',
    phone: '+251 11 555-0100',
    address: null,
  });
});

test('rejects invalid supplier contact details', () => {
  const valid = { name: 'Supplier', contactName: '', email: '', phone: '', address: '' };
  assert.equal(supplierInputSchema.safeParse(valid).success, true);
  for (const invalid of [
    { ...valid, name: '   ' },
    { ...valid, email: 'not-an-email' },
    { ...valid, phone: 'call me' },
    { ...valid, phone: '12' },
    { ...valid, address: 'a'.repeat(501) },
  ]) {
    assert.equal(supplierInputSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test('normalizes location input and validates names', () => {
  assert.deepEqual(locationInputSchema.parse({ name: ' Main Warehouse ', address: ' ' }), {
    name: 'Main Warehouse',
    address: null,
  });
  assert.equal(locationInputSchema.safeParse({ name: '  ', address: '' }).success, false);
  assert.equal(
    locationInputSchema.safeParse({ name: 'A'.repeat(121), address: '' }).success,
    false,
  );
});

test('rejects malformed supplier and location list responses', () => {
  assert.equal(supplierSchema.safeParse(supplier).success, true);
  assert.equal(supplierSchema.safeParse({ ...supplier, email: 5 }).success, false);
  const list = {
    items: [
      {
        id: supplier.id,
        name: 'Depot',
        address: null,
        archivedAt: null,
        createdAt: supplier.createdAt,
        updatedAt: supplier.updatedAt,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  };
  assert.equal(locationListSchema.safeParse(list).success, true);
  assert.equal(locationListSchema.safeParse({ ...list, page: 0 }).success, false);
});
