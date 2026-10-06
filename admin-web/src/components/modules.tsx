'use client';

/**
 * The read-only command-centre screens, built from one config each.
 *
 * These five screens deliberately render only what the endpoints in the survey actually
 * returned, and they read the same shapes the Flutter admin app already relies on:
 * `/admin/finance/metrics`, `/admin/support`, `/admin/identity-verifications`,
 * `/admin/audit-logs`, `/admin/platform-settings`. Nothing here posts anything back: the
 * actions those screens could offer (assign, resolve, approve) are already permission-guarded
 * routes, and wiring a write control is a separate slice from standing up the read surface -
 * a control that 403s because the console was built around the wrong payload is worse than no
 * control yet.
 */
import React, { useMemo, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import {
  MetricGrid, Panel, RecordsTable, StateBlock, UNAVAILABLE, money, count,
  useAdminData, type Row,
} from '@/components/DataPanel';
import { useAuth } from '@/components/AuthProvider';
import { holdsPermission } from '@/lib/access';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Admin endpoints return differently-shaped envelopes (`{ tickets }`, `{ logs }`, `{ metrics }`).
// Rather than spread `any` through every screen, the untyped boundary is declared once here and
// each read names the field it expects, so a renamed field fails visibly at one site.
type Payload = Record<string, any>;

export interface ModuleSpec {
  title: string;
  /** The endpoint, exactly as the backend exposes it. */
  endpoint: string;
  /** Which field of the response carries the rows. Empty means a metrics-only screen. */
  rowsKey: string;
  columns?: { key: string; label: string; render?: (row: Row) => React.ReactNode }[];
  metrics?: (payload: Payload) => { label: string; value: string }[];
  /** Free-text filter over the rows already loaded. Not a server query - says so on screen. */
  searchable?: string[];
  emptyText?: string;
  /** Permission the console checks before rendering the table at all. */
  permission?: string;
}

export const MODULES: Record<string, ModuleSpec> = {
  finance: {
    title: 'Finance',
    endpoint: '/api/admin/finance/metrics',
    rowsKey: '',
    metrics: (p) => ([
      { label: 'Gross transaction value', value: money(p?.metrics?.grossGtv) },
      { label: 'Customer payments', value: money(p?.metrics?.totalCustomerPayments) },
      { label: 'Driver earnings', value: money(p?.metrics?.driverEarnings) },
      { label: 'Platform revenue', value: money(p?.metrics?.platformRevenue) },
      { label: 'Refunds', value: money(p?.metrics?.totalRefunds) },
      { label: 'Pending settlements', value: money(p?.metrics?.pendingSettlements) },
      { label: 'Completed settlements', value: money(p?.metrics?.completedSettlements) },
      { label: 'Outstanding balances', value: money(p?.metrics?.outstandingBalances) },
    ]),
    permission: 'finance.view',
  },
  support: {
    title: 'Support',
    endpoint: '/api/admin/support',
    rowsKey: 'tickets',
    searchable: ['ticketNumber', 'title', 'userName', 'category', 'driverName'],
    emptyText: 'No tickets in the returned page.',
    permission: 'support.view',
    columns: [
      { key: 'ticketNumber', label: 'Ticket' },
      { key: 'title', label: 'Subject' },
      { key: 'category', label: 'Category' },
      { key: 'userName', label: 'Raised by' },
      { key: 'userRole', label: 'Role' },
      { key: 'status', label: 'Status' },
      { key: 'priority', label: 'Priority' },
      { key: 'createdAt', label: 'Opened', render: (r) => <span className="nabin-mono">{r.createdAt ? new Date(String(r.createdAt)).toLocaleString('en-IN', { hour12: false }) : UNAVAILABLE}</span> },
    ],
  },
  kyc: {
    title: 'KYC verification queue',
    endpoint: '/api/admin/identity-verifications',
    rowsKey: 'applications',
    searchable: ['userName', 'phone', 'status'],
    permission: 'identity_verification.view',
    metrics: (p) => ([
      { label: 'Applications', value: count(p?.metrics?.total) },
      { label: 'Pending', value: count(p?.metrics?.pending) },
      { label: 'Under review', value: count(p?.metrics?.underReview) },
      { label: 'Awaiting resubmission', value: count(p?.metrics?.resubmission) },
      { label: 'Verified', value: count(p?.metrics?.verified) },
      { label: 'Rejected', value: count(p?.metrics?.rejected) },
    ]),
    columns: [
      { key: 'userName', label: 'Applicant' },
      { key: 'phone', label: 'Phone', render: (r) => <span className="nabin-mono">{r.phone ? `****${String(r.phone).slice(-4)}` : UNAVAILABLE}</span> },
      // The masked value only. The same response carries `aadhaarNumberRaw`; a document number
      // has no business on a queue screen, so the raw field is never rendered here.
      { key: 'aadhaarNumberMasked', label: 'ID (masked)' },
      { key: 'status', label: 'Status' },
      { key: 'aadhaarDocStatus', label: 'Document' },
      { key: 'submittedAt', label: 'Submitted', render: (r) => <span className="nabin-mono">{r.submittedAt ? new Date(String(r.submittedAt)).toLocaleString('en-IN', { hour12: false }) : UNAVAILABLE}</span> },
    ],
  },
  audit: {
    title: 'Audit logs',
    endpoint: '/api/admin/audit-logs',
    rowsKey: 'logs',
    searchable: ['adminName', 'action', 'module', 'targetEntityId', 'role'],
    permission: 'audit.view',
    columns: [
      { key: 'timestamp', label: 'When', render: (r) => <span className="nabin-mono">{r.timestamp ? new Date(String(r.timestamp)).toLocaleString('en-IN', { hour12: false }) : UNAVAILABLE}</span> },
      { key: 'adminName', label: 'Operator' },
      { key: 'role', label: 'Role' },
      { key: 'action', label: 'Action' },
      { key: 'module', label: 'Module' },
      { key: 'targetEntityType', label: 'Target type' },
      { key: 'targetEntityId', label: 'Target', render: (r) => <span className="nabin-mono">{String(r.targetEntityId ?? UNAVAILABLE)}</span> },
      { key: 'newState', label: 'Result' },
    ],
  },
  settings: {
    title: 'Platform settings',
    endpoint: '/api/admin/platform-settings',
    rowsKey: 'settings',
    searchable: ['setting_key', 'description', 'updated_by'],
    columns: [
      { key: 'setting_key', label: 'Key', render: (r) => <code>{String(r.setting_key ?? UNAVAILABLE)}</code> },
      { key: 'setting_value', label: 'Value', render: (r) => <span className="nabin-mono">{r.setting_value === null || r.setting_value === undefined ? UNAVAILABLE : JSON.stringify(r.setting_value).slice(0, 120)}</span> },
      { key: 'description', label: 'Description' },
      { key: 'updated_by', label: 'Updated by' },
      { key: 'updated_at', label: 'Updated', render: (r) => <span className="nabin-mono">{r.updated_at ? new Date(String(r.updated_at)).toLocaleString('en-IN', { hour12: false }) : UNAVAILABLE}</span> },
    ],
  },
};

export default function ModuleScreen({ name }: { name: keyof typeof MODULES }) {
  const spec = MODULES[name];
  const { user } = useAuth();
  const panel = useAdminData<any>(spec.endpoint, (p: any) => (spec.rowsKey ? p?.[spec.rowsKey] : p));
  const [query, setQuery] = useState('');

  const rows: Row[] = Array.isArray(panel.data) ? panel.data : [];
  const filtered = useMemo(() => {
    if (!query.trim() || !spec.searchable) return rows;
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => spec.searchable!.some((k) => String(r[k] ?? '').toLowerCase().includes(needle)));
  }, [rows, query, spec]);

  const metrics = panel.state === 'ready' && spec.metrics ? spec.metrics(panel.data) : spec.metrics ? [] : undefined;
  const total = (panel.data && typeof panel.data === 'object' && !Array.isArray(panel.data)) ? (panel.data as any).total : undefined;

  return (
    <AdminLayout title={spec.title}>
      <div className="nabin-stack">
        {metrics && metrics.length ? <MetricGrid items={metrics} /> : null}

        {spec.rowsKey ? (
          <Panel title="Records" subtitle={typeof total === 'number'
            ? `${count(total)} reported by the platform${total > rows.length ? `; ${count(rows.length)} in this page` : ''}`
            : 'As returned by the endpoint'} panel={panel}>
            {spec.permission && !holdsPermission(user, spec.permission) ? (
              <div className="nabin-alert nabin-alert--danger" role="alert">
                <span>This console does not render the table: your session carries no
                  <code> {spec.permission} </code> grant. The server would refuse the request -
                  the endpoint is left unlisted rather than shown as empty.</span>
              </div>
            ) : panel.state !== 'ready' ? (
              <StateBlock panel={panel} empty={spec.emptyText ?? 'No rows returned.'} />
            ) : (
              <>
                {spec.searchable ? (
                  <div className="nabin-row" style={{ gap: 'var(--space-xs)', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
                    <label className="nabin-label" htmlFor={`q-${name}`}>Filter loaded rows</label>
                    <input id={`q-${name}`} className="nabin-input" style={{ maxWidth: 320 }} value={query}
                      onChange={(e) => setQuery(e.target.value)} placeholder="type to narrow the rows already loaded" />
                    <span className="nabin-cell-meta">{count(filtered.length)} shown</span>
                  </div>
                ) : null}
                {filtered.length
                  ? <RecordsTable rows={filtered} columns={spec.columns ?? []} caption={`${spec.title} — read from ${spec.endpoint}`} />
                  : <StateBlock panel={{ state: 'empty', data: null, error: null, fetchedAt: panel.fetchedAt, source: panel.source }} empty={query ? 'No loaded rows match that filter.' : (spec.emptyText ?? 'No rows returned.')} />}
              </>
            )}
          </Panel>
        ) : null}
      </div>
    </AdminLayout>
  );
}
