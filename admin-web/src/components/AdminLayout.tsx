'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { holdsPermission } from '@/lib/access';
import { LogOut, LayoutDashboard, Store, Menu, X, Car, Package, Megaphone, ShieldCheck, Users } from 'lucide-react';
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

const NAV_ITEMS: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Drivers', href: '/drivers', icon: Car },
  { name: 'Merchants', href: '/merchants', icon: Store },
  { name: 'Jobs/Orders', href: '/orders', icon: Package },
  { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { name: 'Customers', href: '/customers', icon: Users, permission: 'customers.read' },
  { name: 'Security', href: '/security', icon: ShieldCheck, permission: 'security.view' },
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

        <nav className="nabin-nav__list" aria-label="Admin sections">
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
            <h2 className="nabin-header__title">{title ?? 'Dashboard'}</h2>
            <div className="nabin-header__actions">
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
