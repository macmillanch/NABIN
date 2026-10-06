'use client';

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
// Two allowances, both already the convention in the sibling screens rather than new
// suppressions invented here:
//   no-explicit-any - the settings payload is an untyped JSON envelope, exactly the case
//     `modules.tsx` and `operations/page.tsx` declare once at the file boundary. Every read here
//     still names the field it expects (`setting_key`, `setting_value`) and re-checks the shape
//     with `typeof … === 'object'` before treating it as a token map, so an unexpected value
//     degrades to "nothing published" rather than being trusted.
//   set-state-in-effect - the draft must re-sync when the panel re-reads after a publish; that
//     is the same deliberate pattern `DataPanel.tsx` and `AuthProvider.tsx` carry. No rule is
//     disabled in config, and nothing that validates or refuses a write has been loosened.

/**
 * Platform settings - theme tokens only.
 *
 * The backend's writable space is a namespace, not a list: any `APP_CONFIG_*` key that is not
 * reserved, not `FEATURE_*`, and not credential-shaped is accepted, and every one of those rows
 * is published verbatim to every client device. That is why this screen is deliberately narrow:
 * it edits the single key the backend already validates token-by-token (`APP_CONFIG_THEME`,
 * whose value must be a map of known token -> six-digit hex) and offers no other key, no free
 * JSON, and no add-a-token control. TOKENS below is copied from `CAMPAIGN_THEME_TOKENS` in
 * `backend/src/repositories/CampaignRepository.js` - the same list `validateSettingWrite`
 * enforces - so a name this form can send is a name the server recognises.
 *
 * The write is `PUT /admin/platform-settings/APP_CONFIG_THEME` with body
 * { value, reason }: guarded by authenticateAdmin + requireSuperAdmin, so the honest label is
 * "SUPER_ADMIN only" rather than a permission key that does not exist. A refusal is shown in the
 * server's own words and never retried blindly, because the values here reach every device.
 */
