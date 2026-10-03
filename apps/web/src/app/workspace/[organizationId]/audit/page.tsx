import { ArrowLeft, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import { auditListSchema } from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Audit log' };

const querySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).optional() });

export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  if (!organization.roles.includes('ADMIN')) notFound();
  const rawQuery = querySchema.safeParse(await searchParams);
  const page = rawQuery.success ? (rawQuery.data.page ?? 1) : 1;

  const result = await authenticatedRequest(
    `/organizations/${organization.id}/audit?page=${page}`,
    auditListSchema,
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
    `/workspace/${organization.id}/audit${target > 1 ? `?page=${target}` : ''}`;

  return (
    <AppShell user={user} organization={organization} section="Overview">
      <Link className="text-link" href={`/workspace/${organization.id}`}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to overview
      </Link>
      <div className="page-heading workspace-heading">
        <div>
          <p className="eyebrow">ACCOUNTABILITY</p>
          <h1>Audit log</h1>
        </div>
      </div>
      <section className="workspace-section" aria-labelledby="audit-heading">
        <div className="section-heading">
          <h2 id="audit-heading">Workspace activity</h2>
          <span>
            {total} {total === 1 ? 'event' : 'events'}
          </span>
        </div>
        {items.length === 0 ? (
          <div className="empty-organizations">
            <ScrollText size={38} strokeWidth={1.3} aria-hidden="true" />
            <h2>No activity yet</h2>
            <p className="muted">
              Orders, stock movements, invitations, and member changes appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="service-table-wrapper">
              <table className="service-table product-table">
                <thead>
                  <tr>
                    <th scope="col">WHEN</th>
                    <th scope="col">ACTIVITY</th>
                    <th scope="col">BY</th>
                    <th scope="col">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((event) => (
                    <tr key={event.id}>
                      <td>{formatTime(event.createdAt)} UTC</td>
                      <td>{event.summary}</td>
                      <td>{event.actor ? event.actor.displayName : '\u2014'}</td>
                      <td>
                        <code className="sku-cell">{event.action}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {total} {total === 1 ? 'event' : 'events'} · page {page} of {totalPages}
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
