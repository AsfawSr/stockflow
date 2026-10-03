import {
  ArrowLeftRight,
  Boxes,
  Building2,
  CalendarDays,
  CircleAlert,
  ClipboardList,
  Coins,
} from 'lucide-react';
import Link from 'next/link';
import { z } from 'zod';
import { AppShell } from '@/components/app-shell';
import { InviteMemberButton, RevokeInvitationButton } from '@/components/invitation-forms';
import { MemberRolesButton, RemoveMemberButton } from '@/components/member-forms';
import { RenameOrganizationForm } from '@/components/organization-forms';
import {
  invitationListSchema,
  memberListSchema,
  movementTypeLabels,
  purchaseOrderListSchema,
  roleLabels,
  stockLevelListSchema,
  stockMovementListSchema,
  trendListSchema,
} from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Workspace' };

const pageParam = z.coerce.number().int().min(1).max(100000).optional();
const querySchema = z.object({ membersPage: pageParam, invitesPage: pageParam });

export default async function WorkspacePage({
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
  const rawQuery = querySchema.safeParse(await searchParams);
  const query = rawQuery.success ? rawQuery.data : querySchema.parse({});
  const [members, invitations, balances, lowBalances, submittedOrders, recentMovements, trends] =
    await Promise.all([
      admin
        ? authenticatedRequest(
            `/organizations/${organization.id}/members?page=${query.membersPage ?? 1}`,
            memberListSchema,
          )
        : null,
      admin
        ? authenticatedRequest(
            `/organizations/${organization.id}/invitations?page=${query.invitesPage ?? 1}`,
            invitationListSchema,
          )
        : null,
      authenticatedRequest(
        `/organizations/${organization.id}/stock/levels?pageSize=1`,
        stockLevelListSchema,
      ),
      authenticatedRequest(
        `/organizations/${organization.id}/stock/levels?low=true&pageSize=1`,
        stockLevelListSchema,
      ),
      authenticatedRequest(
        `/organizations/${organization.id}/purchase-orders?status=SUBMITTED&pageSize=1`,
        purchaseOrderListSchema,
      ),
      authenticatedRequest(
        `/organizations/${organization.id}/stock/movements?pageSize=5`,
        stockMovementListSchema,
      ),
      authenticatedRequest(`/organizations/${organization.id}/trends`, trendListSchema),
    ]);
  const pulse = [
    {
      label: 'On-hand balances',
      value: balances.ok ? balances.data.total : null,
      href: `/workspace/${organization.id}/stock`,
      icon: Boxes,
    },
    {
      label: 'Low stock',
      value: lowBalances.ok ? lowBalances.data.total : null,
      href: `/workspace/${organization.id}/stock?show=low`,
      icon: CircleAlert,
      alert: lowBalances.ok && lowBalances.data.total > 0,
    },
    {
      label: 'Awaiting approval',
      value: submittedOrders.ok ? submittedOrders.data.total : null,
      href: `/workspace/${organization.id}/purchase-orders?status=SUBMITTED`,
      icon: ClipboardList,
    },
  ];
  const pageLink = (changes: { membersPage?: number; invitesPage?: number }) => {
    const linkQuery = new URLSearchParams();
    const membersPage = changes.membersPage ?? query.membersPage ?? 1;
    const invitesPage = changes.invitesPage ?? query.invitesPage ?? 1;
    if (membersPage > 1) linkQuery.set('membersPage', String(membersPage));
    if (invitesPage > 1) linkQuery.set('invitesPage', String(invitesPage));
    const suffix = linkQuery.toString();
    return `/workspace/${organization.id}${suffix ? `?${suffix}` : ''}`;
  };
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(date),
    );
  const formatTime = (date: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(date));
  const formatWeek = (date: string) =>
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00Z`),
    );
  return (
    <AppShell user={user} organization={organization} section="Overview">
      <div className="page-heading workspace-heading">
        <div>
          <p className="eyebrow">ORGANIZATION WORKSPACE</p>
          <h1>{organization.name}</h1>
          <div className="role-list heading-roles">
            {organization.roles.map((role) => (
              <span className="role-tag" key={role}>
                {roleLabels[role]}
              </span>
            ))}
          </div>
        </div>
        <Link href="/organizations" className="secondary-button">
          <ArrowLeftRight size={17} aria-hidden="true" />
          Switch organization
        </Link>
      </div>
      <section className="workspace-section" aria-labelledby="profile-heading">
        <div className="section-heading">
          <h2 id="profile-heading">Organization profile</h2>
          <Building2 size={18} className="muted" aria-hidden="true" />
        </div>
        <div className="profile-grid">
          <dl className="organization-details">
            <div>
              <dt>
                <Coins size={15} aria-hidden="true" />
                Currency
              </dt>
              <dd>{organization.currency}</dd>
            </div>
            <div>
              <dt>
                <CalendarDays size={15} aria-hidden="true" />
                Created
              </dt>
              <dd>{formatDate(organization.createdAt)}</dd>
            </div>
            <div>
              <dt>Your account</dt>
              <dd>{user.email}</dd>
            </div>
          </dl>
          {admin && <RenameOrganizationForm organization={organization} />}
        </div>
      </section>
      <section className="workspace-section" aria-labelledby="pulse-heading">
        <div className="section-heading">
          <h2 id="pulse-heading">Workspace pulse</h2>
          <span>LIVE COUNTS</span>
        </div>
        <div className="stat-grid">
          {pulse.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className={`stat-card${stat.alert ? ' is-alert' : ''}`}
            >
              <stat.icon size={18} aria-hidden="true" />
              <span className="stat-value">{stat.value ?? '\u2014'}</span>
              <span className="stat-label">{stat.label}</span>
            </Link>
          ))}
        </div>
        <h3 className="subsection-heading">Recent activity</h3>
        {recentMovements.ok && recentMovements.data.items.length > 0 ? (
          <ul className="activity-list">
            {recentMovements.data.items.map((movement) => (
              <li key={movement.id}>
                <span className={`badge ${movement.quantity < 0 ? 'offline' : 'online'}`}>
                  <span />
                  {movementTypeLabels[movement.type]}
                </span>
                <span className="activity-text">
                  {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}{' '}
                  {movement.product.unit} &middot; {movement.product.name} at{' '}
                  {movement.location.name}
                </span>
                <span className="activity-time">{formatTime(movement.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Stock movements will appear here.</p>
        )}
        <h3 className="subsection-heading">Weekly activity</h3>
        {trends.ok ? (
          <div className="service-table-wrapper">
            <table className="service-table trend-table">
              <thead>
                <tr>
                  <th scope="col">WEEK OF</th>
                  <th scope="col">NEW ORDERS</th>
                  <th scope="col">UNITS RECEIVED</th>
                  <th scope="col">MOVEMENTS</th>
                </tr>
              </thead>
              <tbody>
                {[...trends.data.weeks].reverse().map((week) => (
                  <tr key={week.weekStart}>
                    <td>{formatWeek(week.weekStart)}</td>
                    <td>{week.ordersCreated}</td>
                    <td>{week.unitsReceived}</td>
                    <td>{week.movements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Trends are unavailable right now.</p>
        )}
      </section>
      {admin && (
        <section className="workspace-section" aria-labelledby="members-heading">
          <div className="section-heading">
            <h2 id="members-heading">Members</h2>
            <div className="section-heading-actions">
              {members?.ok && (
                <span>
                  {members.data.total} {members.data.total === 1 ? 'member' : 'members'}
                </span>
              )}
              <Link className="secondary-button" href={`/workspace/${organization.id}/audit`}>
                Audit log
              </Link>
              <InviteMemberButton organizationId={organization.id} />
            </div>
          </div>
          {members?.ok ? (
            <div className="service-table-wrapper">
              <table className="service-table member-table">
                <thead>
                  <tr>
                    <th scope="col">MEMBER</th>
                    <th scope="col">ROLES</th>
                    <th scope="col">JOINED</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.data.items.map((member) => (
                    <tr key={member.user.id}>
                      <td>
                        <div className="member-name">
                          {member.user.displayName}
                          <small>{member.user.email}</small>
                        </div>
                      </td>
                      <td>
                        <div className="role-list">
                          {member.roles.map((role) => (
                            <span className="role-tag" key={role}>
                              {roleLabels[role]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>{formatDate(member.createdAt)}</td>
                      <td>
                        <div className="row-actions">
                          <MemberRolesButton
                            organizationId={organization.id}
                            memberUserId={member.user.id}
                            email={member.user.email}
                            roles={member.roles}
                          />
                          <RemoveMemberButton
                            organizationId={organization.id}
                            memberUserId={member.user.id}
                            email={member.user.email}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="form-alert" role="alert">
              {members && !members.ok ? members.error : 'Member list unavailable.'}
            </p>
          )}
          {members?.ok && members.data.total > members.data.pageSize && (
            <div className="pagination">
              <span>
                Page {members.data.page} of{' '}
                {Math.max(1, Math.ceil(members.data.total / members.data.pageSize))}
              </span>
              <div className="button-row">
                {members.data.page > 1 ? (
                  <Link
                    className="secondary-button"
                    href={pageLink({ membersPage: members.data.page - 1 })}
                  >
                    Previous members
                  </Link>
                ) : null}
                {members.data.page * members.data.pageSize < members.data.total ? (
                  <Link
                    className="secondary-button"
                    href={pageLink({ membersPage: members.data.page + 1 })}
                  >
                    Next members
                  </Link>
                ) : null}
              </div>
            </div>
          )}
          {invitations?.ok && invitations.data.items.length > 0 && (
            <>
              <h3 className="subsection-heading">Pending invitations</h3>
              <div className="service-table-wrapper">
                <table className="service-table member-table">
                  <thead>
                    <tr>
                      <th scope="col">EMAIL</th>
                      <th scope="col">ROLES</th>
                      <th scope="col">INVITED BY</th>
                      <th scope="col">EXPIRES</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.data.items.map((invitation) => (
                      <tr key={invitation.id}>
                        <td>{invitation.email}</td>
                        <td>
                          <div className="role-list">
                            {invitation.roles.map((role) => (
                              <span className="role-tag" key={role}>
                                {roleLabels[role]}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>{invitation.invitedBy.displayName}</td>
                        <td>{formatDate(invitation.expiresAt)}</td>
                        <td>
                          <RevokeInvitationButton
                            organizationId={organization.id}
                            invitationId={invitation.id}
                            email={invitation.email}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {invitations.data.total > invitations.data.pageSize && (
                <div className="pagination">
                  <span>
                    Page {invitations.data.page} of{' '}
                    {Math.max(1, Math.ceil(invitations.data.total / invitations.data.pageSize))}
                  </span>
                  <div className="button-row">
                    {invitations.data.page > 1 ? (
                      <Link
                        className="secondary-button"
                        href={pageLink({ invitesPage: invitations.data.page - 1 })}
                      >
                        Previous invitations
                      </Link>
                    ) : null}
                    {invitations.data.page * invitations.data.pageSize < invitations.data.total ? (
                      <Link
                        className="secondary-button"
                        href={pageLink({ invitesPage: invitations.data.page + 1 })}
                      >
                        Next invitations
                      </Link>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </AppShell>
  );
}
