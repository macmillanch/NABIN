'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import ResourceTable, { StatusBadge, type Column } from '@/components/ResourceTable';
import { useAuth } from '@/components/AuthProvider';
import { useConfirmDetails, type Confirmation } from '@/components/ConfirmAction';
import { heldPermissions, holdsPermission, missingGrantNote } from '@/lib/access';
import { readRefusal } from '@/lib/refusals';
import { adminApi } from '@/lib/api';
import { Users, ShieldCheck, TriangleAlert } from 'lucide-react';

interface Customer {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  accountStatus?: string | null;
  identityStatus?: string | null;
  rating?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  allowedStatuses?: string[];
}

interface CustomerSession {
  sessionId: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
}

interface SessionRead {
  sessions?: CustomerSession[];
  storeChecked?: boolean;
}

// The three values `users.account_status`’s CHECK allows. Sent as a filter rather than
// typed, because the route refuses anything else with 400 and a name in a text box is a
// spelling mistake waiting to happen.
const STATUSES = ['ALL', 'ACTIVE', 'SUSPENDED', 'BLOCKED'] as const;
const PAGE_SIZE = 25;
const AUDIT_LINE = 'Recorded in the administrative audit log against your account.';

function labelFor(customer: Customer) {
  return customer.name || customer.phone || customer.email || customer.id;
}

function when(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN');
}

/**
 * The device sentence a confirmation opens with, in as many words as the count deserves.
 *
 * `null` is the honest answer when the detail read failed, and it must not be rendered as
 * zero: "nothing is signed in" would tell an operator sweeping a compromised account that
 * there was nothing to sweep.
 */
function devicesEnding(count: number | null) {
  if (count === null) return 'Every device this account is signed in on is signed out, as far as this server can tell.';
  if (count === 0) return 'No device is signed in right now, so this ends nothing.';
  if (count === 1) return 'The one device this account is signed in on is signed out.';
  return `The ${count} devices this account is signed in on are signed out.`;
}

