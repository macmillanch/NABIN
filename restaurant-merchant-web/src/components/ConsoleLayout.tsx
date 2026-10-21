'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMerchant } from '@/context/MerchantAuth';
import {
  BarsIcon,
  CloseIcon,
  LogoutIcon,
  GridIcon,
  InboxIcon,
  MenuBookIcon,
  TableIcon,
  TakeawayIcon,
  DeliveryIcon,
  KdsIcon,
  BoxesIcon,
  StaffIcon,
  ReportsIcon,
  SettlementIcon,
  SettingsIcon,
} from '@/components/Icons';

export const RESTAURANT_NAV: ConsoleNavItem[] = [
  { name: 'Overview', href: '/', icon: GridIcon },
  { name: 'Orders', href: '/orders', icon: InboxIcon },
  { name: 'Dine-In & Tables', href: '/tables', icon: TableIcon },
  { name: 'Takeaway', href: '/takeaway', icon: TakeawayIcon },
  { name: 'Delivery', href: '/delivery', icon: DeliveryIcon },
  { name: 'Kitchen Display', href: '/kds', icon: KdsIcon },
  { name: 'Menu', href: '/menu', icon: MenuBookIcon },
  { name: 'Inventory', href: '/inventory', icon: BoxesIcon },
  { name: 'Staff & Roles', href: '/staff', icon: StaffIcon },
  { name: 'Sales & Reports', href: '/reports', icon: ReportsIcon },
  { name: 'Settlements', href: '/settlements', icon: SettlementIcon },
  { name: 'RMS Settings', href: '/settings', icon: SettingsIcon },
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
          <img src="/nabin_logo_full.png" alt="NABIN" style={{ height: 24, width: 'auto', objectFit: 'contain' }} />
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

        <div style={{ padding: 'var(--space-md)', marginTop: 'auto', borderTop: '1px solid var(--border)' }}>
          <a
            href={process.env.NEXT_PUBLIC_UNIFIED_PORTAL_URL || 'http://localhost:3004'}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 12px',
              borderRadius: '8px',
              background: '#EBF1FF',
              color: '#1A3BA2',
              fontSize: '13px',
              fontWeight: 600,
              textDecoration: 'none',
              border: '1px solid #C9DAFF',
            }}
          >
            <span>✨ Unified Portal</span>
            <span style={{ fontSize: '11px', background: '#1A3BA2', color: '#fff', padding: '2px 6px', borderRadius: '4px', marginLeft: 'auto' }}>New</span>
          </a>
        </div>
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
