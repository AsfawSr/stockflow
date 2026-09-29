'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      className="refresh-button"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw size={16} className={pending ? 'spinning' : undefined} aria-hidden="true" />
      {pending ? 'Checking...' : 'Refresh status'}
    </button>
  );
}
