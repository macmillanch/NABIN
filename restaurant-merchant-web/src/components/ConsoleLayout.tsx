'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMerchant } from '@/context/MerchantAuth';
import { BarsIcon, CloseIcon, LogoutIcon, GridIcon, InboxIcon, MenuBookIcon } from '@/components/Icons';

export const RESTAURANT_NAV: ConsoleNavItem[] = [
  { name: 'Dashboard', href: '/', icon: GridIcon },
  { name: 'Orders', href: '/orders', icon: InboxIcon },
  { name: 'Menu', href: '/menu', icon: MenuBookIcon },
];

export interface ConsoleNavItem {
  name: string;
  href: string;
  icon: (props: { size?: number }) => React.ReactNode;
}

interface ConsoleLayoutProps {
  children: React.ReactNode;
  title: string;
  roleLabel: string;
  nav: ConsoleNavItem[];
}

export default function ConsoleLayout({ children, title, roleLabel, nav }: ConsoleLayoutProps) {
  const { merchant, logout } = useMerchant();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="nabin-shell">
      {open && <div className="nabin-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside className={`nabin-nav ${open ? 'is-open' : ''}`} aria-label="Merchant navigation">
        <div className="nabin-nav__brand">
          <span className="nabin-wordmark" style={{ fontSize: 18, color: 'var(--on-brand)' }}>
            NABIN
          </span>
          <span className="nabin-nav__role">{roleLabel}</span>
          <button onClick={() => setOpen(false)} className="nabin-nav__close" aria-label="Close navigation">
            <CloseIcon />
          </button>
        </div>

        <div className="nabin-nav__user">
          <span className="nabin-avatar" aria-hidden="true">
            {(merchant?.name ?? 'N').slice(0, 1).toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <p className="nabin-nav__username">{merchant?.name ?? 'Store'}</p>
            <p className="nabin-nav__subtitle">{merchant?.phone ?? ''}</p>
          </div>
        </div>

        <nav className="nabin-nav__list">
          {nav.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="nabin-nav__item"
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                <Icon />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="nabin-column">
        <header className="nabin-header">
          <div className="nabin-header__inner" style={{ justifyContent: 'flex-start', gap: 'var(--space-md)' }}>
            <button onClick={() => setOpen(true)} className="nabin-header__menu" aria-label="Open navigation">
              <BarsIcon />
            </button>
            <h2 className="nabin-header__title">{title}</h2>
            <div className="nabin-header__actions">
              <button onClick={logout} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
                <LogoutIcon />
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
