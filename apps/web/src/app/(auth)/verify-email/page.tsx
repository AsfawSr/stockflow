import { redirect } from 'next/navigation';
import { LogOut, MailCheck } from 'lucide-react';
import { requireUser } from '@/lib/session';
import { VerificationRequestForm } from '@/components/recovery-form';
import { SubmitButton } from '@/components/form-controls';
import { logoutAction } from '@/app/actions';

export const metadata = {
  title: 'Verify email',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await requireUser(true);
  if (user.emailVerifiedAt) redirect('/organizations');
  const { notice } = await searchParams;
  return (
    <>
      <div className="recovery-symbol">
        <MailCheck size={25} aria-hidden="true" />
      </div>
      <p className="eyebrow">EMAIL VERIFICATION</p>
      <h1>Check your email</h1>
      <p className="verification-address">{user.email}</p>
      {notice === 'delivery-failed' && (
        <p className="form-alert recovery-form" role="alert">
          Your account was created, but the verification email could not be sent.
        </p>
      )}
      <div className="recovery-form">
        <VerificationRequestForm />
      </div>
      <form action={logoutAction} className="recovery-back">
        <SubmitButton className="secondary-button" pendingText="Signing out...">
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </SubmitButton>
      </form>
    </>
  );
}
