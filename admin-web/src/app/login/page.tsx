'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nabin-auth">
      <form onSubmit={handleSubmit} className="nabin-card nabin-auth__card">
        <h1 className="nabin-wordmark" style={{ textAlign: 'center', fontSize: 28 }}>
          NABIN
        </h1>
        <p className="nabin-auth__subtitle">Operations console — admin access only</p>

        {error && (
          <div className="nabin-alert nabin-alert--danger" role="alert">
            <span>{error}</span>
          </div>
        )}

        <div className="nabin-form">
          <div>
            <label className="nabin-label" htmlFor="username">
              Administrator username
            </label>
            <input
              id="username"
              className="nabin-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="superadmin"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              required
            />
          </div>

          <div>
            <label className="nabin-label" htmlFor="password">
              Master password
            </label>
            <div className="nabin-row" style={{ gap: 'var(--space-xs)' }}>
              <input
                id="password"
                className="nabin-input"
                type={reveal ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={busy}
                required
              />
              <button
                type="button"
                className="nabin-btn nabin-btn--ghost"
                style={{ minHeight: 44, padding: '0 var(--space-sm)' }}
                onClick={() => setReveal((value) => !value)}
                aria-pressed={reveal}
              >
                {reveal ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button type="submit" className="nabin-btn nabin-btn--primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
