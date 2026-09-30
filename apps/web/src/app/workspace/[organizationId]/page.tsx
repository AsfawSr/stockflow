import { ArrowLeftRight, Building2, CalendarDays, Coins } from 'lucide-react';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { RenameOrganizationForm } from '@/components/organization-forms';
import { membersSchema, roleLabels } from '@/lib/contracts';
import { authenticatedRequest, requireOrganization, requireUser } from '@/lib/session';

export const metadata = { title: 'Workspace' };

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const user = await requireUser();
  const organization = await requireOrganization(organizationId);
  const admin = organization.roles.includes('ADMIN');
  const members = admin
    ? await authenticatedRequest(`/organizations/${organization.id}/members`, membersSchema)
    : null;
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(date),
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
      {admin && (
        <section className="workspace-section" aria-labelledby="members-heading">
          <div className="section-heading">
            <h2 id="members-heading">Members</h2>
            {members?.ok && (
              <span>
                {members.data.length} {members.data.length === 1 ? 'member' : 'members'}
              </span>
            )}
          </div>
          {members?.ok ? (
            <div className="service-table-wrapper">
              <table className="service-table member-table">
                <thead>
                  <tr>
                    <th scope="col">MEMBER</th>
                    <th scope="col">ROLES</th>
                    <th scope="col">JOINED</th>
                  </tr>
                </thead>
                <tbody>
                  {members.data.map((member) => (
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
        </section>
      )}
    </AppShell>
  );
}
