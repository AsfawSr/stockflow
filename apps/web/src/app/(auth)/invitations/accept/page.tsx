import { AcceptInvitationForm } from '@/components/invitation-forms';
import { requireUser } from '@/lib/session';

export const metadata = {
  title: 'Accept invitation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

export default async function AcceptInvitationPage() {
  await requireUser();
  return <AcceptInvitationForm />;
}
