import { Search, Warehouse } from 'lucide-react';
import Link from 'next/link';
import { saveLocationAction, setLocationArchivedAction } from '@/app/actions';
import { AppShell } from '@/components/app-shell';
import {
  EntityArchiveButton,
  EntityDialogButton,
  type EntityField,
} from '@/components/entity-forms';
import { catalogQuerySchema, locationListSchema, type ProductStatus } from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Locations' };

const statusLabels: Record<ProductStatus, string> = {
  active: 'Active',
  archived: 'Archived',
  all: 'All',
};

const locationFields: EntityField[] = [
  { name: 'name', label: 'Location name', required: true, maxLength: 120 },
  { name: 'address', label: 'Address (optional)', maxLength: 500, textarea: true },
];

export default async function LocationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  const admin = organization.roles.includes('ADMIN');

  const rawQuery = catalogQuerySchema.safeParse(await searchParams);
  const query = rawQuery.success ? rawQuery.data : {};
  const status = query.status ?? 'active';
  const apiQuery = new URLSearchParams({ status });
  if (query.search) apiQuery.set('search', query.search);
  if (query.page) apiQuery.set('page', String(query.page));

  const result = await authenticatedRequest(
    `/organizations/${organization.id}/locations?${apiQuery}`,
    locationListSchema,
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
    return `/workspace/${organization.id}/locations${suffix ? `?${suffix}` : ''}`;
  };

  return (
    <AppShell user={user} organization={organization} section="Locations">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WAREHOUSES AND STORES</p>
          <h1>Locations</h1>
        </div>
        {admin && (
          <EntityDialogButton
            action={saveLocationAction}
            entityLabel="location"
            fields={locationFields}
            hidden={{ organizationId: organization.id }}
          />
        )}
      </div>

      <form className="catalog-toolbar" action={`/workspace/${organization.id}/locations`}>
        <div className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            name="search"
            aria-label="Search locations"
            placeholder="Search by name"
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
          <Warehouse size={38} strokeWidth={1.3} aria-hidden="true" />
          <h2>
            {total === 0 && !query.search
              ? status === 'archived'
                ? 'No archived locations'
                : 'No locations yet'
              : 'No matching locations'}
          </h2>
        </div>
      ) : (
        <>
          <div className="service-table-wrapper">
            <table className="service-table product-table">
              <thead>
                <tr>
                  <th scope="col">LOCATION</th>
                  <th scope="col">ADDRESS</th>
                  <th scope="col">STATUS</th>
                  {admin && <th scope="col">ACTIONS</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((location) => (
                  <tr key={location.id}>
                    <td>
                      <div className="member-name">
                        <span>{location.name}</span>
                      </div>
                    </td>
                    <td>{location.address ?? <span className="muted">No address</span>}</td>
                    <td>
                      <span className={`badge ${location.archivedAt ? 'offline' : 'online'}`}>
                        <span />
                        {location.archivedAt ? 'Archived' : 'Active'}
                      </span>
                    </td>
                    {admin && (
                      <td>
                        <div className="row-actions">
                          <EntityDialogButton
                            action={saveLocationAction}
                            entityLabel="location"
                            itemName={location.name}
                            fields={locationFields}
                            values={{ name: location.name, address: location.address ?? '' }}
                            hidden={{ organizationId: organization.id, entityId: location.id }}
                          />
                          <EntityArchiveButton
                            action={setLocationArchivedAction}
                            hidden={{ organizationId: organization.id, entityId: location.id }}
                            archived={location.archivedAt !== null}
                            itemName={location.name}
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
              {total} {total === 1 ? 'location' : 'locations'} · page {page} of {totalPages}
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
