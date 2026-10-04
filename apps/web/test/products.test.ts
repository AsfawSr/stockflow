import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  catalogQuerySchema,
  importResultSchema,
  productInputSchema,
  productListSchema,
  productSchema,
} from '../src/lib/contracts';

test('validates import results with line-numbered problems', () => {
  assert.equal(importResultSchema.safeParse({ created: 2, errors: [] }).success, true);
  assert.equal(
    importResultSchema.safeParse({
      created: 0,
      errors: [{ line: 2, message: 'Duplicate SKU' }],
    }).success,
    true,
  );
  assert.equal(importResultSchema.safeParse({ created: 2 }).success, false);
  assert.equal(
    importResultSchema.safeParse({ created: 0, errors: [{ line: 0, message: 'x' }] }).success,
    false,
  );
});

const product = {
  id: '8ed13b94-fd8b-4079-848e-f22edaa8ce05',
  sku: 'USB-C_65W.01',
  name: 'USB-C Charger',
  description: null,
  unit: 'piece',
  reorderPoint: null,
  archivedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test('normalizes product input and stores empty descriptions as null', () => {
  const parsed = productInputSchema.parse({
    sku: ' usb-c_65w.01 ',
    name: ' USB-C Charger ',
    unit: ' piece ',
    description: '  ',
    reorderPoint: ' 5 ',
  });
  assert.deepEqual(parsed, {
    sku: 'USB-C_65W.01',
    name: 'USB-C Charger',
    unit: 'piece',
    description: null,
    reorderPoint: 5,
  });
  assert.equal(
    productInputSchema.parse({ sku: 'A', name: 'B', unit: 'c', description: '' }).reorderPoint,
    null,
  );
});

test('rejects malformed SKUs, blank fields, and oversized input', () => {
  const valid = { sku: 'SKU-01', name: 'Product', unit: 'piece', description: '' };
  assert.equal(productInputSchema.safeParse(valid).success, true);
  for (const invalid of [
    { ...valid, sku: 'SKU 01' },
    { ...valid, sku: '-SKU' },
    { ...valid, sku: '' },
    { ...valid, sku: 'A'.repeat(65) },
    { ...valid, name: '   ' },
    { ...valid, unit: ' ' },
    { ...valid, description: 'a'.repeat(2001) },
    { ...valid, reorderPoint: '-1' },
    { ...valid, reorderPoint: '2.5' },
    { ...valid, reorderPoint: '1000001' },
    { ...valid, reorderPoint: 'ten' },
  ]) {
    assert.equal(productInputSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test('accepts archived products and rejects malformed list responses', () => {
  assert.equal(productSchema.safeParse(product).success, true);
  assert.equal(
    productSchema.safeParse({ ...product, archivedAt: new Date().toISOString() }).success,
    true,
  );
  assert.equal(productSchema.safeParse({ ...product, archivedAt: 'soon' }).success, false);
  const list = { items: [product], total: 1, page: 1, pageSize: 20 };
  assert.equal(productListSchema.safeParse(list).success, true);
  assert.equal(productListSchema.safeParse({ ...list, total: -1 }).success, false);
  assert.equal(productListSchema.safeParse({ ...list, items: [{ id: 'x' }] }).success, false);
});

test('parses catalog queries and rejects unknown status or invalid pages', () => {
  assert.deepEqual(catalogQuerySchema.parse({ search: ' usb ', status: 'all', page: '2' }), {
    search: 'usb',
    status: 'all',
    page: 2,
  });
  assert.equal(catalogQuerySchema.safeParse({ status: 'deleted' }).success, false);
  assert.equal(catalogQuerySchema.safeParse({ page: '0' }).success, false);
  assert.equal(catalogQuerySchema.safeParse({ page: 'many' }).success, false);
});
