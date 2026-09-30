import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth-form';
import { currentUser } from '@/lib/session';

export const metadata = { title: 'Create account' };

export default async function SignupPage() {
  const user = await currentUser();
  if (user.ok) redirect('/');
  return <AuthForm mode="signup" />;
}
