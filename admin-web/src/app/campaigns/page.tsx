'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Eye, Megaphone, Plus } from 'lucide-react';
import AdminLayout from '@/components/AdminLayout';
import CampaignEditor from '@/components/CampaignEditor';
import ResourceTable, { StatusBadge, type Column } from '@/components/ResourceTable';
import { useConfirmAction, type Confirmation } from '@/components/ConfirmAction';
import { adminApi } from '@/lib/api';
import {
  CAMPAIGN_SERVICE_TYPES,
  CAMPAIGN_STATUSES,
  asCampaign,
  formatDiscount,
  newCampaign,
  shortDateTime,
  toPayload,
  type Campaign,
  type PromotionOption,
} from '@/lib/campaigns';

type Filter = 'ALL' | (typeof CAMPAIGN_STATUSES)[number];

interface ErrorBody {
  error?: unknown;
  details?: { errors?: unknown };
  allowedTransitions?: unknown;
}

/**
 * The campaign routes answer a refusal with the field names they refused, and a
 * rejected state change with the transitions that were available. Both go straight to
 * the operator rather than being re-derived here.
 */
function readError(err: unknown, fallback: string) {
  const data = (err as { response?: { data?: ErrorBody } })?.response?.data;
  const message = typeof data?.error === 'string' ? data.error : fallback;
  const listed = data?.details && Array.isArray(data.details.errors) ? data.details.errors.map(String) : [];
  const allowed = data && Array.isArray(data.allowedTransitions) ? data.allowedTransitions.map(String) : [];
  return {
    message: allowed.length ? `${message} Allowed from here: ${allowed.join(', ')}.` : message,
    errors: listed.length ? listed : [message],
  };
}

