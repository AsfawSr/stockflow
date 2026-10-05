import { ArrowLeft, ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import {
  CancelCountButton,
  CompleteCountButton,
  RecordCountForm,
  RemoveCountLineButton,
} from '@/components/count-forms';
import {
  cycleCountSchema,
  cycleCountStatusLabels,
  cycleCountTone,
  productListSchema,
} from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Cycle count' };

const idSchema = z.uuid();

export default async function CycleCountPage({
  params,
}: {
  params: Promise<{ organizationId: string; countId: string }>;
}) {
  const { organizationId, countId } = await params;
  if (!idSchema.safeParse(countId).success) notFound();
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  const warehouse = organization.roles.some((role) => role === 'ADMIN' || role === 'WAREHOUSE');

  const result = await authenticatedRequest(
    `/organizations/${organization.id}/cycle-counts/${countId}`,
    cycleCountSchema,
  );
  if (!result.ok) {
    if (result.status === 401) redirect('/login?notice=expired');
    if (result.status === 403 || result.status === 404) notFound();
    throw new Error('The StockFlow API is unavailable.');
  }
  const count = result.data;
  const open = count.status === 'OPEN';
  const counting = warehouse && open;

  const products = counting
    ? await authenticatedRequest(
        `/organizations/${organization.id}/products?status=active&pageSize=100`,
        productListSchema,
      )
    : null;
  const formatTime = (date: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(date));
  const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
  const differences = count.lines.filter(
    (line) => line.countedQuantity !== line.expectedQuantity,
  ).length;

  return (
    <AppShell user={user} organization={organization} section="Stock">
      <Link className="text-link" href={`/workspace/${organization.id}/stock/counts`}>
        <ArrowLeft size={16} aria-hidden="true" />
        All cycle counts
      </Link>
      <div className="page-heading workspace-heading">
        <div>
          <p className="eyebrow">CYCLE COUNT</p>
          <h1>{count.location.name}</h1>
          <div className="role-list heading-roles">
            <span className={`badge ${cycleCountTone[count.status]}`}>
              <span />
              {cycleCountStatusLabels[count.status]}
            </span>
          </div>
        </div>
        {counting && (
          <div className="button-row">
            <CancelCountButton organizationId={organization.id} countId={count.id} />
            <CompleteCountButton organizationId={organization.id} countId={count.id} />
          </div>
        )}
      </div>
      <section className="workspace-section" aria-labelledby="count-heading">
        <div className="section-heading">
          <h2 id="count-heading">Counted products</h2>
          <span>
            {count.lines.length} {count.lines.length === 1 ? 'product' : 'products'}
            {count.lines.length > 0
              ? ` \u00b7 ${differences} ${differences === 1 ? 'difference' : 'differences'}`
              : ''}
          </span>
        </div>
        <p className="muted">
          Opened {formatTime(count.createdAt)} UTC
          {count.createdBy ? ` by ${count.createdBy.displayName}` : ''}
          {count.note ? ` · ${count.note}` : ''}
          {count.status === 'COMPLETED' && count.completedAt
            ? ` · completed ${formatTime(count.completedAt)} UTC${
                count.completedBy ? ` by ${count.completedBy.displayName}` : ''
              }`
            : ''}
          {open ? ' · Differences are posted as adjustments when the count is completed.' : ''}
        </p>
        {count.status === 'COMPLETED' && (
          <p className="form-notice" role="status">
            {differences === 0
              ? 'Every counted product matched the ledger; nothing was adjusted.'
              : `${differences} ${
                  differences === 1 ? 'difference was' : 'differences were'
                } posted to the ledger as stock adjustments.`}
          </p>
        )}
        {count.status === 'CANCELLED' && (
          <p className="form-notice" role="status">
            This session was cancelled; nothing was posted to the ledger.
          </p>
        )}
        {count.lines.length === 0 ? (
          <div className="empty-organizations">
            <ClipboardList size={38} strokeWidth={1.3} aria-hidden="true" />
            <h2>Nothing counted yet</h2>
            <p className="muted">Record the shelf quantity for each product you check.</p>
          </div>
        ) : (
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">PRODUCT</th>
                  <th scope="col">SKU</th>
                  <th scope="col">EXPECTED</th>
                  <th scope="col">COUNTED</th>
                  <th scope="col">DIFFERENCE</th>
                  {counting && (
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {count.lines.map((line) => {
                  const variance = line.countedQuantity - line.expectedQuantity;
                  return (
                    <tr key={line.id}>
                      <td>{line.product.name}</td>
                      <td>
                        <code className="sku-cell">{line.product.sku}</code>
                      </td>
                      <td>
                        {line.expectedQuantity} {line.product.unit}
                      </td>
                      <td>
                        {line.countedQuantity} {line.product.unit}
                      </td>
                      <td>
                        {variance === 0 ? 'matches' : `${signed(variance)} ${line.product.unit}`}
                      </td>
                      {counting && (
                        <td>
                          <RemoveCountLineButton
                            organizationId={organization.id}
                            countId={count.id}
                            productId={line.product.id}
                            label={line.product.sku}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {counting && products?.ok === true && (
          <RecordCountForm
            organizationId={organization.id}
            countId={count.id}
            products={products.data.items.map((product) => ({
              id: product.id,
              label: `${product.sku} \u00b7 ${product.name}`,
            }))}
          />
        )}
      </section>
    </AppShell>
  );
}
