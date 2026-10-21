'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { RESTAURANT_NAV } from '@/components/ConsoleLayout';
import { PlusIcon, RefreshIcon, QrIcon, TableIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import {
  rmsApi,
  type RestaurantTable,
  type TableSession,
  type SessionBill,
} from '@/lib/api';
import { inr, toFailure } from '@/lib/format';

const TABLE_STATUS_TONE: Record<string, string> = {
  AVAILABLE: 'success',
  OCCUPIED: 'danger',
  RESERVED: 'warning',
  ORDERING: 'warning',
  BILL_REQUESTED: 'primary',
  CLEANING: 'neutral',
};

export default function TablesPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();
  const merchantId = merchant?.id;

  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [filter, setFilter] = useState<string>('ALL');
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Modals & Panels
  const [activeTable, setActiveTable] = useState<RestaurantTable | null>(null);
  const [activeSession, setActiveSession] = useState<TableSession | null>(null);
  const [activeBill, setActiveBill] = useState<SessionBill | null>(null);
  const [billLoading, setBillLoading] = useState(false);

  // New Table modal state
  const [showAddTable, setShowAddTable] = useState(false);
  const [newTableNumber, setNewTableNumber] = useState('');
  const [newTableName, setNewTableName] = useState('');
  const [newTableCapacity, setNewTableCapacity] = useState(4);

  // Open Session modal state
  const [showOpenSession, setShowOpenSession] = useState(false);
  const [guestCount, setGuestCount] = useState(2);

  // Transfer Session modal state
  const [showTransfer, setShowTransfer] = useState(false);
  const [targetTableId, setTargetTableId] = useState('');

  // Bill payment state
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD' | 'UPI'>('CASH');
  const [splitCount, setSplitCount] = useState<number>(2);

  const loadTables = useCallback(async () => {
    if (!merchantId) return;
    setPending(true);
    try {
      const res = await rmsApi.getTables(merchantId);
      setTables(res.data.tables || []);
      setError('');
    } catch (err) {
      setError(toFailure(err, 'Could not load floor tables.').message);
    } finally {
      setPending(false);
    }
  }, [merchantId]);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  const selectSessionForTable = async (table: RestaurantTable) => {
    setActiveTable(table);
    if (table.current_session_id && merchantId) {
      setBillLoading(true);
      try {
        const sessRes = await rmsApi.getActiveSession(merchantId, table.id);
        setActiveSession(sessRes.data.session || null);
        const billRes = await rmsApi.getSessionBill(merchantId, table.current_session_id);
        setActiveBill(billRes.data.bill || null);
        if (billRes.data.bill?.balance_amount) {
          setPayAmount(Number(billRes.data.bill.balance_amount));
        }
      } catch (err) {
        console.error(err);
      } finally {
        setBillLoading(false);
      }
    } else {
      setActiveSession(null);
      setActiveBill(null);
    }
  };

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!merchantId || !newTableNumber.trim()) return;
    try {
      await rmsApi.createTable(merchantId, {
        table_number: newTableNumber.trim(),
        name: newTableName.trim() || undefined,
        capacity: Number(newTableCapacity),
      });
      setShowAddTable(false);
      setNewTableNumber('');
      setNewTableName('');
      setSuccessMsg('Table created successfully');
      void loadTables();
    } catch (err) {
      setError(toFailure(err, 'Failed to create table.').message);
    }
  };

  const handleOpenSession = async () => {
    if (!merchantId || !activeTable) return;
    try {
      const res = await rmsApi.openSession(merchantId, activeTable.id, {
        guest_count: Number(guestCount),
      });
      setShowOpenSession(false);
      setSuccessMsg(`Session opened for Table ${activeTable.table_number}`);
      void loadTables();
      if (res.data.session) {
        setActiveSession(res.data.session);
      }
    } catch (err) {
      setError(toFailure(err, 'Failed to open table session.').message);
    }
  };

  const handleCloseSession = async () => {
    if (!merchantId || !activeSession) return;
    try {
      await rmsApi.closeSession(merchantId, activeSession.id);
      setSuccessMsg('Table session closed and marked CLEANING.');
      setActiveTable(null);
      setActiveSession(null);
      setActiveBill(null);
      void loadTables();
    } catch (err) {
      setError(toFailure(err, 'Could not close session.').message);
    }
  };

  const handleSetStatus = async (tableId: string, status: string) => {
    if (!merchantId) return;
    try {
      await rmsApi.setTableStatus(merchantId, tableId, status);
      setSuccessMsg(`Table status updated to ${status}`);
      void loadTables();
    } catch (err) {
      setError(toFailure(err, 'Could not update table status.').message);
    }
  };

  const handleRegenerateQr = async (tableId: string) => {
    if (!merchantId) return;
    try {
      const res = await rmsApi.regenerateTableQr(merchantId, tableId);
      setSuccessMsg(`QR token updated: ${res.data.qrToken}`);
      void loadTables();
    } catch (err) {
      setError(toFailure(err, 'Could not regenerate QR.').message);
    }
  };

  const handleRecordPayment = async () => {
    if (!merchantId || !activeSession || !payAmount) return;
    try {
      const res = await rmsApi.recordBillPayment(merchantId, activeSession.id, {
        amount: Number(payAmount),
        paymentMethod: payMethod,
      });
      setSuccessMsg(`Payment of ₹${payAmount} recorded successfully.`);
      setActiveBill(res.data.bill);
      setPayAmount(Number(res.data.bill.balance_amount || 0));
      void loadTables();
    } catch (err) {
      setError(toFailure(err, 'Payment recording failed.').message);
    }
  };

  const handleSplitBill = async () => {
    if (!merchantId || !activeSession || splitCount < 2) return;
    try {
      const res = await rmsApi.splitBill(merchantId, activeSession.id, splitCount);
      setActiveBill(res.data.bill);
      setSuccessMsg(`Bill divided into ${splitCount} equal splits.`);
    } catch (err) {
      setError(toFailure(err, 'Split bill calculation failed.').message);
    }
  };

  const handleTransferSession = async () => {
    if (!merchantId || !activeSession || !targetTableId) return;
    try {
      await rmsApi.transferSession(merchantId, activeSession.id, targetTableId);
      setSuccessMsg('Session transferred to target table.');
      setShowTransfer(false);
      setActiveTable(null);
      setActiveSession(null);
      setActiveBill(null);
      void loadTables();
    } catch (err) {
      setError(toFailure(err, 'Session transfer failed.').message);
    }
  };

  const filteredTables = filter === 'ALL' ? tables : tables.filter((t) => t.status === filter);

  return (
    <ConsoleLayout title="Dine-In & Tables" roleLabel="Restaurant" nav={RESTAURANT_NAV}>
      {error && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <span>{error}</span>
          <button className="nabin-alert__action" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      {successMsg && (
        <div className="nabin-alert nabin-alert--success" role="status">
          <span>{successMsg}</span>
          <button className="nabin-alert__action" onClick={() => setSuccessMsg('')}>Dismiss</button>
        </div>
      )}

      <div className="nabin-stack">
        <header className="nabin-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900 }}>Dine-In Floor & Tables</h1>
            <p className="nabin-cell-meta">Manage real-time seating, QR ordering codes, active guest sessions, and bills.</p>
          </div>
          <div className="nabin-row">
            <button onClick={() => void loadTables()} className="nabin-btn nabin-btn--ghost" aria-label="Refresh floor">
              <RefreshIcon />
              <span>Refresh</span>
            </button>
            <button onClick={() => setShowAddTable(true)} className="nabin-btn nabin-btn--primary">
              <PlusIcon />
              <span>Add Table</span>
            </button>
          </div>
        </header>

        {/* Filters */}
        <div className="nabin-row" style={{ overflowX: 'auto', paddingBottom: 4 }}>
          {['ALL', 'AVAILABLE', 'OCCUPIED', 'BILL_REQUESTED', 'ORDERING', 'RESERVED', 'CLEANING'].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`nabin-chip ${filter === s ? 'nabin-chip--active' : ''}`}
            >
              {s.replace('_', ' ')} ({s === 'ALL' ? tables.length : tables.filter((t) => t.status === s).length})
            </button>
          ))}
        </div>

        {/* Floor Grid */}
        <div className="nabin-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {pending && !tables.length ? (
            <p className="nabin-cell-meta">Loading tables...</p>
          ) : filteredTables.length === 0 ? (
            <p className="nabin-cell-meta">No tables match the selected filter.</p>
          ) : (
            filteredTables.map((t) => {
              const tone = TABLE_STATUS_TONE[t.status] || 'neutral';
              const isSelected = activeTable?.id === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => selectSessionForTable(t)}
                  className={`nabin-card ${isSelected ? 'is-selected' : ''}`}
                  style={{
                    cursor: 'pointer',
                    border: isSelected ? '2px solid #1A3BA2' : '1px solid var(--border)',
                    boxShadow: isSelected ? '0 0 0 3px rgba(26,59,162,0.15)' : undefined,
                  }}
                >
                  <div className="nabin-card__header" style={{ marginBottom: 8 }}>
                    <div className="nabin-row" style={{ gap: 8 }}>
                      <span style={{ fontSize: 20 }}>🪑</span>
                      <div>
                        <strong style={{ fontSize: 17, display: 'block' }}>Table {t.table_number}</strong>
                        <span className="nabin-cell-meta">{t.name || `Capacity ${t.capacity} guests`}</span>
                      </div>
                    </div>
                    <span className={`nabin-badge nabin-badge--${tone}`}>{t.status.replace('_', ' ')}</span>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                    <span>Capacity: {t.capacity}</span> &middot; <span>Session: {t.current_session_id ? 'Active' : 'None'}</span>
                  </div>

                  <div className="nabin-row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRegenerateQr(t.id);
                      }}
                      className="nabin-btn nabin-btn--ghost"
                      style={{ padding: '4px 8px', fontSize: 11, minHeight: 28 }}
                      title="Regenerate QR Token"
                    >
                      <QrIcon size={14} />
                      <span>QR</span>
                    </button>
                    {t.status === 'CLEANING' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetStatus(t.id, 'AVAILABLE');
                        }}
                        className="nabin-btn nabin-btn--primary"
                        style={{ padding: '4px 8px', fontSize: 11, minHeight: 28 }}
                      >
                        Mark Clean
                      </button>
                    )}
                    {t.status === 'AVAILABLE' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveTable(t);
                          setShowOpenSession(true);
                        }}
                        className="nabin-btn nabin-btn--primary"
                        style={{ padding: '4px 8px', fontSize: 11, minHeight: 28 }}
                      >
                        Seat Guests
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Table Inspection & Billing Drawer */}
        {activeTable && (
          <section className="nabin-card" style={{ borderTop: '4px solid #1A3BA2', marginTop: 16 }}>
            <div className="nabin-card__header">
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 800 }}>
                  Table {activeTable.table_number} &mdash; {activeTable.name || 'Floor Table'}
                </h2>
                <p className="nabin-cell-meta">Status: {activeTable.status} &middot; Capacity: {activeTable.capacity} Seats</p>
              </div>
              <button onClick={() => setActiveTable(null)} className="nabin-btn nabin-btn--ghost">Close Panel</button>
            </div>

            {billLoading ? (
              <p className="nabin-cell-meta">Loading session and bill data...</p>
            ) : activeSession ? (
              <div className="nabin-stack" style={{ gap: 16 }}>
                <div className="nabin-row" style={{ flexWrap: 'wrap', gap: 12 }}>
                  <span className="nabin-chip">Session ID: {activeSession.id}</span>
                  <span className="nabin-chip">Guests: {activeSession.guest_count}</span>
                  <span className="nabin-chip">Status: {activeSession.status}</span>
                  <span className="nabin-chip">Seated At: {new Date(activeSession.opened_at).toLocaleTimeString()}</span>
                </div>

                {/* Bill Details */}
                {activeBill ? (
                  <div className="nabin-card" style={{ background: '#f8fafc', padding: 16 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Session Bill & Payment</h3>
                    <div className="nabin-stack" style={{ gap: 6 }}>
                      <div className="nabin-row" style={{ justifyContent: 'space-between' }}>
                        <span>Subtotal:</span>
                        <strong className="nabin-num">{inr(activeBill.subtotal)}</strong>
                      </div>
                      <div className="nabin-row" style={{ justifyContent: 'space-between' }}>
                        <span>GST Tax:</span>
                        <span className="nabin-num">{inr(activeBill.tax_amount)}</span>
                      </div>
                      <div className="nabin-row" style={{ justifyContent: 'space-between' }}>
                        <span>Service Charge:</span>
                        <span className="nabin-num">{inr(activeBill.service_charge_amount)}</span>
                      </div>
                      <div className="nabin-row" style={{ justifyContent: 'space-between', borderTop: '1px solid #cbd5e1', paddingTop: 6 }}>
                        <strong>Total Amount:</strong>
                        <strong className="nabin-num" style={{ fontSize: 16, color: '#1A3BA2' }}>{inr(activeBill.total_amount)}</strong>
                      </div>
                      <div className="nabin-row" style={{ justifyContent: 'space-between' }}>
                        <span>Paid So Far:</span>
                        <span className="nabin-num" style={{ color: '#16a34a' }}>{inr(activeBill.paid_amount)}</span>
                      </div>
                      <div className="nabin-row" style={{ justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', paddingTop: 6 }}>
                        <strong style={{ color: activeBill.balance_amount > 0 ? '#dc2626' : '#16a34a' }}>
                          Remaining Balance:
                        </strong>
                        <strong className="nabin-num" style={{ fontSize: 18, color: activeBill.balance_amount > 0 ? '#dc2626' : '#16a34a' }}>
                          {inr(activeBill.balance_amount)}
                        </strong>
                      </div>
                    </div>

                    {/* Split Bill Controls */}
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #cbd5e1' }}>
                      <h4 style={{ fontSize: 13, fontWeight: 700 }}>Split Bill Calculation</h4>
                      <div className="nabin-row" style={{ marginTop: 6, gap: 8 }}>
                        <label style={{ fontSize: 12 }}>Ways:</label>
                        <select
                          value={splitCount}
                          onChange={(e) => setSplitCount(Number(e.target.value))}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                        >
                          {[2, 3, 4, 5, 6].map((n) => (
                            <option key={n} value={n}>{n} Persons</option>
                          ))}
                        </select>
                        <button onClick={handleSplitBill} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 32 }}>
                          Calculate Splits
                        </button>
                      </div>
                      {activeBill.splits && activeBill.splits.length > 0 && (
                        <div className="nabin-row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                          {activeBill.splits.map((s) => (
                            <span key={s.split_index} className="nabin-chip" style={{ background: '#fff' }}>
                              Person #{s.split_index}: {inr(s.amount)} {s.is_paid ? '✓ Paid' : 'Pending'}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Record Payment */}
                    {activeBill.balance_amount > 0 && (
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #cbd5e1' }}>
                        <h4 style={{ fontSize: 13, fontWeight: 700 }}>Record Payment</h4>
                        <div className="nabin-row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                          <input
                            type="number"
                            value={payAmount}
                            onChange={(e) => setPayAmount(Number(e.target.value))}
                            placeholder="Amount in INR"
                            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', width: 130 }}
                          />
                          <select
                            value={payMethod}
                            onChange={(e) => setPayMethod(e.target.value as any)}
                            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}
                          >
                            <option value="CASH">Cash</option>
                            <option value="CARD">Card POS</option>
                            <option value="UPI">UPI Dynamic QR</option>
                          </select>
                          <button onClick={handleRecordPayment} className="nabin-btn nabin-btn--primary" style={{ minHeight: 34 }}>
                            Record ₹{payAmount}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="nabin-row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
                      <button onClick={() => setShowTransfer(true)} className="nabin-btn nabin-btn--ghost">
                        Transfer to Table...
                      </button>
                      {activeBill.balance_amount === 0 ? (
                        <button onClick={handleCloseSession} className="nabin-btn nabin-btn--primary">
                          Close Table & Mark Cleaning
                        </button>
                      ) : (
                        <p className="nabin-cell-meta" style={{ color: '#dc2626' }}>
                          Cannot close table while an unpaid balance exists.
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="nabin-row" style={{ justifyContent: 'space-between' }}>
                    <p className="nabin-cell-meta">No orders attached to this session yet.</p>
                    <button onClick={handleCloseSession} className="nabin-btn nabin-btn--ghost">
                      Close Empty Session
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="nabin-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <p className="nabin-cell-meta">Table currently has no active session.</p>
                <button onClick={() => setShowOpenSession(true)} className="nabin-btn nabin-btn--primary">
                  Open Table Session
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Add Table Modal */}
      {showAddTable && (
        <div className="nabin-scrim" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="nabin-card" style={{ maxWidth: 400, width: '90%', margin: 16 }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Add Floor Table</h3>
            <form onSubmit={handleCreateTable} className="nabin-stack" style={{ gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Table Number/Code *</label>
                <input
                  type="text"
                  required
                  value={newTableNumber}
                  onChange={(e) => setNewTableNumber(e.target.value)}
                  placeholder="e.g. T5 or B2"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Name / Description</label>
                <input
                  type="text"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder="e.g. Patio Booth"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Seating Capacity</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={newTableCapacity}
                  onChange={(e) => setNewTableCapacity(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                />
              </div>
              <div className="nabin-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" onClick={() => setShowAddTable(false)} className="nabin-btn nabin-btn--ghost">
                  Cancel
                </button>
                <button type="submit" className="nabin-btn nabin-btn--primary">
                  Create Table
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Open Session Modal */}
      {showOpenSession && activeTable && (
        <div className="nabin-scrim" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="nabin-card" style={{ maxWidth: 360, width: '90%', margin: 16 }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Seat Table {activeTable.table_number}</h3>
            <p className="nabin-cell-meta" style={{ marginBottom: 16 }}>Start an active dining session for this table.</p>
            <div className="nabin-stack" style={{ gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Guest Count</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={guestCount}
                  onChange={(e) => setGuestCount(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                />
              </div>
              <div className="nabin-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={() => setShowOpenSession(false)} className="nabin-btn nabin-btn--ghost">
                  Cancel
                </button>
                <button onClick={handleOpenSession} className="nabin-btn nabin-btn--primary">
                  Open Session
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Session Modal */}
      {showTransfer && activeSession && (
        <div className="nabin-scrim" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="nabin-card" style={{ maxWidth: 380, width: '90%', margin: 16 }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Transfer Dining Session</h3>
            <p className="nabin-cell-meta" style={{ marginBottom: 16 }}>
              Move active session from Table {activeTable?.table_number} to an available table.
            </p>
            <div className="nabin-stack" style={{ gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Target Table</label>
                <select
                  value={targetTableId}
                  onChange={(e) => setTargetTableId(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                >
                  <option value="">Select available table...</option>
                  {tables
                    .filter((t) => t.status === 'AVAILABLE' && t.id !== activeTable?.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        Table {t.table_number} ({t.name || `Cap ${t.capacity}`})
                      </option>
                    ))}
                </select>
              </div>
              <div className="nabin-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={() => setShowTransfer(false)} className="nabin-btn nabin-btn--ghost">
                  Cancel
                </button>
                <button
                  disabled={!targetTableId}
                  onClick={handleTransferSession}
                  className="nabin-btn nabin-btn--primary"
                >
                  Transfer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConsoleLayout>
  );
}
