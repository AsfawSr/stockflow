import { ForgotPasswordForm } from '@/components/recovery-form';

export const metadata = {
  title: 'Forgot password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
