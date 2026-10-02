import { Search, Truck } from 'lucide-react';
import Link from 'next/link';
import { saveSupplierAction, setSupplierArchivedAction } from '@/app/actions';
import { AppShell } from '@/components/app-shell';
import {
  EntityArchiveButton,
  EntityDialogButton,
  type EntityField,
} from '@/components/entity-forms';
import {
  catalogQuerySchema,
  supplierListSchema,
  type ProductStatus,
  type Supplier,
} from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Suppliers' };

const statusLabels: Record<ProductStatus, string> = {
  active: 'Active',
  archived: 'Archived',
  all: 'All',
};

const supplierFields: EntityField[] = [
  { name: 'name', label: 'Supplier name', required: true, maxLength: 160 },
  { name: 'contactName', label: 'Contact name (optional)', maxLength: 120 },
  { name: 'email', label: 'Email (optional)', maxLength: 254, type: 'email' },
  {
    name: 'phone',
    label: 'Phone (optional)',
    maxLength: 32,
    type: 'tel',
    hint: 'Digits with + ( ) . / - separators.',
  },
  { name: 'address', label: 'Address (optional)', maxLength: 500, textarea: true },
];

function supplierValues(supplier: Supplier) {
  return {
    name: supplier.name,
    contactName: supplier.contactName ?? '',
    email: supplier.email ?? '',
    phone: supplier.phone ?? '',
    address: supplier.address ?? '',
  };
}

export default async function SuppliersPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  const manager = organization.roles.some((role) => role === 'ADMIN' || role === 'PURCHASER');

  const rawQuery = catalogQuerySchema.safeParse(await searchParams);
  const query = rawQuery.success ? rawQuery.data : {};
  const status = query.status ?? 'active';
  const apiQuery = new URLSearchParams({ status });
  if (query.search) apiQuery.set('search', query.search);
  if (query.page) apiQuery.set('page', String(query.page));

  const result = await authenticatedRequest(
    `/organizations/${organization.id}/suppliers?${apiQuery}`,
    supplierListSchema,
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
    return `/workspace/${organization.id}/suppliers${suffix ? `?${suffix}` : ''}`;
  };

  return (
    <AppShell user={user} organization={organization} section="Suppliers">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PURCHASING PARTNERS</p>
          <h1>Suppliers</h1>
        </div>
        {manager && (
          <EntityDialogButton
            action={saveSupplierAction}
            entityLabel="supplier"
            fields={supplierFields}
            hidden={{ organizationId: organization.id }}
          />
        )}
      </div>

      <form className="catalog-toolbar" action={`/workspace/${organization.id}/suppliers`}>
        <div className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            name="search"
            aria-label="Search suppliers"
            placeholder="Search by name or email"
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
          <Truck size={38} strokeWidth={1.3} aria-hidden="true" />
          <h2>
            {total === 0 && !query.search
              ? status === 'archived'
                ? 'No archived suppliers'
                : 'No suppliers yet'
              : 'No matching suppliers'}
          </h2>
        </div>
      ) : (
        <>
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">SUPPLIER</th>
                  <th scope="col">CONTACT</th>
                  <th scope="col">STATUS</th>
                  {manager && <th scope="col">ACTIONS</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <div className="member-name">
                        <Link
                          className="text-link"
                          href={`/workspace/${organization.id}/suppliers/${supplier.id}/prices`}
                        >
                          {supplier.name}
                        </Link>
                        {supplier.contactName && <small>{supplier.contactName}</small>}
                        {supplier.address && <small>{supplier.address}</small>}
                      </div>
                    </td>
                    <td>
                      <div className="member-name contact-cell">
                        {supplier.email && <span>{supplier.email}</span>}
                        {supplier.phone && <small>{supplier.phone}</small>}
                        {!supplier.email && !supplier.phone && (
                          <span className="muted">No contact details</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${supplier.archivedAt ? 'offline' : 'online'}`}>
                        <span />
                        {supplier.archivedAt ? 'Archived' : 'Active'}
                      </span>
                    </td>
                    {manager && (
                      <td>
                        <div className="row-actions">
                          <EntityDialogButton
                            action={saveSupplierAction}
                            entityLabel="supplier"
                            itemName={supplier.name}
                            fields={supplierFields}
                            values={supplierValues(supplier)}
                            hidden={{ organizationId: organization.id, entityId: supplier.id }}
                          />
                          <EntityArchiveButton
                            action={setSupplierArchivedAction}
                            hidden={{ organizationId: organization.id, entityId: supplier.id }}
                            archived={supplier.archivedAt !== null}
                            itemName={supplier.name}
                          />
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
              {total} {total === 1 ? 'supplier' : 'suppliers'} · page {page} of {totalPages}
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
