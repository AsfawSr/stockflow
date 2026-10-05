import { ArrowLeft, Camera } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import { valuationSnapshotListSchema } from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Valuation snapshots' };

const querySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).optional() });

export default async function ValuationSnapshotsPage({
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
  const page = rawQuery.success ? (rawQuery.data.page ?? 1) : 1;

  const result = await authenticatedRequest(
    `/organizations/${organization.id}/reports/valuation/snapshots?page=${page}`,
    valuationSnapshotListSchema,
  );
  if (!result.ok) {
    if (result.status === 401) redirect('/login?notice=expired');
    if (result.status === 403 || result.status === 404) notFound();
    throw new Error('The StockFlow API is unavailable.');
  }
  const { items, total, pageSize } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const formatTime = (date: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(date));
  const pageLink = (target: number) =>
    `/workspace/${organization.id}/stock/valuation/snapshots${target > 1 ? `?page=${target}` : ''}`;

  return (
    <AppShell user={user} organization={organization} section="Stock">
      <Link className="text-link" href={`/workspace/${organization.id}/stock/valuation`}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to valuation
      </Link>
      <div className="page-heading workspace-heading">
        <div>
          <p className="eyebrow">INVENTORY</p>
          <h1>Valuation snapshots</h1>
        </div>
      </div>
      <section className="workspace-section" aria-labelledby="snapshots-heading">
        <div className="section-heading">
          <h2 id="snapshots-heading">Saved valuations</h2>
          <span>
            {total} {total === 1 ? 'snapshot' : 'snapshots'}
          </span>
        </div>
        <p className="muted">
          Each snapshot freezes the on-hand valuation at the moment it was saved, so totals can be
          compared across time even as the ledger moves on.
        </p>
        {items.length === 0 ? (
          <div className="empty-organizations">
            <Camera size={38} strokeWidth={1.3} aria-hidden="true" />
            <h2>No snapshots yet</h2>
            <p className="muted">Save one from the valuation report to start the history.</p>
          </div>
        ) : (
          <>
            <div className="service-table-wrapper">
              <table className="service-table product-table">
                <thead>
                  <tr>
                    <th scope="col">WHEN</th>
                    <th scope="col">BY</th>
                    <th scope="col">PRODUCTS</th>
                    <th scope="col">TOTAL VALUE</th>
                    <th scope="col">
                      <span className="visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((snapshot) => (
                    <tr key={snapshot.id}>
                      <td>{formatTime(snapshot.createdAt)} UTC</td>
                      <td>{snapshot.createdBy ? snapshot.createdBy.displayName : '\u2014'}</td>
                      <td>{snapshot.productCount}</td>
                      <td>
                        {snapshot.totalValue} {snapshot.currency}
                      </td>
                      <td>
                        <Link
                          className="secondary-button row-button"
                          href={`/workspace/${organization.id}/stock/valuation/snapshots/${snapshot.id}`}
                          aria-label={`Open snapshot from ${formatTime(snapshot.createdAt)} UTC`}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {total} {total === 1 ? 'snapshot' : 'snapshots'} · page {page} of {totalPages}
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
      </section>
    </AppShell>
  );
}
