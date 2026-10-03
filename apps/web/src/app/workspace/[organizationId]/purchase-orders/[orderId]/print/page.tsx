import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PrintButton } from '@/components/print-button';
import {
  locationSchema,
  orderStatusLabels,
  organizationIdSchema,
  purchaseOrderSchema,
  supplierSchema,
} from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Purchase order document' };

export default async function PurchaseOrderPrintPage({
  params,
}: {
  params: Promise<{ organizationId: string; orderId: string }>;
}) {
  const { organizationId, orderId } = await params;
  await requireUser();
  const organization = await requireOrganization(organizationId);
  if (!organizationIdSchema.safeParse(orderId).success) notFound();

  const order = await authenticatedRequest(
    `/organizations/${organization.id}/purchase-orders/${orderId}`,
    purchaseOrderSchema,
  );
  if (!order.ok) {
    if (order.status === 404) notFound();
    if (order.status === 401) redirect('/login?notice=expired');
    throw new Error('The StockFlow API is unavailable.');
  }
  const [supplier, location] = await Promise.all([
    authenticatedRequest(
      `/organizations/${organization.id}/suppliers/${order.data.supplier.id}`,
      supplierSchema,
    ),
    authenticatedRequest(
      `/organizations/${organization.id}/locations/${order.data.location.id}`,
      locationSchema,
    ),
  ]);
  if (!supplier.ok || !location.ok) throw new Error('The StockFlow API is unavailable.');

  const formatDate = (date: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(date));

  return (
    <main className="print-document">
      <div className="print-toolbar no-print">
        <Link
          className="text-link"
          href={`/workspace/${organization.id}/purchase-orders/${order.data.id}`}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to order
        </Link>
        <PrintButton />
      </div>
      <header className="print-header">
        <div>
          <p className="print-eyebrow">PURCHASE ORDER</p>
          <h1>{order.data.reference}</h1>
        </div>
        <div className="print-org">
          <strong>{organization.name}</strong>
          <span>Status: {orderStatusLabels[order.data.status]}</span>
        </div>
      </header>
      <section className="print-parties">
        <div>
          <h2>Supplier</h2>
          <p>
            <strong>{supplier.data.name}</strong>
          </p>
          {supplier.data.contactName && <p>{supplier.data.contactName}</p>}
          {supplier.data.email && <p>{supplier.data.email}</p>}
          {supplier.data.phone && <p>{supplier.data.phone}</p>}
          {supplier.data.address && <p>{supplier.data.address}</p>}
        </div>
        <div>
          <h2>Deliver to</h2>
          <p>
            <strong>{location.data.name}</strong>
          </p>
          {location.data.address && <p>{location.data.address}</p>}
          <h2>Dates</h2>
          <p>Created {formatDate(order.data.createdAt)} UTC</p>
          {order.data.decidedAt && order.data.status !== 'REJECTED' && (
            <p>Approved {formatDate(order.data.decidedAt)} UTC</p>
          )}
        </div>
      </section>
      {order.data.note && (
        <section className="print-note">
          <h2>Note</h2>
          <p>{order.data.note}</p>
        </section>
      )}
      <div className="print-lines-wrapper">
        <table className="print-lines">
          <thead>
            <tr>
              <th scope="col">PRODUCT</th>
              <th scope="col">SKU</th>
              <th scope="col">QUANTITY</th>
              <th scope="col">UNIT PRICE</th>
              <th scope="col">LINE TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {order.data.lines.map((line) => (
              <tr key={line.id}>
                <td>{line.product.name}</td>
                <td>{line.product.sku}</td>
                <td>
                  {line.quantity} {line.product.unit}
                </td>
                <td>{line.unitPrice}</td>
                <td>{line.lineTotal}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>Total</td>
              <td>
                {order.data.total} {organization.currency}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <footer className="print-footer">
        Generated with StockFlow for {organization.name}. Prices in {organization.currency}.
      </footer>
    </main>
  );
}
