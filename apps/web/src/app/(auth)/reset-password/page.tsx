import { AccountLinkForm } from '@/components/recovery-form';

export const metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

export default function ResetPasswordPage() {
  return <AccountLinkForm mode="reset" />;
}
