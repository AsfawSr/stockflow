import { ArrowLeft, Send } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import { webhookDeliveryListSchema, webhookDeliveryTone } from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Webhook deliveries' };

const querySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).optional() });
const idSchema = z.uuid();

export default async function WebhookDeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; webhookId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, webhookId } = await params;
  if (!idSchema.safeParse(webhookId).success) notFound();
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  if (!organization.roles.includes('ADMIN')) notFound();
  const rawQuery = querySchema.safeParse(await searchParams);
  const page = rawQuery.success ? (rawQuery.data.page ?? 1) : 1;

  const result = await authenticatedRequest(
    `/organizations/${organization.id}/webhooks/${webhookId}/deliveries?page=${page}`,
    webhookDeliveryListSchema,
  );
  if (!result.ok) {
    if (result.status === 401) redirect('/login?notice=expired');
    if (result.status === 403 || result.status === 404) notFound();
    throw new Error('The StockFlow API is unavailable.');
  }
  const { url, items, total, pageSize } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const formatTime = (date: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(date));
  const pageLink = (target: number) =>
    `/workspace/${organization.id}/webhooks/${webhookId}/deliveries${target > 1 ? `?page=${target}` : ''}`;

  return (
    <AppShell user={user} organization={organization} section="Overview">
      <Link className="text-link" href={`/workspace/${organization.id}/webhooks`}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to webhooks
      </Link>
      <div className="page-heading workspace-heading">
        <div>
          <p className="eyebrow">INTEGRATIONS</p>
          <h1>Deliveries</h1>
        </div>
      </div>
      <section className="workspace-section" aria-labelledby="deliveries-heading">
        <div className="section-heading">
          <h2 id="deliveries-heading" className="webhook-url">
            {url}
          </h2>
          <span>
            {total} {total === 1 ? 'delivery' : 'deliveries'}
          </span>
        </div>
        <p className="muted">
          Every attempt is logged. Failed deliveries retry automatically with backoff for up to five
          attempts while the endpoint stays enabled.
        </p>
        {items.length === 0 ? (
          <div className="empty-organizations">
            <Send size={38} strokeWidth={1.3} aria-hidden="true" />
            <h2>No deliveries yet</h2>
            <p className="muted">Purchase order events sent to this endpoint will appear here.</p>
          </div>
        ) : (
          <>
            <div className="service-table-wrapper">
              <table className="service-table product-table">
                <thead>
                  <tr>
                    <th scope="col">WHEN</th>
                    <th scope="col">EVENT</th>
                    <th scope="col">STATUS</th>
                    <th scope="col">ATTEMPTS</th>
                    <th scope="col">DETAIL</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((delivery) => (
                    <tr key={delivery.id}>
                      <td>{formatTime(delivery.createdAt)} UTC</td>
                      <td>
                        <code className="sku-cell">{delivery.event}</code>
                      </td>
                      <td>
                        <span className={`badge ${webhookDeliveryTone[delivery.status]}`}>
                          {delivery.status === 'PENDING'
                            ? 'Retrying'
                            : delivery.status === 'SUCCEEDED'
                              ? 'Delivered'
                              : 'Failed'}
                        </span>
                      </td>
                      <td>{delivery.attempts}</td>
                      <td className="webhook-url">
                        {delivery.status === 'SUCCEEDED'
                          ? `HTTP ${delivery.responseStatus}`
                          : (delivery.lastError ?? '\u2014')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {total} {total === 1 ? 'delivery' : 'deliveries'} · page {page} of {totalPages}
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
