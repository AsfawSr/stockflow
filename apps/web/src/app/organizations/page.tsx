import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { CreateOrganizationButton, OrganizationPicker } from '@/components/organization-forms';
import { organizationsSchema } from '@/lib/contracts';
import { authenticatedRequest, requireUser } from '@/lib/session';

export const metadata = { title: 'Organizations' };

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await requireUser();
  const result = await authenticatedRequest('/organizations', organizationsSchema);
  if (!result.ok) {
    if (result.status === 401) redirect('/login?notice=expired');
    throw new Error('The StockFlow API is unavailable.');
  }
  const names = new Intl.DisplayNames('en', { type: 'currency' });
  const currencies = Intl.supportedValuesOf('currency').map((code) => ({
    code,
    label: names.of(code) ?? code,
  }));
  const { notice } = await searchParams;
  return (
    <AppShell user={user} section="Organizations">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACES</p>
          <h1>Organizations</h1>
        </div>
        <CreateOrganizationButton currencies={currencies} />
      </div>
      {notice === 'unavailable' && (
        <p className="form-notice" role="status">
          That organization is no longer available to your account.
        </p>
      )}
      <OrganizationPicker organizations={result.data} />
    </AppShell>
  );
}
