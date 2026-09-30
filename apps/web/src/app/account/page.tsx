import { ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { PasswordChangeForm } from '@/components/account-forms';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const user = await requireUser(true);
  return (
    <AppShell user={user} section="Account">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR ACCOUNT</p>
          <h1>Account security</h1>
        </div>
      </div>
      <section className="workspace-section" aria-labelledby="password-heading">
        <div className="section-heading">
          <h2 id="password-heading">Change password</h2>
          <ShieldCheck size={18} className="muted" aria-hidden="true" />
        </div>
        <p className="muted">
          Changing your password signs out every other session and voids outstanding email links for
          this account. This session stays signed in.
        </p>
        <PasswordChangeForm />
      </section>
    </AppShell>
  );
}
