import { ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import { CreateOrderButton } from '@/components/purchase-order-forms';
import {
  locationListSchema,
  orderStatusLabels,
  orderStatusTone,
  purchaseOrderListSchema,
  purchaseOrderStatusSchema,
  supplierListSchema,
} from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Purchase orders' };

const querySchema = z.object({
  status: purchaseOrderStatusSchema.or(z.literal('all')).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
});

export default async function PurchaseOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  const purchaser = organization.roles.some((role) => role === 'ADMIN' || role === 'PURCHASER');

  const rawQuery = querySchema.safeParse(await searchParams);
  const query = rawQuery.success ? rawQuery.data : {};
  const status = query.status ?? 'all';
  const apiQuery = new URLSearchParams({ status });
  if (query.page) apiQuery.set('page', String(query.page));

  const [result, suppliers, locations] = await Promise.all([
    authenticatedRequest(
      `/organizations/${organization.id}/purchase-orders?${apiQuery}`,
      purchaseOrderListSchema,
    ),
    purchaser
      ? authenticatedRequest(
          `/organizations/${organization.id}/suppliers?status=active&pageSize=100`,
          supplierListSchema,
        )
      : null,
    purchaser
      ? authenticatedRequest(
          `/organizations/${organization.id}/locations?status=active&pageSize=100`,
          locationListSchema,
        )
      : null,
  ]);
  if (!result.ok || (suppliers && !suppliers.ok) || (locations && !locations.ok))
    throw new Error('The StockFlow API is unavailable.');
  const { items, total, page, pageSize } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(date),
    );

  const pageLink = (target: number) => {
    const linkQuery = new URLSearchParams();
    if (status !== 'all') linkQuery.set('status', status);
    if (target > 1) linkQuery.set('page', String(target));
    const suffix = linkQuery.toString();
    return `/workspace/${organization.id}/purchase-orders${suffix ? `?${suffix}` : ''}`;
  };

  return (
    <AppShell user={user} organization={organization} section="Purchase orders">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PROCUREMENT</p>
          <h1>Purchase orders</h1>
        </div>
        <div className="button-row">
          <Link
            className="secondary-button"
            href={`/workspace/${organization.id}/purchase-orders/suggestions`}
          >
            Reorder suggestions
          </Link>
          {purchaser && suppliers?.ok && locations?.ok && (
            <CreateOrderButton
              organizationId={organization.id}
              suppliers={suppliers.data.items.map((supplier) => ({
                id: supplier.id,
                label: supplier.name,
              }))}
              locations={locations.data.items.map((location) => ({
                id: location.id,
                label: location.name,
              }))}
            />
          )}
        </div>
      </div>

      <form className="catalog-toolbar" action={`/workspace/${organization.id}/purchase-orders`}>
        <div className="catalog-filters">
          <label htmlFor="status-filter">Show</label>
          <select id="status-filter" name="status" defaultValue={status}>
            <option value="all">All</option>
            {Object.entries(orderStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" className="secondary-button">
            Apply
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="empty-organizations">
          <ClipboardList size={38} strokeWidth={1.3} aria-hidden="true" />
          <h2>{status === 'all' ? 'No purchase orders yet' : 'No matching purchase orders'}</h2>
          {purchaser && status === 'all' && (
            <p className="muted">Create an order to start the purchasing workflow.</p>
          )}
        </div>
      ) : (
        <>
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">ORDER</th>
                  <th scope="col">SUPPLIER</th>
                  <th scope="col">DELIVER TO</th>
                  <th scope="col">TOTAL</th>
                  <th scope="col">STATUS</th>
                  <th scope="col">UPDATED</th>
                </tr>
              </thead>
              <tbody>
                {items.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link
                        className="text-link order-link"
                        href={`/workspace/${organization.id}/purchase-orders/${order.id}`}
                      >
                        {order.reference}
                      </Link>
                    </td>
                    <td>{order.supplier.name}</td>
                    <td>{order.location.name}</td>
                    <td>
                      {order.total} {organization.currency}
                    </td>
                    <td>
                      <span className={`badge ${orderStatusTone[order.status]}`}>
                        <span />
                        {orderStatusLabels[order.status]}
                      </span>
                    </td>
                    <td>{formatDate(order.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              {total} {total === 1 ? 'order' : 'orders'} · page {page} of {totalPages}
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
