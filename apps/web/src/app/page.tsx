import { redirect } from 'next/navigation';
import { rememberedOrganization, sessionToken } from '@/lib/session';

export default async function Home() {
  if (!(await sessionToken())) redirect('/login');
  const organizationId = await rememberedOrganization();
  redirect(organizationId ? `/workspace/${organizationId}` : '/organizations');
}
