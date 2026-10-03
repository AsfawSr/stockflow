import { ArrowLeft, PackageSearch } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { SuggestionOrderButton } from '@/components/purchase-order-forms';
import { locationListSchema, reorderSuggestionListSchema } from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Reorder suggestions' };

export default async function ReorderSuggestionsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  const purchaser = organization.roles.some((role) => role === 'ADMIN' || role === 'PURCHASER');

  const [result, locations] = await Promise.all([
    authenticatedRequest(
      `/organizations/${organization.id}/purchase-orders/suggestions`,
      reorderSuggestionListSchema,
    ),
    purchaser
      ? authenticatedRequest(
          `/organizations/${organization.id}/locations?status=active&pageSize=100`,
          locationListSchema,
        )
      : null,
  ]);
  if (!result.ok || (locations && !locations.ok)) {
    if (result.status === 401) redirect('/login?notice=expired');
    throw new Error('The StockFlow API is unavailable.');
  }
  const items = result.data.items;
  const locationOptions =
    locations?.ok === true
      ? locations.data.items.map((location) => ({ id: location.id, label: location.name }))
      : [];
  const canOrder = purchaser && locationOptions.length > 0;

  return (
    <AppShell user={user} organization={organization} section="Purchase orders">
      <Link className="text-link" href={`/workspace/${organization.id}/purchase-orders`}>
        <ArrowLeft size={16} aria-hidden="true" />
        All purchase orders
      </Link>
      <div className="page-heading workspace-heading">
        <div>
          <p className="eyebrow">PROCUREMENT</p>
          <h1>Reorder suggestions</h1>
        </div>
      </div>
      <section className="workspace-section" aria-labelledby="suggestions-heading">
        <div className="section-heading">
          <h2 id="suggestions-heading">Products at or below their reorder point</h2>
          <span>
            {items.length} {items.length === 1 ? 'product' : 'products'}
          </span>
        </div>
        <p className="muted">
          Suggested quantities order up to twice the reorder point. The supplier and price come from
          the latest confirmed order for each product.
        </p>
        {items.length === 0 ? (
          <div className="empty-organizations">
            <PackageSearch size={38} strokeWidth={1.3} aria-hidden="true" />
            <h2>Nothing to reorder</h2>
            <p className="muted">
              Products appear here when their on-hand balance drops to the reorder point.
            </p>
          </div>
        ) : (
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">PRODUCT</th>
                  <th scope="col">SKU</th>
                  <th scope="col">ON HAND</th>
                  <th scope="col">REORDER AT</th>
                  <th scope="col">SUGGESTED QTY</th>
                  <th scope="col">LAST SUPPLIER</th>
                  <th scope="col">LAST PRICE</th>
                  {canOrder && <th scope="col">ORDER</th>}
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
                    <td>{item.reorderPoint}</td>
                    <td>
                      {item.suggestedQuantity} {item.product.unit}
                    </td>
                    <td>{item.supplier ? item.supplier.name : '\u2014'}</td>
                    <td>
                      {item.unitPrice
                        ? `${item.unitPrice} ${organization.currency} (${item.reference})`
                        : '\u2014'}
                    </td>
                    {canOrder && (
                      <td>
                        {item.supplier ? (
                          <SuggestionOrderButton
                            organizationId={organization.id}
                            locations={locationOptions}
                            suggestion={{
                              productId: item.product.id,
                              productName: item.product.name,
                              sku: item.product.sku,
                              supplierId: item.supplier.id,
                              supplierName: item.supplier.name,
                              quantity: item.suggestedQuantity,
                              unitPrice: item.unitPrice ?? '',
                            }}
                          />
                        ) : (
                          '\u2014'
                        )}
                      </td>
                    )}
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
