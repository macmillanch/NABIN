'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { LogOut, LayoutDashboard, Store, Menu, X, Car, Package, Megaphone } from 'lucide-react';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Drivers', href: '/drivers', icon: Car },
  { name: 'Merchants', href: '/merchants', icon: Store },
  { name: 'Jobs/Orders', href: '/orders', icon: Package },
  { name: 'Campaigns', href: '/campaigns', icon: Megaphone },
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
          {NAV_ITEMS.map((item) => {
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
              <button onClick={logout} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
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
