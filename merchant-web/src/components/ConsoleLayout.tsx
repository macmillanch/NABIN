'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMerchant, type BusinessContext } from '@/context/MerchantAuth';
import {
  BarsIcon,
  CloseIcon,
  LogoutIcon,
  GridIcon,
  InboxIcon,
  MenuBookIcon,
  BoxesIcon,
  StoreIcon,
  SettingsIcon,
  UtensilsIcon,
  ShoppingBagIcon,
  CheckCircleIcon,
  WalletIcon,
} from '@/components/Icons';

export interface ConsoleNavItem {
  name: string;
  href: string;
  icon: (props: { size?: number }) => React.ReactNode;
  badge?: string;
}

interface ConsoleLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export default function ConsoleLayout({ children, title, subtitle }: ConsoleLayoutProps) {
  const {
    merchant,
    merchantType,
    isHybrid,
    hasRestaurant,
    hasGrocery,
    activeContext,
    setActiveContext,
    logout,
  } = useMerchant();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Dynamic navigation items based on active business context & permissions
  const nav: ConsoleNavItem[] = [
    { name: 'Dashboard', href: '/', icon: GridIcon },
    { name: 'Live Orders', href: '/orders', icon: InboxIcon },
  ];

  if (hasRestaurant && (activeContext === 'ALL' || activeContext === 'RESTAURANT')) {
    nav.push({ name: 'Kitchen Menu', href: '/menu', icon: MenuBookIcon });
  }

  if (hasGrocery && (activeContext === 'ALL' || activeContext === 'GROCERY')) {
    nav.push({ name: 'Grocery Inventory', href: '/inventory', icon: BoxesIcon });
  }

  nav.push({
    name: 'Payouts & Finance',
    href: '/payouts',
    icon: WalletIcon,
  });

  nav.push({
    name: 'Store Profile',
    href: '/profile',
    icon: StoreIcon,
  });

  nav.push({
    name: 'Operations Settings',
    href: '/settings',
    icon: SettingsIcon,
  });

  const getRoleBadge = () => {
    if (isHybrid) return 'Restaurant + Grocery';
    if (merchantType === 'GROCERY') return 'Grocery Mart';
    return 'Restaurant Kitchen';
  };

  return (
    <div className="nabin-shell">
      {/* Mobile Drawer Backdrop */}
      {open && (
        <div
          className="nabin-scrim"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Modern Light SaaS Sidebar */}
      <aside className={`nabin-nav ${open ? 'is-open' : ''}`} aria-label="Merchant navigation">
        {/* Brand Header */}
        <div className="nabin-nav__brand">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/nabin_logo_full.png" alt="NABIN" style={{ height: 26, width: 'auto', objectFit: 'contain' }} />
            <span className="nabin-badge nabin-badge--brand-subtle">
              {getRoleBadge()}
            </span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="nabin-nav__close"
            aria-label="Close navigation"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Store Profile Card */}
        <div className="nabin-nav__profile-card">
          <div className="nabin-nav__avatar">
            {(merchant?.name ?? 'M').slice(0, 1).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="nabin-nav__store-name" title={merchant?.name ?? 'Store Partner'}>
              {merchant?.name ?? 'Store Partner'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span className="nabin-live-dot" />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--success-ink)' }}>
                {merchant?.is_open ? 'Accepting Orders' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* Business Selector (Hybrid Operators) */}
        {isHybrid && (
          <div className="nabin-nav__context-box">
            <div className="nabin-nav__context-label">Operational Mode</div>
            <div className="nabin-nav__context-pills">
              <button
                type="button"
                className={`nabin-nav__context-pill ${activeContext === 'ALL' ? 'is-active' : ''}`}
                onClick={() => setActiveContext('ALL')}
              >
                <GridIcon size={14} />
                <span>Unified</span>
              </button>
              <button
                type="button"
                className={`nabin-nav__context-pill ${activeContext === 'RESTAURANT' ? 'is-active restaurant' : ''}`}
                onClick={() => setActiveContext('RESTAURANT')}
              >
                <UtensilsIcon size={14} />
                <span>Kitchen</span>
              </button>
              <button
                type="button"
                className={`nabin-nav__context-pill ${activeContext === 'GROCERY' ? 'is-active grocery' : ''}`}
                onClick={() => setActiveContext('GROCERY')}
              >
                <ShoppingBagIcon size={14} />
                <span>Darkstore</span>
              </button>
            </div>
          </div>
        )}

        {/* Navigation List */}
        <nav className="nabin-nav__list">
          <div className="nabin-nav__section-title">Navigation</div>
          {nav.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nabin-nav__item ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                <span className="nabin-nav__item-icon">
                  <Icon size={18} />
                </span>
                <span className="nabin-nav__item-text">{item.name}</span>
                {item.badge && (
                  <span className="nabin-badge nabin-badge--brand" style={{ marginLeft: 'auto', fontSize: 11 }}>
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer Status */}
        <div className="nabin-nav__footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircleIcon size={16} />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>
              NABIN Engine v2.4 · Online
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="nabin-column">
        {/* Modern Sticky Glass Header */}
        <header className="nabin-header">
          <div className="nabin-header__inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
              <button
                onClick={() => setOpen(true)}
                className="nabin-header__menu"
                aria-label="Open navigation"
              >
                <BarsIcon size={22} />
              </button>
              <div>
                <h1 className="nabin-header__title">{title}</h1>
                {subtitle && <p className="nabin-header__subtitle">{subtitle}</p>}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
              {/* Context Switcher in Header (Hybrid) */}
              {isHybrid && (
                <div className="nabin-header__context-bar nabin-hide-md">
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', paddingLeft: 4 }}>
                    View:
                  </span>
                  <div className="nabin-header__context-segmented">
                    <button
                      type="button"
                      className={`nabin-header__context-btn ${activeContext === 'ALL' ? 'is-active' : ''}`}
                      onClick={() => setActiveContext('ALL')}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`nabin-header__context-btn ${activeContext === 'RESTAURANT' ? 'is-active restaurant' : ''}`}
                      onClick={() => setActiveContext('RESTAURANT')}
                    >
                      Restaurant
                    </button>
                    <button
                      type="button"
                      className={`nabin-header__context-btn ${activeContext === 'GROCERY' ? 'is-active grocery' : ''}`}
                      onClick={() => setActiveContext('GROCERY')}
                    >
                      Grocery
                    </button>
                  </div>
                </div>
              )}

              {/* Status Indicator */}
              <div className="nabin-header__status-badge">
                <span className="nabin-live-dot" />
                <span className="nabin-hide-sm" style={{ fontSize: 13, fontWeight: 600, color: 'var(--success-ink)' }}>
                  Accepting Orders
                </span>
              </div>

              {/* Sign Out Button */}
              <button
                onClick={logout}
                className="nabin-btn nabin-btn--ghost nabin-header__logout"
                title="Sign out of merchant account"
              >
                <LogoutIcon size={16} />
                <span className="nabin-hide-sm">Sign out</span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Viewport Content */}
        <main className="nabin-main">{children}</main>
      </div>
    </div>
  );
}
