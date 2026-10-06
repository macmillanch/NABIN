'use client';

/* eslint-disable react-hooks/set-state-in-effect */
// The same allowance `AuthProvider.tsx` carries: a panel that loads on mount must set its
// loading state before the first request resolves, which is exactly what this rule warns about.

/**
 * Shared primitives for the Super Admin command center.
 *
 * Three rules this file exists to enforce, learned from the screens it replaces:
 *
 * 1. A number is only ever rendered when an API actually returned it. `null`/`undefined`
 *    becomes "Data unavailable" - never 0, never a dash that reads as zero. An operator who
 *    sees ₹0 believes the platform took nothing today; an operator who sees "unavailable"
 *    goes and checks. Those are not the same outcome.
 * 2. Every panel states where its data came from and when it was read, because a stale
 *    operations screen is worse than an obviously missing one.
 * 3. Loading, empty, error and unavailable are four different states and get four different
 *    renders. Collapsing them is how "the API is down" ends up looking like "no orders today".
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { api } from '@/lib/api';
import { RefreshCw, AlertTriangle, Inbox, Database } from 'lucide-react';

export type Row = Record<string, unknown>;

/** The four states a panel can be in, kept distinct on purpose. */
type PanelState = 'loading' | 'ready' | 'error' | 'unavailable' | 'empty';

export interface PanelData<T> {
  state: PanelState;
  data: T | null;
  error: string | null;
  /** The moment this panel last successfully read, for the "updated" line. */
  fetchedAt: Date | null;
  /** The endpoint that answered, so a screen can be traced without opening dev tools. */
  source: string;
  /** Present once a panel has been loaded; a page may pass it to a retry control. */
  refetch?: () => Promise<void>;
}

/**
 * Fetch one admin endpoint and keep its state honestly.
 * `refetch` is exposed so a page can offer refresh without pretending the data is live.
 */
