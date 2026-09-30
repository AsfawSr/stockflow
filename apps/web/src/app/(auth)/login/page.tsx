import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { currentUser } from '@/lib/session';

export const metadata = { title: 'Sign in' };

const notices: Record<string, string> = {
  expired: 'Your session ended. Sign in to continue.',
  'signed-out': 'You have signed out.',
  'logout-unconfirmed':
    'Signed out on this device. Server session revocation could not be confirmed.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await currentUser();
  if (user.ok) redirect('/');
  const { notice } = await searchParams;
  return (
    <AuthForm mode="login" notice={typeof notice === 'string' ? notices[notice] : undefined} />
  );
}