export default function CustomersPage() {
  const { user } = useAuth();
  const ask = useConfirmDetails();
  const permissions = heldPermissions(user);
  const canRead = holdsPermission(user, 'customers.read');
  // `customers.suspend` is one of the names §11 answer 10 left with SUPER_ADMIN, so for
  // OPERATIONS and SUPPORT_AGENT this screen is a read-only directory. Their rows carry no
  // button at all: the answer to a click they cannot make would be a 403.
  const canSuspend = holdsPermission(user, 'customers.suspend');

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState<{ search: string; status: string; offset: number }>({
    search: '',
    status: 'ALL',
    offset: 0,
  });
  const [rows, setRows] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [cappedAt, setCappedAt] = useState<number | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canRead) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await adminApi.getCustomers({
        search: query.search || undefined,
        status: query.status === 'ALL' ? undefined : query.status,
        limit: PAGE_SIZE,
        offset: query.offset,
      });
      const data = res.data ?? {};
      const customers = (data.customers ?? []) as Customer[];
      setRows(customers);
      setTotal(Number(data.total ?? customers.length));
      setCappedAt(typeof data.searchCappedAt === 'number' ? data.searchCappedAt : null);
      setSource(data.dataSource ?? null);
      setDegraded(data.degraded === true);
      setError(null);
    } catch (err) {
      setRows([]);
      setTotal(0);
      setError(readRefusal(err, 'Could not load the customer directory.').message);
    } finally {
      setLoading(false);
    }
  }, [canRead, query]);

  useEffect(() => {
    // Every state update in this loader lands after an await, so this is not the
    // cascading render the rule warns about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function apply(next: Partial<typeof query>) {
    setOutcome(null);
    setFailure(null);
    setQuery((current) => ({ ...current, offset: 0, ...next }));
  }

  /**
   * How many devices a sign-out would end, read before the dialog opens.
   *
   * Area 49 asks a confirmation to state what its button does, and the directory row
   * carries no session list — only the detail read does. `null` means the count could not
   * be had, and the caller says "every device" instead of inventing a number.
   */
  async function countSessions(id: string): Promise<{ count: number | null; storeChecked: boolean }> {
    try {
      const res = await adminApi.getCustomer(id);
      const read = (res.data?.sessions ?? {}) as SessionRead;
      return { count: (read.sessions ?? []).length, storeChecked: read.storeChecked !== false };
    } catch {
      return { count: null, storeChecked: false };
    }
  }

  async function changeStatus(customer: Customer, status: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED') {
    const name = labelFor(customer);
    const closing = status !== 'ACTIVE';
    setBusyId(customer.id);
    const devices = closing ? await countSessions(customer.id) : { count: 0, storeChecked: true };
    setBusyId(null);

    const spec: Confirmation = closing
      ? {
          title: `${status === 'BLOCKED' ? 'Block' : 'Suspend'} ${name}`,
          effect: `New sign-ins close for this customer, and ${devicesEnding(devices.count).toLowerCase()}`,
          consequences: [
            'Their orders, wallet balance and saved addresses are untouched. Nothing is deleted and no refund is issued.',
            'They are not notified, so the reason you type below is the only record of why this happened — the route refuses an empty one.',
            `Reversible from this row: Reinstate reopens sign-in, but the ended sessions stay ended and the handset must sign in again.`,
            `${status === 'BLOCKED' ? 'BLOCKED and SUSPENDED' : 'SUSPENDED and BLOCKED'} are identical at the gate — both close sign-in and both end sessions. The only difference is the severity the trail records.`,
            AUDIT_LINE,
          ],
          confirmLabel: status === 'BLOCKED' ? 'Block account' : 'Suspend account',
          tone: 'danger',
          reason: {
            label: 'Reason, stored in the audit log',
            placeholder: 'e.g. Compliance case 4821 — repeated cash-on-delivery cancellations after confirmation',
            minLength: 5,
            help: 'At least 5 characters. The server refuses a shorter one, because an unexplained suspension cannot be answered when the customer appeals.',
          },
        }
      : {
          title: `Reinstate ${name}`,
          effect: 'Sign-in opens again for this customer. Their past sessions are not restored, so the handset has to sign in again.',
          consequences: [
            'Nothing else changes: their orders, wallet and history were never touched by the suspension.',
            'A note is optional here — the reinstatement is recorded either way.',
            AUDIT_LINE,
          ],
          confirmLabel: 'Reinstate account',
          tone: 'warning',
          reason: { label: 'Note for the trail (optional)', minLength: 0, placeholder: 'e.g. Appeal upheld by compliance on 2026-09-23' },
        };

    const answer = await ask(spec);
    if (!answer.confirmed) return;

    setBusyId(customer.id);
    try {
      const res = await adminApi.setCustomerStatus(customer.id, status, answer.reason || undefined);
      const data = res.data ?? {};
      const ended = data.sessions?.signedOut ?? 0;
      const inStore = data.sessions?.revokedInStore ?? 0;
      const inProcess = data.sessions?.revokedInMemory ?? 0;
      setOutcome(
        `${name} is now ${data.status ?? status} (was ${data.previousStatus ?? 'unknown'}). ` +
          (closing
            ? `${ended} session(s) ended — ${inStore} row(s) deleted in the durable store, ${inProcess} held by this process. `
            : '') +
          (data.persisted === false
            ? 'No store was reachable, so this lives in this process’s memory and will not survive a restart.'
            : '') +
          (devices.storeChecked === false ? ' The durable store was not reachable when the count was taken.' : '')
      );
      setFailure(null);
      await load();
    } catch (err) {
      setFailure(readRefusal(err, 'The change was not applied.').message);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function signOutEverywhere(customer: Customer) {
    const name = labelFor(customer);
    setBusyId(customer.id);
    const devices = await countSessions(customer.id);
    setBusyId(null);

    const spec: Confirmation = {
      title: `Sign ${name} out of every device`,
      effect: `${devicesEnding(devices.count)} It happens in the durable session store and here. The account stays open, so they can sign straight back in.`,
      consequences: [
        'This is the stolen-phone case: it removes access without closing the account.',
        'Use Suspend on this row if the account itself should stop working.',
        'Another backend instance honours its own copy of a session until its next reconcile.',
        AUDIT_LINE,
      ],
      confirmLabel: 'Sign out everywhere',
      tone: 'danger',
    };
    if (!(await ask(spec)).confirmed) return;

    setBusyId(customer.id);
    try {
      const res = await adminApi.signOutCustomer(customer.id);
      const sessions = res.data?.sessions ?? {};
      setOutcome(
        `${name} signed out of ${sessions.signedOut ?? 0} session(s) — ${sessions.revokedInStore ?? 0} row(s) deleted in the durable store, ${sessions.revokedInMemory ?? 0} dropped by this process. The account status is unchanged.` +
          (sessions.storeChecked === false ? ' The durable store was unreachable, so this covers this process only.' : '')
      );
      setFailure(null);
    } catch (err) {
      setFailure(readRefusal(err, 'Nothing was revoked.').message);
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      label: 'Customer',
      render: (c) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-title">{c.name ?? 'No name on file'}</span>
          <span className="nabin-cell-meta">
            {c.phone ?? 'no phone'} · {c.email ?? 'no email'}
          </span>
          <span className="nabin-cell-meta">{c.id}</span>
        </div>
      ),
    },
    {
      key: 'identityStatus',
      label: 'Identity',
      hideBelow: 'md',
      render: (c) => <span>{c.identityStatus ? c.identityStatus.replace(/_/g, ' ').toLowerCase() : '—'}</span>,
    },
    {
      key: 'rating',
      label: 'Rating',
      align: 'end',
      hideBelow: 'lg',
      render: (c) => <span className="nabin-num">{c.rating === null || c.rating === undefined ? '—' : Number(c.rating).toFixed(2)}</span>,
    },
    { key: 'accountStatus', label: 'Account', render: (c) => <StatusBadge value={c.accountStatus} /> },
    {
      key: 'createdAt',
      label: 'Registered',
      align: 'end',
      hideBelow: 'md',
      render: (c) => <span className="nabin-cell-meta">{when(c.createdAt)}</span>,
    },
    {
      key: 'action',
      label: '',
      align: 'end',
      render: (c) => {
        if (!canSuspend) {
          // Hidden, and the row says why rather than leaving a blank column that reads
          // as a rendering bug.
          return <span className="nabin-cell-meta">{missingGrantNote(user, 'customers.suspend')}</span>;
        }
        const open = (c.accountStatus ?? 'ACTIVE') === 'ACTIVE';
        return (
          <div className="nabin-row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              onClick={() => signOutEverywhere(c)}
              disabled={busyId === c.id}
              className="nabin-btn nabin-btn--ghost"
              style={{ minHeight: 40 }}
            >
              Sign out everywhere
            </button>
            {open ? (
              <>
                <button
                  onClick={() => changeStatus(c, 'SUSPENDED')}
                  disabled={busyId === c.id}
                  className="nabin-btn nabin-btn--danger"
                  style={{ minHeight: 40 }}
                >
                  {busyId === c.id ? 'Working…' : 'Suspend'}
                </button>
                <button
                  onClick={() => changeStatus(c, 'BLOCKED')}
                  disabled={busyId === c.id}
                  className="nabin-btn nabin-btn--ghost"
                  style={{ minHeight: 40 }}
                >
                  Block
                </button>
              </>
            ) : (
              <button
                onClick={() => changeStatus(c, 'ACTIVE')}
                disabled={busyId === c.id}
                className="nabin-btn nabin-btn--primary"
                style={{ minHeight: 40 }}
              >
                {busyId === c.id ? 'Working…' : 'Reinstate'}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const firstOnPage = total === 0 ? 0 : query.offset + 1;
  const lastOnPage = Math.min(query.offset + PAGE_SIZE, total);

  return (
    <AdminLayout title="Customers">
      <div className="nabin-page-head">
        <div>
          <h1>
            <Users size={22} aria-hidden style={{ verticalAlign: -3, marginRight: 8 }} />
            Customer accounts
          </h1>
          <p>
            {loading
              ? 'Loading…'
              : `${rows.length} shown of ${total} account(s)${cappedAt && total >= cappedAt ? ` — the search hit its ${cappedAt}-row ceiling, so narrow it to be sure you have seen everything` : ''}`}
          </p>
        </div>
        <button onClick={load} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
          Refresh
        </button>
      </div>

      {outcome && (
        <div className="nabin-alert nabin-alert--success" role="status">
          <span>{outcome}</span>
          <button onClick={() => setOutcome(null)} className="nabin-alert__action">
            Dismiss
          </button>
        </div>
      )}
      {failure && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <TriangleAlert size={18} />
          <span>{failure}</span>
          <button onClick={() => setFailure(null)} className="nabin-alert__action">
            Dismiss
          </button>
        </div>
      )}
      {!canRead && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <TriangleAlert size={18} />
          <span>{missingGrantNote(user, 'customers.read')}</span>
        </div>
      )}

      <section className="nabin-section" aria-labelledby="directory-heading">
        <h2 id="directory-heading" className="nabin-section-title">
          Directory
        </h2>
        <p className="nabin-cell-meta">
          Projected columns only — id, name, phone, email, account and identity status, rating and timestamps. A
          customer’s wallet, order history and saved addresses are not on this surface, and suspending an account
          does not touch them.{' '}
          {source ? `Read from ${source === 'postgres' ? 'the durable store' : 'this process’s memory'}.` : ''}
          {degraded ? ' A store was unreachable, so this page is not durable.' : ''}
        </p>
        <form
          className="nabin-row"
          style={{ flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}
          onSubmit={(event) => {
            event.preventDefault();
            apply({ search: search.trim() });
          }}
        >
          <div className="nabin-stack" style={{ gap: 'var(--space-xxs)', flex: '1 1 240px' }}>
            <label className="nabin-label" htmlFor="customer-search">
              Search name, phone or email
            </label>
            <input
              id="customer-search"
              className="nabin-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="e.g. 9176100002"
            />
          </div>
          <button type="submit" className="nabin-btn nabin-btn--primary" style={{ alignSelf: 'flex-end', minHeight: 40 }}>
            Search
          </button>
        </form>
        <div className="nabin-row" role="group" aria-label="Filter by account status" style={{ marginBottom: 'var(--space-sm)' }}>
          {STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => apply({ status })}
              className={`nabin-chip ${query.status === status ? 'is-active' : ''}`}
              aria-pressed={query.status === status}
            >
              {status === 'ALL' ? 'All' : status.charAt(0) + status.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <ResourceTable
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          loading={loading}
          error={error}
          onRetry={load}
          emptyTitle={canRead ? 'No customer accounts in this view' : 'The customer directory is hidden for your role'}
          emptyBody={
            canRead
              ? 'Change the status filter, widen the search, or refresh to load newer registrations.'
              : 'Nothing is listed, because customers.read is not one of your grants.'
          }
        />
        {total > PAGE_SIZE && (
          <div className="nabin-row" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
            <span className="nabin-cell-meta">
              {firstOnPage}–{lastOnPage} of {total}
            </span>
            <button
              onClick={() => setQuery((q) => ({ ...q, offset: Math.max(0, q.offset - PAGE_SIZE) }))}
              disabled={loading || query.offset === 0}
              className="nabin-btn nabin-btn--ghost"
              style={{ minHeight: 40 }}
            >
              Previous
            </button>
            <button
              onClick={() => setQuery((q) => ({ ...q, offset: q.offset + PAGE_SIZE }))}
              disabled={loading || lastOnPage >= total}
              className="nabin-btn nabin-btn--ghost"
              style={{ minHeight: 40 }}
            >
              Next
            </button>
          </div>
        )}
      </section>

      {/* §11 answer 10’s other half: there is no permission editor by decision, so the
          screen shows the caller their own grants read-only instead of leaving them to
          infer it from which buttons did not render. */}
      <section className="nabin-section" aria-labelledby="my-access-heading">
        <h2 id="my-access-heading" className="nabin-section-title">
          <ShieldCheck size={18} /> Your role and grants
        </h2>
        <p className="nabin-cell-meta">
          Signed in as <strong>{user?.role ?? 'unknown role'}</strong> with {permissions.length} grant(s), read from{' '}
          <code>GET /api/admin/me</code>. Grants come from the role and are never editable from this panel — a change
          is one edit to <code>backend/src/adminPermissions.js</code>, and it applies to every account holding that
          role.
        </p>
        <details>
          <summary className="nabin-cell-title">Show the {permissions.length} grant name(s)</summary>
          <ul className="nabin-cell-meta">
            {permissions.slice().sort().map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      </section>
    </AdminLayout>
  );
}
