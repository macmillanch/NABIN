'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const PRIMARY_LINKS = [
  { href: '/ride', label: 'Ride' },
  { href: '/food', label: 'Food' },
  { href: '/grocery', label: 'Grocery' },
  { href: '/parcel', label: 'Parcel' },
];

const ACCOUNT_LINKS = [
  { href: '/orders', label: 'Orders' },
  { href: '/profile', label: 'Profile' },
];

export default function Header() {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  const links = [...PRIMARY_LINKS, ...ACCOUNT_LINKS];
  const isActive = (href: string) => pathname === href;

  return (
    <header className="nabin-header">
      <div className="nabin-header__inner nabin-container">
        <Link href="/" className="nabin-wordmark" style={{ fontSize: 22 }}>
          NABIN
        </Link>

        <nav className="nabin-header__links" aria-label="Primary">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={isActive(link.href) ? 'is-active' : undefined}
              aria-current={isActive(link.href) ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="nabin-row">
          {user ? (
            <>
              <Link href="/profile" className="nabin-header__account">
                {user?.phone || 'Profile'}
              </Link>
              <button onClick={logout} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="nabin-btn nabin-btn--primary" style={{ minHeight: 40 }}>
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
