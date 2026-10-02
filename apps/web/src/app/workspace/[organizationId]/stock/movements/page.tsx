import { History } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import {
  locationListSchema,
  movementTypeLabels,
  movementTypeTone,
  productListSchema,
  stockMovementListSchema,
} from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Stock movements' };

const idParam = z
  .string()
  .optional()
  .transform((value) => (value && z.uuid().safeParse(value).success ? value : undefined));
const querySchema = z.object({
  product: idParam,
  location: idParam,
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

export default async function StockMovementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);

  const rawQuery = querySchema.safeParse(await searchParams);
  const query = rawQuery.success ? rawQuery.data : querySchema.parse({});
  const movementsQuery = new URLSearchParams();
  if (query.product) movementsQuery.set('productId', query.product);
  if (query.location) movementsQuery.set('locationId', query.location);
  if (query.page) movementsQuery.set('page', String(query.page));

  const [movements, products, locations] = await Promise.all([
    authenticatedRequest(
      `/organizations/${organization.id}/stock/movements?${movementsQuery}`,
      stockMovementListSchema,
    ),
    authenticatedRequest(
      `/organizations/${organization.id}/products?status=all&pageSize=100`,
      productListSchema,
    ),
    authenticatedRequest(
      `/organizations/${organization.id}/locations?status=all&pageSize=100`,
      locationListSchema,
    ),
  ]);
  if (!movements.ok || !products.ok || !locations.ok)
    throw new Error('The StockFlow API is unavailable.');
  const { items, total, page, pageSize } = movements.data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(date));
  const signed = (quantity: number) => (quantity > 0 ? `+${quantity}` : String(quantity));

  const pageLink = (target: number) => {
    const linkQuery = new URLSearchParams();
    if (query.product) linkQuery.set('product', query.product);
    if (query.location) linkQuery.set('location', query.location);
    if (target > 1) linkQuery.set('page', String(target));
    const suffix = linkQuery.toString();
    return `/workspace/${organization.id}/stock/movements${suffix ? `?${suffix}` : ''}`;
  };
  const exportQuery = new URLSearchParams();
  if (query.product) exportQuery.set('product', query.product);
  if (query.location) exportQuery.set('location', query.location);
  const exportHref = `/workspace/${organization.id}/stock/export/movements${
    exportQuery.toString() ? `?${exportQuery}` : ''
  }`;

  return (
    <AppShell user={user} organization={organization} section="Stock">
      <div className="page-heading">
        <div>
          <p className="eyebrow">INVENTORY</p>
          <h1>Stock movements</h1>
        </div>
        <Link href={`/workspace/${organization.id}/stock`} className="secondary-button">
          Back to stock
        </Link>
      </div>

      <form className="catalog-toolbar" action={`/workspace/${organization.id}/stock/movements`}>
        <div className="catalog-filters">
          <label htmlFor="movement-product">Product</label>
          <select id="movement-product" name="product" defaultValue={query.product ?? ''}>
            <option value="">All products</option>
            {products.data.items.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({product.sku})
              </option>
            ))}
          </select>
          <label htmlFor="movement-location">Location</label>
          <select id="movement-location" name="location" defaultValue={query.location ?? ''}>
            <option value="">All locations</option>
            {locations.data.items.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <button type="submit" className="secondary-button">
            Apply
          </button>
          <a className="secondary-button" href={exportHref} download>
            Export CSV
          </a>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="empty-organizations">
          <History size={38} strokeWidth={1.3} aria-hidden="true" />
          <h2>
            {total === 0 && !query.product && !query.location
              ? 'No movements yet'
              : 'No matching movements'}
          </h2>
          <p className="muted">Deliveries, transfers, and adjustments appear here.</p>
        </div>
      ) : (
        <>
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
                {items.map((movement) => (
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
                    <td>{movement.detail ?? '\u2014'}</td>
                    <td>{movement.createdBy.displayName}</td>
                    <td>{formatDate(movement.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              {total} {total === 1 ? 'movement' : 'movements'} &middot; page {page} of {totalPages}
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
    </AppShell>
  );
}
