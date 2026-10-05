import { ArrowLeft, ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import { OpenCountButton } from '@/components/count-forms';
import {
  cycleCountListSchema,
  cycleCountStatusLabels,
  cycleCountTone,
  locationListSchema,
} from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Cycle counts' };

const querySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).optional() });

export default async function CycleCountsPage({
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
  const page = rawQuery.success ? (rawQuery.data.page ?? 1) : 1;

  const [counts, locations] = await Promise.all([
    authenticatedRequest(
      `/organizations/${organization.id}/cycle-counts?page=${page}`,
      cycleCountListSchema,
    ),
    warehouse
      ? authenticatedRequest(
          `/organizations/${organization.id}/locations?status=active&pageSize=100`,
          locationListSchema,
        )
      : Promise.resolve(null),
  ]);
  if (!counts.ok) {
    if (counts.status === 401) redirect('/login?notice=expired');
    if (counts.status === 403 || counts.status === 404) notFound();
    throw new Error('The StockFlow API is unavailable.');
  }
  const { items, total, pageSize } = counts.data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const formatTime = (date: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(date));
  const pageLink = (target: number) =>
    `/workspace/${organization.id}/stock/counts${target > 1 ? `?page=${target}` : ''}`;

  return (
    <AppShell user={user} organization={organization} section="Stock">
      <Link className="text-link" href={`/workspace/${organization.id}/stock`}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to stock
      </Link>
      <div className="page-heading workspace-heading">
        <div>
          <p className="eyebrow">INVENTORY</p>
          <h1>Cycle counts</h1>
        </div>
        {warehouse && locations?.ok === true && (
          <OpenCountButton
            organizationId={organization.id}
            locations={locations.data.items.map((location) => ({
              id: location.id,
              label: location.name,
            }))}
          />
        )}
      </div>
      <section className="workspace-section" aria-labelledby="counts-heading">
        <div className="section-heading">
          <h2 id="counts-heading">Counting sessions</h2>
          <span>
            {total} {total === 1 ? 'session' : 'sessions'}
          </span>
        </div>
        <p className="muted">
          A session records the real shelf quantities at one location. Completing it posts every
          difference as a stock adjustment; cancelled sessions change nothing.
        </p>
        {items.length === 0 ? (
          <div className="empty-organizations">
            <ClipboardList size={38} strokeWidth={1.3} aria-hidden="true" />
            <h2>No counts yet</h2>
            <p className="muted">Open a session to reconcile shelf stock with the ledger.</p>
          </div>
        ) : (
          <>
            <div className="service-table-wrapper">
              <table className="service-table product-table">
                <thead>
                  <tr>
                    <th scope="col">OPENED</th>
                    <th scope="col">LOCATION</th>
                    <th scope="col">STATUS</th>
                    <th scope="col">PRODUCTS</th>
                    <th scope="col">BY</th>
                    <th scope="col">
                      <span className="visually-hidden">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((count) => (
                    <tr key={count.id}>
                      <td>{formatTime(count.createdAt)} UTC</td>
                      <td>{count.location.name}</td>
                      <td>
                        <span className={`badge ${cycleCountTone[count.status]}`}>
                          {cycleCountStatusLabels[count.status]}
                        </span>
                      </td>
                      <td>{count.lineCount}</td>
                      <td>{count.createdBy ? count.createdBy.displayName : '\u2014'}</td>
                      <td>
                        <Link
                          className="secondary-button row-button"
                          href={`/workspace/${organization.id}/stock/counts/${count.id}`}
                          aria-label={`Open the count at ${count.location.name} from ${formatTime(count.createdAt)} UTC`}
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
                {total} {total === 1 ? 'session' : 'sessions'} · page {page} of {totalPages}
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
