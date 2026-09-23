'use client';

import React, { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { StatusBadge } from '@/components/ResourceTable';
import {
  CAMPAIGN_ASSET_KINDS,
  CAMPAIGN_MESSAGE_KINDS,
  CAMPAIGN_SERVICE_TYPES,
  CAMPAIGN_STATUSES,
  CAMPAIGN_THEME_TOKENS,
  CAMPAIGN_TRIGGER_EVENTS,
  couponLabel,
  formatDiscount,
  toLocalInput,
  type Campaign,
  type CampaignAsset,
  type CampaignMessage,
  type CampaignOffer,
  type PromotionOption,
} from '@/lib/campaigns';

interface Props {
  /** Normalised with `asCampaign`, so every bound field already has a value. */
  campaign: Campaign;
  isNew: boolean;
  promotions: PromotionOption[];
  couponsUnavailable: boolean;
  errors: string[];
  saving: boolean;
  onSave: (campaign: Campaign) => void;
  onCancel: () => void;
}

const ROW = { alignItems: 'flex-end', flexWrap: 'wrap' } as const;
const CELL = { flex: '1 1 170px', minWidth: 0 } as const;

function Field({
  id,
  label,
  hint,
  style,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div style={{ ...CELL, ...style }}>
      <label className="nabin-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="nabin-cell-meta" style={{ marginTop: 'var(--space-xxs)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  body,
  action,
  children,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="nabin-card">
      <div className="nabin-card__header">
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 900 }}>{title}</h3>
          <p className="nabin-cell-meta">{body}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="nabin-btn nabin-btn--ghost"
      style={{ minHeight: 'var(--target-min)', padding: '0 var(--space-sm)' }}
    >
      <Trash2 size={16} />
    </button>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="nabin-btn nabin-btn--ghost">
      <Plus size={16} />
      <span>{label}</span>
    </button>
  );
}

