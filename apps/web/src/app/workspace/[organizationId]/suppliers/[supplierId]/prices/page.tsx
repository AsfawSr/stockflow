import { ArrowLeft, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import {
  organizationIdSchema,
  supplierPerformanceSchema,
  supplierPriceListSchema,
  supplierSchema,
} from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Supplier prices' };

export default async function SupplierPricesPage({
  params,
}: {
  params: Promise<{ organizationId: string; supplierId: string }>;
}) {
  const { organizationId, supplierId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  if (!organizationIdSchema.safeParse(supplierId).success) notFound();

  const [supplier, prices, performance] = await Promise.all([
    authenticatedRequest(
      `/organizations/${organization.id}/suppliers/${supplierId}`,
      supplierSchema,
    ),
    authenticatedRequest(
      `/organizations/${organization.id}/suppliers/${supplierId}/prices`,
      supplierPriceListSchema,
    ),
    authenticatedRequest(
      `/organizations/${organization.id}/suppliers/${supplierId}/performance`,
      supplierPerformanceSchema,
    ),
  ]);
  if (!supplier.ok || !prices.ok || !performance.ok) {
    if (supplier.status === 404 || prices.status === 404 || performance.status === 404) notFound();
    if (supplier.status === 401 || prices.status === 401 || performance.status === 401)
      redirect('/login?notice=expired');
    throw new Error('The StockFlow API is unavailable.');
  }
  const metrics = performance.data;
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(date),
    );

  return (
    <AppShell user={user} organization={organization} section="Suppliers">
      <Link className="text-link" href={`/workspace/${organization.id}/suppliers`}>
        <ArrowLeft size={16} aria-hidden="true" />
        All suppliers
      </Link>
      <div className="page-heading workspace-heading">
        <div>
          <p className="eyebrow">CONFIRMED PRICES</p>
          <h1>{supplier.data.name}</h1>
        </div>
      </div>
      <section className="workspace-section" aria-labelledby="performance-heading">
        <div className="section-heading">
          <h2 id="performance-heading">Delivery performance</h2>
          <span>confirmed orders only</span>
        </div>
        <dl className="organization-details order-details">
          <div>
            <dt>Confirmed orders</dt>
            <dd>
              {metrics.confirmedOrders} ({metrics.openOrders} open)
            </dd>
          </div>
          <div>
            <dt>Fill rate</dt>
            <dd>
              {metrics.fillRatePercent !== null
                ? `${metrics.fillRatePercent}% (${metrics.receivedUnits} of ${metrics.orderedUnits} units)`
                : '\u2014'}
            </dd>
          </div>
          <div>
            <dt>Average lead time</dt>
            <dd>
              {metrics.averageLeadDays !== null ? `${metrics.averageLeadDays} days` : '\u2014'}
            </dd>
          </div>
        </dl>
      </section>
      <section className="workspace-section" aria-labelledby="prices-heading">
        <div className="section-heading">
          <h2 id="prices-heading">Latest confirmed prices</h2>
          <span>
            {prices.data.items.length} {prices.data.items.length === 1 ? 'product' : 'products'}
          </span>
        </div>
        {prices.data.items.length === 0 ? (
          <div className="empty-organizations">
            <ReceiptText size={38} strokeWidth={1.3} aria-hidden="true" />
            <h2>No confirmed prices yet</h2>
            <p className="muted">
              Prices appear after an order for this supplier has been approved.
            </p>
          </div>
        ) : (
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">PRODUCT</th>
                  <th scope="col">SKU</th>
                  <th scope="col">LAST PRICE</th>
                  <th scope="col">ORDER</th>
                  <th scope="col">CONFIRMED</th>
                </tr>
              </thead>
              <tbody>
                {prices.data.items.map((item) => (
                  <tr key={item.product.id}>
                    <td>{item.product.name}</td>
                    <td>
                      <code className="sku-cell">{item.product.sku}</code>
                    </td>
                    <td>
                      {item.unitPrice} {organization.currency}
                    </td>
                    <td>{item.reference}</td>
                    <td>{formatDate(item.decidedAt)}</td>
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
