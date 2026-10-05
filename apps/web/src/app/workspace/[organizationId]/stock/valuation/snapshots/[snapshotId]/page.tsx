import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import { valuationSnapshotSchema } from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Valuation snapshot' };

const idSchema = z.uuid();

export default async function ValuationSnapshotPage({
  params,
}: {
  params: Promise<{ organizationId: string; snapshotId: string }>;
}) {
  const { organizationId, snapshotId } = await params;
  if (!idSchema.safeParse(snapshotId).success) notFound();
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);

  const result = await authenticatedRequest(
    `/organizations/${organization.id}/reports/valuation/snapshots/${snapshotId}`,
    valuationSnapshotSchema,
  );
  if (!result.ok) {
    if (result.status === 401) redirect('/login?notice=expired');
    if (result.status === 403 || result.status === 404) notFound();
    throw new Error('The StockFlow API is unavailable.');
  }
  const snapshot = result.data;
  const formatTime = (date: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(date));

  return (
    <AppShell user={user} organization={organization} section="Stock">
      <Link className="text-link" href={`/workspace/${organization.id}/stock/valuation/snapshots`}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to snapshots
      </Link>
      <div className="page-heading workspace-heading">
        <div>
          <p className="eyebrow">INVENTORY</p>
          <h1>Valuation snapshot</h1>
        </div>
      </div>
      <section className="workspace-section" aria-labelledby="snapshot-heading">
        <div className="section-heading">
          <h2 id="snapshot-heading">Saved {formatTime(snapshot.createdAt)} UTC</h2>
          <span>
            Total {snapshot.payload.totalValue} {snapshot.payload.currency}
          </span>
        </div>
        <p className="muted">
          Saved by {snapshot.createdBy ? snapshot.createdBy.displayName : 'a removed account'}. This
          report is frozen; the live valuation may differ.
        </p>
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
              {snapshot.payload.items.map((item) => (
                <tr key={item.product.id}>
                  <td>{item.product.name}</td>
                  <td>
                    <code className="sku-cell">{item.product.sku}</code>
                  </td>
                  <td>
                    {item.onHand} {item.product.unit}
                  </td>
                  <td>
                    {item.averageCost
                      ? `${item.averageCost} ${snapshot.payload.currency}`
                      : '\u2014'}
                  </td>
                  <td>{item.value ? `${item.value} ${snapshot.payload.currency}` : '\u2014'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
