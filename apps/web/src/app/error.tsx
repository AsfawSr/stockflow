'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, RefreshCw } from 'lucide-react';
import { Brand } from '@/components/brand';
import { logoutAction } from './actions';

export default function ErrorPage({ reset }: { reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Brand />
      </header>
      <main className="auth-main">
        <p className="eyebrow">CONNECTION INTERRUPTED</p>
        <h1>StockFlow is unavailable</h1>
        <p className="muted error-description">Your session has not been cleared.</p>
        <div className="button-row">
          <button
            className="primary-button"
            disabled={pending}
            onClick={() =>
              startTransition(() => {
                router.refresh();
                reset();
              })
            }
          >
            <RefreshCw size={17} aria-hidden="true" />
            {pending ? 'Retrying...' : 'Try again'}
          </button>
          <form action={logoutAction}>
            <button className="secondary-button">
              <LogOut size={17} aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
