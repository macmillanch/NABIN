'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { holdsPermission } from '@/lib/access';
import { LogOut, LayoutDashboard, Store, Menu, X, Car, Package, Megaphone, ShieldCheck, Users, Activity, Wallet, LifeBuoy, FileText, Settings, Fingerprint, AlertTriangle } from 'lucide-react';
import { usePathname } from 'next/navigation';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /**
   * The name the server's own guard checks for this screen. Left unset on the sections
   * whose routes are gated per row rather than per page, so the navigation they were
   * always shown in does not change under them.
   */
  permission?: string;
}

/**
 * The command-center sections, in the order an operator works them.
 *
 * Two of these point at screens that already exist rather than a new duplicate: Marketing is
 * the campaign console (`/campaigns`) and Security is the session/lockout centre (`/security`).
 * `Operations` and `Settings` carry no nav permission because their pages read endpoints that are
 * gated individually (pause, resume, kill-switch, settings writes) - hiding the whole screen
 * would remove the read-only view an operator needs in order to ask for the grant, and the
 * controls inside are still permission-checked here and re-checked by Express regardless.
 */
const NAV_ITEMS: NavItem[] = [
  { name: 'Overview', href: '/', icon: LayoutDashboard },
  { name: 'Operations', href: '/operations', icon: Activity },
  { name: 'Finance', href: '/finance', icon: Wallet, permission: 'finance.view' },
  { name: 'Support', href: '/support', icon: LifeBuoy, permission: 'support.view' },
  { name: 'KYC', href: '/kyc', icon: Fingerprint, permission: 'identity_verification.view' },
  { name: 'Marketing', href: '/campaigns', icon: Megaphone, permission: 'campaign.view' },
  { name: 'Security', href: '/security', icon: ShieldCheck, permission: 'security.view' },
  { name: 'Audit Logs', href: '/audit', icon: FileText, permission: 'audit.view' },
  { name: 'Settings', href: '/settings', icon: Settings },
];

// Kept from the previous shell so nobody loses a screen they already use while the new
// sections are being stood up beside them.
const DETAIL_ITEMS: NavItem[] = [
  { name: 'Customers', href: '/customers', icon: Users, permission: 'customers.read' },
  { name: 'Drivers', href: '/drivers', icon: Car },
  { name: 'Merchants', href: '/merchants', icon: Store },
  { name: 'Jobs/Orders', href: '/orders', icon: Package },
];

export default function AdminLayout({ children, title }: { children: React.ReactNode; title?: string }) {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  if (!user) return <>{children}</>;

  return (
    <div className="nabin-shell">
      {sidebarOpen && (
        <div
          className="nabin-scrim"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`nabin-nav ${sidebarOpen ? 'is-open' : ''}`}>
        <div className="nabin-nav__brand">
          <span className="nabin-wordmark" style={{ fontSize: 18, color: 'var(--on-brand)' }}>
            NABIN
          </span>
          <span className="nabin-nav__role">Admin</span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="nabin-nav__close"
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        <div className="nabin-nav__user">
          <span className="nabin-avatar" aria-hidden="true">
            {user.role?.[0]?.toUpperCase() || 'A'}
          </span>
          <div style={{ minWidth: 0 }}>
            <p className="nabin-nav__username">{user.phone || 'Admin User'}</p>
            <p className="nabin-nav__subtitle">{user.role}</p>
          </div>
        </div>

        <nav className="nabin-nav__list" aria-label="Command centre sections">
          {NAV_ITEMS.filter((item) => !item.permission || holdsPermission(user, item.permission)).map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className="nabin-nav__item"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={20} />
                <span>{item.name}</span>
              </Link>
            );
          })}
          {/*
            The record screens are listed under their own heading rather than mixed into the
            sections, because an operator comes to a section to work and to these to look something
            up. The same permission rule applies: a control that could only answer 403 is not shown.
          */}
          <p className="nabin-nav__role" style={{ marginTop: 'var(--space-md)' }}>Records</p>
          {DETAIL_ITEMS.filter((item) => !item.permission || holdsPermission(user, item.permission)).map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className="nabin-nav__item"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={20} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="nabin-column">
        <header className="nabin-header">
          <div className="nabin-header__inner" style={{ justifyContent: 'flex-start', gap: 'var(--space-md)' }}>
            <button
              onClick={() => setSidebarOpen(true)}
              className="nabin-header__menu"
              aria-label="Open navigation"
            >
              <Menu size={24} />
            </button>
            <h2 className="nabin-header__title">{title ?? 'Overview'}</h2>
            <div className="nabin-header__actions">
              {/*
                Search and alerts are placeholders on purpose. The backend exposes no
                `/api/admin/search` and no alert feed, and a box that looks usable but returns
                nothing is worse than one that says it is not wired up yet: an operator would
                read an empty result as "no matches" and move on. The label states the gap, and
                the Operations screen is named as where live state actually is.
              */}
              <div className="nabin-header__links">
                <input
                  className="nabin-input"
                  type="search"
                  placeholder="Global search — no search API yet"
                  aria-label="Global search (not yet available)"
                  aria-disabled="true"
                  readOnly
                  title="Global search is not implemented. No endpoint exists to answer it, so this box is deliberately inert rather than showing empty results."
                />
                <button
                  type="button"
                  className="nabin-btn nabin-btn--ghost"
                  aria-disabled="true"
                  title="No alert feed exists yet. Live service state is on the Operations screen; nothing here is invented."
                >
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>Alerts</span>
                </button>
              </div>
              <span className="nabin-header__account" title={`Signed in as ${user.username || user.name || 'administrator'}`}>
                <span className="nabin-avatar" aria-hidden="true">{user.role?.[0]?.toUpperCase() || 'A'}</span>
                <span>
                  <span className="nabin-cell-title" style={{ display: 'block' }}>{user.name || user.username || 'Administrator'}</span>
                  <span className="nabin-cell-meta">{user.role}</span>
                </span>
              </span>
              <button onClick={logout} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 'var(--target-min)' }}>
                <LogOut size={16} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </header>

        <main className="nabin-main">{children}</main>
      </div>
    </div>
  );
}
