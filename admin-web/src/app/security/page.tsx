'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import ResourceTable, { StatusBadge, type Column } from '@/components/ResourceTable';
import { useAuth } from '@/components/AuthProvider';
import { useConfirmAction, type Confirmation } from '@/components/ConfirmAction';
import { readRefusal } from '@/lib/refusals';
import { adminApi } from '@/lib/api';
import { holdsPermission } from '@/lib/access';
import { ShieldCheck, Users, KeyRound, TriangleAlert } from 'lucide-react';

interface AdminAccount {
  id: string;
  username?: string | null;
  name?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  status?: string | null;
  permissions?: string[];
  createdAt?: string | null;
}

interface AdminSession {
  sessionId: string;
  role?: string | null;
  adminId?: string | null;
  adminName?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
  inAdminMap?: boolean;
}

interface LockoutCounter {
  username: string;
  failedAttempts: number;
  lockedUntil?: string | null;
  locked?: boolean;
  lockedForMinutes?: number;
}

interface Revoked {
  mode?: string;
  adminId?: string | null;
  sessionId?: string;
  sessionIds?: string[];
  revokedInStore?: number;
  revokedInMemory?: number;
  inAdminMap?: number;
  storeChecked?: boolean;
}

const AUDIT_LINE = 'Recorded in the administrative audit log against your account.';

function shortHandle(handle?: string | null) {
  return handle ? `${handle.slice(0, 8)}…${handle.slice(-6)}` : 'unknown';
}

