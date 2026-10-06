'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Same single untyped boundary the other command-centre screens declare; each read still names
// the field it expects (`p?.tickets`), so a renamed field fails visibly at one place.

/**
 * Support queue with the two actions the backend actually exposes.
 *
 * Payloads are read off the routes, not inferred:
 *   POST /admin/support/:id/assign  body {}            - the route assigns `req.admin`, so no
 *                                                        assignee is ever sent from the client.
 *   POST /admin/support/:id/resolve body { resolutionNotes }
 * `refundAmount` exists on the resolve route and is deliberately NOT sent or rendered: a
 * resolution stays a non-financial action here until a money workflow is designed and authorised.
 * Visibility of a button is only comfort - `support.respond` / `support.resolve` are re-checked
 * by Express on every call, and a refusal is shown in the server's own words.
 */
import React, { useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { Panel, RecordsTable, StateBlock, Badge, UNAVAILABLE, count, useAdminData, type Row } from '@/components/DataPanel';
import { adminApi } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { holdsPermission } from '@/lib/access';

const MIN_NOTES = 12;

export default function SupportPage() {
  const { user } = useAuth();
  const tickets = useAdminData<Row[]>('/api/admin/support', (p: any) => p?.tickets);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const rows: Row[] = Array.isArray(tickets.data) ? tickets.data : [];
  const canAssign = holdsPermission(user, 'support.respond');
  const canResolve = holdsPermission(user, 'support.resolve');
  const reload = () => tickets.refetch?.();

  const call = async (label: string, id: string, run: () => Promise<unknown>) => {
    setBusy(`${id}:${label}`);
    setNotice(null);
    try {
      await run();
      setNotice({ ok: true, text: `${label} recorded for ticket ${id}. The queue was re-read from the server.` });
    } catch (err) {
      const res = (err as { response?: { status?: number; data?: { error?: string; code?: string } } })?.response;
      const safe = res?.data?.error || res?.data?.code || 'the request did not complete.';
      setNotice({ ok: false, text: `${label} refused (${res?.status ?? 'network'}): ${safe}` });
    } finally {
      setBusy(null);
      await reload();
    }
  };

  return (
    <AdminLayout title="Support">
      <div className="nabin-stack">
        {notice ? (
          <div className={`nabin-alert ${notice.ok ? 'nabin-alert--success' : 'nabin-alert--danger'}`} role="status">
            <span>{notice.text}</span>
          </div>
        ) : null}
        <Panel title="Tickets" subtitle={`${count((tickets.data as any)?.length ?? 0)} rows returned by /api/admin/support (a page, not the whole queue)`} panel={tickets}>
          {tickets.state !== 'ready' ? <StateBlock panel={tickets} empty="No tickets in the returned page." /> : (
            <>
              {!canAssign && !canResolve ? (
                <div className="nabin-alert" role="note">
                  <span>This session holds neither <code>support.respond</code> nor <code>support.resolve</code>,
                    so no action is offered. The queue is still readable, and the server would refuse either call regardless.</span>
                </div>
              ) : null}
              <RecordsTable
                rows={rows.slice(0, 25)}
                caption="Newest 25 returned rows. Assign takes the ticket for the signed-in operator; resolving requires notes."
                columns={[
                  { key: 'ticketNumber', label: 'Ticket' },
                  { key: 'title', label: 'Subject' },
                  { key: 'category', label: 'Category' },
                  { key: 'userName', label: 'Raised by' },
                  { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
                  {
                    key: 'actions', label: 'Actions', render: (r) => {
                      const id = String(r.id ?? '');
                      const note = notes[id] || '';
                      return (
                        <div className="nabin-row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          {canAssign ? (
                            <button className="nabin-btn nabin-btn--ghost" disabled={busy !== null || !id}
                              onClick={() => call('Assignment', id, () => adminApi.assignTicket(id))}>
                              {busy === `${id}:Assignment` ? 'Assigning…' : 'Assign to me'}
                            </button>
                          ) : null}
                          {canResolve ? (
                            <>
                              <label className="nabin-visually-hidden" htmlFor={`notes-${id}`}>Resolution notes for ticket {id}</label>
                              <input id={`notes-${id}`} className="nabin-input" style={{ minWidth: 200 }} value={note}
                                placeholder="what was done to resolve it" disabled={busy !== null}
                                onChange={(e) => setNotes(n => ({ ...n, [id]: e.target.value }))} />
                              <button className="nabin-btn nabin-btn--primary"
                                disabled={busy !== null || !id || note.trim().length < MIN_NOTES}
                                title={note.trim().length < MIN_NOTES ? `Write at least ${MIN_NOTES} characters of notes first` : undefined}
                                onClick={() => {
                                  if (!window.confirm(`Resolve ticket ${r.ticketNumber ?? id} with the notes as written?`)) return;
                                  return call('Resolution', id, () => adminApi.resolveTicket(id, note.trim()));
                                }}>
                                {busy === `${id}:Resolution` ? 'Resolving…' : 'Resolve'}
                              </button>
                            </>
                          ) : null}
                          {busy === null && !canAssign && !canResolve ? UNAVAILABLE : null}
                        </div>
                      );
                    },
                  },
                ]}
              />
            </>
          )}
        </Panel>
      </div>
    </AdminLayout>
  );
}
