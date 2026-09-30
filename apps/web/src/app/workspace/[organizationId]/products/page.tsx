import { Package, Search } from 'lucide-react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { ArchiveToggleButton, ProductDialogButton } from '@/components/product-forms';
import { catalogQuerySchema, productListSchema, type ProductStatus } from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Products' };

const statusLabels: Record<ProductStatus, string> = {
  active: 'Active',
  archived: 'Archived',
  all: 'All',
};

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  const manager = organization.roles.some((role) => role === 'ADMIN' || role === 'MANAGER');

  const rawQuery = catalogQuerySchema.safeParse(await searchParams);
  const query = rawQuery.success ? rawQuery.data : {};
  const status = query.status ?? 'active';
  const apiQuery = new URLSearchParams({ status });
  if (query.search) apiQuery.set('search', query.search);
  if (query.page) apiQuery.set('page', String(query.page));

  const result = await authenticatedRequest(
    `/organizations/${organization.id}/products?${apiQuery}`,
    productListSchema,
  );
  if (!result.ok) throw new Error('The StockFlow API is unavailable.');
  const { items, total, page, pageSize } = result.data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageLink = (target: number) => {
    const linkQuery = new URLSearchParams();
    if (query.search) linkQuery.set('search', query.search);
    if (status !== 'active') linkQuery.set('status', status);
    if (target > 1) linkQuery.set('page', String(target));
    const suffix = linkQuery.toString();
    return `/workspace/${organization.id}/products${suffix ? `?${suffix}` : ''}`;
  };

  return (
    <AppShell user={user} organization={organization} section="Products">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ORGANIZATION CATALOG</p>
          <h1>Products</h1>
        </div>
        {manager && <ProductDialogButton organizationId={organization.id} />}
      </div>

      <form className="catalog-toolbar" action={`/workspace/${organization.id}/products`}>
        <div className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            name="search"
            aria-label="Search products"
            placeholder="Search by name or SKU"
            defaultValue={query.search ?? ''}
            maxLength={160}
          />
        </div>
        <div className="catalog-filters">
          <label htmlFor="status-filter">Show</label>
          <select id="status-filter" name="status" defaultValue={status}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit" className="secondary-button">
            Apply
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="empty-organizations">
          <Package size={38} strokeWidth={1.3} aria-hidden="true" />
          <h2>
            {total === 0 && !query.search
              ? status === 'archived'
                ? 'No archived products'
                : 'No products yet'
              : 'No matching products'}
          </h2>
          {manager && total === 0 && !query.search && status !== 'archived' && (
            <p className="muted">Create your first product to start building the catalog.</p>
          )}
        </div>
      ) : (
        <>
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">PRODUCT</th>
                  <th scope="col">UNIT</th>
                  <th scope="col">STATUS</th>
                  {manager && <th scope="col">ACTIONS</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <code className="sku-cell">{product.sku}</code>
                    </td>
                    <td>
                      <div className="member-name">
                        <span>{product.name}</span>
                        {product.description && <small>{product.description}</small>}
                      </div>
                    </td>
                    <td>{product.unit}</td>
                    <td>
                      <span className={`badge ${product.archivedAt ? 'offline' : 'online'}`}>
                        <span />
                        {product.archivedAt ? 'Archived' : 'Active'}
                      </span>
                    </td>
                    {manager && (
                      <td>
                        <div className="row-actions">
                          <ProductDialogButton organizationId={organization.id} product={product} />
                          <ArchiveToggleButton organizationId={organization.id} product={product} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              {total} {total === 1 ? 'product' : 'products'} · page {page} of {totalPages}
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
    </AppShell>
  );
}