export function useAdminData<T = Row[]>(path: string, pick?: (payload: unknown) => T): PanelData<T> {
  const [panel, setPanel] = useState<PanelData<T>>({
    state: 'loading', data: null, error: null, fetchedAt: null, source: path,
  });

  // `pick` is held in a reference rather than listed as a dependency. Every caller passes a fresh
  // inline arrow (`(p) => p?.tickets`), and if that identity were a dependency the loader would be
  // rebuilt on every render, the effect would fire again, setState would re-render, and the panel
  // would poll the server in a loop. The path is the only real input.
  const pickRef = useRef(pick);
  useEffect(() => { pickRef.current = pick; }, [pick]);

  const load = useCallback(async () => {
    setPanel(p => ({ ...p, state: 'loading', error: null }));
    try {
      // Reuse the configured client: it already carries the base URL and the bearer token,
      // so a panel cannot accidentally start talking to a different backend than the shell.
      const res = await api.get(path.replace(/^\/api\/admin/, '/admin'));
      const payload = res.data;
      // An endpoint that answers 200 with success:false is refusing, not empty. Say so.
      if (payload && payload.success === false) {
        setPanel({ state: 'error', data: null, error: String(payload.error || payload.code || 'The platform refused this request'), fetchedAt: null, source: path });
        return;
      }
      const chooser = pickRef.current;
      const value = (chooser ? chooser(payload) : (payload?.data ?? payload)) as T;
      setPanel({
        state: value === undefined || value === null ? 'unavailable' : 'ready',
        data: (value ?? null) as T | null,
        error: null,
        fetchedAt: new Date(),
        source: path,
      });
    } catch (err) {
      const friendly = axios.isAxiosError(err)
        ? (err.response?.status === 403
          // A 403 here is the server's guard doing its job; the message names the permission
          // the server itself reported, so the operator can ask for the right thing.
          ? `Refused by the server: ${String(err.response?.data?.error || 'missing permission')}`
          : err.response?.status === 401
            ? 'Session expired - sign in again.'
            : `Request failed (${err.response?.status ?? 'network'}).`)
        : 'Could not reach the platform.';
      setPanel({ state: 'error', data: null, error: friendly, fetchedAt: null, source: path });
    }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  return { ...panel, refetch: load } as PanelData<T> & { refetch: () => Promise<void> };
}

export const money = (value: unknown): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return UNAVAILABLE;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

export const count = (value: unknown): string => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-IN') : UNAVAILABLE;
};

/** The single spelling of "we have no number for this", used everywhere. */
export const UNAVAILABLE = 'Data unavailable';

export function Panel({ title, subtitle, panel, action, children }: {
  title: string;
  subtitle?: string;
  panel?: PanelData<unknown> & { refetch?: () => Promise<void> };
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="nabin-card" aria-busy={panel?.state === 'loading'}>
      <header className="nabin-card__header">
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          {subtitle ? <p className="nabin-cell-meta" style={{ margin: '2px 0 0' }}>{subtitle}</p> : null}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
          {panel ? (
            <span className="nabin-chip" title={panel.source}>
              <Database size={12} aria-hidden="true" />
              {panel.fetchedAt
                ? `updated ${panel.fetchedAt.toLocaleTimeString('en-IN', { hour12: false })}`
                : 'not loaded'}
            </span>
          ) : null}
          {panel?.refetch ? (
            <button className="nabin-btn nabin-btn--ghost" onClick={() => void panel.refetch?.()}
              aria-label={`Refresh ${title}`} disabled={panel.state === 'loading'}>
              <RefreshCw size={15} className={panel.state === 'loading' ? 'nabin-spin' : undefined} aria-hidden="true" />
            </button>
          ) : null}
          {action}
        </div>
      </header>
      {children}
    </section>
  );
}

/** One state block for empty / error / unavailable, so pages cannot disagree about them. */
export function StateBlock({ panel, empty = 'Nothing to show right now.' }: { panel: PanelData<unknown>; empty?: string }) {
  if (panel.state === 'loading') {
    return <p className="nabin-cell-meta" role="status">Loading…</p>;
  }
  if (panel.state === 'error') {
    return (
      <div className="nabin-alert nabin-alert--danger" role="alert">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>{panel.error}</span>
        {panel.refetch ? (
          <button className="nabin-alert__action nabin-btn nabin-btn--ghost" onClick={() => void (panel.refetch as () => Promise<void>)()}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  if (panel.state === 'unavailable') {
    return (
      <div className="nabin-empty" role="status">
        <Inbox size={18} aria-hidden="true" />
        <p className="nabin-empty__title">{UNAVAILABLE}</p>
        <p className="nabin-cell-meta">The endpoint answered but carried no value for this.</p>
      </div>
    );
  }
  return <div className="nabin-empty" role="status"><Inbox size={18} aria-hidden="true" /><p className="nabin-empty__title">{empty}</p></div>;
}

export function MetricGrid({ items }: { items: { label: string; value: string; tone?: 'brand' | 'success' | 'warning' | 'info' }[] }) {
  return (
    <div className="nabin-grid">
      {items.map((m) => (
        <article className="nabin-metric" key={m.label}>
          <span className={`nabin-metric__icon nabin-metric__icon--${m.tone ?? 'info'}`} aria-hidden="true" />
          <div>
            <p className="nabin-cell-meta" style={{ margin: 0 }}>{m.label}</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{m.value}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * A dense table over real rows. Columns name the field they read and may supply a renderer;
 * a missing field shows the shared unavailable marker instead of an empty cell, which is how
 * a renamed API field becomes visible on screen instead of silently blank.
 */
export function RecordsTable({ rows, columns, caption }: {
  rows: Row[];
  columns: { key: string; label: string; render?: (row: Row) => React.ReactNode }[];
  caption: string;
}) {
  if (!rows.length) return <StateBlock panel={{ state: 'empty', data: null, error: null, fetchedAt: null, source: '' } as unknown as PanelData<unknown>} />;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="nabin-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption className="nabin-cell-meta" style={{ textAlign: 'left', padding: '0 0 var(--space-xs)' }}>{caption}</caption>
        <thead>
          <tr>{columns.map(c => <th key={c.key} scope="col" className="nabin-label" style={{ textAlign: 'left', padding: '6px 8px' }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.id ?? row.uuid ?? i)}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: '8px', borderTop: '1px solid var(--border)' }}>
                  {c.render ? c.render(row) : (row[c.key] === undefined || row[c.key] === null || row[c.key] === '' ? UNAVAILABLE : String(row[c.key]))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Badge = ({ value }: { value: unknown }) => {
  const s = String(value ?? '').toUpperCase();
  if (!s) return <span className="nabin-badge nabin-badge--neutral">{UNAVAILABLE}</span>;
  const tone = ['ACTIVE', 'COMPLETED', 'VERIFIED', 'RESOLVED', 'SETTLED', 'ONLINE', 'SUCCESS'].includes(s)
    ? 'success'
    : ['SUSPENDED', 'REJECTED', 'CANCELLED', 'FAILED', 'CLOSED', 'EXPIRED'].includes(s)
      ? 'danger'
      : ['PENDING', 'UNDER_REVIEW', 'PAUSED', 'INITIATED', 'OPEN', 'LOW_STOCK', 'RESUBMISSION'].includes(s)
        ? 'warning'
        : 'neutral';
  return <span className={`nabin-badge nabin-badge--${tone}`}>{s}</span>;
};
