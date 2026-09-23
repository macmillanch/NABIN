'use client';

import React from 'react';
import { TriangleAlert } from 'lucide-react';

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  align?: 'start' | 'end';
  hideBelow?: 'sm' | 'md' | 'lg';
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  emptyTitle: string;
  emptyBody: string;
}

const HIDE_CLASS = { sm: 'nabin-hide-sm', md: 'nabin-hide-md', lg: 'nabin-hide-lg' } as const;

function cellClass(c: Pick<Column<never>, 'align' | 'hideBelow'>) {
  return [c.align === 'end' ? 'nabin--end' : '', c.hideBelow ? HIDE_CLASS[c.hideBelow] : '']
    .filter(Boolean)
    .join(' ');
}

export default function ResourceTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyBody,
}: Props<T>) {
  if (error) {
    return (
      <div className="nabin-alert nabin-alert--danger" role="alert">
        <TriangleAlert size={18} />
        <span>{error}</span>
        <button onClick={onRetry} className="nabin-alert__action">
          Retry
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="nabin-stack">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="nabin-skeleton" style={{ height: 56 }} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="nabin-empty">
        <p className="nabin-empty__title">{emptyTitle}</p>
        <p>{emptyBody}</p>
      </div>
    );
  }

  return (
    /* Focusable, because below ~360px the table is wider than its own box and the last
       column — which on the customer screen is where Suspend and Block live — sits past
       the right edge. Focusing a button that is off to the side does not scroll a
       horizontal container in Chrome, so a keyboard operator would be pressing an
       invisible control; a focused scroll region answers to the arrow keys first. */
    <div className="nabin-table-wrap" tabIndex={0} role="region" aria-label="Scrollable results table">
      <table className="nabin-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cellClass(c)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={cellClass(c)}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatusBadge({ value }: { value?: string | null }) {
  const normalized = (value || 'UNKNOWN').toUpperCase();
  const tone =
    ['ACTIVE', 'APPROVED', 'ONLINE', 'COMPLETED', 'OPEN', 'LIVE'].includes(normalized)
      ? 'nabin-badge--success'
      : ['PENDING', 'SEARCHING', 'ASSIGNED', 'ACCEPTED', 'PREPARING'].includes(normalized)
        ? 'nabin-badge--warning'
        : ['SUSPENDED', 'REJECTED', 'CANCELLED', 'PAUSED', 'OFFLINE'].includes(normalized)
          ? 'nabin-badge--danger'
          : 'nabin-badge--neutral';
  return <span className={`nabin-badge ${tone}`}>{normalized}</span>;
}

export const inr = (amount?: number | null) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    amount ?? 0,
  );