export default function CampaignsPage() {
  const confirm = useConfirmAction();
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [promotions, setPromotions] = useState<PromotionOption[]>([]);
  const [couponsUnavailable, setCouponsUnavailable] = useState(false);

  const [editing, setEditing] = useState<{ campaign: Campaign; isNew: boolean } | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [live, setLive] = useState<{ resolvedAt: string; campaigns: Campaign[] } | null>(null);
  const [liveService, setLiveService] = useState<'ALL' | (typeof CAMPAIGN_SERVICE_TYPES)[number]>('ALL');
  const [liveBusy, setLiveBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getCampaigns();
      setRows(((res.data.campaigns ?? []) as Campaign[]).map(asCampaign));
      setError(null);
    } catch {
      setError('Could not load campaigns.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Every state update in these loaders lands after an await, so this is not the
    // cascading render the rule warns about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // The coupon list is only needed to fill the offer picker, and a role without
    // promotion.view is entitled to manage campaigns without seeing it.
    adminApi
      .getPromotions({ limit: '100' })
      .then((res) => setPromotions((res.data.promotions ?? []) as PromotionOption[]))
      .catch(() => setCouponsUnavailable(true));
  }, [load]);

  async function afterWrite(message: string) {
    setFlash(message);
    setActionError(null);
    await load();
  }

  function startNew() {
    setFormErrors([]);
    setEditing({ campaign: newCampaign(), isNew: true });
  }

  async function openEditor(campaign: Campaign) {
    setFormErrors([]);
    setBusyKey(campaign.id ?? campaign.code);
    try {
      const res = await adminApi.getCampaign(campaign.id ?? campaign.code);
      setEditing({ campaign: asCampaign(res.data.campaign as Campaign), isNew: false });
    } catch (err) {
      // Editing from the list row would show an empty theme, assets and offers, and
      // saving replaces those sections wholesale — so a failed read closes the door
      // rather than opening a form that could wipe the campaign's face.
      setActionError(readError(err, `Could not open ${campaign.code} for editing.`).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function save(draft: Campaign) {
    setSaving(true);
    setFormErrors([]);
    const payload = toPayload(draft);
    try {
      if (editing?.isNew) {
        await adminApi.createCampaign(payload);
        await afterWrite(`Campaign ${payload.code} saved. It reaches the apps once it is ACTIVE and inside its window.`);
      } else {
        await adminApi.updateCampaign(draft.id ?? draft.code, payload, draft.updatedAt);
        await afterWrite(`Campaign ${payload.code} updated. The config feed was refreshed on the server.`);
      }
      setEditing(null);
    } catch (err) {
      setFormErrors(readError(err, 'The campaign was not saved.').errors);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(campaign: Campaign, status: string) {
    setBusyKey(campaign.id ?? campaign.code);
    try {
      await adminApi.setCampaignStatus(campaign.id ?? campaign.code, status);
      await afterWrite(`${campaign.code} is now ${status}.`);
    } catch (err) {
      setActionError(readError(err, `Could not change ${campaign.code}.`).message);
    } finally {
      setBusyKey(null);
    }
  }

  // Area 49. The three transitions that change what a customer sees right now, or that
  // cannot be taken back, are confirmed; DRAFT and SCHEDULED are not, because a campaign
  // in neither state has reached an app yet and both are one click from here.
  function confirmationFor(campaign: Campaign, status: string): Confirmation | null {
    const code = campaign.code || campaign.id;
    const targets = campaign.serviceTypes.length ? campaign.serviceTypes.join(', ') : 'every service';
    if (status === 'ACTIVE') {
      return {
        title: `Publish ${code}`,
        effect: `This campaign's theme, logo, banners, messages and offer chips are served to apps for ${targets} on their next config refresh.`,
        consequences: [
          'Only inside its window — before the start date it stays scheduled and unseen.',
          'At most five live campaigns are served, highest priority first, so a higher-priority one can still win the slot.',
          'The coupon behind an offer is untouched: it discounts a checkout only if that coupon is itself active.',
          'Reversible — pausing or archiving takes it back out.',
        ],
        confirmLabel: 'Publish campaign',
        tone: 'warning',
      };
    }
    if (status === 'PAUSED') {
      return {
        title: `Pause ${code}`,
        effect: 'The campaign stops being served to apps immediately, on every surface it appears on.',
        consequences: [
          'Its window keeps running while paused.',
          'Resuming only brings it back while that window is still open; after the end date it reads as expired.',
          'Orders already placed under it are unchanged.',
        ],
        confirmLabel: 'Pause campaign',
        tone: 'danger',
      };
    }
    if (status === 'ARCHIVED') {
      return {
        title: `Archive ${code}`,
        effect: 'The campaign leaves every app immediately, and this is the one state with no way back.',
        consequences: [
          'Archived is terminal: running this promotion again means authoring a new campaign.',
          'The row is kept, so the audit trail and its redemption history still read it.',
          'Orders already placed under it are unchanged.',
        ],
        confirmLabel: 'Archive campaign',
        tone: 'danger',
      };
    }
    return null;
  }

  async function changeStatus(campaign: Campaign, status: string) {
    const spec = confirmationFor(campaign, status);
    if (spec && !(await confirm(spec))) return;
    await setStatus(campaign, status);
  }

  async function previewLive(serviceType: string) {
    setLiveBusy(true);
    try {
      const res = await adminApi.getLiveCampaigns(serviceType === 'ALL' ? undefined : serviceType);
      setLive({
        resolvedAt: String(res.data.resolvedAt ?? new Date().toISOString()),
        campaigns: ((res.data.campaigns ?? []) as Campaign[]).map(asCampaign),
      });
      setActionError(null);
    } catch {
      setActionError('Could not resolve the live campaigns.');
    } finally {
      setLiveBusy(false);
    }
  }

  const visible = filter === 'ALL' ? rows : rows.filter((c) => c.status === filter);

  const columns: Column<Campaign>[] = [
    {
      key: 'name',
      label: 'Campaign',
      render: (c) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-title">{c.name || c.code}</span>
          <span className="nabin-cell-meta">
            {c.code} · priority {c.priority}
          </span>
        </div>
      ),
    },
    {
      key: 'state',
      label: 'State',
      render: (c) => (
        <div className="nabin-cell-stack">
          <StatusBadge value={c.effectiveStatus} />
          <span className="nabin-cell-meta">
            {c.effectiveStatus === c.status ? 'as set' : `set to ${c.status}`}
            {c.isActive ? '' : ' · held back'}
          </span>
        </div>
      ),
    },
    {
      key: 'window',
      label: 'Window',
      hideBelow: 'md',
      render: (c) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-meta">{shortDateTime(c.startsAt)}</span>
          <span className="nabin-cell-meta">to {shortDateTime(c.endsAt)}</span>
        </div>
      ),
    },
    {
      key: 'services',
      label: 'Targets',
      hideBelow: 'sm',
      render: (c) => (
        <span className="nabin-cell-meta">
          {c.serviceTypes.length ? c.serviceTypes.join(', ') : 'All services'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'end',
      render: (c) => (
        <div className="nabin-row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            onClick={() => openEditor(c)}
            disabled={busyKey === (c.id ?? c.code)}
            className="nabin-btn nabin-btn--ghost"
            style={{ minHeight: 40 }}
          >
            {busyKey === (c.id ?? c.code) ? 'Opening…' : 'Edit'}
          </button>
          {c.status === 'ARCHIVED' ? (
            <span className="nabin-cell-meta">Archived — author a new campaign to run it again.</span>
          ) : (
            CAMPAIGN_STATUSES.filter((s) => s !== c.status).map((s) => (
              <button
                key={s}
                onClick={() => changeStatus(c, s)}
                disabled={busyKey === (c.id ?? c.code)}
                className={`nabin-chip ${s === 'ACTIVE' ? 'is-active' : ''}`}
              >
                {s.toLowerCase()}
              </button>
            ))
          )}
        </div>
      ),
    },
  ];

  return (
    <AdminLayout title="Campaigns">
      <div className="nabin-page-head">
        <div>
          <h1>
            <Megaphone size={22} aria-hidden style={{ verticalAlign: -3, marginRight: 8 }} />
            Festivals, themes and offers
          </h1>
          <p>{loading ? 'Loading…' : `${visible.length} of ${rows.length} campaigns`}</p>
        </div>
        <div className="nabin-row" style={{ flexWrap: 'wrap' }}>
          <button onClick={load} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
            Refresh
          </button>
          <button onClick={startNew} className="nabin-btn nabin-btn--primary" style={{ minHeight: 40 }}>
            <Plus size={16} />
            <span>New campaign</span>
          </button>
        </div>
      </div>

      {flash && (
        <div className="nabin-alert nabin-alert--success" role="status">
          <span>{flash}</span>
        </div>
      )}
      {actionError && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="nabin-alert__action">
            Dismiss
          </button>
        </div>
      )}

      {editing ? (
        <CampaignEditor
          key={editing.campaign.id ?? editing.campaign.code ?? 'new'}
          campaign={editing.campaign}
          isNew={editing.isNew}
          promotions={promotions}
          couponsUnavailable={couponsUnavailable}
          errors={formErrors}
          saving={saving}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="nabin-stack">
          <div className="nabin-row" role="group" aria-label="Filter by state" style={{ flexWrap: 'wrap' }}>
            {(['ALL', ...CAMPAIGN_STATUSES] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`nabin-chip ${filter === f ? 'is-active' : ''}`}
                aria-pressed={filter === f}
              >
                {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <ResourceTable
            columns={columns}
            rows={visible}
            rowKey={(c) => c.id ?? c.code}
            loading={loading}
            error={error}
            onRetry={load}
            emptyTitle="No campaigns yet"
            emptyBody="Create one to publish a festival theme, a logo, banners or per-service offers without shipping a new build."
          />

          <section className="nabin-card">
            <div className="nabin-card__header">
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 900 }}>What the apps are served right now</h3>
                <p className="nabin-cell-meta">
                  Resolved by the database clock, not by a browser or a device. The feed carries at most five live
                  campaigns, highest priority first.
                </p>
              </div>
              <div className="nabin-row" style={{ gap: 'var(--space-xs)' }}>
                <select
                  aria-label="Preview for service"
                  className="nabin-input"
                  style={{ width: 'auto' }}
                  value={liveService}
                  onChange={(e) => {
                    const next = e.target.value as typeof liveService;
                    setLiveService(next);
                    if (live) previewLive(next);
                  }}
                >
                  <option value="ALL">All services</option>
                  {CAMPAIGN_SERVICE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => previewLive(liveService)}
                  disabled={liveBusy}
                  className="nabin-btn nabin-btn--ghost"
                  style={{ minHeight: 40 }}
                >
                  <Eye size={16} />
                  <span>{liveBusy ? 'Checking…' : 'Preview'}</span>
                </button>
              </div>
            </div>

            {!live ? (
              <p className="nabin-cell-meta">
                Not checked yet. Preview after publishing to see exactly what a client will pull on its next config
                refresh.
              </p>
            ) : live.campaigns.length === 0 ? (
              <p className="nabin-cell-meta">
                Nothing is live for {liveService === 'ALL' ? 'any service' : liveService} as of{' '}
                {shortDateTime(live.resolvedAt)} — a client keeps the brand theme it ships with.
              </p>
            ) : (
              <div className="nabin-stack" style={{ gap: 'var(--space-sm)' }}>
                <p className="nabin-cell-meta">Resolved at {shortDateTime(live.resolvedAt)}</p>
                {live.campaigns.map((campaign) => (
                  <div key={campaign.id ?? campaign.code} className="nabin-row" style={{ flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                    <span className="nabin-cell-title">{campaign.name}</span>
                    <StatusBadge value={campaign.effectiveStatus} />
                    {Object.keys(campaign.theme.palette).length > 0 && (
                      <span className="nabin-chip">
                        {Object.keys(campaign.theme.palette).length} theme colours
                      </span>
                    )}
                    {campaign.assets.map((asset) => (
                      <span key={`${asset.kind}-${asset.url}`} className="nabin-chip">
                        {asset.kind.toLowerCase()}
                      </span>
                    ))}
                    {campaign.offers.map((offer) => (
                      <span key={`${offer.serviceType}-${offer.promotionId}`} className="nabin-chip is-active">
                        {offer.serviceType} ·{' '}
                        {formatDiscount(offer.coupon?.discountType, offer.coupon?.discountValue) ||
                          offer.coupon?.code ||
                          'coupon'}
                      </span>
                    ))}
                    {campaign.messages.map((message) => (
                      <span key={`${message.kind}-${message.title}`} className="nabin-chip">
                        {message.kind.toLowerCase()} · {message.surface}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