export default function CampaignEditor({
  campaign,
  isNew,
  promotions,
  couponsUnavailable,
  errors,
  saving,
  onSave,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState(campaign);

  const patch = (changes: Partial<Campaign>) => setDraft((d) => ({ ...d, ...changes }));

  const setAsset = (index: number, changes: Partial<CampaignAsset>) =>
    setDraft((d) => ({
      ...d,
      assets: d.assets.map((r, n) => (n === index ? { ...r, ...changes } : r)),
    }));

  const setOffer = (index: number, changes: Partial<CampaignOffer>) =>
    setDraft((d) => ({
      ...d,
      offers: d.offers.map((r, n) => (n === index ? { ...r, ...changes } : r)),
    }));

  const setMessage = (index: number, changes: Partial<CampaignMessage>) =>
    setDraft((d) => ({
      ...d,
      messages: d.messages.map((r, n) => (n === index ? { ...r, ...changes } : r)),
    }));

  const palette = draft.theme.palette;
  const setColor = (token: string, color: string) =>
    setDraft((d) => ({ ...d, theme: { ...d.theme, palette: { ...d.theme.palette, [token]: color } } }));

  const renameToken = (previous: string, next: string) =>
    setDraft((d) => {
      if (previous === next) return d;
      const merged = { ...d.theme.palette };
      merged[next] = merged[previous];
      delete merged[previous];
      return { ...d, theme: { ...d.theme, palette: merged } };
    });

  const dropToken = (token: string) =>
    setDraft((d) => {
      const merged = { ...d.theme.palette };
      delete merged[token];
      return { ...d, theme: { ...d.theme, palette: merged } };
    });

  const addToken = () => {
    const taken = new Set(Object.keys(palette));
    const next = CAMPAIGN_THEME_TOKENS.find((token) => !taken.has(token));
    if (next) setColor(next, '#0F5C2E');
  };

  const toggleService = (serviceType: string) =>
    setDraft((d) => ({
      ...d,
      serviceTypes: d.serviceTypes.includes(serviceType)
        ? d.serviceTypes.filter((s) => s !== serviceType)
        : [...d.serviceTypes, serviceType],
    }));

  // Reading `d` rather than the render's `draft` is what lets two clicks in the same
  // frame both append a row instead of one overwriting the other.
  const addAsset = () =>
    setDraft((d) => ({
      ...d,
      assets: [...d.assets, { kind: 'BANNER', url: '', altText: '', locale: 'en', priority: 0 }],
    }));

  const addOffer = () =>
    setDraft((d) => ({
      ...d,
      offers: [...d.offers, { serviceType: 'RIDE', promotionId: '', copy: '', priority: 0 }],
    }));

  const addMessage = () =>
    setDraft((d) => ({
      ...d,
      messages: [
        ...d.messages,
        {
          kind: 'ANNOUNCEMENT',
          title: '',
          body: '',
          surface: 'CUSTOMER_HOME',
          triggerEvent: 'APP_OPEN',
          dismissible: true,
          showOnce: false,
          locale: 'en',
          priority: 0,
        },
      ],
    }));

  const int = (value: string) => (value === '' ? 0 : Number(value));

  return (
    <form
      className="nabin-stack"
      onSubmit={(e) => {
        e.preventDefault();
        // Nothing here is checked twice: the campaign routes validate every field and
        // answer with the names of the ones they refused.
        onSave(draft);
      }}
    >
      {errors.length > 0 && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <div>
            <strong>The campaign was not saved.</strong>
            <ul style={{ margin: 'var(--space-xs) 0 0', paddingLeft: 20 }}>
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Section title="Identity" body="The code is what the apps and the audit log refer to, and it cannot be reused once taken.">
        <div className="nabin-row" style={ROW}>
          <Field id="campaign-name" label="Name">
            <input
              id="campaign-name"
              className="nabin-input"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Christmas 2026"
              maxLength={150}
              required
            />
          </Field>
          <Field id="campaign-code" label="Code" hint="A-Z 0-9 _ -, up to 40 characters.">
            <input
              id="campaign-code"
              className="nabin-input nabin-mono"
              value={draft.code}
              onChange={(e) => patch({ code: e.target.value.toUpperCase() })}
              placeholder="XMAS-2026"
              maxLength={40}
              required
            />
          </Field>
          <Field id="campaign-priority" label="Priority" hint="Highest priority wins where two campaigns overlap.">
            <input
              id="campaign-priority"
              className="nabin-input"
              type="number"
              min={-1000}
              max={1000}
              step={1}
              value={draft.priority}
              onChange={(e) => patch({ priority: int(e.target.value) })}
            />
          </Field>
          {isNew ? (
            <Field id="campaign-status" label="Initial state">
              <select
                id="campaign-status"
                className="nabin-input"
                value={draft.status}
                onChange={(e) => patch({ status: e.target.value })}
              >
                {CAMPAIGN_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field id="campaign-status" label="State" hint="Changed with the state buttons below, never by an edit.">
              <div className="nabin-row" style={{ gap: 'var(--space-xs)' }}>
                <StatusBadge value={draft.status} />
                <StatusBadge value={draft.effectiveStatus} />
              </div>
            </Field>
          )}
        </div>
        <div style={{ marginTop: 'var(--space-md)' }}>
          <Field id="campaign-description" label="Internal note" hint="Never shown to customers.">
            <input
              id="campaign-description"
              className="nabin-input"
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              maxLength={2000}
            />
          </Field>
        </div>
      </Section>

      <Section
        title="Schedule and targeting"
        body="Server time opens and closes the window; the apps cannot start a campaign early."
      >
        <div className="nabin-row" style={ROW}>
          <Field id="campaign-start" label="Starts">
            <input
              id="campaign-start"
              className="nabin-input"
              type="datetime-local"
              value={toLocalInput(draft.startsAt)}
              onChange={(e) => patch({ startsAt: e.target.value })}
            />
          </Field>
          <Field id="campaign-end" label="Ends">
            <input
              id="campaign-end"
              className="nabin-input"
              type="datetime-local"
              value={toLocalInput(draft.endsAt)}
              onChange={(e) => patch({ endsAt: e.target.value })}
            />
          </Field>
          <Field id="campaign-serving" label="Serving" hint="Switching this off pauses the campaign regardless of its window.">
            <select
              id="campaign-serving"
              className="nabin-input"
              value={draft.isActive ? 'serving' : 'held'}
              onChange={(e) => patch({ isActive: e.target.value === 'serving' })}
            >
              <option value="serving">Serving while live</option>
              <option value="held">Held back</option>
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 'var(--space-md)' }}>
          <span className="nabin-label">Services</span>
          <div className="nabin-row" role="group" aria-label="Target services">
            {CAMPAIGN_SERVICE_TYPES.map((serviceType) => {
              const on = draft.serviceTypes.includes(serviceType);
              return (
                <button
                  key={serviceType}
                  type="button"
                  onClick={() => toggleService(serviceType)}
                  aria-pressed={on}
                  className={`nabin-chip ${on ? 'is-active' : ''}`}
                >
                  {serviceType}
                </button>
              );
            })}
          </div>
          <p className="nabin-cell-meta" style={{ marginTop: 'var(--space-xxs)' }}>
            {draft.serviceTypes.length === 0
              ? 'No service selected: this campaign is platform-wide.'
              : `Limited to ${draft.serviceTypes.join(', ')}.`}
          </p>
        </div>
      </Section>

      <Section
        title="Theme"
        body="Colours that repaint the apps over the published brand palette. Every token you leave out stays as the brand set it."
        action={
          <AddButton
            onClick={addToken}
            label="Add colour"
          />
        }
      >
        {Object.keys(palette).length === 0 ? (
          <p className="nabin-cell-meta">No colours overridden — the campaign carries banners and offers only.</p>
        ) : (
          <div className="nabin-stack" style={{ gap: 'var(--space-sm)' }}>
            {Object.entries(palette).map(([token, color]) => (
              <div key={token} className="nabin-row" style={ROW}>
                <Field id={`token-${token}`} label="Token">
                  <select
                    id={`token-${token}`}
                    className="nabin-input"
                    value={token}
                    onChange={(e) => renameToken(token, e.target.value)}
                  >
                    {CAMPAIGN_THEME_TOKENS.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {candidate}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id={`color-${token}`} label="Colour" hint={color}>
                  <input
                    id={`color-${token}`}
                    className="nabin-input"
                    type="color"
                    value={color}
                    onChange={(e) => setColor(token, e.target.value)}
                    style={{ minHeight: 'var(--target-min)', padding: 4 }}
                  />
                </Field>
                <RemoveButton onClick={() => dropToken(token)} label={`Remove ${token}`} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Assets"
        body="Logo, wordmark, banner and splash images by URL. A LOGO or WORDMARK here is what the apps put in the title bar — no new build needed."
        action={<AddButton onClick={addAsset} label="Add asset" />}
      >
        {draft.assets.length === 0 ? (
          <p className="nabin-cell-meta">No assets yet.</p>
        ) : (
          <div className="nabin-stack" style={{ gap: 'var(--space-sm)' }}>
            {draft.assets.map((asset, index) => (
              <div key={`${asset.kind}-${index}`} className="nabin-row" style={ROW}>
                <Field id={`asset-kind-${index}`} label="Kind">
                  <select
                    id={`asset-kind-${index}`}
                    className="nabin-input"
                    value={asset.kind}
                    onChange={(e) => setAsset(index, { kind: e.target.value })}
                  >
                    {CAMPAIGN_ASSET_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  id={`asset-url-${index}`}
                  label="URL"
                  hint="https only. Point it at Cloudinary or your own CDN."
                  style={{ flex: '3 1 320px', minWidth: 0 }}
                >
                  <input
                    id={`asset-url-${index}`}
                    className="nabin-input nabin-mono"
                    value={asset.url}
                    onChange={(e) => setAsset(index, { url: e.target.value })}
                    placeholder="https://res.cloudinary.com/…/christmas-banner.png"
                  />
                </Field>
                <Field id={`asset-alt-${index}`} label="Alt text">
                  <input
                    id={`asset-alt-${index}`}
                    className="nabin-input"
                    value={asset.altText}
                    onChange={(e) => setAsset(index, { altText: e.target.value })}
                    maxLength={200}
                  />
                </Field>
                <Field id={`asset-locale-${index}`} label="Locale">
                  <input
                    id={`asset-locale-${index}`}
                    className="nabin-input"
                    value={asset.locale}
                    onChange={(e) => setAsset(index, { locale: e.target.value })}
                    maxLength={10}
                  />
                </Field>
                <Field id={`asset-priority-${index}`} label="Priority">
                  <input
                    id={`asset-priority-${index}`}
                    className="nabin-input"
                    type="number"
                    step={1}
                    value={asset.priority}
                    onChange={(e) => setAsset(index, { priority: int(e.target.value) })}
                  />
                </Field>
                <RemoveButton onClick={() => patch({ assets: draft.assets.filter((_, n) => n !== index) })} label={`Remove asset ${index + 1}`} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Offers"
        body="One row per service: the coupon it points at is the same row checkout already redeems, so there is never a second discount number to fall out of step."
        action={<AddButton onClick={addOffer} label="Add offer" />}
      >
        {couponsUnavailable && (
          <p className="nabin-cell-meta" style={{ marginBottom: 'var(--space-sm)' }}>
            The coupon list could not be read (it needs promotion.view). A coupon id still works if you have one.
          </p>
        )}
        {draft.offers.length === 0 ? (
          <p className="nabin-cell-meta">No offers — this campaign is decoration only.</p>
        ) : (
          <div className="nabin-stack" style={{ gap: 'var(--space-sm)' }}>
            {draft.offers.map((offer, index) => {
              const chosen = promotions.find((p) => p.id === offer.promotionId);
              const terms = formatDiscount(
                chosen?.discountType ?? offer.coupon?.discountType,
                chosen?.discountValue ?? offer.coupon?.discountValue,
              );
              return (
                <div key={`offer-${index}`} className="nabin-row" style={ROW}>
                  <Field id={`offer-service-${index}`} label="Service">
                    <select
                      id={`offer-service-${index}`}
                      className="nabin-input"
                      value={offer.serviceType}
                      onChange={(e) => setOffer(index, { serviceType: e.target.value })}
                    >
                      {CAMPAIGN_SERVICE_TYPES.map((serviceType) => (
                        <option key={serviceType} value={serviceType}>
                          {serviceType}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    id={`offer-coupon-${index}`}
                    label="Coupon"
                    hint={terms || 'Pick the coupon this campaign advertises.'}
                  >
                    <select
                      id={`offer-coupon-${index}`}
                      className="nabin-input"
                      value={offer.promotionId}
                      onChange={(e) => setOffer(index, { promotionId: e.target.value })}
                      required
                    >
                      <option value="">Select a coupon…</option>
                      {offer.promotionId && !chosen && (
                        <option value={offer.promotionId}>
                          {offer.coupon?.code ?? 'Coupon outside the loaded list'}
                        </option>
                      )}
                      {promotions.map((promotion) => (
                        <option key={promotion.id} value={promotion.id}>
                          {couponLabel(promotion)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id={`offer-copy-${index}`} label="Shelf copy" hint="Optional line above the offer.">
                    <input
                      id={`offer-copy-${index}`}
                      className="nabin-input"
                      value={offer.copy}
                      onChange={(e) => setOffer(index, { copy: e.target.value })}
                      maxLength={150}
                    />
                  </Field>
                  <Field id={`offer-priority-${index}`} label="Priority">
                    <input
                      id={`offer-priority-${index}`}
                      className="nabin-input"
                      type="number"
                      step={1}
                      value={offer.priority}
                      onChange={(e) => setOffer(index, { priority: int(e.target.value) })}
                    />
                  </Field>
                  <RemoveButton
                    onClick={() => patch({ offers: draft.offers.filter((_, n) => n !== index) })}
                    label={`Remove offer ${index + 1}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Messages"
        body="Announcements, popups, inline banners and toasts. A message is only shown on a surface an app actually listens to — today that is CUSTOMER_HOME."
        action={<AddButton onClick={addMessage} label="Add message" />}
      >
        {draft.messages.length === 0 ? (
          <p className="nabin-cell-meta">No messages.</p>
        ) : (
          <div className="nabin-stack" style={{ gap: 'var(--space-sm)' }}>
            {draft.messages.map((message, index) => (
              <div key={`message-${index}`} className="nabin-card" style={{ padding: 'var(--space-md)' }}>
                <div className="nabin-row" style={ROW}>
                  <Field id={`message-kind-${index}`} label="Kind">
                    <select
                      id={`message-kind-${index}`}
                      className="nabin-input"
                      value={message.kind}
                      onChange={(e) => setMessage(index, { kind: e.target.value })}
                    >
                      {CAMPAIGN_MESSAGE_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id={`message-surface-${index}`} label="Surface">
                    <input
                      id={`message-surface-${index}`}
                      className="nabin-input nabin-mono"
                      value={message.surface}
                      onChange={(e) => setMessage(index, { surface: e.target.value.toUpperCase() })}
                      maxLength={40}
                    />
                  </Field>
                  <Field id={`message-trigger-${index}`} label="Trigger">
                    <select
                      id={`message-trigger-${index}`}
                      className="nabin-input"
                      value={message.triggerEvent}
                      onChange={(e) => setMessage(index, { triggerEvent: e.target.value })}
                    >
                      {CAMPAIGN_TRIGGER_EVENTS.map((trigger) => (
                        <option key={trigger} value={trigger}>
                          {trigger}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id={`message-locale-${index}`} label="Locale">
                    <input
                      id={`message-locale-${index}`}
                      className="nabin-input"
                      value={message.locale}
                      onChange={(e) => setMessage(index, { locale: e.target.value })}
                      maxLength={10}
                    />
                  </Field>
                  <Field id={`message-priority-${index}`} label="Priority">
                    <input
                      id={`message-priority-${index}`}
                      className="nabin-input"
                      type="number"
                      step={1}
                      value={message.priority}
                      onChange={(e) => setMessage(index, { priority: int(e.target.value) })}
                    />
                  </Field>
                  <RemoveButton
                    onClick={() => patch({ messages: draft.messages.filter((_, n) => n !== index) })}
                    label={`Remove message ${index + 1}`}
                  />
                </div>
                <div style={{ marginTop: 'var(--space-sm)' }}>
                  <Field id={`message-title-${index}`} label="Title">
                    <input
                      id={`message-title-${index}`}
                      className="nabin-input"
                      value={message.title}
                      onChange={(e) => setMessage(index, { title: e.target.value })}
                      maxLength={150}
                      required
                    />
                  </Field>
                </div>
                <div style={{ marginTop: 'var(--space-sm)' }}>
                  <Field id={`message-body-${index}`} label="Body">
                    <textarea
                      id={`message-body-${index}`}
                      className="nabin-input"
                      rows={2}
                      value={message.body}
                      onChange={(e) => setMessage(index, { body: e.target.value })}
                      required
                    />
                  </Field>
                </div>
                <div className="nabin-row" style={{ marginTop: 'var(--space-sm)' }}>
                  <label className="nabin-row" style={{ gap: 'var(--space-xxs)', fontSize: 13, fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={message.dismissible}
                      onChange={(e) => setMessage(index, { dismissible: e.target.checked })}
                    />
                    Dismissible
                  </label>
                  <label className="nabin-row" style={{ gap: 'var(--space-xxs)', fontSize: 13, fontWeight: 700 }}>
                    <input
                      type="checkbox"
                      checked={message.showOnce}
                      onChange={(e) => setMessage(index, { showOnce: e.target.checked })}
                    />
                    Once per device
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="nabin-row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} className="nabin-btn nabin-btn--ghost" disabled={saving}>
          <X size={16} />
          <span>Close</span>
        </button>
        <button type="submit" className="nabin-btn nabin-btn--primary" disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create campaign' : 'Save changes'}
        </button>
      </div>
      <p className="nabin-cell-meta">
        Saving replaces this campaign&rsquo;s theme, assets, offers and messages in full. Status moves through the state
        buttons so an edit can never publish itself by accident.
      </p>
    </form>
  );
}
