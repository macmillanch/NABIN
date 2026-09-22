// The campaign vocabulary the editor offers as choices. These lists mirror the
// backend's allow-lists and exist only to populate selects: every one of them is
// re-checked by CampaignRepository on save, so drifting here costs an option in the
// console, never a bad row in the database.
export const CAMPAIGN_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export const CAMPAIGN_SERVICE_TYPES = ['RIDE', 'FOOD', 'GROCERY', 'PARCEL'] as const;
export const CAMPAIGN_ASSET_KINDS = [
  'LOGO',
  'WORDMARK',
  'BANNER',
  'PROMOTIONAL_IMAGE',
  'POPUP_BACKGROUND',
  'SPLASH',
  'FAVICON',
] as const;
export const CAMPAIGN_MESSAGE_KINDS = ['ANNOUNCEMENT', 'POPUP', 'INLINE_BANNER', 'TOAST'] as const;
export const CAMPAIGN_TRIGGER_EVENTS = ['APP_OPEN', 'HOME', 'POST_TRIP', 'IDLE', 'CART'] as const;
export const CAMPAIGN_THEME_TOKENS = [
  'brand',
  'brandTint',
  'onBrand',
  'canvas',
  'surface',
  'surfaceMuted',
  'surfaceEmphasized',
  'onSurface',
  'onSurfaceMuted',
  'divider',
  'success',
  'warning',
  'danger',
  'foodAccent',
  'groceryAccent',
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export interface CampaignCoupon {
  code?: string | null;
  name?: string | null;
  discountType?: string | null;
  discountValue?: number | null;
  isActive?: boolean | null;
}

export interface CampaignOffer {
  id?: string;
  serviceType: string;
  promotionId: string;
  copy: string;
  priority: number;
  coupon?: CampaignCoupon | null;
}

export interface CampaignAsset {
  id?: string;
  kind: string;
  url: string;
  altText: string;
  locale: string;
  priority: number;
}

export interface CampaignMessage {
  id?: string;
  kind: string;
  title: string;
  body: string;
  surface: string;
  triggerEvent: string;
  dismissible: boolean;
  showOnce: boolean;
  locale: string;
  priority: number;
}

export interface Campaign {
  id?: string;
  code: string;
  name: string;
  description: string;
  status: string;
  effectiveStatus?: string | null;
  priority: number;
  serviceTypes: string[];
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  theme: { palette: Record<string, string> };
  assets: CampaignAsset[];
  offers: CampaignOffer[];
  messages: CampaignMessage[];
}

export interface PromotionOption {
  id: string;
  code: string;
  name?: string;
  serviceType?: string;
  discountType?: string;
  discountValue?: number;
  isActive?: boolean;
}

/** What the create form starts with: a draft nothing is live until it is published. */
export function newCampaign(): Campaign {
  return {
    code: '',
    name: '',
    description: '',
    status: 'DRAFT',
    priority: 0,
    serviceTypes: [],
    startsAt: null,
    endsAt: null,
    isActive: true,
    theme: { palette: {} },
    assets: [],
    offers: [],
    messages: [],
  };
}

/**
 * Fills every field the form binds to, so no input is ever handed `undefined` (which
 * React treats as "uncontrolled" and stops updating).
 */
export function asCampaign(raw: Partial<Campaign>): Campaign {
  const base = newCampaign();
  return {
    ...base,
    ...raw,
    name: raw.name ?? '',
    code: raw.code ?? '',
    description: raw.description ?? '',
    priority: Number(raw.priority ?? 0),
    serviceTypes: raw.serviceTypes ?? [],
    isActive: raw.isActive !== false,
    theme: { palette: raw.theme?.palette ?? {} },
    assets: (raw.assets ?? []).map((a) => ({
      ...a,
      kind: a.kind ?? 'BANNER',
      url: a.url ?? '',
      altText: a.altText ?? '',
      locale: a.locale ?? 'en',
      priority: Number(a.priority ?? 0),
    })),
    offers: (raw.offers ?? []).map((o) => ({
      ...o,
      serviceType: o.serviceType ?? 'RIDE',
      promotionId: o.promotionId ?? '',
      copy: o.copy ?? '',
      priority: Number(o.priority ?? 0),
    })),
    messages: (raw.messages ?? []).map((m) => ({
      ...m,
      kind: m.kind ?? 'ANNOUNCEMENT',
      title: m.title ?? '',
      body: m.body ?? '',
      surface: m.surface ?? 'CUSTOMER_HOME',
      triggerEvent: m.triggerEvent ?? 'APP_OPEN',
      dismissible: m.dismissible !== false,
      showOnce: m.showOnce === true,
      locale: m.locale ?? 'en',
      priority: Number(m.priority ?? 0),
    })),
  };
}

/**
 * Payload sent to POST/PUT. The whole child set goes every time, because the backend
 * treats a supplied section as a replacement — which is what the form implies.
 */
export function toPayload(campaign: Campaign) {
  return {
    code: campaign.code.trim().toUpperCase(),
    name: campaign.name.trim(),
    description: campaign.description.trim() || null,
    status: campaign.status,
    priority: campaign.priority,
    serviceTypes: campaign.serviceTypes,
    startsAt: toIso(campaign.startsAt),
    endsAt: toIso(campaign.endsAt),
    isActive: campaign.isActive,
    theme: { palette: campaign.theme.palette },
    assets: campaign.assets.map((a) => ({
      kind: a.kind,
      url: a.url.trim(),
      altText: a.altText.trim() || null,
      locale: a.locale || 'en',
      priority: a.priority,
    })),
    offers: campaign.offers.map((o) => ({
      serviceType: o.serviceType,
      promotionId: o.promotionId,
      copy: o.copy.trim() || null,
      priority: o.priority,
    })),
    messages: campaign.messages.map((m) => ({
      kind: m.kind,
      title: m.title.trim(),
      body: m.body.trim(),
      surface: m.surface,
      triggerEvent: m.triggerEvent,
      dismissible: m.dismissible,
      showOnce: m.showOnce,
      locale: m.locale || 'en',
      priority: m.priority,
    })),
  };
}

/**
 * `datetime-local` yields a wall-clock string with no offset. Resolving it here turns
 * "20 Dec, midnight" into one instant the database can compare against its own clock,
 * instead of leaving Node and the browser to guess differently. An unparseable value is
 * passed through so the server can name the field it rejected.
 */
export function toIso(local: string | null): string | null {
  if (!local) return null;
  const parsed = Date.parse(local);
  if (Number.isNaN(parsed)) return local;
  return new Date(parsed).toISOString();
}

export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export const shortDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** The coupon's own terms, spelled the way the apps spell it. */
export function formatDiscount(discountType?: string | null, value?: number | null): string {
  if (!value) return '';
  const amount = value % 1 === 0 ? String(Math.round(value)) : String(value);
  if (discountType === 'PERCENTAGE') return `${amount}% OFF`;
  if (discountType === 'FLAT') return `₹${amount} OFF`;
  return '';
}

export function couponLabel(coupon: { code?: string | null; discountType?: string | null; discountValue?: number | null }): string {
  const terms = formatDiscount(coupon.discountType, coupon.discountValue);
  return terms ? `${coupon.code} — ${terms}` : String(coupon.code ?? '');
}
