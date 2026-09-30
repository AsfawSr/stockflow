import Link from 'next/link';
import { Activity } from 'lucide-react';
import { Brand } from '@/components/brand';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="auth-header">
        <Brand />
        <Link href="/status" className="text-link">
          <Activity size={16} aria-hidden="true" />
          System status
        </Link>
      </header>
      <main id="main" className="auth-main">
        {children}
      </main>
      <footer className="auth-footer">
        STOCKFLOW <span>Inventory & procurement</span>
      </footer>
    </div>
  );
}
