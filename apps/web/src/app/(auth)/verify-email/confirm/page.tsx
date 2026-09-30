import { AccountLinkForm } from '@/components/recovery-form';

export const metadata = {
  title: 'Confirm email',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

export default function ConfirmEmailPage() {
  return <AccountLinkForm mode="verify" />;
}
