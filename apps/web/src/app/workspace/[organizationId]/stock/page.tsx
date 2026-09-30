import { Boxes, Search } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import { AdjustmentButton, TransferButton } from '@/components/stock-forms';
import {
  locationListSchema,
  movementTypeLabels,
  movementTypeTone,
  productListSchema,
  stockLevelListSchema,
  stockMovementListSchema,
} from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Stock' };

const querySchema = z.object({
  location: z
    .string()
    .optional()
    .transform((value) => (value && z.uuid().safeParse(value).success ? value : undefined)),
  show: z.enum(['all', 'low']).optional(),
  search: z.string().trim().max(160).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  const warehouse = organization.roles.some((role) => role === 'ADMIN' || role === 'WAREHOUSE');

  const rawQuery = querySchema.safeParse(await searchParams);
  const query = rawQuery.success ? rawQuery.data : querySchema.parse({});
  const levelsQuery = new URLSearchParams();
  if (query.location) levelsQuery.set('locationId', query.location);
  if (query.show === 'low') levelsQuery.set('low', 'true');
  if (query.search) levelsQuery.set('search', query.search);
  if (query.page) levelsQuery.set('page', String(query.page));

  const [levels, movements, locations, products] = await Promise.all([
    authenticatedRequest(
      `/organizations/${organization.id}/stock/levels?${levelsQuery}`,
      stockLevelListSchema,
    ),
    authenticatedRequest(
      `/organizations/${organization.id}/stock/movements?pageSize=15`,
      stockMovementListSchema,
    ),
    authenticatedRequest(
      `/organizations/${organization.id}/locations?status=active&pageSize=100`,
      locationListSchema,
    ),
    warehouse
      ? authenticatedRequest(
          `/organizations/${organization.id}/products?status=active&pageSize=100`,
          productListSchema,
        )
      : null,
  ]);
  if (!levels.ok || !movements.ok || !locations.ok || (products && !products.ok))
    throw new Error('The StockFlow API is unavailable.');
  const { items, total, page, pageSize } = levels.data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const locationOptions = locations.data.items.map((location) => ({
    id: location.id,
    label: location.name,
  }));
  const productOptions =
    products?.ok === true
      ? products.data.items.map((product) => ({
          id: product.id,
          label: `${product.name} (${product.sku})`,
        }))
      : [];
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(date));
  const signed = (quantity: number) => (quantity > 0 ? `+${quantity}` : String(quantity));

  const pageLink = (target: number) => {
    const linkQuery = new URLSearchParams();
    if (query.location) linkQuery.set('location', query.location);
    if (query.show === 'low') linkQuery.set('show', 'low');
    if (query.search) linkQuery.set('search', query.search);
    if (target > 1) linkQuery.set('page', String(target));
    const suffix = linkQuery.toString();
    return `/workspace/${organization.id}/stock${suffix ? `?${suffix}` : ''}`;
  };

  return (
    <AppShell user={user} organization={organization} section="Stock">
      <div className="page-heading">
        <div>
          <p className="eyebrow">INVENTORY</p>
          <h1>Stock</h1>
        </div>
        {warehouse && (
          <div className="button-row">
            <TransferButton
              organizationId={organization.id}
              products={productOptions}
              locations={locationOptions}
            />
            <AdjustmentButton
              organizationId={organization.id}
              products={productOptions}
              locations={locationOptions}
            />
          </div>
        )}
      </div>

      <form className="catalog-toolbar" action={`/workspace/${organization.id}/stock`}>
        <div className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            name="search"
            aria-label="Search stock"
            placeholder="Search by name or SKU"
            defaultValue={query.search ?? ''}
            maxLength={160}
          />
        </div>
        <div className="catalog-filters">
          <label htmlFor="stock-location">Location</label>
          <select id="stock-location" name="location" defaultValue={query.location ?? ''}>
            <option value="">All locations</option>
            {locationOptions.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </select>
          <label htmlFor="stock-show">Show</label>
          <select id="stock-show" name="show" defaultValue={query.show ?? 'all'}>
            <option value="all">All balances</option>
            <option value="low">Low stock</option>
          </select>
          <button type="submit" className="secondary-button">
            Apply
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="empty-organizations">
          <Boxes size={38} strokeWidth={1.3} aria-hidden="true" />
          <h2>
            {total === 0 && !query.search && !query.location && query.show !== 'low'
              ? 'No stock yet'
              : 'No matching stock'}
          </h2>
          <p className="muted">
            {query.show === 'low'
              ? 'No balances are at or below their reorder points.'
              : 'Stock appears here after deliveries, transfers, or opening adjustments.'}
          </p>
        </div>
      ) : (
        <>
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">PRODUCT</th>
                  <th scope="col">SKU</th>
                  <th scope="col">LOCATION</th>
                  <th scope="col">ON HAND</th>
                  <th scope="col">REORDER AT</th>
                  <th scope="col">UPDATED</th>
                </tr>
              </thead>
              <tbody>
                {items.map((level) => (
                  <tr key={`${level.product.id}-${level.location.id}`}>
                    <td>{level.product.name}</td>
                    <td>
                      <code className="sku-cell">{level.product.sku}</code>
                    </td>
                    <td>{level.location.name}</td>
                    <td>
                      <span className="quantity-cell">
                        {level.quantity} {level.product.unit}
                        {level.low && (
                          <span className="badge offline">
                            <span />
                            Low
                          </span>
                        )}
                      </span>
                    </td>
                    <td>{level.product.reorderPoint ?? '\u2014'}</td>
                    <td>{formatDate(level.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              {total} {total === 1 ? 'balance' : 'balances'} · page {page} of {totalPages}
            </span>
            <div className="button-row">
              {page > 1 ? (
                <Link className="secondary-button" href={pageLink(page - 1)}>
                  Previous
                </Link>
              ) : null}
              {page < totalPages ? (
                <Link className="secondary-button" href={pageLink(page + 1)}>
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}

      <section aria-labelledby="movements-heading" className="receipt-history">
        <h2 id="movements-heading">Recent movements</h2>
        {movements.data.items.length === 0 ? (
          <p className="muted">Deliveries, transfers, and adjustments will appear here.</p>
        ) : (
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">TYPE</th>
                  <th scope="col">PRODUCT</th>
                  <th scope="col">LOCATION</th>
                  <th scope="col">QTY</th>
                  <th scope="col">DETAIL</th>
                  <th scope="col">BY</th>
                  <th scope="col">WHEN</th>
                </tr>
              </thead>
              <tbody>
                {movements.data.items.map((movement) => (
                  <tr key={movement.id}>
                    <td>
                      <span className={`badge ${movementTypeTone[movement.type]}`}>
                        <span />
                        {movementTypeLabels[movement.type]}
                      </span>
                    </td>
                    <td>{movement.product.name}</td>
                    <td>{movement.location.name}</td>
                    <td>{signed(movement.quantity)}</td>
                    <td>{movement.detail ?? '—'}</td>
                    <td>{movement.createdBy.displayName}</td>
                    <td>{formatDate(movement.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
