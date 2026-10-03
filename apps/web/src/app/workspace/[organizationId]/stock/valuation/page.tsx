import { ArrowLeft, Banknote } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { stockValuationSchema } from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Inventory valuation' };

export default async function StockValuationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);

  const result = await authenticatedRequest(
    `/organizations/${organization.id}/stock/valuation`,
    stockValuationSchema,
  );
  if (!result.ok) {
    if (result.status === 401) redirect('/login?notice=expired');
    throw new Error('The StockFlow API is unavailable.');
  }
  const { items, totalValue } = result.data;

  return (
    <AppShell user={user} organization={organization} section="Stock">
      <Link className="text-link" href={`/workspace/${organization.id}/stock`}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to stock
      </Link>
      <div className="page-heading workspace-heading">
        <div>
          <p className="eyebrow">INVENTORY</p>
          <h1>Inventory valuation</h1>
        </div>
      </div>
      <section className="workspace-section" aria-labelledby="valuation-heading">
        <div className="section-heading">
          <h2 id="valuation-heading">On-hand value</h2>
          <span>
            Total {totalValue} {organization.currency}
          </span>
        </div>
        <p className="muted">
          Unit costs are the weighted average of received deliveries. Stock that never arrived
          through a delivery has no known cost and is excluded from the total.
        </p>
        {items.length === 0 ? (
          <div className="empty-organizations">
            <Banknote size={38} strokeWidth={1.3} aria-hidden="true" />
            <h2>No stock to value</h2>
            <p className="muted">Balances appear here once products are on hand.</p>
          </div>
        ) : (
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">PRODUCT</th>
                  <th scope="col">SKU</th>
                  <th scope="col">ON HAND</th>
                  <th scope="col">AVG COST</th>
                  <th scope="col">VALUE</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.product.id}>
                    <td>{item.product.name}</td>
                    <td>
                      <code className="sku-cell">{item.product.sku}</code>
                    </td>
                    <td>
                      {item.onHand} {item.product.unit}
                    </td>
                    <td>
                      {item.averageCost ? `${item.averageCost} ${organization.currency}` : '\u2014'}
                    </td>
                    <td>{item.value ? `${item.value} ${organization.currency}` : '\u2014'}</td>
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