function when(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function SecurityPage() {
  const { user } = useAuth();
  const confirm = useConfirmAction();
  // `lib/access.ts` rather than a local `permissions.includes(...)`: the server admits
  // SUPER_ADMIN by wildcard before consulting its list, and a screen that reads only the
  // list can hide a control from the one account that always holds it.
  const canView = holdsPermission(user, 'security.view');
  const canRevoke = holdsPermission(user, 'security.session.revoke');
  const canManageAccounts = holdsPermission(user, 'admin_accounts.manage');

  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [sessionScope, setSessionScope] = useState<string | null>(null);
  const [sessionNote, setSessionNote] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [lockouts, setLockouts] = useState<LockoutCounter[]>([]);
  const [lockoutScope, setLockoutScope] = useState<{ scope?: string; resetOnRestart?: boolean; durableColumnsInSchema?: boolean }>({});
  const [lockoutsError, setLockoutsError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Read independently and labelled independently: one list refusing is not a reason
    // to present another as empty, and a 403 on the directory is a fact the operator
    // needs, not a bug.
    const [accountsRes, sessionsRes, lockoutsRes] = await Promise.allSettled([
      canManageAccounts ? adminApi.getAdminAccounts() : Promise.reject(new Error('SKIPPED')),
      canView ? adminApi.getAdminSessions() : Promise.reject(new Error('SKIPPED')),
      canView ? adminApi.getAdminLoginLockouts() : Promise.reject(new Error('SKIPPED')),
    ]);

    if (accountsRes.status === 'fulfilled') {
      setAccounts(accountsRes.value.data.accounts ?? []);
      setAccountsError(null);
    } else {
      setAccounts([]);
      setAccountsError(
        canManageAccounts
          ? readRefusal(accountsRes.reason, 'Could not load the administrator directory.').message
          : 'Hidden: this role holds no admin_accounts.manage grant, so the directory is not listed.'
      );
    }

    if (sessionsRes.status === 'fulfilled') {
      setSessions(sessionsRes.value.data.sessions ?? []);
      setSessionScope(sessionsRes.value.data.scope ?? null);
      setSessionNote(sessionsRes.value.data.note ?? null);
      setSessionsError(null);
    } else {
      setSessions([]);
      setSessionsError(
        canView
          ? readRefusal(sessionsRes.reason, 'Could not load administrator sessions.').message
          : 'Hidden: this role holds no security.view grant, so the session directory is not listed.'
      );
    }

    if (lockoutsRes.status === 'fulfilled') {
      const data = lockoutsRes.value.data;
      setLockouts(data.counters ?? []);
      setLockoutScope({
        scope: data.scope,
        resetOnRestart: data.resetOnRestart,
        durableColumnsInSchema: data.durableColumnsInSchema,
      });
      setLockoutsError(null);
    } else {
      setLockouts([]);
      setLockoutsError(
        canView
          ? readRefusal(lockoutsRes.reason, 'Could not read the failed-login counters.').message
          : 'Hidden: this role holds no security.view grant, so the failed-login counters are not listed.'
      );
    }

    setLoading(false);
  }, [canManageAccounts, canView]);

  useEffect(() => {
    // Every state update in this loader lands after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function run(
    label: string,
    action: () => Promise<{
      data: {
        revoked?: Revoked;
        account?: AdminAccount;
        sessionsRevoked?: { inStore: number; inThisProcess: number; storeChecked?: boolean };
      };
    }>
  ) {
    setBusyId(label);
    setOutcome(null);
    setFailure(null);
    try {
      const res = await action();
      const revoked = res.data.revoked;
      const perAccount = res.data.sessionsRevoked;
      // The store's count is how many sessions existed; this process's count is how many
      // copies of them it held in its own maps. Adding the two counts one session twice,
      // so the line below keeps them apart.
      const fromStore = revoked ? (revoked.revokedInStore ?? 0) : (perAccount?.inStore ?? 0);
      const localCopies = revoked
        ? (revoked.revokedInMemory ?? 0) + (revoked.inAdminMap ?? 0)
        : (perAccount?.inThisProcess ?? 0);
      const storeSkipped = (revoked ? revoked.storeChecked : perAccount?.storeChecked) === false;
      const detail = [
        fromStore ? `${fromStore} session row(s) deleted in the durable store` : '',
        localCopies ? `${localCopies} copy/copies dropped by this process` : '',
      ]
        .filter(Boolean)
        .join(' and ');
      let summary: string;
      if (revoked) {
        const subject =
          revoked.mode === 'SESSION' ? `Session ${shortHandle(revoked.sessionId)}` : 'Every session of that account';
        summary = detail
          ? `${subject} closed — ${detail}.`
          : 'Nothing was revoked — no live session matched that target.';
      } else if (perAccount) {
        const account = res.data.account;
        const enabled = account?.status === 'ACTIVE';
        const tail = detail
          ? ` — ${detail}.`
          : enabled
            ? '. No session was restored, so nobody is signed in by this click.'
            : ' — it held no live session.';
        summary = `${account?.username ?? account?.id ?? 'Account'} is now ${enabled ? 'enabled' : 'disabled'}${tail}`;
      } else {
        summary = 'Done.';
      }
      setOutcome(summary + (storeSkipped ? ' The durable store was not reachable, so this covers this process only.' : ''));
      await load();
    } catch (err) {
      // `applied: true` from the server means the change landed and only its audit
      // record failed, and readRefusal is what keeps those two cases apart here.
      setFailure(readRefusal(err, 'The action was not applied.').message);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function revokeSession(session: AdminSession) {
    const spec: Confirmation = {
      title: `Revoke one session (${shortHandle(session.sessionId)})`,
      effect: 'This signed-in administrator is logged out. Their next request is refused and they must sign in again.',
      consequences: [
        'It is not a disable: their account keeps its role and can sign straight back in.',
        'Another backend instance honours its own copy until its next session reconcile.',
        'Only the SHA-256 handle is shown or sent here, never the token itself.',
        AUDIT_LINE,
      ],
      confirmLabel: 'Revoke session',
      tone: 'danger',
    };
    if (!(await confirm(spec))) return;
    await run(session.sessionId, () => adminApi.revokeAdminSessions({ sessionId: session.sessionId }));
  }

  async function revokeAccountSessions(account: AdminAccount) {
    const name = account.username || account.name || account.id;
    const spec: Confirmation = {
      title: `Revoke every session of ${name}`,
      effect: 'Everyone signed in as this administrator is logged out, on this server and in the durable session store.',
      consequences: [
        'The account stays enabled, so they can sign back in immediately.',
        "Use Disable on this row if the account itself should stop working.",
        AUDIT_LINE,
      ],
      confirmLabel: 'Revoke all sessions',
      tone: 'danger',
    };
    if (!(await confirm(spec))) return;
    await run(account.id, () => adminApi.revokeAdminSessions({ adminId: account.id }));
  }

  async function setAccountStatus(account: AdminAccount, isActive: boolean) {
    const name = account.username || account.name || account.id;
    const spec: Confirmation = isActive
      ? {
          title: `Enable ${name}`,
          effect: `The account can sign in again, with the role it already holds (${account.role ?? 'unknown'}). No session is restored, so nobody is signed in by this click.`,
          consequences: [
            'Its permissions come from its role, not from this screen — a role is never changed here.',
            AUDIT_LINE,
          ],
          confirmLabel: 'Enable account',
          tone: 'warning',
        }
      : {
          title: `Disable ${name}`,
          effect: 'Sign-in closes for this account, and every session it already holds is revoked in the same call — anyone using it is logged out on their next request.',
          consequences: [
            'Their role and permission grants are left as they are; enabling restores exactly this access.',
            'Another backend instance honours its own session copy until its next session reconcile.',
            'If this is the only enabled SUPER_ADMIN account the server refuses the change, because nothing could re-enable it afterwards.',
            AUDIT_LINE,
          ],
          confirmLabel: 'Disable account',
          tone: 'danger',
        };
    if (!(await confirm(spec))) return;
    await run(account.id, () => adminApi.setAdminAccountStatus(account.id, isActive));
  }

  const accountColumns: Column<AdminAccount>[] = [
    {
      key: 'name',
      label: 'Administrator',
      render: (a) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-title">{a.name ?? a.username ?? a.id}</span>
          <span className="nabin-cell-meta">
            {a.username ?? 'no username'} · {a.id}
          </span>
        </div>
      ),
    },
    { key: 'role', label: 'Role', render: (a) => <span>{a.role ?? '—'}</span> },
    {
      key: 'permissions',
      label: 'Grants',
      align: 'end',
      hideBelow: 'lg',
      // A count, not the list: the names are derived from the role and shown in the
      // permission catalogue, and pasting 70 of them into a row makes the row unreadable.
      render: (a) => <span className="nabin-num">{a.permissions?.length ?? 0}</span>,
    },
    { key: 'status', label: 'Status', render: (a) => <StatusBadge value={a.status} /> },
    {
      key: 'action',
      label: '',
      align: 'end',
      render: (a) => {
        if (!canRevoke && !canManageAccounts) return null;
        return (
          <div className="nabin-row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {/* Two different names on one row: the revoke goes to
                `POST /api/admin/security/sessions/revoke` (`security.session.revoke`),
                not to the account route, so it cannot ride on the directory grant. */}
            {canRevoke && (
              <button
                onClick={() => revokeAccountSessions(a)}
                disabled={busyId === a.id}
                className="nabin-btn nabin-btn--ghost"
                style={{ minHeight: 'var(--target-min)' }}
              >
                Revoke sessions
              </button>
            )}
            {canManageAccounts &&
              (a.status === 'ACTIVE' ? (
                <button
                  onClick={() => setAccountStatus(a, false)}
                  disabled={busyId === a.id}
                  className="nabin-btn nabin-btn--danger"
                  style={{ minHeight: 'var(--target-min)' }}
                >
                  {busyId === a.id ? 'Working…' : 'Disable'}
                </button>
              ) : (
                <button
                  onClick={() => setAccountStatus(a, true)}
                  disabled={busyId === a.id}
                  className="nabin-btn nabin-btn--primary"
                  style={{ minHeight: 'var(--target-min)' }}
                >
                  {busyId === a.id ? 'Working…' : 'Enable'}
                </button>
              ))}
          </div>
        );
      },
    },
  ];

  const sessionColumns: Column<AdminSession>[] = [
    {
      key: 'adminName',
      label: 'Signed in as',
      render: (s) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-title">{s.adminName ?? 'Unknown account'}</span>
          <span className="nabin-cell-meta">{s.adminId ?? 'no account id'}</span>
        </div>
      ),
    },
    { key: 'role', label: 'Role', hideBelow: 'sm', render: (s) => <span>{s.role ?? '—'}</span> },
    {
      key: 'sessionId',
      label: 'Session handle',
      hideBelow: 'md',
      render: (s) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-meta">{shortHandle(s.sessionId)}</span>
          <span className="nabin-cell-meta">{s.inAdminMap ? 'also in this process\' map' : 'store only'}</span>
        </div>
      ),
    },
    {
      key: 'createdAt',
      label: 'Since / until',
      hideBelow: 'lg',
      render: (s) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-meta">{when(s.createdAt)}</span>
          <span className="nabin-cell-meta">to {when(s.expiresAt)}</span>
        </div>
      ),
    },
    {
      key: 'expired',
      label: 'State',
      render: (s) => (s.expired ? <StatusBadge value="EXPIRED" /> : <StatusBadge value="ACTIVE" />),
    },
    {
      key: 'action',
      label: '',
      align: 'end',
      render: (s) =>
        canRevoke ? (
          <button
            onClick={() => revokeSession(s)}
            disabled={busyId === s.sessionId}
            className="nabin-btn nabin-btn--ghost"
            style={{ minHeight: 'var(--target-min)' }}
          >
            {busyId === s.sessionId ? 'Working…' : 'Revoke'}
          </button>
        ) : null,
    },
  ];

  const lockoutColumns: Column<LockoutCounter>[] = [
    { key: 'username', label: 'Account', render: (c) => <span className="nabin-cell-title">{c.username}</span> },
    {
      key: 'failedAttempts',
      label: 'Failed attempts',
      align: 'end',
      render: (c) => <span className="nabin-num">{c.failedAttempts}</span>,
    },
    {
      key: 'locked',
      label: 'State',
      render: (c) =>
        c.locked ? (
          <div className="nabin-cell-stack">
            <StatusBadge value="LOCKED" />
            <span className="nabin-cell-meta">{c.lockedForMinutes ?? 0} min left</span>
          </div>
        ) : (
          <StatusBadge value="OPEN" />
        ),
    },
    {
      key: 'lockedUntil',
      label: 'Locked until',
      hideBelow: 'md',
      render: (c) => <span className="nabin-cell-meta">{when(c.lockedUntil)}</span>,
    },
  ];

  return (
    <AdminLayout title="Security centre">
      <div className="nabin-page-head">
        <div>
          <h1>
            <ShieldCheck size={22} aria-hidden style={{ verticalAlign: -3, marginRight: 8 }} />
            Administrator access
          </h1>
          <p>
            {loading
              ? 'Loading…'
              : `${accounts.length} account(s) · ${sessions.length} session(s) · ${lockouts.length} failed-login counter(s)`}
          </p>
        </div>
        <button onClick={load} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 'var(--target-min)' }}>
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

      <section className="nabin-section" aria-labelledby="accounts-heading">
        <h2 id="accounts-heading" className="nabin-section-title">
          <Users size={18} /> Administrator directory
        </h2>
        {accountsError ? (
          <p className="nabin-cell-meta">{accountsError}</p>
        ) : (
          <p className="nabin-cell-meta">
            Status only. A role is never edited from this screen, so it is not listed as a control here either.
          </p>
        )}
        <ResourceTable
          columns={accountColumns}
          rows={accounts}
          rowKey={(a) => a.id}
          loading={loading && !accountsError}
          error={null}
          onRetry={load}
          emptyTitle="No administrator accounts"
          emptyBody="Nothing was returned by the directory. Provisioning is a separate, SUPER_ADMIN-only surface."
        />
      </section>

      <section className="nabin-section" aria-labelledby="sessions-heading">
        <h2 id="sessions-heading" className="nabin-section-title">
          <KeyRound size={18} /> Live administrator sessions
        </h2>
        <p className="nabin-cell-meta">
          {sessionScope ? `Scope: ${sessionScope.replace(/_/g, ' ').toLowerCase()}. ` : ''}
          {sessionNote ??
            'A revoked session is removed from the durable store and from this process; another instance converges on its next reconcile.'}
        </p>
        {!canRevoke && (
          <p className="nabin-cell-meta">Hidden: this role holds no security.session.revoke grant.</p>
        )}
        {sessionsError ? <p className="nabin-cell-meta">{sessionsError}</p> : null}
        <ResourceTable
          columns={sessionColumns}
          rows={sessions}
          rowKey={(s) => s.sessionId}
          loading={loading && !sessionsError}
          error={null}
          onRetry={load}
          emptyTitle="No administrator sessions"
          emptyBody="Every signed-in administrator session in the durable store and this process appears here."
        />
      </section>

      <section className="nabin-section" aria-labelledby="lockouts-heading">
        <h2 id="lockouts-heading" className="nabin-section-title">
          <TriangleAlert size={18} /> Failed-login lockouts
        </h2>
        <p className="nabin-cell-meta">
          {lockoutScope.scope
            ? `Scope: ${lockoutScope.scope.replace(/_/g, ' ').toLowerCase()}` +
              (lockoutScope.resetOnRestart ? ', and a restart clears them. ' : '. ')
            : ''}
          {lockoutScope.durableColumnsInSchema === false
            ? 'The admin_accounts failed_attempts and locked_until columns are not written by this backend — what is listed here is what is actually enforced, and nothing more.'
            : ''}
        </p>
        {lockoutsError ? <p className="nabin-cell-meta">{lockoutsError}</p> : null}
        <ResourceTable
          columns={lockoutColumns}
          rows={lockouts}
          rowKey={(c) => c.username}
          loading={loading && !lockoutsError}
          error={null}
          onRetry={load}
          emptyTitle="No failed sign-ins recorded"
          emptyBody="Counters appear here once an account name has failed authentication on this process."
        />
      </section>
    </AdminLayout>
  );
}
