import { ArrowLeft, Webhook as WebhookIcon } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import {
  AddWebhookButton,
  DeleteWebhookButton,
  WebhookToggleButton,
} from '@/components/webhook-forms';
import { webhookListSchema } from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Webhooks' };

export default async function WebhooksPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  if (!organization.roles.includes('ADMIN')) notFound();

  const result = await authenticatedRequest(
    `/organizations/${organization.id}/webhooks`,
    webhookListSchema,
  );
  if (!result.ok) {
    if (result.status === 401) redirect('/login?notice=expired');
    if (result.status === 403 || result.status === 404) notFound();
    throw new Error('The StockFlow API is unavailable.');
  }
  const { items } = result.data;
  const formatTime = (date: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(date));

  return (
    <AppShell user={user} organization={organization} section="Overview">
      <Link className="text-link" href={`/workspace/${organization.id}`}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to overview
      </Link>
      <div className="page-heading workspace-heading">
        <div>
          <p className="eyebrow">INTEGRATIONS</p>
          <h1>Webhooks</h1>
        </div>
        <AddWebhookButton organizationId={organization.id} />
      </div>
      <section className="workspace-section" aria-labelledby="webhooks-heading">
        <div className="section-heading">
          <h2 id="webhooks-heading">Order event deliveries</h2>
          <span>
            {items.length} {items.length === 1 ? 'endpoint' : 'endpoints'}
          </span>
        </div>
        <p className="muted">
          StockFlow posts a JSON payload to every active endpoint when a purchase order is
          submitted, approved, rejected, received, cancelled, or reopened. Each request carries an
          X-StockFlow-Event header and an X-StockFlow-Signature HMAC you can verify with the
          endpoint secret.
        </p>
        {items.length === 0 ? (
          <div className="empty-organizations">
            <WebhookIcon size={38} strokeWidth={1.3} aria-hidden="true" />
            <h2>No webhooks yet</h2>
            <p className="muted">Add an endpoint to stream purchase order events to your tools.</p>
          </div>
        ) : (
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">URL</th>
                  <th scope="col">STATUS</th>
                  <th scope="col">ADDED</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((webhook) => (
                  <tr key={webhook.id}>
                    <td className="webhook-url">{webhook.url}</td>
                    <td>
                      <span className={`badge ${webhook.active ? 'online' : 'offline'}`}>
                        {webhook.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td>{formatTime(webhook.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        <WebhookToggleButton organizationId={organization.id} webhook={webhook} />
                        <DeleteWebhookButton organizationId={organization.id} webhook={webhook} />
                      </div>
                    </td>
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