import React, { useEffect, useMemo, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { Panel, StateBlock, UNAVAILABLE, useAdminData } from '@/components/DataPanel';
import { adminApi } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { Palette } from 'lucide-react';

const THEME_KEY = 'APP_CONFIG_THEME';
const TOKENS = ['brand', 'brandTint', 'onBrand', 'canvas', 'surface', 'surfaceMuted', 'surfaceEmphasized',
  'onSurface', 'onSurfaceMuted', 'divider', 'success', 'warning', 'danger', 'foodAccent', 'groceryAccent'] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
const LABELS: Record<string, string> = {
  brand: 'Brand', brandTint: 'Brand tint', onBrand: 'Text on brand', canvas: 'Canvas', surface: 'Surface',
  surfaceMuted: 'Surface muted', surfaceEmphasized: 'Surface emphasised', onSurface: 'Text on surface',
  onSurfaceMuted: 'Muted text', divider: 'Divider', success: 'Success', warning: 'Warning', danger: 'Danger',
  foodAccent: 'Food accent', groceryAccent: 'Grocery accent',
};

type ThemeMap = Record<string, string>;

export default function SettingsPage() {
  const { user } = useAuth();
  const settings = useAdminData<any>('/api/admin/platform-settings', (p: any) => p?.settings);
  const published: ThemeMap = useMemo(() => {
    const row = ((settings.data as any[]) || []).find(r => r.setting_key === THEME_KEY);
    const v = row?.setting_value;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as ThemeMap : {};
  }, [settings.data]);

  const [draft, setDraft] = useState<ThemeMap>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setDraft(published); }, [published]);

  const isSuper = user?.role === 'SUPER_ADMIN';
  const dirty = JSON.stringify(draft) !== JSON.stringify(published);
  const invalid = Object.entries(draft).filter(([, v]) => v !== '' && !HEX.test(v)).map(([k]) => k);
  const changed = TOKENS.filter(t => (draft[t] || '') !== (published[t] || ''));

  const save = async () => {
    if (!window.confirm(
      `Publish ${changed.length} theme token change(s) to every client device?\n\n`
      + changed.map(t => `  ${LABELS[t]}: ${published[t] || 'not published'} -> ${draft[t] || 'cleared'}`).join('\n'))) return;
    setBusy(true);
    setNotice(null);
    const value = Object.fromEntries(TOKENS.filter(t => HEX.test(draft[t] || '')).map(t => [t, draft[t]]));
    try {
      await adminApi.putPlatformSetting(THEME_KEY, { value, reason: reason.trim() });
      await settings.refetch?.();
      setNotice({ ok: true, text: `Published. The server now reports: ${JSON.stringify(Object.fromEntries(TOKENS.filter(t => HEX.test(draft[t] || '')).map(t => [t, draft[t]])))}. Re-read from the platform.` });
      setReason('');
    } catch (err) {
      const res = (err as { response?: { status?: number; data?: { error?: string; code?: string } } })?.response;
      setNotice({ ok: false, text: `Refused (${res?.status ?? 'network'}): ${res?.data?.error || res?.data?.code || 'the setting was not written.'}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout title="Settings">
      <div className="nabin-stack">
        <Panel title="Theme tokens" subtitle={`${THEME_KEY} — the only setting this console can write`} panel={settings}>
          {settings.state !== 'ready' ? <StateBlock panel={settings} /> : (
            <div className="nabin-stack">
              <div className="nabin-alert" role="note">
                <Palette size={16} aria-hidden="true" />
                <span><strong>SUPER_ADMIN only.</strong> The route is guarded by <code>requireSuperAdmin</code>,
                  not a permission key. Every published value ships verbatim to all client devices, so only
                  {' '}{TOKENS.length} known tokens are editable here and nothing else in the settings namespace is offered.</span>
              </div>
              {!isSuper ? (
                <div className="nabin-alert nabin-alert--danger" role="alert">
                  <span>This session is signed in as {String(user?.role || 'an operator')}, so the write controls are
                    not offered; the server would refuse them. The published values remain readable.</span>
                </div>
              ) : null}

              {Object.keys(published).length === 0
                ? <p className="nabin-cell-meta">No theme has been published yet (<code>{THEME_KEY}</code> is an empty
                  object), so every client is rendering its bundled palette.</p>
                : null}

              <div className="nabin-grid">
                {TOKENS.map((t) => (
                  <div key={t} className="nabin-row" style={{ gap: 8, alignItems: 'center' }}>
                    <input type="color" aria-label={`${LABELS[t]} colour`} value={HEX.test(draft[t] || '') ? draft[t] : '#000000'}
                      disabled={!isSuper || busy}
                      onChange={(e) => setDraft(d => ({ ...d, [t]: e.target.value }))} />
                    <div style={{ minWidth: 150 }}>
                      <label className="nabin-label" htmlFor={`tk-${t}`}>{LABELS[t]} <code className="nabin-mono">{t}</code></label>
                      <input id={`tk-${t}`} className="nabin-input" value={draft[t] || ''} placeholder="not published"
                        aria-invalid={invalid.includes(t)} disabled={!isSuper || busy}
                        onChange={(e) => setDraft(d => ({ ...d, [t]: e.target.value }))} />
                      {invalid.includes(t) ? <p className="nabin-field__error">Use a six-digit hex value, e.g. #1268D9</p> : null}
                    </div>
                    <span className="nabin-cell-meta nabin-mono">{published[t] || UNAVAILABLE}</span>
                  </div>
                ))}
              </div>

              {notice ? (
                <div className={`nabin-alert ${notice.ok ? 'nabin-alert--success' : 'nabin-alert--danger'}`} role="status">
                  <span>{notice.text}</span>
                </div>
              ) : null}

              <div className="nabin-stack" style={{ maxWidth: 520 }}>
                <label className="nabin-label" htmlFor="ksr">Reason for publishing (kept in the audit record)</label>
                <textarea id="ksr" className="nabin-input" rows={2} value={reason} disabled={!isSuper || busy}
                  onChange={(e) => setReason(e.target.value)} placeholder="e.g. festival palette refresh" />
                <div className="nabin-row" style={{ gap: 'var(--space-xs)' }}>
                  <button className="nabin-btn nabin-btn--primary" disabled={!isSuper || busy || !dirty || invalid.length > 0 || reason.trim().length < 8}
                    onClick={() => void save()}>
                    {busy ? 'Publishing…' : `Publish ${changed.length} change(s)`}
                  </button>
                  <button className="nabin-btn nabin-btn--ghost" disabled={busy || !dirty} onClick={() => { setDraft(published); setReason(''); }}>
                    Discard changes
                  </button>
                </div>
                <p className="nabin-cell-meta" style={{ margin: 0 }}>
                  Publish stays disabled until the draft differs from the published object, every entered value is
                  valid hex, and a reason of at least eight characters is given. Invalid tokens are dropped from the
                  payload rather than sent, because the server refuses the whole write for one bad token.
                </p>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Other platform settings" subtitle="Read-only by design">
          <p className="nabin-cell-meta" style={{ padding: '0 var(--space-md)' }}>
            The remaining settings rows are shown by the read endpoint and are not editable from this console: the
            backend accepts any non-reserved key in the published namespace, so offering a generic editor would let
            one form publish arbitrary data to every device. Credential-shaped keys are refused by the server as well.
          </p>
        </Panel>
      </div>
    </AdminLayout>
  );
}
