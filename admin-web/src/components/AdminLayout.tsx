'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { holdsPermission } from '@/lib/access';
import { LogOut, LayoutDashboard, Store, Menu, X, Car, Package, Megaphone, ShieldCheck, Users, Activity, Wallet, LifeBuoy, FileText, Settings, Fingerprint, AlertTriangle, MapPin } from 'lucide-react';
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
interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { name: 'Overview', href: '/', icon: LayoutDashboard },
      { name: 'Live Operations', href: '/operations', icon: Activity },
      { name: 'Geofencing', href: '/geofencing', icon: MapPin },
    ],
  },
  {
    title: 'Management',
    items: [
      { name: 'Finance & Payouts', href: '/finance', icon: Wallet, permission: 'finance.view' },
      { name: 'Support Tickets', href: '/support', icon: LifeBuoy, permission: 'support.view' },
      { name: 'KYC Verification', href: '/kyc', icon: Fingerprint, permission: 'identity_verification.view' },
      { name: 'Marketing & Promos', href: '/campaigns', icon: Megaphone, permission: 'campaign.view' },
    ],
  },
  {
    title: 'Security & System',
    items: [
      { name: 'Security & Access', href: '/security', icon: ShieldCheck, permission: 'security.view' },
      { name: 'Audit Logs', href: '/audit', icon: FileText, permission: 'audit.view' },
      { name: 'Settings', href: '/settings', icon: Settings },
    ],
  },
  {
    title: 'Directories & Records',
    items: [
      { name: 'Customers', href: '/customers', icon: Users, permission: 'customers.read' },
      { name: 'Drivers', href: '/drivers', icon: Car },
      { name: 'Merchants', href: '/merchants', icon: Store },
      { name: 'Jobs & Orders', href: '/orders', icon: Package },
    ],
  },
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/nabin_logo_full.png" alt="NABIN" style={{ height: 26, width: 'auto', objectFit: 'contain' }} />
            <span className="nabin-admin-tag">
              CONSOLE
            </span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="nabin-nav__close"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <div className="nabin-nav__body">
          <nav className="nabin-nav__list" aria-label="Command centre sections">
            {NAV_SECTIONS.map((section) => {
              const visibleItems = section.items.filter(
                (item) => !item.permission || holdsPermission(user, item.permission)
              );
              if (visibleItems.length === 0) return null;

              return (
                <div key={section.title} className="nabin-nav__section">
                  <div className="nabin-nav__section-header">{section.title}</div>
                  {visibleItems.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        className={`nabin-nav__item ${isActive ? 'is-active' : ''}`}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => setSidebarOpen(false)}
                      >
                        <Icon size={18} className="nabin-nav__icon" />
                        <span>{item.name}</span>
                        {isActive && <span className="nabin-nav__active-pip" />}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="nabin-nav__footer">
          <div className="nabin-nav__user-card">
            <span className="nabin-avatar-modern" aria-hidden="true">
              {user.role?.[0]?.toUpperCase() || 'A'}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="nabin-nav__user-name">{user.name || user.username || 'Administrator'}</p>
              <p className="nabin-nav__user-role">{user.role}</p>
            </div>
            <button
              onClick={logout}
              className="nabin-btn-icon-soft"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="nabin-column">
        <header className="nabin-header">
          <div className="nabin-header__inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                onClick={() => setSidebarOpen(true)}
                className="nabin-header__menu"
                aria-label="Open navigation"
              >
                <Menu size={22} />
              </button>
              <div>
                <h2 className="nabin-header__title" style={{ margin: 0 }}>{title ?? 'Overview'}</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span className="nabin-pulse-dot" />
                  <span style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600 }}>System Live · All Services Operational</span>
                </div>
              </div>
            </div>

            <div className="nabin-header__actions">
              <div className="nabin-header__search-modern">
                <input
                  type="text"
                  placeholder="Quick lookup (users, orders, drivers)..."
                  aria-label="Quick search"
                  readOnly
                  title="Search is available on dedicated directory screens"
                />
                <kbd className="nabin-kbd">⌘K</kbd>
              </div>

              <button
                type="button"
                className="nabin-btn-alert-badge"
                title="System Notifications & Alerts"
              >
                <AlertTriangle size={16} />
                <span>0 Alerts</span>
              </button>

              <div className="nabin-header__user-pill">
                <span className="nabin-avatar-mini">{user.role?.[0]?.toUpperCase() || 'A'}</span>
                <span className="nabin-header__user-label">
                  <strong>{user.username || 'admin'}</strong>
                  <small>{user.role}</small>
                </span>
              </div>

              <button
                onClick={logout}
                className="nabin-btn-signout"
                title="Sign out of Admin Console"
              >
                <LogOut size={15} />
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
