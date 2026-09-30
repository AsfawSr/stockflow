import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import {
  AddLineForm,
  OrderTransitionButton,
  ReceiptForm,
  RejectOrderButton,
  RemoveLineButton,
} from '@/components/purchase-order-forms';
import {
  orderStatusLabels,
  orderStatusTone,
  organizationIdSchema,
  productListSchema,
  purchaseOrderSchema,
} from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Purchase order' };

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ organizationId: string; orderId: string }>;
}) {
  const { organizationId, orderId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  if (!organizationIdSchema.safeParse(orderId).success) notFound();

  const result = await authenticatedRequest(
    `/organizations/${organization.id}/purchase-orders/${orderId}`,
    purchaseOrderSchema,
  );
  if (!result.ok) {
    if (result.status === 404) notFound();
    if (result.status === 401) redirect('/login?notice=expired');
    throw new Error('The StockFlow API is unavailable.');
  }
  const order = result.data;

  const purchaser = organization.roles.some((role) => role === 'ADMIN' || role === 'PURCHASER');
  const approver = organization.roles.some((role) => role === 'ADMIN' || role === 'MANAGER');
  const receiver = organization.roles.some((role) => role === 'ADMIN' || role === 'WAREHOUSE');
  const draft = order.status === 'DRAFT';
  const canReceive =
    receiver && (order.status === 'APPROVED' || order.status === 'PARTIALLY_RECEIVED');
  const canCancel =
    purchaser &&
    (draft ||
      order.status === 'SUBMITTED' ||
      (order.status === 'APPROVED' && order.receipts.length === 0));

  const products = draft
    ? await authenticatedRequest(
        `/organizations/${organization.id}/products?status=active&pageSize=100`,
        productListSchema,
      )
    : null;
  if (products && !products.ok) throw new Error('The StockFlow API is unavailable.');

  const formatDate = (date: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(date));

  return (
    <AppShell user={user} organization={organization} section="Purchase orders">
      <Link className="text-link" href={`/workspace/${organization.id}/purchase-orders`}>
        <ArrowLeft size={16} aria-hidden="true" />
        All purchase orders
      </Link>
      <div className="page-heading workspace-heading order-heading">
        <div>
          <p className="eyebrow">PURCHASE ORDER</p>
          <h1>{order.reference}</h1>
          <div className="role-list heading-roles">
            <span className={`badge ${orderStatusTone[order.status]}`}>
              <span />
              {orderStatusLabels[order.status]}
            </span>
          </div>
        </div>
        <div className="button-row order-actions">
          {purchaser && draft && (
            <OrderTransitionButton
              organizationId={organization.id}
              orderId={order.id}
              transition="submit"
              label="Submit for approval"
              pendingLabel="Submitting..."
              primary
            />
          )}
          {approver && order.status === 'SUBMITTED' && (
            <>
              <OrderTransitionButton
                organizationId={organization.id}
                orderId={order.id}
                transition="approve"
                label="Approve"
                pendingLabel="Approving..."
                primary
              />
              <RejectOrderButton organizationId={organization.id} orderId={order.id} />
            </>
          )}
          {canCancel && (
            <OrderTransitionButton
              organizationId={organization.id}
              orderId={order.id}
              transition="cancel"
              label="Cancel order"
              pendingLabel="Cancelling..."
            />
          )}
        </div>
      </div>

      <section className="workspace-section" aria-labelledby="order-summary">
        <div className="section-heading">
          <h2 id="order-summary">Order summary</h2>
          <span>
            Total {order.total} {organization.currency}
          </span>
        </div>
        <dl className="organization-details order-details">
          <div>
            <dt>Supplier</dt>
            <dd>{order.supplier.name}</dd>
          </div>
          <div>
            <dt>Deliver to</dt>
            <dd>{order.location.name}</dd>
          </div>
          <div>
            <dt>Created by</dt>
            <dd>
              {order.createdBy.displayName} · {formatDate(order.createdAt)} UTC
            </dd>
          </div>
          {order.note && (
            <div>
              <dt>Note</dt>
              <dd>{order.note}</dd>
            </div>
          )}
          {order.decidedBy && order.decidedAt && (
            <div>
              <dt>{order.status === 'REJECTED' ? 'Rejected by' : 'Approved by'}</dt>
              <dd>
                {order.decidedBy.displayName} · {formatDate(order.decidedAt)} UTC
                {order.decisionNote ? ` · ${order.decisionNote}` : ''}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="workspace-section" aria-labelledby="order-lines">
        <div className="section-heading">
          <h2 id="order-lines">Lines</h2>
          <span>
            {order.lines.length} {order.lines.length === 1 ? 'line' : 'lines'}
          </span>
        </div>
        {order.lines.length === 0 ? (
          <p className="muted">No lines yet. Add the products to order below.</p>
        ) : (
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">PRODUCT</th>
                  <th scope="col">QUANTITY</th>
                  <th scope="col">UNIT PRICE</th>
                  <th scope="col">RECEIVED</th>
                  <th scope="col">LINE TOTAL</th>
                  {purchaser && draft && <th scope="col">ACTIONS</th>}
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <div className="member-name">
                        <span>{line.product.name}</span>
                        <small>{line.product.sku}</small>
                      </div>
                    </td>
                    <td>
                      {line.quantity} {line.product.unit}
                    </td>
                    <td>{line.unitPrice}</td>
                    <td>
                      {line.receivedQuantity} of {line.quantity}
                    </td>
                    <td>{line.lineTotal}</td>
                    {purchaser && draft && (
                      <td>
                        <RemoveLineButton
                          organizationId={organization.id}
                          orderId={order.id}
                          lineId={line.id}
                          label={line.product.sku}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {purchaser && draft && products?.ok && (
          <AddLineForm
            organizationId={organization.id}
            orderId={order.id}
            products={products.data.items.map((product) => ({
              id: product.id,
              label: `${product.sku} · ${product.name}`,
            }))}
          />
        )}
      </section>

      {canReceive && (
        <section className="workspace-section" aria-labelledby="record-delivery">
          <div className="section-heading">
            <h2 id="record-delivery">Record a delivery</h2>
          </div>
          <ReceiptForm organizationId={organization.id} order={order} />
        </section>
      )}

      <section className="workspace-section" aria-labelledby="order-receipts">
        <div className="section-heading">
          <h2 id="order-receipts">Deliveries</h2>
          <span>
            {order.receipts.length} {order.receipts.length === 1 ? 'receipt' : 'receipts'}
          </span>
        </div>
        {order.receipts.length === 0 ? (
          <p className="muted">Nothing has been received for this order.</p>
        ) : (
          <div className="receipt-history">
            {order.receipts.map((receipt) => (
              <div className="receipt-entry" key={receipt.id}>
                <p>
                  <strong>{formatDate(receipt.createdAt)} UTC</strong> ·{' '}
                  {receipt.receivedBy.displayName}
                  {receipt.note ? ` · ${receipt.note}` : ''}
                </p>
                <ul>
                  {receipt.lines.map((line) => (
                    <li key={line.id}>
                      {line.quantity} × {line.product.sku} {line.product.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
