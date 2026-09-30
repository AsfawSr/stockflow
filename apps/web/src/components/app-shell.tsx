import Link from 'next/link';
import { Activity, Building2, LayoutDashboard, LogOut } from 'lucide-react';
import { logoutAction } from '@/app/actions';
import type { Organization, UserProfile } from '@/lib/contracts';
import { Brand } from './brand';
import { SubmitButton } from './form-controls';

export function AppShell({
  user,
  organization,
  section,
  children,
}: {
  user?: UserProfile;
  organization?: Organization;
  section: 'Organizations' | 'Overview' | 'System status';
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar application-sidebar">
        <Brand />
        <div className="workspace-label">
          <span className="workspace-avatar">
            <Building2 size={17} aria-hidden="true" />
          </span>
          <div className="workspace-name" title={organization?.name}>
            {organization?.name ?? 'StockFlow workspace'}
            <small>{organization?.currency ?? 'Inventory & procurement'}</small>
          </div>
        </div>
        <nav className="workspace-nav" aria-label="Main navigation">
          <p className="nav-label">WORKSPACE</p>
          {user && (
            <Link
              className="nav-item"
              href="/organizations"
              aria-current={section === 'Organizations' ? 'page' : undefined}
            >
              <Building2 size={18} aria-hidden="true" />
              Organizations
            </Link>
          )}
          {organization && (
            <Link
              className="nav-item"
              href={`/workspace/${organization.id}`}
              aria-current={section === 'Overview' ? 'page' : undefined}
            >
              <LayoutDashboard size={18} aria-hidden="true" />
              Overview
            </Link>
          )}
          <Link
            className="nav-item"
            href="/status"
            aria-current={section === 'System status' ? 'page' : undefined}
          >
            <Activity size={18} aria-hidden="true" />
            System status
          </Link>
        </nav>
        <div className="sidebar-footer">
          <span className="workspace-avatar">
            {user?.displayName.slice(0, 2).toUpperCase() ?? 'SF'}
          </span>
          <div className="profile-info">
            {user?.displayName ?? 'StockFlow'}
            <small>{user?.email ?? 'Inventory & procurement'}</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            Workspace <span>/</span>
            <strong>{section}</strong>
          </div>
          <div className="account-controls">
            {user ? (
              <>
                <span className="account-name">{user.displayName}</span>
                <form action={logoutAction}>
                  <SubmitButton className="secondary-button" pendingText="Signing out...">
                    <LogOut size={16} aria-hidden="true" />
                    Sign out
                  </SubmitButton>
                </form>
              </>
            ) : (
              <Link href="/login" className="secondary-button">
                Sign in
              </Link>
            )}
          </div>
        </header>
        <main id="main">
          {children}
          <footer className="page-footer">
            <span>STOCKFLOW</span>
            <span>Inventory & procurement</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
