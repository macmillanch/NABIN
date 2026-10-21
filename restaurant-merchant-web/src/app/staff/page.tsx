'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { RESTAURANT_NAV } from '@/components/ConsoleLayout';
import { PlusIcon, RefreshIcon, StaffIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { rmsApi, type RestaurantStaff } from '@/lib/api';
import { dateTime, toFailure } from '@/lib/format';

const ROLE_PERMISSIONS: Record<string, { label: string; desc: string; badge: string }> = {
  OWNER: {
    label: 'Owner',
    desc: 'Full administrative authority, RMS configuration, finance & staff control.',
    badge: 'primary',
  },
  MANAGER: {
    label: 'Manager',
    desc: 'Operational management, floor management, menu prices & staff coordination.',
    badge: 'primary',
  },
  CASHIER: {
    label: 'Cashier',
    desc: 'Bill generation, splits, payment recording (Cash/POS/UPI), and receipts.',
    badge: 'success',
  },
  WAITER: {
    label: 'Waiter / Service',
    desc: 'Table seating, opening dining sessions, staff-assisted ordering.',
    badge: 'warning',
  },
  KITCHEN_STAFF: {
    label: 'Kitchen Staff',
    desc: 'Kitchen Display System (KDS), cooking status, mark food ready.',
    badge: 'neutral',
  },
  INVENTORY_STAFF: {
    label: 'Inventory Staff',
    desc: 'Stock adjustments, ingredient tracking, mark items sold-out.',
    badge: 'neutral',
  },
};

export default function StaffPage() {
  const { merchant, loading } = useMerchant();
  const router = useRouter();
  const merchantId = merchant?.id;

  const [staff, setStaff] = useState<RestaurantStaff[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Add staff modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<string>('WAITER');

  const loadStaff = useCallback(async () => {
    if (!merchantId) return;
    setPending(true);
    try {
      const res = await rmsApi.getStaff(merchantId);
      setStaff(res.data.staff || []);
      setError('');
    } catch (err) {
      setError(toFailure(err, 'Failed to fetch restaurant staff.').message);
    } finally {
      setPending(false);
    }
  }, [merchantId]);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!merchantId || !name.trim()) return;
    try {
      await rmsApi.createStaff(merchantId, {
        name: name.trim(),
        phone: phone.trim() || undefined,
        role,
      });
      setShowAddModal(false);
      setName('');
      setPhone('');
      setSuccessMsg(`Staff member ${name} created with role ${role}.`);
      void loadStaff();
    } catch (err) {
      setError(toFailure(err, 'Failed to add staff member.').message);
    }
  };

  const handleDeleteStaff = async (staffId: string) => {
    if (!merchantId) return;
    if (!confirm('Are you sure you want to deactivate this staff account?')) return;
    try {
      await rmsApi.deleteStaff(merchantId, staffId);
      setSuccessMsg('Staff member deactivated successfully.');
      void loadStaff();
    } catch (err) {
      setError(toFailure(err, 'Could not deactivate staff member.').message);
    }
  };

  return (
    <ConsoleLayout title="Staff & Roles" roleLabel="Restaurant" nav={RESTAURANT_NAV}>
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
            <h1 style={{ fontSize: 22, fontWeight: 900 }}>Restaurant Staff & Role Permissions</h1>
            <p className="nabin-cell-meta">
              Enforce server-side Role-Based Access Control (RBAC) across floor, cash counter, kitchen, and inventory.
            </p>
          </div>
          <div className="nabin-row">
            <button onClick={() => void loadStaff()} className="nabin-btn nabin-btn--ghost" aria-label="Refresh">
              <RefreshIcon />
              <span>Refresh</span>
            </button>
            <button onClick={() => setShowAddModal(true)} className="nabin-btn nabin-btn--primary">
              <PlusIcon />
              <span>Add Staff</span>
            </button>
          </div>
        </header>

        {/* Roles Reference Grid */}
        <div className="nabin-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {Object.entries(ROLE_PERMISSIONS).map(([k, v]) => (
            <div key={k} className="nabin-card" style={{ background: '#f8fafc', padding: 12 }}>
              <div className="nabin-row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <strong style={{ fontSize: 14 }}>{v.label}</strong>
                <span className={`nabin-badge nabin-badge--${v.badge}`}>{k}</span>
              </div>
              <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>{v.desc}</p>
            </div>
          ))}
        </div>

        {/* Staff Table */}
        <div className="nabin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Staff Name</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Phone</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Role</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Permissions</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700 }}>Created</th>
                  <th style={{ padding: '12px 16px', fontWeight: 700, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending && !staff.length ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                      Loading restaurant staff...
                    </td>
                  </tr>
                ) : staff.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                      No staff members assigned yet. Click &quot;Add Staff&quot; to invite a team member.
                    </td>
                  </tr>
                ) : (
                  staff.map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 700 }}>
                        <div className="nabin-row" style={{ gap: 8 }}>
                          <span className="nabin-avatar" style={{ width: 30, height: 30, fontSize: 12 }}>
                            {s.name.slice(0, 1).toUpperCase()}
                          </span>
                          <div>
                            <div>{s.name}</div>
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>ID: {s.id}</span>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>{s.phone || '—'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className={`nabin-badge nabin-badge--${ROLE_PERMISSIONS[s.role]?.badge || 'neutral'}`}>
                          {s.role}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#475569', fontSize: 12 }}>
                        {s.permissions && s.permissions.length > 0
                          ? s.permissions.join(', ')
                          : ROLE_PERMISSIONS[s.role]?.desc}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>
                        {dateTime(s.created_at)}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        {s.role !== 'OWNER' && (
                          <button
                            onClick={() => handleDeleteStaff(s.id)}
                            className="nabin-btn nabin-btn--ghost"
                            style={{ color: '#dc2626', padding: '4px 8px', fontSize: 12, minHeight: 28 }}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add Staff Modal */}
      {showAddModal && (
        <div className="nabin-scrim" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="nabin-card" style={{ maxWidth: 420, width: '90%', margin: 16 }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Add Restaurant Staff Member</h3>
            <p className="nabin-cell-meta" style={{ marginBottom: 16 }}>
              Select a specialized role with server-enforced permissions.
            </p>
            <form onSubmit={handleCreateStaff} className="nabin-stack" style={{ gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Mohanty"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Phone Number</label>
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Role & Permissions *</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
                >
                  <option value="MANAGER">Manager (Operations & Floor)</option>
                  <option value="CASHIER">Cashier (Bills, Splits & Payments)</option>
                  <option value="WAITER">Waiter (Dine-In Seating & Orders)</option>
                  <option value="KITCHEN_STAFF">Kitchen Staff (KDS & Prep)</option>
                  <option value="INVENTORY_STAFF">Inventory Staff (Stock & Supplies)</option>
                </select>
              </div>
              <div className="nabin-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="nabin-btn nabin-btn--ghost"
                >
                  Cancel
                </button>
                <button type="submit" className="nabin-btn nabin-btn--primary">
                  Add Staff Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ConsoleLayout>
  );
}
